import Dexie, { type EntityTable } from 'dexie';
import {
  analysisSchema,
  attemptSchema,
  draftSchema,
  type AnalysisDocument,
  type AnalysisDraft,
  type Attempt,
} from './schema';

/**
 * Local-only persistence for LexiGene.
 *
 * This database intentionally stores generated analyses, drafts, attempts and
 * card selections only. API configuration (base URL, model, API key) belongs to
 * the settings layer and must never be written here, so exported or inspected
 * learning data cannot leak provider credentials.
 */

export interface SelectionRecord {
  analysisId: string;
  cardIds: string[];
}

export const DATABASE_NAME = 'lexigene';

class LexiGeneDatabase extends Dexie {
  analyses!: EntityTable<AnalysisDocument, 'id'>;
  drafts!: EntityTable<AnalysisDraft, 'id'>;
  attempts!: EntityTable<Attempt, 'id'>;
  selections!: EntityTable<SelectionRecord, 'analysisId'>;

  constructor() {
    super(DATABASE_NAME);
    this.version(1).stores({
      analyses: 'id, target, createdAt',
      drafts: 'id',
      attempts: 'id, analysisId',
      selections: 'analysisId',
    });
  }
}

export const db = new LexiGeneDatabase();

/**
 * Validate and upsert a completed analysis. Returns the stored id.
 * The matching draft is removed in the same transaction so a finished
 * analysis and its in-progress copy cannot coexist.
 */
export async function saveAnalysis(analysis: AnalysisDocument): Promise<string> {
  const parsed = analysisSchema.parse(analysis);
  await db.transaction('rw', db.analyses, db.drafts, async () => {
    await db.analyses.put(parsed);
    await db.drafts.delete(parsed.id);
  });
  return parsed.id;
}

/** Validate and upsert an in-progress draft. Returns the stored id. */
export async function saveDraft(draft: AnalysisDraft): Promise<string> {
  const parsed = draftSchema.parse(draft);
  await db.drafts.put(parsed);
  return parsed.id;
}

/** Completed analyses, newest first. */
export async function getHistory(): Promise<AnalysisDocument[]> {
  return db.analyses.orderBy('createdAt').reverse().toArray();
}

/** Chronological comparison of the ISO timestamps stored in every record. */
function compareCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/** Drafts, newest first (the drafts table is not indexed by createdAt). */
export async function getDrafts(): Promise<AnalysisDraft[]> {
  const drafts = await db.drafts.toArray();
  return drafts.sort((a, b) => compareCreatedAt(b, a));
}

/** Attempts for one analysis, oldest first. */
export async function getAttempts(analysisId: string): Promise<Attempt[]> {
  const attempts = await db.attempts.where('analysisId').equals(analysisId).toArray();
  return attempts.sort(compareCreatedAt);
}

/** Validate and upsert an attempt. Returns the stored id. */
export async function saveAttempt(attempt: Attempt): Promise<string> {
  const parsed = attemptSchema.parse(attempt);
  await db.attempts.put(parsed);
  return parsed.id;
}

/** Remove an analysis together with its attempts, card selection and draft. */
export async function deleteAnalysis(id: string): Promise<void> {
  await db.transaction('rw', db.analyses, db.attempts, db.selections, db.drafts, async () => {
    await db.attempts.where('analysisId').equals(id).delete();
    await db.selections.delete(id);
    await db.drafts.delete(id);
    await db.analyses.delete(id);
  });
}

/**
 * Selected card ids for an analysis.
 *
 * `undefined` means nothing was ever saved, so the caller may apply default
 * selections (core/chunk/pitfall). `[]` means the user explicitly cleared the
 * selection and no defaults should be restored.
 */
export async function loadSelections(analysisId: string): Promise<string[] | undefined> {
  const record = await db.selections.get(analysisId);
  if (!record) return undefined;
  if (!Array.isArray(record.cardIds)) return [];
  return record.cardIds.filter((id): id is string => typeof id === 'string');
}

/** Persist the selected card ids for an analysis (order preserved, duplicates dropped). */
export async function saveSelections(analysisId: string, cardIds: string[]): Promise<void> {
  await db.selections.put({
    analysisId,
    cardIds: [...new Set(cardIds.filter((id): id is string => typeof id === 'string'))],
  });
}
