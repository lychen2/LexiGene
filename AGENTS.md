# LexiGene development

LexiGene uses Go 1.27.3 and MyGo 0.7.1 with a pre-rendered React/Vite frontend. The installed desktop application requires no Node server.

- Runtime API handlers live in `internal/api/`; model transport lives in `internal/llm/`. Keep browser and native request contracts equivalent.
- `src/lib/schema.ts` defines schemaVersion1 learning contracts. Regenerate embedded Go schemas through `internal/contracts/generate_schemas.mjs` when those contracts change.
- `src/app/api/`, `src/lib/llm.ts`, and `src/lib/prompts.ts` are legacy compatibility references for unit tests, not production server entry points.
- Keep IndexedDB learning records and stable Anki note IDs backward-compatible. Credentials remain separate from learning records and exports.
- Keep Chinese interface/teaching copy and English code identifiers. Preserve keyboard operation, reduced motion, and the390px layout.
- Use `node tools/run-go.mjs` for Go commands so caches and temporary files remain inside `artifacts/`.
- Required affected checks include TypeScript, existing tests, Go tests/vet, and actual browser/native interaction for transport changes.
- Build the static frontend with `npm run build:web`; preview with `npm start`; package MyGo with `npm run build`.

Repository artifacts use English unless requested otherwise. Preserve existing authorship and leave new author fields empty unless the user supplies them.
