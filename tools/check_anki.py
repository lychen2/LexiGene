#!/usr/bin/env python3
"""Validate Anki `.apkg` exports with the real Anki engine.

This is an acceptance check, not a fixture test: it drives the installed Python
`anki` package (the same Rust engine the desktop app uses) to import a package
into a throwaway Collection, then inspects the imported notes/cards, rendered
templates and Chinese text. It also re-imports the same package to prove the
stable GUIDs prevent duplicates, and can import an updated package to prove
notes are updated in place instead of duplicated.

Requirements (kept outside the project dependency tree):

    cd artifacts/anki-check
    UV_CACHE_DIR="$PWD/.uv-cache" uv venv .venv
    UV_CACHE_DIR="$PWD/.uv-cache" uv pip install --python .venv/bin/python anki

Usage:

    artifacts/anki-check/.venv/bin/python tools/check_anki.py artifacts/resent.apkg

Optional update checks accept `--updated package.apkg`. The updated package
must reuse the baseline GUIDs, revise every existing Back field, and add one
note. See --help for the expected update marker and new note fields.

Every temporary collection lives under `artifacts/anki-check/tmp/` and is kept
for inspection. Nothing is deleted recursively; only stdout evidence is
produced otherwise.

Exit codes: 0 = all checks passed, 1 = a check failed, 2 = environment error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
HTML = re.compile(r"<\s*/?\s*([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>")
ENTITY = re.compile(r"&(?:amp|lt|gt|quot|apos|nbsp|#39|#x[0-9a-fA-F]+|#\d+);")
UNSAFE = re.compile(r"<\s*script|javascript:|onerror\s*=|onclick\s*=", re.IGNORECASE)
CONTROL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]")
# Only <br> is produced by the exporter (src/lib/cards.ts textToHtml).
ALLOWED_TAGS = {"br"}

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "anki-check"
TMP_ROOT = ARTIFACT_ROOT / "tmp"

# Defaults matching artifacts/anki-check/make-updated-apkg.mjs.
DEFAULT_UPDATE_MARKER = "Updated: 修订版"
DEFAULT_NEW_FRONT = "resent the fact that"


@dataclass
class Checks:
    results: list[tuple[bool, str, str]] = field(default_factory=list)

    def check(self, ok: bool, name: str, detail: str = "") -> bool:
        self.results.append((bool(ok), name, detail))
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
        return bool(ok)

    def eq(self, actual, expected, name: str) -> bool:
        return self.check(actual == expected, name, f"expected {expected!r}, got {actual!r}")

    @property
    def failed(self) -> int:
        return sum(1 for ok, _, _ in self.results if not ok)


def load_anki():
    try:
        import anki.buildinfo  # noqa: F401
        from anki.collection import Collection
        from anki.import_export_pb2 import ImportAnkiPackageOptions, ImportAnkiPackageRequest
    except ImportError as error:  # pragma: no cover - environment guard
        print(f"ERROR: Python `anki` package is not importable: {error}", file=sys.stderr)
        print("Install it inside artifacts/anki-check, e.g.:", file=sys.stderr)
        print(
            '  cd artifacts/anki-check && UV_CACHE_DIR="$PWD/.uv-cache" uv venv .venv '
            '&& UV_CACHE_DIR="$PWD/.uv-cache" uv pip install --python .venv/bin/python anki',
            file=sys.stderr,
        )
        raise SystemExit(2)
    try:
        package_version = version("anki")
    except PackageNotFoundError:  # pragma: no cover - editable installs
        package_version = "unknown"
    return Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest, package_version


def make_collection(Collection, prefix: str):
    """Create a Collection in a fresh directory under artifacts/anki-check/tmp."""
    TMP_ROOT.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(dir=TMP_ROOT, prefix=f"check-{prefix}-"))
    collection = Collection(str(directory / "collection.anki2"))
    return collection, directory


def import_package(collection, request_cls, options_cls, path: Path):
    request = request_cls(package_path=str(path), options=options_cls())
    return collection.import_anki_package(request)


def describe_log(log) -> dict[str, int]:
    return {
        "found_notes": log.found_notes,
        "new": len(log.new),
        "updated": len(log.updated),
        "duplicate": len(log.duplicate),
        "conflicting": len(log.conflicting),
        "missing_notetype": len(log.missing_notetype),
        "missing_deck": len(log.missing_deck),
        "empty_first_field": len(log.empty_first_field),
    }


@dataclass
class NoteView:
    nid: int
    guid: str
    type_name: str
    fields: list[str]
    tags: list[str]
    decks: list[str]
    card_ids: list[int]


def read_notes(collection) -> list[NoteView]:
    views = []
    for nid in collection.find_notes(""):
        note = collection.get_note(nid)
        notetype = collection.models.get(note.mid)
        card_ids = list(note.card_ids())
        decks = sorted({collection.decks.name(collection.get_card(cid).did) for cid in card_ids})
        views.append(
            NoteView(
                nid=int(nid),
                guid=note.guid,
                type_name=notetype["name"] if notetype else f"<missing mid {note.mid}>",
                fields=list(note.fields),
                tags=list(note.tags),
                decks=decks,
                card_ids=[int(cid) for cid in card_ids],
            )
        )
    return views


def inspect_content(collection, notes: list[NoteView], checks: Checks, label: str) -> dict:
    """Structural, text and rendering checks shared by every imported package."""
    print(f"\n[{label}] content")
    all_fields = [value for view in notes for value in view.fields]
    joined = "\n".join(all_fields)
    tags = [tag for view in notes for tag in view.tags]

    checks.check(bool(notes), "imported at least one note", f"{len(notes)} notes")
    checks.eq(len(notes), collection.note_count(), "note_count() matches scanned notes")
    checks.check(collection.card_count() >= len(notes), "card_count() >= note_count", f"{collection.card_count()} cards")

    checks.check(all(len(view.fields) == 2 for view in notes), "every note has exactly two fields")
    checks.check(all(view.fields[0].strip() for view in notes), "every note has a non-empty Front")
    checks.check(all(len(view.card_ids) >= 1 for view in notes), "every note generated at least one card")
    checks.check(len({view.guid for view in notes}) == len(notes), "note GUIDs are unique", f"{len(notes)} GUIDs")
    checks.check(
        "\x00" not in joined and not CONTROL.search(joined),
        "no NUL / forbidden control characters in fields",
    )
    checks.check(not UNSAFE.search(joined), "no raw script/handler payloads in fields")
    checks.check(all("apiKey" not in view.fields[1] and "Authorization" not in view.fields[1] for view in notes),
                 "no credential markers in note fields")

    han_notes = [view for view in all_fields if HAN.search(view)]
    checks.check(len(han_notes) >= 1, "Chinese (Han) text present in fields", f"{len(han_notes)} field(s)")
    checks.check("把那份不公平" in joined or "resent" in joined, "expected vocabulary content present")

    br_notes = [value for value in all_fields if "<br>" in value]
    checks.check(len(br_notes) >= 1, "line breaks encoded as <br>", f"{len(br_notes)} field(s)")
    entities = sorted({match for match in ENTITY.findall(joined)})
    checks.check(bool(entities), "HTML entities escaped", ", ".join(entities) or "none")
    tags_found = sorted({tag.lower() for tag in HTML.findall(joined)})
    checks.check(set(tags_found) <= ALLOWED_TAGS, "field markup limited to <br>", f"tags: {tags_found}")

    types = sorted({view.type_name for view in notes})
    decks = sorted({deck for view in notes for deck in view.decks})
    checks.check(bool(decks), "notes belong to a deck", ", ".join(decks))
    print(f"  notetypes: {types}")
    print(f"  decks: {decks}")
    print(f"  tags: {sorted(set(tags))}")

    # Render through the real card templates so the check is not just raw SQLite text.
    rendered = []
    for view in notes:
        for cid in view.card_ids:
            card = collection.get_card(cid)
            rendered.append((view, card.question(), card.answer()))
    checks.check(bool(rendered) and all(question.strip() for _, question, _ in rendered),
                 "templates render non-empty questions", f"{len(rendered)} rendered")
    checks.check(all(answer.strip() for _, _, answer in rendered), "templates render non-empty answers")

    rendered_answers = [answer for _, _, answer in rendered]
    chinese_rendered = [answer for answer in rendered_answers if HAN.search(answer)]
    checks.check(bool(chinese_rendered), "Chinese text reaches the rendered answer",
                 f"{len(chinese_rendered)}/{len(rendered_answers)} answers")
    br_rendered = [answer for answer in rendered_answers if "<br>" in answer]
    checks.check(bool(br_rendered), "rendered answers keep <br> line breaks",
                 f"{len(br_rendered)}/{len(rendered_answers)} answers")

    sample = next((view for view in notes if HAN.search(view.fields[1])), notes[0])
    card = collection.get_card(sample.card_ids[0])
    print(f"  sample note {sample.nid} [{sample.type_name}] deck={collection.decks.name(card.did)}")
    print(f"  front: {sample.fields[0][:120]!r}")
    print(f"  back:  {sample.fields[1][:200]!r}")
    print(f"  rendered answer: {card.answer()[:220]!r}")

    return {
        "notes": len(notes),
        "cards": collection.card_count(),
        "notetypes": types,
        "decks": decks,
        "tags": sorted(set(tags)),
        "note_ids": [view.nid for view in notes],
        "guids": [view.guid for view in notes],
    }


def run_package_checks(args) -> tuple[bool, dict]:
    Collection, Options, Request, package_version = load_anki()
    checks = Checks()
    report: dict = {
        "anki_package_version": package_version,
        "python": sys.version.split()[0],
    }

    baseline = Path(args.package).resolve()
    updated = Path(args.updated).resolve() if args.updated else None
    for path in [baseline] + ([updated] if updated else []):
        if not path.is_file():
            print(f"ERROR: package not found: {path}", file=sys.stderr)
            raise SystemExit(2)

    print(f"anki python package: {package_version}")
    print(f"python: {sys.version.split()[0]}")
    print(f"baseline: {baseline} ({baseline.stat().st_size} bytes)")
    report["baseline"] = {
        "path": str(baseline),
        "bytes": baseline.stat().st_size,
    }
    if updated:
        print(f"updated:  {updated} ({updated.stat().st_size} bytes)")
        report["updated"] = {
            "path": str(updated),
            "bytes": updated.stat().st_size,
        }

    # 1. Fresh import of the browser-exported package.
    collection, directory = make_collection(Collection, "baseline")
    try:
        started = time.monotonic()
        log = import_package(collection, Request, Options, baseline)
        elapsed = time.monotonic() - started
        summary = describe_log(log.log)
        print(f"\n[baseline] import into {directory} took {elapsed:.2f}s: {summary}")
        report["baseline"]["import"] = summary
        checks.eq(summary["new"], summary["found_notes"], "first import created every found note")
        checks.eq(summary["duplicate"], 0, "first import had no duplicates")
        checks.check(summary["missing_notetype"] == 0, "notetype present", f"missing: {summary['missing_notetype']}")
        checks.check(summary["missing_deck"] == 0, "deck present", f"missing: {summary['missing_deck']}")

        notes = read_notes(collection)
        baseline_info = inspect_content(collection, notes, checks, "baseline")
        report["baseline"]["imported"] = baseline_info
        if args.expect_notes is not None:
            checks.eq(len(notes), args.expect_notes, "note count matches --expect-notes")

        # 2. Re-import the same package: GUIDs must dedupe, nothing new.
        print("\n[baseline] re-import same package")
        log2 = import_package(collection, Request, Options, baseline)
        summary2 = describe_log(log2.log)
        print(f"  import log: {summary2}")
        report["baseline"]["reimport"] = summary2
        checks.eq(summary2["new"], 0, "re-import added no notes")
        checks.eq(summary2["updated"], 0, "re-import changed no notes")
        checks.eq(summary2["duplicate"], len(notes), "re-import detected every note as duplicate")
        checks.eq(collection.note_count(), len(notes), "note count unchanged after re-import")
        checks.eq(collection.card_count(), baseline_info["cards"], "card count unchanged after re-import")
    finally:
        collection.close()

    # 3. Updated artifact: same GUIDs edited, plus one new note.
    if updated:
        collection, directory = make_collection(Collection, "updated")
        try:
            first = import_package(collection, Request, Options, baseline)
            print(f"\n[updated] baseline import into {directory}: {describe_log(first.log)}")
            notes_before = read_notes(collection)
            before_guids = {view.guid for view in notes_before}
            before_backs = {view.guid: view.fields[1] for view in notes_before}

            log3 = import_package(collection, Request, Options, updated)
            summary3 = describe_log(log3.log)
            print(f"[updated] updated package import: {summary3}")
            report["updated"]["import"] = summary3
            total = collection.note_count()
            checks.eq(summary3["duplicate"], 0, "updated import created no duplicates")
            checks.check(summary3["updated"] >= 1, "updated import updated existing notes", f"{summary3['updated']} updated")
            checks.check(summary3["new"] >= 1, "updated import added the new note", f"{summary3['new']} new")
            checks.eq(total, len(notes_before) + summary3["new"], "note count grows only by new notes")
            checks.eq(collection.card_count(), total, "one card per note after update")

            notes_after = read_notes(collection)
            after_guids = {view.guid for view in notes_after}
            checks.eq(len(after_guids), total, "GUIDs stay unique after update")
            checks.check(before_guids <= after_guids, "every original GUID is retained",
                         f"missing: {sorted(before_guids - after_guids)}")
            marker_notes = [view for view in notes_after if args.update_marker in view.fields[1]]
            checks.eq(len(marker_notes), len(before_guids), "all original notes carry the updated content")
            changed = [
                view.guid for view in notes_after
                if view.guid in before_backs and view.fields[1] != before_backs[view.guid]
            ]
            checks.eq(len(changed), len(before_guids), "original note fields changed in place")
            new_notes = [view for view in notes_after if view.guid not in before_guids]
            checks.check(
                any(args.new_front in view.fields[0] or view.fields[0] == args.new_front for view in new_notes),
                "new note present",
                f"fronts: {[view.fields[0] for view in new_notes]}",
            )
            checks.check(all(HAN.search(view.fields[1]) for view in new_notes), "new note keeps Chinese text")
            rendered = [
                collection.get_card(view.card_ids[0]).answer()
                for view in marker_notes if view.card_ids
            ]
            checks.check(all(args.update_marker in answer for answer in rendered),
                         "updated Chinese text reaches rendered answers", f"{len(rendered)} answers")

            # 4. Re-import the updated package: still no duplicate growth.
            log4 = import_package(collection, Request, Options, updated)
            summary4 = describe_log(log4.log)
            print(f"[updated] re-import updated package: {summary4}")
            report["updated"]["reimport"] = summary4
            checks.eq(summary4["new"], 0, "re-import of updated package added no notes")
            checks.eq(collection.note_count(), total, "note count unchanged after updated re-import")

            report["updated"]["imported"] = inspect_content(collection, notes_after, checks, "updated")
        finally:
            collection.close()

    print("\n" + "=" * 72)
    print(f"checks passed: {len(checks.results) - checks.failed}/{len(checks.results)}; failed: {checks.failed}")
    report["checks"] = {
        "total": len(checks.results),
        "failed": checks.failed,
        "failures": [name for ok, name, _ in checks.results if not ok],
    }
    return checks.failed == 0, report


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import and validate an Anki .apkg with the real Anki engine.")
    parser.add_argument("package", help="path to the browser-exported .apkg")
    parser.add_argument("--updated", help="optional updated .apkg with the same GUIDs plus new notes")
    parser.add_argument("--expect-notes", type=int, help="assert the baseline package imports exactly this many notes")
    parser.add_argument("--update-marker", default=DEFAULT_UPDATE_MARKER, help="Back-field marker proving an update applied")
    parser.add_argument("--new-front", default=DEFAULT_NEW_FRONT, help="Front field of the note added by the updated package")
    parser.add_argument("--json-out", help="write the evidence report as JSON to this path")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    # Keep Anki backend scratch files inside the assigned artifacts folder.
    TMP_ROOT.mkdir(parents=True, exist_ok=True)
    os.environ["TMPDIR"] = str(TMP_ROOT)

    ok, report = run_package_checks(args)
    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"json report: {out}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
