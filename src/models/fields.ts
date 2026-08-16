import { db } from '../db';

export type FieldType =
  | 'short_text'
  | 'paragraph'
  | 'single_select'
  | 'multi_select'
  | 'dropdown'
  | 'number'
  | 'date'
  | 'file'
  | 'statement'
  | 'image';

export const FIELD_TYPES: FieldType[] = [
  'short_text',
  'paragraph',
  'single_select',
  'multi_select',
  'dropdown',
  'number',
  'date',
  'file',
  'statement',
  'image',
];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: '短文字',
  paragraph: '段落文字',
  single_select: '單選',
  multi_select: '多選',
  dropdown: '下拉選單',
  number: '數字',
  date: '日期',
  file: '檔案上傳',
  statement: '文字說明（不填答）',
  image: '圖片（不填答）',
};

export const CHOICE_TYPES: FieldType[] = ['single_select', 'multi_select', 'dropdown'];
export const TEXT_TYPES: FieldType[] = ['short_text', 'paragraph'];
export const DISPLAY_TYPES: FieldType[] = ['statement', 'image']; // 只顯示、不收答案

export function isChoiceType(t: FieldType): boolean {
  return CHOICE_TYPES.includes(t);
}
export function isTextType(t: FieldType): boolean {
  return TEXT_TYPES.includes(t);
}
export function isDisplayType(t: FieldType): boolean {
  return DISPLAY_TYPES.includes(t);
}

interface FieldRow {
  id: number;
  key: string;
  label: string;
  help_text: string | null;
  type: FieldType;
  required: number;
  options_json: string | null;
  regex: string | null;
  regex_message: string | null;
  allow_other: number;
  section_id: number | null;
  option_jumps_json: string | null;
  content: string | null;
  image_path: string | null;
  worker_editable: number;
  position: number;
}

export interface Field {
  id: number;
  key: string;
  label: string;
  helpText: string;
  type: FieldType;
  required: boolean;
  options: string[];
  regex: string;
  regexMessage: string;
  allowOther: boolean;
  sectionId: number;
  optionJumps: Record<string, string>; // option value -> section id 字串 或 'submit'
  content: string; // statement 內文
  imagePath: string; // 上傳圖片的路徑（/form-images/xxx）；任何欄位都可掛圖
  workerEditable: boolean; // 允許工人事後用修改連結編輯此欄位
  position: number;
}

function toField(r: FieldRow): Field {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    helpText: r.help_text || '',
    type: r.type,
    required: !!r.required,
    options: r.options_json ? (JSON.parse(r.options_json) as string[]) : [],
    regex: r.regex || '',
    regexMessage: r.regex_message || '',
    allowOther: !!r.allow_other,
    sectionId: r.section_id || 0,
    optionJumps: r.option_jumps_json ? (JSON.parse(r.option_jumps_json) as Record<string, string>) : {},
    content: r.content || '',
    imagePath: r.image_path || '',
    workerEditable: !!r.worker_editable,
    position: r.position,
  };
}

function firstSectionId(): number | null {
  const row = db.prepare('SELECT id FROM sections ORDER BY position, id LIMIT 1').get() as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}

export interface FieldInput {
  label: string;
  helpText?: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  regex?: string;
  regexMessage?: string;
  allowOther?: boolean;
  sectionId?: number;
  optionJumps?: Record<string, string>;
  content?: string;
  imagePath?: string;
  workerEditable?: boolean;
}

function slugify(label: string): string {
  const base =
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9一-鿿]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field';
  return base;
}

function uniqueKey(label: string): string {
  const base = slugify(label);
  let key = base;
  let i = 2;
  while (db.prepare('SELECT 1 FROM fields WHERE key = ?').get(key)) {
    key = `${base}_${i++}`;
  }
  return key;
}

export function listFields(): Field[] {
  const rows = db
    .prepare('SELECT * FROM fields ORDER BY position ASC, id ASC')
    .all() as FieldRow[];
  return rows.map(toField);
}

export function getField(id: number): Field | undefined {
  const row = db.prepare('SELECT * FROM fields WHERE id = ?').get(id) as FieldRow | undefined;
  return row ? toField(row) : undefined;
}

