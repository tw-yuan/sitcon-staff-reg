import { db } from '../db';

export interface Draft {
  data: Record<string, unknown>;
  updatedMs: number;
}

/** 讀取某帳號尚未送出的草稿；沒有則回 null。 */
export function getDraft(email: string): Draft | null {
  const row = db
    .prepare('SELECT answers_json, updated_ms FROM reg_drafts WHERE identity_key = ?')
    .get(email) as { answers_json: string; updated_ms: number } | undefined;
  if (!row) return null;
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.answers_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    /* 壞掉的草稿當作空 */
  }
  return { data, updatedMs: row.updated_ms };
}

/** 寫入／覆蓋草稿，回傳伺服器記錄的時間戳（epoch 毫秒）。 */
export function saveDraft(email: string, data: unknown): number {
  const ms = Date.now();
  const json = JSON.stringify(data && typeof data === 'object' ? data : {});
  db.prepare(
    `INSERT INTO reg_drafts (identity_key, answers_json, updated_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(identity_key) DO UPDATE SET
       answers_json = excluded.answers_json,
       updated_ms   = excluded.updated_ms`,
  ).run(email, json, ms);
  return ms;
}

/** 送出成功後清掉草稿。 */
export function deleteDraft(email: string): void {
  db.prepare('DELETE FROM reg_drafts WHERE identity_key = ?').run(email);
}
