import { db } from '../db';
import type { Platform } from './workgroups';

export type ProvStatus =
  | 'pending'
  | 'success'
  | 'invited'
  | 'skipped'
  | 'manual'
  | 'failed'
  | 'revoked';
export const PROV_STATUS_LABELS: Record<ProvStatus, string> = {
  pending: '待處理',
  success: '成功',
  invited: '已邀請（待接受）',
  skipped: '已具備（略過）',
  manual: '待手動處理',
  failed: '失敗',
  revoked: '已撤銷',
};

export interface ProvTask {
  id: number;
  submissionId: number;
  platform: Platform;
  target: string;
  role: string;
  status: ProvStatus;
  detail: string;
  updatedAt: string;
}

interface ProvTaskRow {
  id: number;
  submission_id: number;
  platform: Platform;
  target: string;
  role: string;
  status: ProvStatus;
  detail: string | null;
  updated_at: string;
}

function toTask(r: ProvTaskRow): ProvTask {
  return {
    id: r.id,
    submissionId: r.submission_id,
    platform: r.platform,
    target: r.target,
    role: r.role,
    status: r.status,
    detail: r.detail || '',
    updatedAt: r.updated_at,
  };
}

export function listTasks(submissionId: number): ProvTask[] {
  const rows = db
    .prepare('SELECT * FROM provisioning_tasks WHERE submission_id = ? ORDER BY platform, id')
    .all(submissionId) as ProvTaskRow[];
  return rows.map(toTask);
}

export function getTask(id: number): ProvTask | undefined {
  const row = db.prepare('SELECT * FROM provisioning_tasks WHERE id = ?').get(id) as
    | ProvTaskRow
    | undefined;
  return row ? toTask(row) : undefined;
}

export interface NewTask {
  platform: Platform;
  target: string;
  role: string;
  status?: ProvStatus; // 預設 pending；自訂通知(note)以 'manual' 建立，不會被自動開通
}

/** 依核准時選定的範本，重建該工人的 provisioning 任務清單。 */
export function replaceTasks(submissionId: number, tasks: NewTask[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM provisioning_tasks WHERE submission_id = ?').run(submissionId);
    const stmt = db.prepare(
      `INSERT INTO provisioning_tasks (submission_id, platform, target, role, status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const t of tasks) {
      stmt.run(submissionId, t.platform, t.target, t.role, t.status || 'pending');
    }
  });
  tx();
}

export function setTaskStatus(id: number, status: ProvStatus, detail = ''): void {
  db.prepare(
    "UPDATE provisioning_tasks SET status = ?, detail = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, detail || null, id);
}
