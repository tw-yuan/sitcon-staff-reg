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

/** 確保表頭欄位齊全（欄位變多時補寫），並回傳「實際生效」的表頭，供呼叫端定位欄位。 */
async function ensureHeader(): Promise<string[]> {
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`,
    }),
  );
  const header = buildHeader(listFields());
  const existing = (res.data.values?.[0] || []).map((h) => String(h));
  if (existing.length < header.length) {
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [header] },
      }),
    );
    return header;
  }
  return existing;
}

/** Sheets API 有「每分鐘讀寫次數」配額，撞到時回 429；退避重試比整批失敗好。 */
function isRetryable(err: unknown): boolean {
  const code = Number((err as { code?: number | string })?.code);
  const msg = err instanceof Error ? err.message : String(err);
  return code === 429 || code === 503 || code === 500 || /quota|rate limit/i.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 3 ** i)); // 2s → 6s → 18s，讓每分鐘配額回補
    }
  }
  throw lastErr;
}

/** 新增一列，回傳該列的 row index（1-based）。 */
export async function appendSubmissionRow(sub: Submission): Promise<number> {
  if (!featureReady.sheets()) throw new Error('Google Sheet 尚未設定（RESPONSES_SPREADSHEET_ID）');
  await ensureHeader();
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const res = await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [buildRow(sub, listFields())] },
    }),
  );
  const updatedRange = res.data.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * 更新既有列（admin 編輯 / 狀態變更後同步）。回傳實際寫入的列號（0 = 沒寫）。
 *
 * 不再無條件相信本地 sheetRow：只要有人在試算表手動刪／插入列，
 * 下面的所有列號就會整體位移，本地存的 sheetRow 會指到「別人的列」，
 * 一寫下去就會覆蓋掉別人的資料，同時讓自己在表上多出一筆重複。
 * 因此寫入前先讀該列的 Email 對一下，對不上就改走以 Email 為鍵的 upsert。
 * 呼叫端應把回傳值寫回本地 sheetRow 保持同步。
 */
export async function updateSubmissionRow(sub: Submission): Promise<number> {
  if (!featureReady.sheets()) return 0;
  if (!sub.sheetRow) {
    const { row } = await upsertSubmissionRow(sub);
    return row;
  }
  if (!(await rowBelongsTo(sub.sheetRow, sub.googleEmail))) {
    const { row } = await upsertSubmissionRow(sub);
    return row;
  }
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${sub.sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [buildRow(sub, listFields())] },
    }),
  );
  return sub.sheetRow;
}

/** 該列的 Email 欄是否真的是這個人（防止列位移後覆蓋到別人）。 */
async function rowBelongsTo(row: number, email: string): Promise<boolean> {
  const target = email.trim().toLowerCase();
  if (!target) return false;
  let col = await headerColumnIndex('Email');
  if (col < 0) col = 2;
  const letter = columnLetter(col);
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${letter}${row}`,
    }),
  );
  return String(res.data.values?.[0]?.[0] ?? '').trim().toLowerCase() === target;
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
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!1:1` }),
  );
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
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${letter}2:${letter}`, // 從第 2 列起，跳過表頭
    }),
  );
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
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A${existingRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [buildRow(sub, listFields())] },
      }),
    );
    return { row: existingRow, mode: 'updated' };
  }
  const row = await appendSubmissionRow(sub);
  return { row, mode: 'appended' };
}

export type SyncProgress = {
  phase: string;
  total: number;
  done: number;
  updated: number;
  appended: number;
  failed: number;
};

export type SyncAllResult = {
  total: number;
  updated: number;
  appended: number;
  failed: number;
  firstError: string;
  /** submission id → 實際所在列，呼叫端寫回本地 sheetRow。 */
  rowById: Map<number, number>;
};

/** 一次 batchUpdate 最多帶幾個 range：太大單次太久、太小 API 次數又多。 */
const BATCH_CHUNK = 25;

