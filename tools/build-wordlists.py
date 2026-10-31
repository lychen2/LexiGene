#!/usr/bin/env python3
"""Build LexiGene's goal word lists from ECDICT.

ECDICT (https://github.com/skywind3000/ECDICT, MIT) tags every entry with the
exams it belongs to. LexiGene keeps only what reading alone rarely teaches: the
CET-4 band and everyday high-frequency vocabulary are removed, inflected forms
and abbreviations are dropped, and each list is sorted from the words a learner
is most likely to meet down to the rare ones.

Usage:
    python3 tools/build-wordlists.py [--csv PATH] [--out DIR] [--download]

Writes one JSON file per exam plus index.json. The output is committed so a
build needs no network and no 66 MB corpus.
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import re
import sys
import urllib.request

SOURCE_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
SOURCE_NAME = "ECDICT"

GOALS = [
    ("kaoyan", "考研", "ky", "硕士研究生入学考试大纲词汇，去掉四级及以下"),
    ("ielts", "雅思", "ielts", "雅思常见词汇，去掉四级及以下"),
    ("toefl", "托福", "toefl", "托福常见词汇，去掉四级及以下"),
    ("gre", "GRE", "gre", "GRE 常见词汇，去掉四级及以下"),
]

# Frequency bands, by COCA rank. Reading absorbs the first band on its own,
# which is why the lists start above it.
COMMON_RANK = 4000        # top of everyday reading vocabulary: dropped
BANDS = [(12_000, "少见"), (20_000, "较难"), (10**9, "罕见")]

GLOSS_LIMIT = 30
WORD_RE = re.compile(r"[a-z][a-z' -]{1,40}")
POS_PREFIX = re.compile(r"^(?:[a-zA-Z]{1,5}\.\s*)+")
BRACKETS = re.compile(r"\[[^\]]*\]")


def first_gloss(translation: str) -> str:
    """The first sense in one short line, without part-of-speech noise."""
    # ECDICT separates senses with the two characters backslash-n.
    line = translation.replace("\\n", "\n").split("\n")[0].strip()
    line = POS_PREFIX.sub("", line)
    line = BRACKETS.sub("", line)
    line = re.split(r"[；;]", line)[0].strip(" ，,")
    line = re.sub(r"\s+", " ", line)
    if len(line) > GLOSS_LIMIT:
        line = line[:GLOSS_LIMIT].rstrip(" ，,") + "…"
    return line


def is_inflection(exchange: str) -> bool:
    """ECDICT marks derived forms as 0:lemma."""
    return any(part.startswith("0:") for part in exchange.split("/") if part)


def rarity(frequency: int) -> tuple[int, str]:
    for index, (limit, label) in enumerate(BANDS):
        if frequency <= limit:
            return index, label
    return len(BANDS), "罕见"


def load(csv_path: pathlib.Path, download: bool) -> pathlib.Path:
    if csv_path.exists():
        return csv_path
    if not download:
        sys.exit(f"missing {csv_path}; run with --download to fetch ECDICT once")
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {SOURCE_URL}")
    urllib.request.urlretrieve(SOURCE_URL, csv_path)
    return csv_path


def usable(row: dict[str, str]) -> bool:
    word = row["word"]
    if word != word.lower() or not WORD_RE.fullmatch(word):
        return False
    if len(word) < 3 or is_inflection(row["exchange"] or ""):
        return False
    if row["oxford"] == "1":          # Oxford 3000: everyday reading vocabulary
        return False
    if row["collins"] in {"4", "5"}:  # very common in general English
        return False
    try:
        frequency = int(row["frq"] or 0)
    except ValueError:
        frequency = 0
    return not (0 < frequency <= COMMON_RANK)


def build(csv_path: pathlib.Path, out: pathlib.Path) -> dict:
    entries: dict[str, dict] = {}
    cet4: set[str] = set()
    with csv_path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            word = row["word"].strip()
            tags = set((row["tag"] or "").split())
            if "cet4" in tags:
                cet4.add(word)
            if not tags & {"ky", "ielts", "toefl", "gre", "cet6"}:
                continue
            if not usable(row):
                continue
            gloss = first_gloss(row["translation"] or "")
            if not gloss:
                continue
            try:
                frequency = int(row["frq"] or 0)
            except ValueError:
                frequency = 0
            entries[word] = {"w": word, "p": (row["phonetic"] or "").strip(), "z": gloss, "f": frequency, "tags": tags}

    print(f"ECSDICT entries kept: {len(entries)}; CET-4 band: {len(cet4)}")
    out.mkdir(parents=True, exist_ok=True)
    index = {"source": SOURCE_NAME, "sourceUrl": "https://github.com/skywind3000/ECDICT",
             "license": "MIT", "excluded": {"label": "四级及以下与日常高频词"}, "goals": []}
    for slug, label, tag, description in GOALS:
        picked = [entry for word, entry in entries.items() if tag in entry["tags"] and word not in cet4]
        picked.sort(key=lambda entry: (entry["f"] == 0, entry["f"], entry["w"]))
        rows = []
        for entry in picked:
            band, band_label = rarity(entry["f"])
            rows.append({"w": entry["w"], "p": entry["p"], "z": entry["z"], "b": band, "bl": band_label})
        payload = {"goal": slug, "label": label, "description": description, "count": len(rows), "words": rows}
        (out / f"{slug}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        size = (out / f"{slug}.json").stat().st_size
        index["goals"].append({"slug": slug, "label": label, "description": description, "count": len(rows), "bytes": size})
        print(f"  {label:5} {len(rows):5} words  {size / 1024:6.0f} KB")
    # Hand-written expressions are kept as they are; the index only lists them.
    expressions = out / "idioms.json"
    if expressions.exists():
        payload = json.loads(expressions.read_text(encoding="utf-8"))
        index["goals"].insert(0, {"slug": "idioms", "label": payload["label"],
                                  "description": payload["description"], "count": len(payload["words"]),
                                  "bytes": expressions.stat().st_size})
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return index


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=pathlib.Path, default=pathlib.Path("artifacts/ecdict/ecdict.csv"))
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("public/wordlists"))
    parser.add_argument("--download", action="store_true", help="fetch ECDICT when the CSV is missing")
    args = parser.parse_args()
    build(load(args.csv, args.download), args.out)


if __name__ == "__main__":
    main()
