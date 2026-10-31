# Changelog

## 0.1.3

Study any language, explain it in yours, and choose the interface language.

### Languages

- **Target language** covers 38 languages and their varieties: eight varieties of English, Japan's and Korea's standard forms, four kinds of Chinese, Latin American and European Spanish, Brazilian and European Portuguese, five varieties of Arabic, and so on. The variety reaches the model, so British spellings, Mexican vocabulary and Tokyo readings stay consistent.
- **Explanation language** is chosen separately: 19 options, from Simplified and Traditional Chinese to English, Japanese, Korean, Arabic, Hindi and Vietnamese. Every explanation, label and translation in an analysis is written in it.
- **Interface language** switches between 简体中文 and English. The interface and the teaching copy are translated independently: an analysis keeps the explanation language it was written in.

### Typography for other scripts

- Each script brings its own type: kana uses a Japanese serif, Han a Chinese one, Hangul a Korean sans, Arabic a Naskh, Devanagari and Thai their own faces, with tracking, leading and hero sizes adjusted per script.
- Right-to-left text follows its own direction inside the sheet, while the layout around it stays put.
- `docs/TYPOGRAPHY.md` records the families, sizes and the direction rule.

### Word lists

- Japanese: JLPT N1 (3,070 words) and N2 (1,778) from OpenJLPT (CC BY-SA 4.0), kept as headword plus kana.
- Chinese: HSK 5 (1,059) and HSK 6 (1,123) from complete-hsk-vocabulary (MIT), kept as headword plus pinyin.
- The desk now groups lists by language, starts on the language you are studying, and shows readings instead of glosses where a list has none.
- `public/wordlists/NOTICE.txt` names every source and licence.

### Downloads

- Android: `LexiGene-android.apk` (Android 8 or later; arm64 and x86_64).
- Windows: the `.exe` installer or standalone `LexiGene.exe`.
- macOS: the universal `.dmg` or `.zip` package.
- Linux: the amd64 `.deb` or `.tar.gz` package.

## 0.1.2

LexiGene can now update itself, and an analysis follows the word you typed instead of the dictionary entry it came from.

### Auto-updates

- Installed desktop apps check for a newer signed release at launch and once a day, then show its notes with **Install Update**, **Remind Me Later** and **Skip This Version**.
- **Update → Check for Updates…** in the menu checks on demand.
- `install.sh` installs the newest signed release, so one command sets up the app and later updates.
- Packages installed by a package manager, such as the Debian package in `/opt`, keep updating through that package manager.

### Analysis accuracy

- The first dimension now receives the queried word's own pronunciation, senses and usage labels alongside its etymology, each attributed to its source headword and section.
- Prompts keep a word distinct from its historical relative: "possibly a variant of" stays a possibility, and the archive describes the word you asked for.
- The etymology story no longer invents a naming reason, and evolution stages follow the evidence, with two allowed when only a source relation is known.
- Several senses of one word are separated by occasion, including slang and derogatory use, before the analysis picks the one to teach.

### Downloads

- Android: `LexiGene-android.apk` (Android 8 or later; arm64 and x86_64).
- Windows: the `.exe` installer or standalone `LexiGene.exe`.
- macOS: the universal `.dmg` or `.zip` package.
- Linux: the amd64 `.deb` or `.tar.gz` package.

Version 0.1.2 is the first signed release with update manifests, so it installs whole; later versions download only what changed.
