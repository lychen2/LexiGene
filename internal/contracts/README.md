# Contracts

The JSON files in `schemas/` are the runtime validation contracts used by the Go
API. They are generated from the existing Zod definitions, not maintained by
hand.

`src/lib/schema.ts` is the source of truth for every shared document (analysis
drafts and dimensions, grading output, quiz questions, cards). The request
wrappers in `generate_schemas.mjs` mirror the schemas declared in the old Next
route handlers. The generator loads the TypeScript module through Vite's SSR
loader and writes JSON Schema draft 2020-12.

Regenerate after changing a Zod schema:

```sh
go generate ./internal/contracts
```

The output is embedded with `//go:embed`, so the Go binary needs neither Node.js
nor the TypeScript sources at runtime. `contracts_test.go` checks that every
embedded schema uses input semantics (`additionalProperties: false` is omitted
because Zod objects strip unknown keys, and defaulted fields stay optional).

JSON Schema cannot express several Zod refinements. Those checks live in
`contracts.go` and run together with the structural schema:

- provider URLs must use `http` or `https` and have a host;
- register levels must contain each integer from 1 to 10;
- the three dialogue settings must be unique (friends, work, culture);
- quiz ids must be unique;
- export deck names and tags must not contain control characters;
- export string caps are measured in UTF-16 code units, like browser strings;
- total exported card content must stay within the old 4,000,000-character cap.

Unknown keys stay accepted everywhere, matching Zod's default stripping
behavior; the Go handlers decode into typed structs, which drops them.
