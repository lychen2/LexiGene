# LexiGene interface

## Purpose and scope

LexiGene is a local-first vocabulary research desk for Chinese-speaking English learners.
The first screen must identify the input, the analysis action, and the current vocabulary note.
Users must configure a model, explore a word, read eight modules, practise, and export their learning.
This refinement preserves the existing layout, content, storage, API contracts, and keyboard workflows.

## Visual direction

Keep the quiet botanical editorial style: paper, forest ink, restrained terracotta, and English serif display type.
Use visual variation 4/10, motion 2/10, and information density 6/10.
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
Do not add entrance choreography or change the existing interaction model.

## Acceptance

Inspect desktop and 390px screenshots of the first screen, a module, and the settings panel.
Exercise search focus, model settings, directory navigation, and existing learning acceptance tests.
Check typography, focus visibility, contrast, overflow, and the unchanged import/export task flow.
Android content must remain inside status and navigation bars, including edge-to-edge Android 15 layouts.
