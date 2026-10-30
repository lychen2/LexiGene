# Changelog

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
