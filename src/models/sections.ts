import { db } from '../db';

export interface Section {
  id: number;
  title: string;
  description: string;
  position: number;
}

interface SectionRow {
  id: number;
  title: string;
  description: string | null;
  position: number;
}

function toSection(r: SectionRow): Section {
  return { id: r.id, title: r.title, description: r.description || '', position: r.position };
}

export function listSections(): Section[] {
  const rows = db
    .prepare('SELECT * FROM sections ORDER BY position ASC, id ASC')
    .all() as SectionRow[];
  return rows.map(toSection);
}

export function getSection(id: number): Section | undefined {
  const row = db.prepare('SELECT * FROM sections WHERE id = ?').get(id) as SectionRow | undefined;
  return row ? toSection(row) : undefined;
}

export function createSection(title: string, description = ''): Section {
  const maxPos = (db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM sections').get() as { m: number }).m;
  const info = db
    .prepare('INSERT INTO sections (title, description, position) VALUES (?, ?, ?)')
    .run(title, description || null, maxPos + 1);
  return getSection(Number(info.lastInsertRowid))!;
}

export function updateSection(id: number, title: string, description: string): void {
  db.prepare('UPDATE sections SET title = ?, description = ? WHERE id = ?').run(
    title,
    description || null,
    id,
  );
}

/** 刪除區塊；至少保留一個。刪除後把該區塊的欄位改掛到第一個區塊。 */
export function deleteSection(id: number): boolean {
  const all = listSections();
  if (all.length <= 1) return false;
  db.prepare('DELETE FROM sections WHERE id = ?').run(id);
  const first = listSections()[0];
  db.prepare(
    'UPDATE fields SET section_id = ? WHERE section_id IS NULL OR section_id NOT IN (SELECT id FROM sections)',
  ).run(first.id);
  return true;
}

/** 與相鄰區塊交換位置。dir = -1 上移、+1 下移。 */
export function moveSection(id: number, dir: -1 | 1): void {
  const list = listSections();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= list.length) return;
  const a = list[idx];
  const b = list[swapIdx];
  const tx = db.transaction(() => {
    db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(b.position, a.id);
    db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(a.position, b.id);
  });
  tx();
}
