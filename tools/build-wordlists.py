#!/usr/bin/env python3
"""Build LexiGene's goal word lists.

Three sources, one shape. Only what reading alone rarely teaches is kept:

- English exams (考研 / 雅思 / 托福 / GRE) from ECDICT (MIT). The CET-4 band,
  everyday high-frequency words, inflected forms and proper nouns are removed.
- Japanese levels (JLPT N1 / N2) from OpenJLPT (CC BY-SA 4.0, built on JMdict,
  KANJIDIC2 and Jonathan Waller's lists). Kept as word + kana reading.
- Chinese levels (HSK 5 / 6) from complete-hsk-vocabulary (MIT). Kept as
  word + pinyin.

Usage:
    python3 tools/build-wordlists.py [--out DIR] [--download] [--only en,ja,zh]

Output is committed, so a build needs no network and no corpus on disk.
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import re
import sys
import urllib.request

CACHE = pathlib.Path("artifacts/wordlists-src")
ECDICT_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
JLPT_URL = "https://raw.githubusercontent.com/evanclan/OpenJLPT/main/data/json/vocab/{level}.json"
HSK_URL = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/wordlists/exclusive/new/{level}.min.json"

COMMON_RANK = 4000          # top of everyday reading vocabulary: dropped
GLOSS_LIMIT = 30
WORD_RE = re.compile(r"[a-z][a-z' -]{1,40}")
POS_PREFIX = re.compile(r"^(?:[a-zA-Z]{1,5}\.\s*)+")
BRACKETS = re.compile(r"\[[^\]]*\]")

EN_GOALS = [
    ("kaoyan", "考研", "ky", "硕士研究生入学考试大纲词汇，去掉四级及以下", "ECDICT", "MIT"),
    ("ielts", "雅思", "ielts", "雅思常见词汇，去掉四级及以下", "ECDICT", "MIT"),
    ("toefl", "托福", "toefl", "托福常见词汇，去掉四级及以下", "ECDICT", "MIT"),
    ("gre", "GRE", "gre", "GRE 常见词汇，去掉四级及以下", "ECDICT", "MIT"),
]
JA_GOALS = [("ja-n1", "JLPT N1", "N1", "日本语能力测试 N1 词汇"), ("ja-n2", "JLPT N2", "N2", "日本语能力测试 N2 词汇")]
ZH_GOALS = [("zh-hsk5", "HSK 5", "5", "HSK 5 级词汇"), ("zh-hsk6", "HSK 6", "6", "HSK 6 级词汇")]

BANDS = [(12_000, "少见"), (20_000, "较难"), (10**9, "罕见")]


def download(url: str, target: pathlib.Path, allow: bool) -> pathlib.Path:
    if target.exists():
        return target
    if not allow:
        sys.exit(f"missing {target}; run once with --download")
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    urllib.request.urlretrieve(url, target)
    return target


def first_gloss(translation: str) -> str:
    line = translation.replace("\\n", "\n").split("\n")[0].strip()
    line = POS_PREFIX.sub("", line)
    line = BRACKETS.sub("", line)
    line = re.split(r"[；;]", line)[0].strip(" ，,")
    line = re.sub(r"\s+", " ", line)
    if len(line) > GLOSS_LIMIT:
        line = line[:GLOSS_LIMIT].rstrip(" ，,") + "…"
    return line


def is_inflection(exchange: str) -> bool:
    return any(part.startswith("0:") for part in exchange.split("/") if part)


def rarity(frequency: int) -> tuple[int, str]:
    for index, (limit, label) in enumerate(BANDS):
        if frequency <= limit:
            return index, label
    return len(BANDS), "罕见"


def usable(row: dict[str, str]) -> bool:
    word = row["word"]
    if word != word.lower() or not WORD_RE.fullmatch(word):
        return False
    if len(word) < 3 or is_inflection(row["exchange"] or ""):
        return False
    if row["oxford"] == "1" or row["collins"] in {"4", "5"}:
        return False
    try:
        frequency = int(row["frq"] or 0)
    except ValueError:
        frequency = 0
    return not (0 < frequency <= COMMON_RANK)


def english(csv_path: pathlib.Path) -> list[dict]:
    entries: dict[str, dict] = {}
    cet4: set[str] = set()
    with csv_path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            word = row["word"].strip()
            tags = set((row["tag"] or "").split())
            if "cet4" in tags:
                cet4.add(word)
            if not tags & {"ky", "ielts", "toefl", "gre", "cet6"} or not usable(row):
                continue
            gloss = first_gloss(row["translation"] or "")
            if not gloss:
                continue
            try:
                frequency = int(row["frq"] or 0)
            except ValueError:
                frequency = 0
            entries[word] = {"w": word, "p": (row["phonetic"] or "").strip(), "z": gloss, "f": frequency, "tags": tags}

    goals = []
    for slug, label, tag, description, source, license_name in EN_GOALS:
        picked = [entry for word, entry in entries.items() if tag in entry["tags"] and word not in cet4]
        picked.sort(key=lambda entry: (entry["f"] == 0, entry["f"], entry["w"]))
        rows = []
        for entry in picked:
            band, band_label = rarity(entry["f"])
            rows.append({"w": entry["w"], "p": entry["p"], "z": entry["z"], "b": band, "bl": band_label})
        goals.append({"slug": slug, "label": label, "lang": "en", "description": description,
                      "source": source, "license": license_name, "words": rows,
                      "sourceUrl": "https://github.com/skywind3000/ECDICT"})
    return goals


def japanese(allow_download: bool) -> list[dict]:
    goals = []
    for slug, label, level, description in JA_GOALS:
        path = download(JLPT_URL.format(level=level.lower()), CACHE / f"jlpt-{level.lower()}.json", allow_download)
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = []
        seen: set[str] = set()
        for item in data:
            word = (item.get("word") or "").strip()
            if not word or word in seen:
                continue
            seen.add(word)
            reading = (item.get("reading") or "").strip()
            # A kana-only headword reads as itself; showing it twice is noise.
            row = {"w": word, "b": 0, "bl": label}
            if reading and reading != word:
                row["p"] = reading
            rows.append(row)
        goals.append({"slug": slug, "label": label, "lang": "ja", "description": description,
                      "source": "OpenJLPT", "license": "CC BY-SA 4.0", "words": rows,
                      "sourceUrl": "https://github.com/evanclan/OpenJLPT"})
    return goals


def chinese(allow_download: bool) -> list[dict]:
    goals = []
    for slug, label, level, description in ZH_GOALS:
        path = download(HSK_URL.format(level=level), CACHE / f"hsk-{level}.json", allow_download)
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = []
        seen: set[str] = set()
        for item in data:
            word = (item.get("s") or "").strip()
            if not word or word in seen:
                continue
            seen.add(word)
            pinyin = ""
            for form in item.get("f", []):
                pinyin = (form.get("i", {}).get("y") or "").strip()
                if pinyin:
                    break
            rows.append({"w": word, "p": pinyin, "b": 0, "bl": label})
        goals.append({"slug": slug, "label": label, "lang": "zh", "description": description,
                      "source": "complete-hsk-vocabulary", "license": "MIT", "words": rows,
                      "sourceUrl": "https://github.com/drkameleon/complete-hsk-vocabulary"})
    return goals


def write(goals: list[dict], out: pathlib.Path, index: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for goal in goals:
        payload = {key: goal[key] for key in ("slug", "label", "lang", "description", "source", "license")}
        payload["sourceUrl"] = goal.get("sourceUrl", "https://github.com/skywind3000/ECDICT")
        # Normalise the field names the app reads.
        payload["goal"] = goal["slug"]
        payload["count"] = len(goal["words"])
        payload["words"] = goal["words"]
        path = out / f"{goal['slug']}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index["goals"].append({"slug": goal["slug"], "label": goal["label"], "lang": goal["lang"],
                               "description": goal["description"], "count": payload["count"],
                               "bytes": path.stat().st_size, "source": goal["source"], "license": goal["license"]})
        print(f"  {goal['label']:10} {payload['count']:5} words  {path.stat().st_size / 1024:6.0f} KB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=pathlib.Path, default=pathlib.Path("artifacts/ecdict/ecdict.csv"))
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("public/wordlists"))
    parser.add_argument("--download", action="store_true", help="fetch missing sources once")
    parser.add_argument("--only", default="en,ja,zh", help="comma separated subsets: en,ja,zh")
    args = parser.parse_args()

    index: dict = {
        "sources": [
            {"name": "ECDICT", "url": "https://github.com/skywind3000/ECDICT", "license": "MIT"},
            {"name": "OpenJLPT", "url": "https://github.com/evanclan/OpenJLPT", "license": "CC BY-SA 4.0"},
            {"name": "complete-hsk-vocabulary", "url": "https://github.com/drkameleon/complete-hsk-vocabulary", "license": "MIT"},
        ],
        "excluded": {"label": "四级及以下与日常高频词"},
        "goals": [],
    }
    wanted = {part.strip() for part in args.only.split(",")}

    # Hand-written expressions are English-only and are indexed, not generated.
    expressions = args.out / "idioms.json"
    if expressions.exists():
        payload = json.loads(expressions.read_text(encoding="utf-8"))
        index["goals"].append({"slug": "idioms", "label": payload["label"], "lang": "en",
                               "description": payload["description"], "count": len(payload["words"]),
                               "bytes": expressions.stat().st_size, "source": "LexiGene", "license": "MIT"})

    if "en" in wanted:
        csv_path = download(ECDICT_URL, args.csv, args.download)
        write(english(csv_path), args.out, index)
    if "ja" in wanted:
        write(japanese(args.download), args.out, index)
    if "zh" in wanted:
        write(chinese(args.download), args.out, index)

    (args.out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote index.json")


if __name__ == "__main__":
    main()
