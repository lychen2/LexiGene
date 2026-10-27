import { z } from 'zod';

const text = z.string().min(1);
export const exampleSchema = z.object({ en: text, zh: text });
export const originSchema = z.object({
  story: text, physicalImage: text,
  evolution: z.array(z.object({ id: text, label: text, period: text, meaning: text, connection: text, example: exampleSchema })).min(2),
});
export const bloodlineSchema = z.object({
  family: text, route: z.array(text).min(1), socialFeel: text, root: text,
  cognates: z.array(z.object({ word: text, meaning: text, connection: text })).max(4),
});
export const conceptSchema = z.object({
  scene: text, trigger: text, psychology: text, intensity: text, boundary: text,
  translation: z.object({ common: text, adds: text, misses: text }),
});
export const nuanceSchema = z.object({
  sharedScene: text,
  words: z.array(z.object({ word: text, image: text, register: z.number().int().min(1).max(10), distinction: text, example: exampleSchema })).min(3).max(4),
});
export const candidateSchema = z.object({
  word: text, nuance: text, persona: text, prosody: text, shift: text, example: exampleSchema,
});
export const registerSchema = z.object({
  score: z.number().int().min(1).max(10), persona: text, prosody: z.enum(['positive', 'neutral', 'negative', 'mixed']), prosodyExplanation: text, subtext: text,
  levels: z.array(z.object({ level: z.number().int().min(1).max(10), label: text, candidates: z.array(candidateSchema).max(3) })).length(10)
    .refine(items => new Set(items.map(item => item.level)).size === 10, 'Levels must contain each integer from 1 to 10'),
});
export const chunksSchema = z.object({
  items: z.array(z.object({ phrase: text, meaning: text, example: exampleSchema })).min(4).max(5),
  culture: z.array(z.object({ expression: text, explanation: text, example: exampleSchema })).max(4),
});
export const pitfallsSchema = z.object({
  items: z.array(z.object({ wrong: text, right: text, explanation: text, image: text, translation: text })).min(2).max(3),
});
export const vocabularyHintSchema = z.object({ term: text, en: text });
export const quizQuestionSchema = z.object({
  id: text, scenario: text, challenge: text, focus: text, reference: exampleSchema,
  hints: z.array(vocabularyHintSchema).optional(),
});
export const slicesSchema = z.object({
  dialogues: z.array(z.object({ setting: z.enum(['friends', 'work', 'culture']), title: text, lines: z.array(z.object({ speaker: text, en: text, zh: text, annotation: text })).min(2).max(6) })).length(3)
    .refine(items => new Set(items.map(item => item.setting)).size === 3, 'Include friends, work and culture'),
  quiz: z.array(quizQuestionSchema).length(2).refine(items => new Set(items.map(item => item.id)).size === 2, 'Quiz IDs must be unique'),
});
export const overviewSchema = z.object({ pronunciation: text, core: text, definition: text, partOfSpeech: text });
export const dimensionOneSchema = z.object({ overview: overviewSchema, origin: originSchema, bloodline: bloodlineSchema });
export const dimensionTwoSchema = z.object({ concept: conceptSchema, nuance: nuanceSchema });
export const dimensionThreeSchema = z.object({ register: registerSchema, chunks: chunksSchema, pitfalls: pitfallsSchema, slices: slicesSchema });
export const dimensionsSchema = z.object({ one: dimensionOneSchema, two: dimensionTwoSchema, three: dimensionThreeSchema });
export const analysisSchema = z.object({
  schemaVersion: z.literal(1), id: text, createdAt: z.string().datetime(), target: text, language: text,
  dimensions: dimensionsSchema,
});
export const draftSchema = z.object({
  schemaVersion: z.literal(1), id: text, createdAt: z.string().datetime(), target: text, language: text,
  dimensions: z.object({ one: dimensionOneSchema.optional(), two: dimensionTwoSchema.optional(), three: dimensionThreeSchema.optional() }),
});
export const apiConfigSchema = z.object({
  baseUrl: z.string().url().refine(value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return false; }
  }, 'Use HTTP or HTTPS'),
  apiKey: text, model: text,
});
export const gradeSchema = z.object({
  scores: z.object({ naturalness: z.number().min(0).max(10), register: z.number().min(0).max(10), imagery: z.number().min(0).max(10) }),
  feedback: text, correction: exampleSchema, changes: z.array(text).min(1), followUp: text, usesTarget: z.boolean(),
});
export const attemptSchema = z.object({ id: text, analysisId: text, questionId: text, answer: text, createdAt: z.string().datetime(), grade: gradeSchema });
export type AnalysisDocument = z.infer<typeof analysisSchema>;
export type AnalysisDraft = z.infer<typeof draftSchema>;
export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type Grade = z.infer<typeof gradeSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export type Example = z.infer<typeof exampleSchema>;
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
export type VocabularyHint = z.infer<typeof vocabularyHintSchema>;
export type DimensionKey = 'one' | 'two' | 'three';
export type GenerationProgress = { receivedChars: number; phase: 'thinking' | 'generating' | 'repairing' };
export type AnalysisEvent =
  | { type: 'dimension-start'; dimension: DimensionKey }
  | ({ type: 'dimension-progress'; dimension: DimensionKey } & GenerationProgress)
  | { type: 'dimension-complete'; dimension: DimensionKey; data: unknown }
  | { type: 'complete' }
  | { type: 'error'; message: string; dimension: DimensionKey };
export const dimensionSchemas = { one: dimensionOneSchema, two: dimensionTwoSchema, three: dimensionThreeSchema };
export const cardSchema = z.object({ id: text, type: z.enum(['core', 'chunk', 'pitfall', 'nuance', 'quiz']), front: text, back: text, tags: z.array(text) });
export type StudyCard = z.infer<typeof cardSchema>;
