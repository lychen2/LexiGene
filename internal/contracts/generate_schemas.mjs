#!/usr/bin/env node
// Generates the embedded JSON Schemas from the existing Zod contracts.
//
// The frontend/Next sources stay the source of truth: this script loads
// `src/lib/schema.ts` through Vite's SSR module loader and converts the Zod
// schemas to JSON Schema draft 2020-12. Route-level request wrappers mirror the
// schemas declared in the old Next route handlers so the Go endpoints validate
// exactly the same shapes.
//
// `io: 'input'` is required: default Zod objects strip unknown keys instead of
// rejecting them, and `.default(...)` fields are optional on input. The output
// schema therefore must not set `additionalProperties: false`, and defaulted
// fields must not be required; the Go handlers apply the defaults and trims.
//
// Refinements that JSON Schema cannot express (unique register levels, unique
// dialogue settings and quiz ids, URL scheme, control characters, total export
// size) live in the Go contract/API validation.
//
// Run with: go generate ./internal/contracts  (or: node generate_schemas.mjs)

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outputDir = join(here, 'schemas');
// Keep Vite's dependency cache out of node_modules: regenerating contracts is a
// tools action and must not mutate installed packages.
const cacheDir = join(root, 'artifacts', 'tmp', 'vite-contracts');

const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  cacheDir,
  logLevel: 'error',
  resolve: { alias: { '@': join(root, 'src') } },
  server: { middlewareMode: true },
});

try {
  const schema = await server.ssrLoadModule('/src/lib/schema.ts');

  const noControlChars = value => !/[\u0000-\u001f\u007f]/.test(value);

  // Mirrors src/app/api/grade/route.ts.
  const gradeContextSchema = z.object({
    core: z.string().max(4_000).default(''),
    register: z.union([z.string().max(200), z.number()]).optional(),
    subtext: z.string().max(2_000).default(''),
    chunks: z.array(z.unknown()).max(20).default([]),
  });
  const gradeRequestSchema = z.object({
    config: schema.apiConfigSchema,
    target: z.string().trim().min(1).max(120),
    language: z.string().trim().min(1).max(60),
    question: schema.quizQuestionSchema,
    answer: z.string().trim().min(1).max(4_000),
    context: gradeContextSchema,
  });

  // Mirrors src/app/api/quiz-hints/route.ts.
  const hintOutputSchema = z.object({
    hints: z.array(schema.vocabularyHintSchema).max(8 * 2),
  });
  const hintsRequestSchema = z.object({
    config: schema.apiConfigSchema,
    target: z.string().trim().min(1).max(120),
    language: z.string().trim().min(1).max(60),
    question: z.object({
      id: z.string().trim().min(1).max(200),
      scenario: z.string().trim().min(1).max(2_000),
      challenge: z.string().trim().min(1).max(2_000),
    }),
  });

  // Mirrors src/app/api/export/anki/route.ts.
  const exportCardSchema = schema.cardSchema.extend({
    id: z.string().min(1).max(2_048),
    front: z.string().min(1).max(10_000),
    back: z.string().min(1).max(30_000),
    tags: z
      .array(z.string().min(1).max(64).refine(noControlChars, 'Tag contains control characters'))
      .max(30),
  });
  const exportRequestSchema = z.object({
    deckName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(noControlChars, 'Deck name contains control characters')
      .default('LexiGene'),
    cards: z.array(exportCardSchema).min(1).max(1_000),
  });

  const definitions = {
    'api-config': schema.apiConfigSchema,
    'api-credentials': schema.apiConfigSchema.pick({ baseUrl: true, apiKey: true }),
    'analyze-request': z.object({ config: schema.apiConfigSchema, draft: schema.draftSchema }),
    'connection-test-request': z.object({ config: schema.apiConfigSchema }),
    'models-request': z.object({ config: schema.apiConfigSchema.pick({ baseUrl: true, apiKey: true }) }),
    'dimension-one': schema.dimensionOneSchema,
    'dimension-two': schema.dimensionTwoSchema,
    'dimension-three': schema.dimensionThreeSchema,
    draft: schema.draftSchema,
    grade: schema.gradeSchema,
    'grade-request': gradeRequestSchema,
    'quiz-hints-output': hintOutputSchema,
    'quiz-hints-request': hintsRequestSchema,
    'quiz-question': schema.quizQuestionSchema,
    'export-request': exportRequestSchema,
  };

  await mkdir(outputDir, { recursive: true });

  for (const name of Object.keys(definitions).sort()) {
    const document = z.toJSONSchema(definitions[name], { io: 'input' });
    document.$comment =
      'Generated from src/lib/schema.ts by internal/contracts/generate_schemas.mjs. Do not edit.';
    await writeFile(join(outputDir, `${name}.json`), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }

  console.log(`wrote ${Object.keys(definitions).length} schemas to ${outputDir}`);
} finally {
  await server.close();
}
