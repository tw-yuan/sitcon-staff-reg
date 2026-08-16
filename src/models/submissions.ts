import { randomBytes } from 'crypto';
import { db } from '../db';

export type Status = 'pending' | 'approved' | 'rejected';
export const STATUS_LABELS: Record<Status, string> = {
  pending: '待審核',
  approved: '已核准',
  rejected: '已退回',
};

export interface Identity {
  googleEmail: string;
  googleSub: string;
  githubLogin: string;
  githubId: string;
  gitlabUsername: string;
  gitlabId: string;
  telegramId: string;
  telegramUsername: string;
}

interface SubmissionRow {
  id: number;
  identity_key: string;
  google_email: string | null;
  google_sub: string | null;
  github_login: string | null;
  github_id: string | null;
  gitlab_username: string | null;
  gitlab_id: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  workgroup_id: number | null;
  answers_json: string;
  status: Status;
  sheet_row: number | null;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  edit_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Submission {
  id: number;
  identityKey: string;
  googleEmail: string;
  githubLogin: string;
  githubId: string;
  gitlabUsername: string;
  gitlabId: string;
  telegramUsername: string;
  telegramId: string;
  workgroupId: number | null;
  answers: Record<string, unknown>;
  status: Status;
  sheetRow: number | null;
  rejectReason: string;
  reviewedBy: string;
  reviewedAt: string;
  editToken: string;
  createdAt: string;
  updatedAt: string;
}

function toSubmission(r: SubmissionRow): Submission {
  return {
    id: r.id,
    identityKey: r.identity_key,
    googleEmail: r.google_email || '',
    githubLogin: r.github_login || '',
    githubId: r.github_id || '',
    gitlabUsername: r.gitlab_username || '',
    gitlabId: r.gitlab_id || '',
    telegramUsername: r.telegram_username || '',
    telegramId: r.telegram_id || '',
    workgroupId: r.workgroup_id,
    answers: JSON.parse(r.answers_json || '{}') as Record<string, unknown>,
    status: r.status,
    sheetRow: r.sheet_row,
    rejectReason: r.reject_reason || '',
    reviewedBy: r.reviewed_by || '',
    reviewedAt: r.reviewed_at || '',
    editToken: r.edit_token || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function findByIdentity(identityKey: string): Submission | undefined {
  const row = db.prepare('SELECT * FROM submissions WHERE identity_key = ?').get(identityKey) as
    | SubmissionRow
    | undefined;
  return row ? toSubmission(row) : undefined;
}

export function getSubmission(id: number): Submission | undefined {
  const row = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
  return row ? toSubmission(row) : undefined;
}

export function findByEditToken(token: string): Submission | undefined {
  if (!token) return undefined;
  const row = db.prepare('SELECT * FROM submissions WHERE edit_token = ?').get(token) as
    | SubmissionRow
    | undefined;
  return row ? toSubmission(row) : undefined;
}

export function listSubmissions(filter: { status?: Status; q?: string } = {}): Submission[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.status) {
    clauses.push('status = @status');
    params.status = filter.status;
  }
  if (filter.q) {
    clauses.push('(google_email LIKE @q OR github_login LIKE @q OR gitlab_username LIKE @q)');
    params.q = `%${filter.q}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM submissions ${where} ORDER BY created_at DESC`)
    .all(params) as SubmissionRow[];
  return rows.map(toSubmission);
}

export interface CreateSubmissionInput {
  identity: Identity;
  workgroupId: number | null;
  answers: Record<string, unknown>;
}

export function createSubmission(input: CreateSubmissionInput): Submission {
  const { identity } = input;
  const info = db
    .prepare(
      `INSERT INTO submissions
        (identity_key, google_email, google_sub, github_login, github_id,
         gitlab_username, gitlab_id, telegram_id, telegram_username,
         workgroup_id, answers_json, status, edit_token)
       VALUES (@identity_key, @google_email, @google_sub, @github_login, @github_id,
         @gitlab_username, @gitlab_id, @telegram_id, @telegram_username,
         @workgroup_id, @answers_json, 'pending', @edit_token)`,
    )
    .run({
      identity_key: identity.googleEmail.toLowerCase(),
      google_email: identity.googleEmail,
      google_sub: identity.googleSub,
      github_login: identity.githubLogin,
      github_id: identity.githubId,
      gitlab_username: identity.gitlabUsername,
      gitlab_id: identity.gitlabId,
      telegram_id: identity.telegramId,
      telegram_username: identity.telegramUsername,
      workgroup_id: input.workgroupId,
      answers_json: JSON.stringify(input.answers),
      edit_token: randomBytes(24).toString('base64url'),
    });
  return getSubmission(Number(info.lastInsertRowid))!;
}

export function setStatus(id: number, status: Status, reviewedBy: string, rejectReason = ''): void {
  db.prepare(
    `UPDATE submissions
     SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
         reject_reason = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(status, reviewedBy, rejectReason || null, id);
}

export function setWorkgroup(id: number, workgroupId: number | null): void {
  db.prepare("UPDATE submissions SET workgroup_id = ?, updated_at = datetime('now') WHERE id = ?").run(
    workgroupId,
    id,
  );
}

export function setSheetRow(id: number, row: number): void {
  db.prepare('UPDATE submissions SET sheet_row = ? WHERE id = ?').run(row, id);
}

export function updateAnswers(id: number, answers: Record<string, unknown>): void {
  db.prepare("UPDATE submissions SET answers_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(answers),
    id,
  );
}

/**
 * 從本地資料庫刪除一筆登錄。provisioning_tasks 因 ON DELETE CASCADE 會一併移除；
 * audit_log 為稽核紀錄，刻意保留（含刪除事件本身）。
 * 注意：不會動到 Google Sheet 的資料列，也不會撤銷已開通的權限。
 * 刪除後該工人的 identity_key 釋出，可重新登錄。
 */
export function deleteSubmission(id: number): void {
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
}