/**
 * 把「全部」登錄一次同步進 Sheet。以 Email 為鍵：有列就更新、沒列就新增。
 *
 * 舊做法是每筆各自 upsert，一筆要 3 次讀取（表頭、Email 欄、再加找列），
 * 100 多筆就 300 多次讀取，必定撞上 Sheets 的「每分鐘讀取次數」配額而整批出錯，
 * 而且慢到讓反向代理回 504。這裡改成：整張表的 Email 欄只讀一次，
 * 更新用 values.batchUpdate 分批送、新增併成一次 append，總共約 2 次讀 + 數次寫。
 */
export async function syncAllSubmissionRows(
  subs: Submission[],
  onProgress: (p: SyncProgress) => void = () => {},
): Promise<SyncAllResult> {
  if (!featureReady.sheets()) {
    throw new Error('Google Sheet 尚未設定（缺 responses_spreadsheet_id 或 service account）');
  }
  const result: SyncAllResult = {
    total: subs.length,
    updated: 0,
    appended: 0,
    failed: 0,
    firstError: '',
    rowById: new Map(),
  };
  const report = (phase: string, done: number) =>
    onProgress({
      phase,
      total: result.total,
      done,
      updated: result.updated,
      appended: result.appended,
      failed: result.failed,
    });
  const noteError = (err: unknown, count: number) => {
    result.failed += count;
    if (!result.firstError) result.firstError = err instanceof Error ? err.message : String(err);
  };

  report('讀取表頭…', 0);
  const header = await ensureHeader();
  let emailCol = header.findIndex((h) => String(h).trim() === 'Email');
  if (emailCol < 0) emailCol = 2; // 保險：Email 固定在第 3 欄（C）

  report('讀取試算表現有資料…', 0);
  const sheets = sheetsClient();
  const { spreadsheetId, sheetName } = config.sheets;
  const letter = columnLetter(emailCol);
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!${letter}2:${letter}`, // 從第 2 列起，跳過表頭
    }),
  );
  const emailRow = new Map<string, number>();
  (res.data.values || []).forEach((r, i) => {
    const email = String(r?.[0] ?? '').trim().toLowerCase();
    if (!email || emailRow.has(email)) return; // 與 findRowByEmail 一致：重複只認第一列
    emailRow.set(email, i + 2); // +2：跳表頭且轉 1-based
  });

  const fields = listFields();
  const toUpdate: { sub: Submission; row: number }[] = [];
  const toAppend: Submission[] = [];
  for (const sub of subs) {
    const row = emailRow.get(sub.googleEmail.trim().toLowerCase());
    if (row) toUpdate.push({ sub, row });
    else toAppend.push(sub);
  }

  let done = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_CHUNK) {
    const chunk = toUpdate.slice(i, i + BATCH_CHUNK);
    try {
      await withRetry(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: chunk.map(({ sub, row }) => ({
              range: `${sheetName}!A${row}`,
              values: [buildRow(sub, fields)],
            })),
          },
        }),
      );
      chunk.forEach(({ sub, row }) => result.rowById.set(sub.id, row));
      result.updated += chunk.length;
    } catch (err) {
      noteError(err, chunk.length);
    }
    done += chunk.length;
    report(`更新既有資料列…`, done);
  }

  if (toAppend.length) {
    report('新增缺少的資料列…', done);
    try {
      const appendRes = await withRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: toAppend.map((sub) => buildRow(sub, fields)) },
        }),
      );
      // updatedRange 形如 web_response!A111:N118，起始列 + 索引即為各筆實際列號
      const match = (appendRes.data.updates?.updatedRange || '').match(/!A(\d+)/);
      const startRow = match ? parseInt(match[1], 10) : 0;
      if (startRow) toAppend.forEach((sub, i) => result.rowById.set(sub.id, startRow + i));
      result.appended += toAppend.length;
    } catch (err) {
      noteError(err, toAppend.length);
    }
    done += toAppend.length;
  }

  report(result.failed ? '完成（有失敗）' : '完成', done);
  return result;
}
