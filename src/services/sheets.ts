import { config, featureReady } from '../config';
import { sheetsClient } from './google';
import { listFields, isDisplayType, Field } from '../models/fields';
import { getWorkGroup } from '../models/workgroups';
import { STATUS_LABELS, Submission } from '../models/submissions';

const FIXED_HEADERS = [
  '登錄時間',
  '狀態',
  'Email',
  'GitHub',
  'GitHub ID',
  'GitLab',
  'GitLab ID',
  'Telegram',
  'Telegram ID',
  '工作組',
];

function buildHeader(fields: Field[]): string[] {
  return [...FIXED_HEADERS, ...fields.filter((f) => !isDisplayType(f.type)).map((f) => f.label)];
}

function cellValue(f: Field, answers: Record<string, unknown>): string {
  const v = answers[f.key];
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (f.type === 'file' && typeof v === 'object') {
    const file = v as { link?: string; name?: string };
    return file.link || file.name || '';
  }
  return String(v);
}

function buildRow(sub: Submission, fields: Field[]): string[] {
  const wg = sub.workgroupId ? getWorkGroup(sub.workgroupId)?.name || '' : '';
  return [
    sub.createdAt,
    STATUS_LABELS[sub.status],
    sub.googleEmail,
    sub.githubLogin,
    sub.githubId,
    sub.gitlabUsername,
    sub.gitlabId,
    sub.telegramUsername ? `@${sub.telegramUsername}` : '',
    sub.telegramId,
    wg,
    ...fields.filter((f) => !isDisplayType(f.type)).map((f) => cellValue(f, sub.answers)),
  ];
}

async function ensureHeader(): Promise<void> {
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const header = buildHeader(listFields());
  const existing = res.data.values?.[0] || [];
  if (existing.length < header.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
  }
}

/** 新增一列，回傳該列的 row index（1-based）。 */
export async function appendSubmissionRow(sub: Submission): Promise<number> {
  if (!featureReady.sheets()) throw new Error('Google Sheet 尚未設定（RESPONSES_SPREADSHEET_ID）');
  await ensureHeader();
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [buildRow(sub, listFields())] },
  });
  const updatedRange = res.data.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** 更新既有列（admin 編輯 / 狀態變更後同步）。 */
export async function updateSubmissionRow(sub: Submission): Promise<void> {
  if (!featureReady.sheets() || !sub.sheetRow) return;
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${sub.sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [buildRow(sub, listFields())] },
  });
}

/** 0-based 欄位索引 → A1 欄名（0→A、25→Z、26→AA）。 */
function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 讀表頭找出欄名對應的欄位索引（0-based）；找不到回 -1。 */
async function headerColumnIndex(label: string): Promise<number> {
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!1:1` });
  const header = res.data.values?.[0] || [];
  return header.findIndex((h) => String(h).trim() === label);
}

/** 在 Sheet 的 Email 欄找出與 email 相同的資料列（1-based，跳過表頭）；找不到回 null。大小寫不敏感。 */
async function findRowByEmail(email: string): Promise<number | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  let col = await headerColumnIndex('Email');
  if (col < 0) col = 2; // 保險：Email 固定在第 3 欄（C）
  const letter = columnLetter(col);
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${letter}2:${letter}`, // 從第 2 列起，跳過表頭
  });
  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? '').trim().toLowerCase() === target) return i + 2; // +2：跳表頭且轉 1-based
  }
  return null;
}

/**
 * 手動 upsert：以 Email 為鍵，在 Sheet 中查找相同 email 的資料列 —— 找到就更新該列，找不到才新增。
 * 不依賴本地 sheetRow（可能為空或過期），改以 Sheet 現況為準；即使列被搬動或本地重建也能對上。
 * 失敗會「拋出」而非靜默略過，讓後台按鈕能顯示真正的錯誤原因
 * （例如試算表未分享給 service account 時的 "The caller does not have permission"）。
 * 回傳 { row, mode }；呼叫端應把 row 寫回本地 sheetRow 保持同步。
 */
export async function upsertSubmissionRow(
  sub: Submission,
): Promise<{ row: number; mode: 'appended' | 'updated' }> {
  if (!featureReady.sheets()) {
    throw new Error('Google Sheet 尚未設定（缺 responses_spreadsheet_id 或 service account）');
  }
  await ensureHeader();
  const existingRow = await findRowByEmail(sub.googleEmail);
  if (existingRow) {
    const sheets = sheetsClient();
    const { spreadsheetId, sheetName } = config.sheets;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${existingRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [buildRow(sub, listFields())] },
    });
    return { row: existingRow, mode: 'updated' };
  }
  const row = await appendSubmissionRow(sub);
  return { row, mode: 'appended' };
}
