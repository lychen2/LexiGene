# LexiGene interface

## Purpose and scope

LexiGene is a local-first vocabulary research desk for Chinese-speaking English learners.
The first screen must identify the input, the analysis action, and the current vocabulary note.
Users must configure a model, explore a word, read eight modules, practise, and export their learning.
This refinement preserves the existing layout, content, storage, API contracts, and keyboard workflows.

## Visual direction

Keep the quiet botanical editorial style: paper, forest ink, restrained terracotta, and English serif display type.
Use visual variation 4/10, motion 5/10, and information density 6/10.
Prioritise clear reading, visible controls, and a single primary action in each task area.
Omit decorative English subtitles, duplicate section labels, and slogans. Keep labels that explain learning content or available actions.
Use a word-cloud double helix instead of the generic orbit illustration. Add no remote fonts.
Populate the helix from the current entry's root, cognates, synonyms, and words from its collocations.
Do not invent etymologies or treat cloud placement as a direct derivation claim.
Show the vocabulary diagram below the definition on mobile and beside the entry on desktop.
Both the illustration and compact brand mark are built from dense, curved words.
The shared geometry projects two ribbons around a cylinder, with depth-sorted words, perspective sizing, and occluded crossings.
The illustration uses four word lanes per strand. Large brand artwork uses two lanes with linguistic vocabulary.
At small sizes, four short words use separate shallow curves and heavier glyphs to preserve the silhouette.
Keep the forest-ink tile, warm-paper foreground words, and terracotta second strand.
`src/lib/word-helix-layout.mjs` defines the shared geometry and compact brand vocabulary.
Run `node tools/generate-brand.mjs` to regenerate the compact `src/app/icon.svg` and larger `docs/assets/brand.svg`.
Then run `node tools/generate-icon.mjs` for both native PNG assets.
The interface, favicon, README, desktop icon, and Android launcher all use this word-built identity.

## Tokens and typography

- Canvas: `--paper: #f3f4ee`; note surface: `--surface: #fffefa`.
- Primary text: `--ink: #293e32`; supporting text: `--muted: #5f6b5b`.
- Main action: `--green: #456b54`; warm emphasis: `--orange: #a1552f`.
- Preserve the three dimension accent roles and their pale backgrounds.
- Chinese interface and explanatory text use the local system sans-serif stack.
- The bundled LexiGene Reading face remains for English words, pronunciation, examples, and the wordmark.
- Body text uses weight 400, headings 500–600, and reading line-height 1.75–1.9.
- Chinese headings use normal letter spacing. Large English words may use tighter display spacing.
- Small labels support the content. Required instructions and explanations remain at least 14px.

## Layout and components

Use 8px spacing increments for sections and 4px increments within controls.
Keep the desktop sidebar fixed and full-height below the header, with contained overscroll.
The document remains the main reading surface. Avoid adding nested decorative cards.
Use 8px control radii, 12px input radii, and 16px document radii.
Selected navigation uses a full background and restrained border, without left accent bars.
Touch targets are at least 44px for primary controls and navigation.
Show visible keyboard focus using the existing terracotta accent.
Keep default, hover, pressed, focused, selected, and disabled states distinguishable.

## Reference details

The Claude design-system reference informs these details, while LexiGene keeps its own palette:

1. Separate editorial serif display from functional sans-serif interface text.
2. Use an 8px spacing unit and 24–32px document padding.
3. Keep 8px control, 12px input, and 16px featured-surface radii.
4. Use quiet ring and whisper shadows, adapted to forest ink at low opacity.
5. Keep the warm canvas and note surface close in luminance.

## Responsive and motion

At 760px, use a single content column and a modal directory.
At 390px, retain the input, language selector, submit action, and export controls without horizontal overflow.
Allow English words and pronunciation to wrap without clipping.
Keep the mobile introduction compact so the vocabulary note appears promptly.
Use short colour and surface transitions. Preserve reduced-motion behaviour.
Content may settle into place as it enters the viewport; the interaction model itself stays unchanged.
See the motion system below for what may move and why.

## Acceptance

