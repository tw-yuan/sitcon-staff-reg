import { db } from '../db';
import { getSetting, setSetting } from './settings';

const DEFAULT_WG_KEY = 'default_workgroup_id';

// 'note' 為「自訂通知文字」：不自動開通，只會列進核准通知信，供手動處理的權限說明用。
export type Platform = 'drive' | 'google_group' | 'gitlab' | 'note';
export const PLATFORMS: Platform[] = ['drive', 'google_group', 'gitlab', 'note'];
export const PLATFORM_LABELS: Record<Platform, string> = {
  drive: 'Google Drive',
  google_group: 'Google Groups',
  gitlab: 'GitLab',
  note: '自訂通知（不開通）',
};

export interface WorkGroup {
  id: number;
  name: string;
  position: number;
}

export interface Grant {
  id: number;
  workgroupId: number;
  platform: Platform;
  target: string;
  role: string;
}

interface WorkGroupRow {
  id: number;
  name: string;
  position: number;
}
interface GrantRow {
  id: number;
  workgroup_id: number;
  platform: Platform;
  target: string;
  role: string;
}

export function listWorkGroups(): WorkGroup[] {
  return db
    .prepare('SELECT id, name, position FROM workgroups ORDER BY position ASC, id ASC')
    .all() as WorkGroupRow[];
}

export function getWorkGroup(id: number): WorkGroup | undefined {
  return db.prepare('SELECT id, name, position FROM workgroups WHERE id = ?').get(id) as
    | WorkGroup
    | undefined;
}

export function createWorkGroup(name: string): WorkGroup {
  const maxPos = (db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM workgroups').get() as { m: number }).m;
  const info = db
    .prepare('INSERT INTO workgroups (name, position) VALUES (?, ?)')
    .run(name, maxPos + 1);
  return getWorkGroup(Number(info.lastInsertRowid))!;
}

export function renameWorkGroup(id: number, name: string): void {
  db.prepare('UPDATE workgroups SET name = ? WHERE id = ?').run(name, id);
}

export function deleteWorkGroup(id: number): void {
  db.prepare('DELETE FROM workgroups WHERE id = ?').run(id);
}

/** 目前設定的預設工作組 id；若未設定或該工作組已被刪除則回 null。 */
export function getDefaultWorkgroupId(): number | null {
  const v = getSetting(DEFAULT_WG_KEY);
  const id = v ? Number(v) : 0;
  if (!id) return null;
  return getWorkGroup(id) ? id : null; // 已刪除 → 視為無預設
}

/** 設定（或以 null 清除）預設工作組。 */
export function setDefaultWorkgroupId(id: number | null): void {
  setSetting(DEFAULT_WG_KEY, id ? String(id) : '');
}

export function listGrants(workgroupId: number): Grant[] {
  const rows = db
    .prepare('SELECT * FROM permission_grants WHERE workgroup_id = ? ORDER BY platform, id')
    .all(workgroupId) as GrantRow[];
  return rows.map((r) => ({
    id: r.id,
    workgroupId: r.workgroup_id,
    platform: r.platform,
    target: r.target,
    role: r.role,
  }));
}

export function addGrant(workgroupId: number, platform: Platform, target: string, role: string): void {
  db.prepare(
    'INSERT INTO permission_grants (workgroup_id, platform, target, role) VALUES (?, ?, ?, ?)',
  ).run(workgroupId, platform, target, role);
}

export function deleteGrant(id: number): void {
  db.prepare('DELETE FROM permission_grants WHERE id = ?').run(id);
}