/** 開放給工人事後修改的欄位（排除純顯示型）。 */
export function listWorkerEditableFields(): Field[] {
  return listFields().filter((f) => f.workerEditable && !isDisplayType(f.type));
}

export function createField(input: FieldInput): Field {
  const maxPos = (db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM fields').get() as { m: number }).m;
  const info = db
    .prepare(
      `INSERT INTO fields (key, label, help_text, type, required, options_json, regex, regex_message, allow_other, section_id, option_jumps_json, content, image_path, worker_editable, position)
       VALUES (@key, @label, @help_text, @type, @required, @options_json, @regex, @regex_message, @allow_other, @section_id, @option_jumps_json, @content, @image_path, @worker_editable, @position)`,
    )
    .run({
      key: uniqueKey(input.label),
      label: input.label,
      help_text: input.helpText || null,
      type: input.type,
      required: !isDisplayType(input.type) && input.required ? 1 : 0,
      options_json: isChoiceType(input.type) ? JSON.stringify(input.options || []) : null,
      regex: isTextType(input.type) ? input.regex || null : null,
      regex_message: isTextType(input.type) ? input.regexMessage || null : null,
      allow_other: isChoiceType(input.type) && input.allowOther ? 1 : 0,
      section_id: input.sectionId ?? firstSectionId(),
      option_jumps_json:
        input.type === 'single_select' && input.optionJumps && Object.keys(input.optionJumps).length
          ? JSON.stringify(input.optionJumps)
          : null,
      content: isDisplayType(input.type) ? input.content || null : null,
      image_path: input.imagePath || null,
      worker_editable: !isDisplayType(input.type) && input.workerEditable ? 1 : 0,
      position: maxPos + 1,
    });
  return getField(Number(info.lastInsertRowid))!;
}

export function updateField(id: number, input: FieldInput): Field | undefined {
  const existing = getField(id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE fields
     SET label = @label, help_text = @help_text, type = @type, required = @required,
         options_json = @options_json, regex = @regex, regex_message = @regex_message,
         allow_other = @allow_other, section_id = @section_id, option_jumps_json = @option_jumps_json,
         content = @content, image_path = @image_path, worker_editable = @worker_editable,
         updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    label: input.label,
    help_text: input.helpText || null,
    type: input.type,
    required: !isDisplayType(input.type) && input.required ? 1 : 0,
    options_json: isChoiceType(input.type) ? JSON.stringify(input.options || []) : null,
    regex: isTextType(input.type) ? input.regex || null : null,
    regex_message: isTextType(input.type) ? input.regexMessage || null : null,
    allow_other: isChoiceType(input.type) && input.allowOther ? 1 : 0,
    section_id: input.sectionId ?? existing.sectionId ?? firstSectionId(),
    option_jumps_json:
      input.type === 'single_select' && input.optionJumps && Object.keys(input.optionJumps).length
        ? JSON.stringify(input.optionJumps)
        : null,
    content: isDisplayType(input.type) ? input.content || null : null,
    image_path: input.imagePath || null,
    worker_editable: !isDisplayType(input.type) && input.workerEditable ? 1 : 0,
  });
  return getField(id);
}

export function deleteField(id: number): void {
  db.prepare('DELETE FROM fields WHERE id = ?').run(id);
}

/**
 * 與「同一區塊內」相鄰的欄位交換位置。dir = -1 上移、+1 下移。
 * 只在同區塊內排序：各區塊的 position 值可能跨區塊交錯，若用全域清單找鄰居
 * 常會跟別區塊的欄位交換，導致同區塊內看起來沒反應。
 */
export function moveField(id: number, dir: -1 | 1): void {
  const field = getField(id);
  if (!field) return;
  const siblings = listFields().filter((f) => f.sectionId === field.sectionId); // 已按 position 排序
  const idx = siblings.findIndex((f) => f.id === id);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const a = siblings[idx];
  const b = siblings[swapIdx];
  const tx = db.transaction(() => {
    db.prepare("UPDATE fields SET position = ?, updated_at = datetime('now') WHERE id = ?").run(b.position, a.id);
    db.prepare("UPDATE fields SET position = ?, updated_at = datetime('now') WHERE id = ?").run(a.position, b.id);
  });
  tx();
}
