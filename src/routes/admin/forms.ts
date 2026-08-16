import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config';
import { takeFlash } from '../../auth/session';
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  FieldInput,
  FieldType,
  createField,
  deleteField,
  getField,
  listFields,
  moveField,
  updateField,
} from '../../models/fields';
import {
  createSection,
  deleteSection,
  listSections,
  moveSection,
  updateSection,
} from '../../models/sections';
import { logAudit } from '../../models/audit';

export const formsRouter = Router();

// 表單圖片上傳（存到 data volume，經 /form-images 提供）
const imageDir = path.join(path.dirname(config.databaseFile), 'form-images');
fs.mkdirSync(imageDir, { recursive: true });
const IMG_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, !!IMG_EXT[file.mimetype]),
});

formsRouter.post('/upload-image', imageUpload.single('image'), (req, res) => {
  const file = req.file;
  if (!file || !IMG_EXT[file.mimetype]) {
    res.status(400).json({ error: '請上傳 PNG / JPG / GIF / WebP 圖片' });
    return;
  }
  const name = randomBytes(12).toString('hex') + IMG_EXT[file.mimetype];
  fs.writeFileSync(path.join(imageDir, name), file.buffer);
  res.json({ path: '/form-images/' + name });
});

/** 解析「每選項跳段」textarea：每行 `選項 = 區塊id 或 submit`。 */
function parseJumps(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  text.split('\n').forEach((line) => {
    const i = line.indexOf('=');
    if (i < 0) return;
    const opt = line.slice(0, i).trim();
    let target = line.slice(i + 1).trim();
    if (!opt || !target) return;
    if (target === 'submit' || target === '送出' || target === '提交') target = 'submit';
    map[opt] = target;
  });
  return map;
}

function parseInput(body: Record<string, unknown>): FieldInput {
  const typeRaw = String(body.type || 'short_text');
  const type: FieldType = (FIELD_TYPES as string[]).includes(typeRaw)
    ? (typeRaw as FieldType)
    : 'short_text';
  const options = String(body.options || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const sectionId = Number(body.section_id) || undefined;
  return {
    label: String(body.label || '').trim(),
    helpText: String(body.help_text || '').trim(),
    type,
    required: body.required === 'on' || body.required === 'true',
    options,
    allowOther: body.allow_other === 'on' || body.allow_other === 'true',
    regex: String(body.regex || '').trim(),
    regexMessage: String(body.regex_message || '').trim(),
    sectionId,
    optionJumps: parseJumps(String(body.option_jumps || '')),
    content: String(body.content || '').trim(),
    imagePath: String(body.image_path || '').trim(),
    workerEditable: body.worker_editable === 'on' || body.worker_editable === 'true',
  };
}

formsRouter.get('/', (req, res) => {
  const sections = listSections();
  const all = listFields();
  const grouped = sections.map((s) => ({ section: s, fields: all.filter((f) => f.sectionId === s.id) }));
  res.render('admin/forms', {
    sections,
    grouped,
    types: FIELD_TYPES,
    typeLabels: FIELD_TYPE_LABELS,
    flash: takeFlash(req),
  });
});

// ---- 欄位 ----
formsRouter.post('/', (req, res) => {
  const input = parseInput(req.body);
  if (!input.label) {
    req.session.flash = '欄位標題必填';
    res.redirect('/admin/forms');
    return;
  }
  const field = createField(input);
  logAudit(req.session.admin!.email, 'field_created', null, { key: field.key });
  req.session.flash = `已新增欄位「${field.label}」`;
  res.redirect('/admin/forms');
});

formsRouter.post('/:id/update', (req, res) => {
  const id = Number(req.params.id);
  const input = parseInput(req.body);
  if (!input.label) {
    req.session.flash = '欄位標題必填';
    res.redirect('/admin/forms');
    return;
  }
  updateField(id, input);
  logAudit(req.session.admin!.email, 'field_updated', null, { id });
  req.session.flash = '已更新欄位';
  res.redirect('/admin/forms');
});

formsRouter.post('/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  const field = getField(id);
  deleteField(id);
  logAudit(req.session.admin!.email, 'field_deleted', null, { key: field?.key });
  req.session.flash = '已刪除欄位';
  res.redirect('/admin/forms');
});

formsRouter.post('/:id/move', (req, res) => {
  moveField(Number(req.params.id), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/forms');
});

// ---- 區塊 sections ----
formsRouter.post('/sections', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) {
    req.session.flash = '區塊標題必填';
    res.redirect('/admin/forms');
    return;
  }
  createSection(title, String(req.body.description || '').trim());
  logAudit(req.session.admin!.email, 'section_created', null, { title });
  req.session.flash = `已新增區塊「${title}」`;
  res.redirect('/admin/forms');
});

formsRouter.post('/sections/:sid/update', (req, res) => {
  const title = String(req.body.title || '').trim();
  if (title) updateSection(Number(req.params.sid), title, String(req.body.description || '').trim());
  res.redirect('/admin/forms');
});

formsRouter.post('/sections/:sid/delete', (req, res) => {
  const ok = deleteSection(Number(req.params.sid));
  req.session.flash = ok ? '已刪除區塊（欄位已移到第一區塊）' : '至少要保留一個區塊';
  logAudit(req.session.admin!.email, 'section_deleted', null, { sid: req.params.sid });
  res.redirect('/admin/forms');
});

formsRouter.post('/sections/:sid/move', (req, res) => {
  moveSection(Number(req.params.sid), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/forms');
});
