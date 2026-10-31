# Development and build guide

[Back to the project overview](../README.md)

## Start the learning desk

Build tools require Go 1.27.3 and Node.js 22.12+ with npm. The installed desktop application runs Go and MyGo without a Node server.

```sh
npm ci
npm run dev
```

This opens the MyGo development window with the Vite frontend. Linux requires GTK 3 and WebKitGTK 4.1.

For the browser preview:

```sh
npm run build:web
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The Go service binds to loopback and forwards model requests to your configured provider.

Build desktop packages with `npm run build`. Outputs appear under `build/<platform>/`.

```sh
npm run build:all
```

Cross-building produces Linux amd64, Windows amd64, and a universal macOS application. Creating a macOS DMG requires macOS; a Windows installer requires NSIS.

The Linux executable is `build/linux-amd64/lexigene`. Its `.deb` and `.tar.gz` packages are generated alongside it.

`tools/run-go.mjs` keeps Go modules, build caches, and temporary files inside `artifacts/`.

## Goal word lists

`tools/build-wordlists.py` writes the goal lists into `public/wordlists/` from three sources: ECDICT (English exams, a 66 MB CSV fetched once into `artifacts/ecdict/`), OpenJLPT (JLPT N1/N2), and complete-hsk-vocabulary (HSK 5/6). Downloaded sources are cached under `artifacts/wordlists-src/`. Run it with `--download` on a machine that has no copy yet.

The generator drops words tagged `cet4`, Oxford-3000 entries, Collins 4–5 words, everything within the 4,000 most frequent words, inflected forms (`0:` in ECDICT's `exchange` column), proper nouns and anything under three letters. Exam tagging then splits what is left into 考研 (`ky`), 雅思 (`ielts`), 托福 (`toefl`) and GRE (`gre`). `idioms.json` is hand-written and only indexed by the generator.

`tools/prerender.mjs` copies `public/wordlists/` into `dist/`, because `vite.config.ts` sets `publicDir: false`. A list reaches the browser only when its tab is opened.

## Interface locale

`src/lib/i18n.ts` holds the interface strings keyed by their Chinese source text; `t()` returns the source when a key is missing, so a gap stays readable. `src/lib/prefs.ts` stores the studied language, variety, explanation language and interface locale in `localStorage` under `lexigene.prefs`, apart from API credentials.

## Motion

`src/lib/motion.ts` provides `revealOnScroll`, which adds `is-revealed` to `[data-reveal]` elements once, and `inkBurst`, a short canvas burst for a completed practice attempt. Both return immediately under `prefers-reduced-motion`. Timing tokens (`--ease`, `--spring`, `--dur-1..3`) live in `src/app/globals.css`; `DESIGN.md` explains what may move and why.

## Auto-updates

Desktop builds carry signed update manifests. `mygo.json` names the signing key's public half in `updates.publicKey` and the release repository in `updates.github`; `MYGO_UPDATER_PRIVATE_KEY` holds the private half when building, and the `MYGO_UPDATER_PRIVATE_KEY` repository secret holds it in CI.

Keep `~/.config/mygo/update-keys/mygo-update.key` outside the repository, in a password manager and in CI secrets. Installed apps accept only updates signed with it, so losing it strands every installation.

Each release's notes come from the matching `## <version>` section of `CHANGELOG.md`. Publish those notes before publishing the release, because the update window displays them.

MyGo writes the Linux archives even without a key, but the update manifests need it: `MYGO_UPDATER_PRIVATE_KEY="$(cat path/to/mygo-update.key)" npm run build` adds `update-<platform>.json` and signed archives.

## Automated builds and releases

GitHub Actions runs TypeScript, unit, Go, and browser checks on pushes and pull requests. Successful verification starts platform packaging jobs:

- Ubuntu: Linux amd64 executable, Debian package, and tarball.
- macOS: universal application, ZIP archive, and DMG.
- Windows: amd64 executable and NSIS installer.
- Android: signed APK with the bundled Go service for arm64 devices and x86_64 emulators.

Download packages from the workflow's **Artifacts** section. Version tags such as `v0.1.2` also publish packages to GitHub Releases.
Before tagging, align the versions in `package.json`, `package-lock.json`, `mygo.json`, and `main.go`.
Increase the default Android version code in `tools/build-android.mjs` for each release.
Version 0.1.2 uses version code 3.

```sh
git tag -a v0.1.2 -m "LexiGene v0.1.2"
git push origin v0.1.2
```

The workflow uses pinned action commits and the Go version from `go.mod`. Desktop packages still lack platform code signatures, so macOS Gatekeeper and Windows SmartScreen may warn; update archives carry their own signatures instead.