Inspect desktop and 390px screenshots of the first screen, a module, and the settings panel.
Exercise search focus, model settings, directory navigation, and existing learning acceptance tests.
Check typography, focus visibility, contrast, overflow, and the unchanged import/export task flow.
Android content must remain inside status and navigation bars, including edge-to-edge Android 15 layouts.

## Motion system

Added after the product felt too still to read as alive. The rule is: movement
answers the reader or places content; it never decorates a wait.

Two curves, three durations:

- `--ease: cubic-bezier(.2,.8,.2,1)` for arrivals and reveals.
- `--spring: cubic-bezier(.34,1.3,.5,1)` for anything the reader just touched.
- `--dur-1: .16s` state, `--dur-2: .3s` surface, `--dur-3: .55s` content.

| Element | Motion | Reason |
| --- | --- | --- |
| Modules, hero | 16px rise and fade on viewport entry, once | shows the document is longer than the screen |
| Hero word | letter spacing settles over .7s | the word is the subject; it lands |
| Dimension nav | underline scales in on the current tab | position in a long document |
| Evolution dots, cognate stars, score bars, progress track | spring pop or scale from the left | confirms the tap, turns a number into a length |
| Running dimension | 2.6s breathing border, shimmering skeleton | this is a wait; it should look alive, not urgent |
| Completed practice attempt | one short ink burst in five paper pigments | a small reward, once |
| Word helix | 11s drift of ±7px | the plate stays alive while reading |
| Goal list rows | 14ms stagger, capped at 12 rows | a list appearing, not a slot machine |

Reveal state lives in `[data-reveal]` and `is-revealed`; `src/lib/motion.ts`
supplies the observer and the burst, and both return immediately under
`prefers-reduced-motion`. Elements reveal when any sliver enters the viewport,
so content that peeks above the fold never waits for a full scroll.

Banned: `transition: all`, `scale(0)` entrances, looping attention-seekers on
primary buttons, animations over one second other than the two ambient drifts,
and any motion that survives reduced-motion.

## Goal word lists

`目标词单` opens a drawer of lists for 考研, 雅思, 托福, GRE and everyday
expressions. Lists are data files under `public/wordlists`, loaded per tab, so
the page pays nothing for a list nobody opens.

- Education here is not a beginner's course: the CET-4 band, everyday
  high-frequency words, inflected forms and proper nouns are removed, because
  reading teaches those on its own.
- `idioms.json` is hand-written and holds what reading rarely shows: slang,
  idioms, workplace shorthand. It is the reason the product exists.
- Progress counts existing analyses, so the archive and the lists cannot
  disagree. `下一个未解剖` starts the next unanalysed word directly.
- Rows show the word, one short gloss, and the state. Rarity is shown only where
  it varies, and exam lists never repeat the same chip on every row.
- The source, its licence and what was excluded are named in the drawer: a
  learner should know where a list came from.

## Control language

One scale, one ring, four states.

- Radii: `--r-1: 6px` chips and small labels, `--r-2: 8px` controls and
  buttons, `--r-3: 12px` cards, drawers and inputs, `--r-4: 16px` only the
  document sheet.
- Focus: a 2px ink-orange ring, 3px offset, on buttons, links and summaries; a
  2px green ring at 1px offset on fields. A focused field never draws a second
  border on top of the ring.
- States: hover changes surface, active moves 1px and deepens, disabled loses
  its shadow and desaturates. Nothing changes size on hover.
- Type floor: 11px for anything read in a panel, 12px for supporting text,
  13–14px for controls and labels, 15px for reading. Decorative micro-labels
  may go to 9–10px but never carry an instruction.
- Numerals are tabular wherever a reader compares figures: module numbers,
  counts, scores, timers, list indices.
- Chips (language, part of speech, rarity, filter) share one shape: 6px radius,
  1px border, 11–12px label, no shadow. A chip never looks clickable unless it
  is.
- Lists show the next action on hover or focus, not as a permanent icon on
  every row; touch shows it at reduced opacity.
- Phonetic lines wrap between tokens, never inside one.
