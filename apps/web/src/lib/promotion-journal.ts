import { z } from 'zod';
import type { Session } from './table';

const commandSchema = z.object({
  path: z.string().regex(/^\/promotions\/(?:generate|[A-Za-z0-9_-]+(?:\/(?:preview|approve|publish|revoke|derive))?)$/),
  method: z.enum(['POST', 'PATCH']),
  body: z.record(z.string(), z.unknown()).refine(body => typeof body.idempotencyKey === 'string', 'Missing idempotency key'),
}).strict();
const recordSchema = z.object({ revision: z.number().int().nonnegative(), pending: commandSchema.nullable() }).strict();
export type PromotionCommand = z.infer<typeof commandSchema>;
export type PromotionJournalRecord = z.infer<typeof recordSchema>;
export interface PromotionJournal {
  load(): Promise<PromotionJournalRecord>;
  save(revision: number, pending: PromotionCommand | null): Promise<PromotionJournalRecord>;
  close(): Promise<void>;
}

// One merchant/user lane, shared across tabs. Commit before sending; CAS refuses
// stale editors. Audience, scoped profile/visit/order IDs and full target arrays
// persist verbatim for exact replay; no auth token or provider credential is added.
export function promotionJournal(session: Session): PromotionJournal {
  const key = `${session.merchantId}:${session.userId}`;
  let database: Promise<IDBDatabase> | undefined;
  function open() {
    return database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('bitpos-promotion-commands-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('commands');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error('Promotion journal unavailable; nothing sent.'));
      request.onblocked = () => reject(Error('Close older workspace tabs to unlock the promotion journal.'));
    });
  }
  async function transact(expected?: number, pending?: PromotionCommand | null) {
    const db = await open();
    return new Promise<PromotionJournalRecord>((resolve, reject) => {
      const transaction = db.transaction('commands', expected === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('commands');
      const request = store.get(key);
      let result: PromotionJournalRecord;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const saved = request.result === undefined ? { revision: 0, pending: null } : recordSchema.parse(request.result);
          if (expected !== undefined && saved.revision !== expected) throw Error('Another tab changed promotions. Reload the saved action; do not replace it.');
          result = expected === undefined ? saved : { revision: saved.revision + 1, pending: pending === null ? null : commandSchema.parse(pending) };
          if (expected !== undefined) store.put(result, key);
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(failure ?? Error('Promotion journal failed; retain the exact saved action.'));
    });
  }
  return { load: () => transact(), save: (revision: number, pending: PromotionCommand | null) => transact(revision, pending), close: async () => { if (database) (await database).close(); } };
}