APKs are signed with a generated key unless `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` secrets hold your release key. Keep one signing key for every published version: Android refuses to install an update signed by a different key.

## Android

The APK runs the same React desk and the same Go API inside a native WebView shell. A bundled Go service listens on `127.0.0.1:47821`, serves the pre-rendered pages, and forwards model requests. No Node process, account, or remote server is involved.

Install `build/android/LexiGene-android.apk` from the workflow artifact. Model settings, history, drafts, and attempts stay in the app's own storage. JSON transfer moves a complete analysis between the desktop, browser, and Android applications.

Exports use Android's file picker. Choose a folder for `.json`, `.tsv`, or `.apkg` files, then import the deck in AnkiDroid or Anki.

Building locally needs Java 17, Python 3, the Android SDK with build-tools, and no Gradle:

```sh
npm run build:android
```

Set `ANDROID_HOME` when the SDK is not at `~/Android/Sdk`. The script builds both ABIs, compiles resources with `aapt2`, dexes with `d8`, and signs the result.

Android service builds use the `headless` Go tag to exclude desktop dependencies. Both bundled programs are static executables, so they need no Linux dynamic loader or shared libraries. The `.so` filename lets Android extract each program into the installed application's native library directory.

The build verifies the signed APK before upload. Tagged releases verify the downloaded APK again before publication. Each check requires nonempty dex, frontend, and service entries for both ABIs. It also checks ELF architectures and rejects dynamic loader or shared-library dependencies.

The x86_64 APK is tested on an Android 15 emulator. Physical arm64-device testing remains pending.

## Connect your model

1. Open **模型设置** in the top bar.
2. Enter your provider's API Base URL and API Key.
3. Select **拉取模型**, then choose a model from the list. You can also enter a model ID manually.
4. Select **测试连接**, then **保存设置**.
5. Enter one word or expression and select **开始解剖**.

For OpenAI, use `https://api.openai.com/v1`. Other providers can supply their own compatible API root, including an existing `/chat/completions` endpoint.

Model discovery requests the configured API root's `/models` endpoint, such as `/v1/models`. **手动输入** keeps custom model IDs available.

No `.env` file is required. Settings use the current tab's session storage by default. **记住在本机** saves them in browser local storage.

American English is selected initially. The variety selector changes English spelling and usage; teaching copy stays Chinese.

## Explore eight modules

| Dimension | Modules | Interaction |
| --- | --- | --- |
| Origins | Etymology and meaning evolution; cognate constellation | Select evolution stages and related words. |
| Meaning | Concept coordinates; synonym comparison | Compare imagery, register, and examples within a shared situation. |
| Usage | Register thermometer; chunks; learner pitfalls; dialogue and practice | Move the thermometer, collect phrases, inspect corrections, and write original sentences. |

The thermometer responds locally to mouse, touch, and arrow keys. Each of its ten levels supports several candidates or an empty result.

Each candidate includes an example, typical speaker, delivery, and meaning shift. The original expression's position stays visible.

Dotted underlines mark vocabulary hints in practice scenarios and instructions. Hover, focus with Tab, or tap to reveal a contextual English equivalent.

Older exercises fetch missing hints when visible. Successful hints stay with the saved analysis and its JSON export.

The practice sandbox grades naturalness, register, and imagery. It supplies a revision, Chinese feedback, and a follow-up question.

## Keep and reuse your work

Completed analyses, partial drafts, practice attempts, and card selections live in IndexedDB. Open **学习档案** to revisit or delete records.

Generation streams three dimensions sequentially. Each dimension and its optional repair request allows up to 32,768 output tokens.

The current dimension shows actual received character counts and separate thinking, generation, and repair phases. Hidden reasoning remains private.

Each dimension has a shared ten-minute deadline, including repair. The browser stops waiting after eleven minutes if the connection fails silently.

Pause or recover from a failed request, then continue with the missing dimensions. Completed dimensions remain saved.

A provider-reported output cutoff produces a specific length-limit error. Genuine JSON or structure errors receive one repair attempt.

The toolbar downloads complete analyses as versioned JSON. Import that JSON through the history drawer to restore an analysis on another browser.

**导出 Anki** opens selectable card previews. Export an `.apkg` deck, a UTF-8 TSV file, or the complete JSON analysis.

Cards cover core meaning, chunks, synonym distinctions, register, and sentence practice. Stable note IDs support repeat imports and updates in Anki.

JSON files transfer the complete analysis itself. Practice attempts, partial drafts, and card selections remain in their original storage profile.

The Go browser preview preserves the original browser origin and IndexedDB data. MyGo uses its own persistent desktop origin and storage profile.

To transfer a complete browser analysis into the desktop application, download its JSON and import it through **学习档案**.

