import { db } from '../db';

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  submissionId: number | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  submission_id: number | null;
  meta_json: string | null;
  created_at: string;
}

export function logAudit(
  actor: string,
  action: string,
  submissionId: number | null = null,
  meta: Record<string, unknown> = {},
): void {
  db.prepare(
    'INSERT INTO audit_log (actor, action, submission_id, meta_json) VALUES (?, ?, ?, ?)',
  ).run(actor, action, submissionId, JSON.stringify(meta));
}

export function listAudit(submissionId?: number): AuditEntry[] {
  const rows = (
    submissionId
      ? db.prepare('SELECT * FROM audit_log WHERE submission_id = ? ORDER BY id DESC').all(submissionId)
      : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all()
  ) as AuditRow[];
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    submissionId: r.submission_id,
    meta: r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : {},
    createdAt: r.created_at,
  }));
}
