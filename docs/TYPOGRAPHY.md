# Scripts and typography

A word in Japanese, Arabic or Devanagari cannot be set in the same type as an
English one. This file decides, per script, which family draws the word, how
much air it needs, and whether it runs right to left. The CSS lives in
`src/app/globals.css` under `.script-*`; the class is applied to the whole
sheet so examples, headings and the hero word agree.

## Families

The bundled `LexiGene Reading` serif is Latin-only. When a script needs other
glyphs, the fallback chain starts with the script's own families and the
bundled serif is dropped, so no mixed-font word ever appears.

| Script | Display family (first three) | Notes |
| --- | --- | --- |
| Latin | LexiGene Reading, Noto Serif, Georgia | only script that uses the bundled face |
| Cyrillic | Noto Serif, PT Serif, Georgia | bundled face has no Cyrillic |
| Greek | Noto Serif, GFS Didot, Georgia | |
| Han | Noto Serif CJK SC, Source Han Serif SC, Songti SC, SimSun | 4% tracking, 1.9 line-height |
| Kana | Noto Serif CJK JP, Yu Mincho, Hiragino Mincho ProN, MS Mincho | 6% tracking, 2.0 line-height |
| Hangul | Apple SD Gothic Neo, Noto Sans KR, Malgun Gothic | sans is the honest choice; no faux serif |
| Arabic | Noto Naskh Arabic, Geeza Pro, Traditional Arabic | right to left, 1.95 line-height |
| Hebrew | Noto Serif Hebrew, Times New Roman | right to left |
| Devanagari | Noto Serif Devanagari, Kohinoor Devanagari, Mangal | matras need extra leading |
| Thai | Noto Serif Thai, Thonburi, Leelawadee UI | stacked vowels need extra leading |
| Bengali, Tamil, Telugu, Kannada, Malayalam | the matching Noto Serif, then the platform's font | |

## Sizes

The hero word is the loudest element, so it scales by script rather than by a
single pixel value: Latin 88px, Han 66px, Kana 62px, Hangul 60px, Arabic and
Hebrew 56px, Devanagari and Thai 52px. Below 500px each shrinks with the
existing clamps. Letter spacing follows the same logic: Latin tightens
(`-3px`), CJK opens slightly, Arabic never gets tracking (it breaks joining).

## Direction

Arabic and Hebrew set `dir="rtl"` on the sheet. Text alignment, list markers
and the hero all follow; the surrounding chrome stays left-to-right because the
interface itself is not RTL yet. That limit is stated in `DESIGN.md` rather than
half-implemented.

## Verification

`tools/check-scripts.mjs` renders one sample word per script in headless Chrome
and reports the family actually used plus the measured line box, so a missing
font shows up as `serif` fallback instead of passing silently.