API settings stay separate from learning records and exports. The application server forwards credentials to the configured provider without persisting them.

## Optional English etymology references

Dimension one looks up English Wiktionary references before generation. It first finds the level-two English language boundary, then selects English etymology sections.

Missing entries, missing etymology, API errors, and the three-second lookup timeout all continue with the original generation prompt.

Retrieved text is bounded and supplied as untrusted reference data. It cannot replace the generation instructions.

`LEXIGENE_WIKTIONARY_USER_AGENT` configures the descriptive client identification. Replace the development default `LexiGene/1.0 (contact)` with your genuine contact before public distribution.

`LEXIGENE_WIKTIONARY_ENDPOINT` optionally overrides the MediaWiki API endpoint for testing.

## Verify the application

```sh
npm run typecheck
npm test
npm run test:go
node tools/run-go.mjs test -tags headless ./...
node tools/run-go.mjs vet ./...
python3 -m unittest discover -s tools -p 'test_*.py'
npm run test:e2e
```

The browser suite builds the production application and starts a temporary server on port 3100. It uses a local mock provider through real API routes.

Local checks use `/opt/google/chrome/chrome`. Set `CHROME_PATH` to another Chrome or Chromium executable. CI uses Playwright's installed Chromium.

On this host, redirect temporary browser caches to avoid its `/tmp` storage limit:

```sh
mkdir -p artifacts/tmp
TMPDIR="$PWD/artifacts/tmp" PWTEST_CACHE_DIR="$PWD/artifacts/playwright-cache" npm run test:e2e
```

Browser checks cover model discovery, manual model IDs, generation, retry, grading, restored attempts, JSON import, deletion, thermometer controls, and exports.

They also exercise vocabulary hint recovery, keyboard controls, touch tooltips, reduced motion, and mobile overflow.

Screenshots and the browser-exported `anagnorisis.apkg` appear under `artifacts/`. Playwright retains traces for failed scenarios.

For an additional import check, install Python `anki` in an isolated environment and run:

```sh
artifacts/anki-check/.venv/bin/python tools/check_anki.py artifacts/anagnorisis.apkg
```

The script's header documents environment setup. It imports through Anki's engine, checks rendered Chinese cards, and repeats the import to verify deduplication.

Acceptance used Anki 26.9.3. A legacy Node package imported nine notes; the Go update changed all nine and added one without duplicates.

Reports are stored in `artifacts/anki-check/go-cross-runtime-report.json` and `artifacts/anki-check/go-report.json`.

Browser acceptance uses a local compatible provider, including gated upstream SSE. It does not validate a personal provider account.

## Code map

- `src/components/lexigene.tsx`: learning desk, drawers, settings, history, exports, and practice.
- `src/components/modules.tsx`: the eight visual modules and their controls.
- `src/components/word-helix.tsx`: a double helix built from the current entry’s vocabulary.
- `src/app/globals.css`: warm-paper design, responsive layouts, and reduced-motion styles.
- `src/lib/schema.ts`: versioned Zod contracts for analyses, grading, and cards.
- `src/lib/demo.ts`: validated sample content.
- `internal/api/` and `internal/llm/`: Go API handlers, upstream streaming, validation, repair, and provider requests.
- `internal/prompts/`: generation and grading prompts.
- `internal/wiktionary/`: bounded English-section etymology lookup.
- `internal/anki/`: pure-Go SQLite Anki packages with legacy-compatible note GUIDs.
- `src/lib/storage.ts`: IndexedDB persistence.
- `src/lib/cards.ts`: atomic cards, semantic IDs, HTML escaping, and TSV output.
- `main.go`: shared service setup and browser preview.
- `desktop.go`, `headless.go`, and `mygo.json`: desktop launcher, static Android service build, and native packaging.
- `tools/verify_apk.py`: required APK entries, ELF architecture, and static service validation.
- `src/lib/client.ts`: browser and native API transport.
- `src/app/api/`, `src/lib/llm.ts`, and `src/lib/prompts.ts`: legacy compatibility references used by existing unit tests.
- `tests/` and `e2e/`: API, export, and browser acceptance checks.

Validated dimensions and generation progress reach the interface through server-sent events. Three sequential generation calls preserve missing-only resume.

The current application uses model-generated analysis. Its data layer supports one target expression per record.

## License

LexiGene application code is available under the MIT License; see `LICENSE`. Bundled fonts retain their original licenses.

The locally embedded reading font derives from Noto Serif at medium weight 500. It covers the interface's Latin text, English phonetic symbols, and Greek examples.

Its SIL Open Font License is included as `public/fonts/ReadingFont-OFL.txt` and shipped in the built frontend's `licenses/OFL.txt`.
