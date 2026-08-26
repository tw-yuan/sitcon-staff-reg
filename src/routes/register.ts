import express, { Router } from 'express';
import multer from 'multer';
import { config, featureReady } from '../config';
import { allLinked, sessionIdentity, takeFlash } from '../auth/session';
import { WORKER_PROVIDERS, getProvider } from '../auth/providers';
import { Field, listFields, listWorkerEditableFields, isDisplayType } from '../models/fields';
import { Section, listSections } from '../models/sections';
import {
  createSubmission,
  findByIdentity,
  findByEditToken,
  sameAnswer,
  setSheetRow,
  getSubmission,
  updateAnswers,
} from '../models/submissions';
import { isFormOpen, getClosedMessage } from '../models/formState';
import { getDraft, saveDraft, deleteDraft } from '../models/drafts';
import { interpolateFields } from '../services/interpolate';
import { validateAnswers } from '../validation/validate';
import { computeVisitedSections } from '../validation/branching';
import { uploadBuffer } from '../services/drive';
import { appendSubmissionRow, upsertSubmissionRow } from '../services/sheets';
import { sendReceivedMail } from '../services/mailer';
import { notifyNewSubmission, notifyAnswersUpdated } from '../services/telegramNotify';
import { logAudit } from '../models/audit';

export const registerRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

/**
 * multer/busboy 以 latin1 解析 multipart 的欄位「名稱」（busboy defParamCharset 預設 latin1），
 * 中文欄位 key 會變亂碼（例如「暱稱」→「æ±ç¨±」），導致找不到任何欄位、全部誤判必填。
 * 這裡把 key 的 latin1 位元組還原回 UTF-8。只在 multipart 請求套用，避免破壞 urlencoded 已正確解出的 key。
 */
function fixMultipartUtf8Keys(req: import('express').Request): void {
  if (!req.is('multipart/form-data')) return;
  const relatin = (s: string) => Buffer.from(s, 'latin1').toString('utf8');
  if (req.body && typeof req.body === 'object') {
    const fixed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) fixed[relatin(k)] = v;
    req.body = fixed;
  }
  for (const file of (req.files as Express.Multer.File[]) || []) {
    file.fieldname = relatin(file.fieldname);
    if (file.originalname) file.originalname = relatin(file.originalname);
  }
}

function groupedSections(sections: Section[], all: Field[]) {
  return sections.map((s) => ({ section: s, fields: all.filter((f) => f.sectionId === s.id) }));
}

function providerStatus(req: import('express').Request) {
  const linked = req.session.linked || {};
  return WORKER_PROVIDERS.map((name) => {
    const def = getProvider(name);
    let isLinked = false;
    let value = '';
    if (name === 'google' && linked.google) {
      isLinked = true;
      value = linked.google.email;
    } else if (name === 'github' && linked.github) {
      isLinked = true;
      value = `${linked.github.login} (${linked.github.id})`;
    } else if (name === 'gitlab' && linked.gitlab) {
      isLinked = true;
      value = `${linked.gitlab.username} (${linked.gitlab.id})`;
    }
    return {
      name,
      configured: !!(def.clientId && def.clientSecret),
      linked: isLinked,
      value,
    };
  });
}

function telegramStatus(req: import('express').Request) {
  const tg = req.session.linked && req.session.linked.telegram;
  return {
    configured: featureReady.telegramLogin(),
    linked: !!tg,
    botUsername: config.telegram.botUsername,
    // bot_id = bot token 冒號前的數字，非機密（登入彈窗需要），供自訂按鈕呼叫 Telegram.Login.auth。
    botId: config.telegram.botToken.split(':')[0] || '',
    value: tg ? (tg.username ? `${tg.username} (${tg.id})` : `(id: ${tg.id})`) : '',
    username: tg ? tg.username || '' : '',
  };
}

// Telegram username 為必要條件：沒設 username 不能開始填表（設定後點「重新登入」才會帶入）。
function tgUsernameMissing(req: import('express').Request): boolean {
  const tg = req.session.linked && req.session.linked.telegram;
  return !!tg && !tg.username;
}

// 已登錄過者看到的「登錄完畢」畫面：帶入修改連結（若有開放修改的欄位）。
function renderAlready(
  res: import('express').Response,
  submission: import('../models/submissions').Submission,
  flash: string,
): void {
  const canEdit = listWorkerEditableFields().length > 0;
  const editLink = canEdit
    ? `${config.baseUrl.replace(/\/+$/, '')}/edit/${submission.editToken}`
    : '';
  res.render('already', { submission, flash, editable: canEdit, editLink });
}

registerRouter.get('/', (req, res) => {
  const flash = takeFlash(req);
  // 只要 Google 已登入，先查是否已登錄過；有的話直接顯示「已登錄」＋修改連結，
  // 不必再連結其餘帳號（返場工人的常見情況）。
  const linked = req.session.linked;
  if (linked && linked.google) {
    const existing = findByIdentity(linked.google.email);
    if (existing) {
      renderAlready(res, existing, flash);
      return;
    }
  }
  if (!allLinked(req) || tgUsernameMissing(req)) {
    res.render('login', { providers: providerStatus(req), telegram: telegramStatus(req), flash });
    return;
  }
  const identity = sessionIdentity(req)!;
  // 走到這裡代表尚未登錄（已登錄者已於上方攔截）
  if (!isFormOpen()) {
    res.render('closed', { message: getClosedMessage(), flash });
    return;
  }
  const sections = listSections();
  const draft = getDraft(identity.googleEmail); // 跨裝置草稿：灌回表單初值
  res.render('register', {
    identity,
    sections,
    grouped: groupedSections(sections, interpolateFields(listFields(), identity)),
    errors: {},
    values: draft ? draft.data : {},
    draftTs: draft ? draft.updatedMs : 0,
    flash,
  });
});

// 工人填寫時即時把草稿存到伺服器（以登入身分的 email 為鍵，跨裝置接續）。
// 只信任 session 身分，不採用前端傳來的任何識別；避免跨帳號竄改。
registerRouter.post('/register/draft', express.json({ limit: '256kb' }), (req, res) => {
  const identity = sessionIdentity(req);
  if (!identity) {
    res.status(401).json({ ok: false });
    return;
  }
  if (findByIdentity(identity.googleEmail)) {
    // 已送出登錄就不再收草稿
    res.status(409).json({ ok: false });
    return;
  }
  const body = req.body as unknown;
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const ts = saveDraft(identity.googleEmail, data);
  res.json({ ok: true, ts });
});

registerRouter.post('/register', upload.any(), async (req, res, next) => {
  try {
    fixMultipartUtf8Keys(req); // 修正 multipart 中文欄位名亂碼（見函式說明）
    const identity = sessionIdentity(req);
    if (!identity) {
      res.redirect('/');
      return;
    }
    if (!identity.telegramUsername) {
      // 伺服器權威：沒設 username 一律擋下（登入頁會顯示教學與「重新登入」）
      req.session.flash = '請先設定 Telegram username，再點 Telegram 重新登入';
      res.redirect('/');
      return;
    }
    if (findByIdentity(identity.googleEmail)) {
      renderAlready(res, findByIdentity(identity.googleEmail)!, '你已經登錄過了');
      return;
    }
    if (!isFormOpen()) {
      res.status(403).render('closed', { message: getClosedMessage(), flash: '' });
      return;
    }

    const allFields = listFields();
    const sections = listSections();
    const body = req.body as Record<string, unknown>;

    // 伺服器權威：依提交答案重算應經過的區塊，只處理這條路徑上的欄位
    const raw = (k: string): string => {
      const v = body[k];
      return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
    };
    const visited = new Set(computeVisitedSections(sections, allFields, raw));
    const onPathFields = allFields.filter((f) => visited.has(f.sectionId));

    const files = (req.files as Express.Multer.File[]) || [];
    const fileMap = new Map<string, Express.Multer.File>();
    for (const f of files) if (!fileMap.has(f.fieldname)) fileMap.set(f.fieldname, f);
    const providedFileKeys = new Set(fileMap.keys());

    const result = validateAnswers(onPathFields, body, providedFileKeys);
    const errors = { ...result.errors };

    // 工作組改由 admin 於審核時指定，工人不填
    const workgroupId: number | null = null;

    if (Object.keys(errors).length > 0) {
      console.warn(
        '[register] 驗證失敗 email=%s visited=%j errors=%j onPathKeys=%j',
        identity.googleEmail,
        [...visited],
        errors,
        onPathFields.map((f) => f.key),
      );
      res.status(400).render('register', {
        identity,
        sections,
        grouped: groupedSections(sections, interpolateFields(allFields, identity)),
        errors,
        values: body,
        draftTs: 0, // 此頁已帶入本次送出值，交由 localStorage 處理即可
        flash: '',
      });
      return;
    }

    // 只上傳路徑上的檔案欄位
    const answers: Record<string, unknown> = { ...result.values };
    for (const f of onPathFields) {
      if (f.type !== 'file') continue;
      const file = fileMap.get(f.key);
      if (!file) continue;
      if (featureReady.driveUpload()) {
        const uploaded = await uploadBuffer(file.originalname, file.mimetype, file.buffer);
        answers[f.key] = { name: uploaded.name, link: uploaded.link, id: uploaded.id };
      } else {
        answers[f.key] = { name: file.originalname, link: '', note: 'Drive 未設定，僅記錄檔名' };
      }
    }

    const submission = createSubmission({ identity, workgroupId, answers });
    deleteDraft(identity.googleEmail); // 已成功送出，清掉伺服器草稿
    logAudit('system', 'submission_created', submission.id, { email: identity.googleEmail });

    try {
      const row = await appendSubmissionRow(getSubmission(submission.id)!);
      if (row) setSheetRow(submission.id, row);
    } catch (err) {
      console.error('[sheets] 寫入失敗', err);
      logAudit('system', 'sheet_write_failed', submission.id, { error: String(err) });
    }

    void sendReceivedMail(submission);
    void notifyNewSubmission(submission); // Telegram 群組通知（未設定則安靜略過）

    const canEdit = listWorkerEditableFields().length > 0;
    const editLink = canEdit
      ? `${config.baseUrl.replace(/\/+$/, '')}/edit/${submission.editToken}`
      : '';
    res.render('submitted', { submission, editable: canEdit, editLink });
  } catch (err) {
    next(err);
  }
});

// ---- 工人事後修改（密鑰連結，免登入）----
// 只開放「允許工人事後修改」的欄位；表單截止後不給改。
// 與 /register 相同：依答案重算分段路徑，路徑外的欄位不顯示、不驗證（否則
// 第一次分支沒經過的必填欄位會在修改時被誤判未填而卡住）。

function rawFromAnswers(answers: Record<string, unknown>): (k: string) => string {
  return (k: string): string => {
    const v = answers[k];
    if (Array.isArray(v)) return String(v[0] ?? '');
    if (v && typeof v === 'object') return ''; // 檔案欄位等物件值，不會是分段題
    return String(v ?? '');
  };
}

function visitedSectionsFor(rawAnswer: (k: string) => string): Set<number> {
  return new Set(computeVisitedSections(listSections(), listFields(), rawAnswer));
}

function renderEdit(
  res: import('express').Response,
  sub: import('../models/submissions').Submission,
  fields: Field[],
  values: Record<string, unknown>,
  errors: Record<string, string>,
  opts: { flash?: string; saved?: boolean; status?: number } = {},
): void {
  if (opts.status) res.status(opts.status);
  // 修改頁免登入、無 session 身分，改用「這筆登錄」的資料做 $email 等變數帶入。
  const idVars = {
    googleEmail: sub.googleEmail,
    githubLogin: sub.githubLogin,
    gitlabUsername: sub.gitlabUsername,
    telegramUsername: sub.telegramUsername,
    telegramId: sub.telegramId,
  };
  // 唯讀檢視也只列「這筆登錄實際經過的路徑」上的填答欄位
  const visited = visitedSectionsFor(rawFromAnswers(sub.answers));
  res.render('edit', {
    token: sub.editToken,
    sub,
    fields: interpolateFields(fields, idVars),
    allFields: interpolateFields(
      listFields().filter((f) => !isDisplayType(f.type) && visited.has(f.sectionId)),
      idVars,
    ),
    values,
    errors,
    flash: opts.flash || '',
    saved: !!opts.saved,
  });
}

registerRouter.get('/edit/:token', (req, res) => {
  const sub = findByEditToken(String(req.params.token));
  if (!sub) {
    res.status(404).render('error', { title: '連結無效', message: '找不到對應的登錄，連結可能已失效。' });
    return;
  }
  if (!isFormOpen()) {
    res.render('closed', { message: getClosedMessage(), flash: '' });
    return;
  }
  const visited = visitedSectionsFor(rawFromAnswers(sub.answers));
  const editable = listWorkerEditableFields().filter((f) => visited.has(f.sectionId));
  renderEdit(res, sub, editable, sub.answers, {}, { flash: takeFlash(req) });
});

registerRouter.post('/edit/:token', upload.any(), async (req, res, next) => {
  try {
    fixMultipartUtf8Keys(req);
    const sub = findByEditToken(String(req.params.token));
    if (!sub) {
      res.status(404).render('error', { title: '連結無效', message: '找不到對應的登錄，連結可能已失效。' });
      return;
    }
    if (!isFormOpen()) {
      res.status(403).render('closed', { message: getClosedMessage(), flash: '' });
      return;
    }

    const editableAll = listWorkerEditableFields();
    const body = req.body as Record<string, unknown>;

    // 伺服器權威：重算分段路徑。分段題若開放修改就採本次送出的值，否則用原登錄的答案。
    const editableKeys = new Set(editableAll.map((f) => f.key));
    const storedRaw = rawFromAnswers(sub.answers);
    const bodyRaw = (k: string): string => {
      const v = body[k];
      return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
    };
    const visited = visitedSectionsFor((k) => (editableKeys.has(k) ? bodyRaw(k) : storedRaw(k)));
    const editable = editableAll.filter((f) => visited.has(f.sectionId));

    const files = (req.files as Express.Multer.File[]) || [];
    const fileMap = new Map<string, Express.Multer.File>();
    for (const f of files) if (!fileMap.has(f.fieldname)) fileMap.set(f.fieldname, f);
    const providedFileKeys = new Set(fileMap.keys());
    // 檔案欄位若已有舊檔、這次沒重傳，視為「已提供」以免必填誤判
    for (const f of editable) {
      if (f.type !== 'file') continue;
      const cur = sub.answers[f.key] as { name?: string } | undefined;
      if (cur && cur.name) providedFileKeys.add(f.key);
    }

    const result = validateAnswers(editable, body, providedFileKeys);
    if (Object.keys(result.errors).length > 0) {
      renderEdit(res, sub, editable, body, result.errors, { status: 400 });
      return;
    }

    // 只覆蓋開放編輯的欄位，其餘保留原值。
    // 分支改變後不在路徑上的可編輯欄位，答案一併清除（與 /register 不收路徑外答案一致）。
    const answers: Record<string, unknown> = { ...sub.answers };
    for (const f of editableAll) {
      if (!visited.has(f.sectionId)) delete answers[f.key];
    }
    for (const f of editable) {
      if (f.type === 'file') {
        const file = fileMap.get(f.key);
        if (!file) continue; // 沒重新上傳 → 保留原檔
        if (featureReady.driveUpload()) {
          const uploaded = await uploadBuffer(file.originalname, file.mimetype, file.buffer);
          answers[f.key] = { name: uploaded.name, link: uploaded.link, id: uploaded.id };
        } else {
          answers[f.key] = { name: file.originalname, link: '', note: 'Drive 未設定，僅記錄檔名' };
        }
      } else {
        answers[f.key] = result.values[f.key];
      }
    }

    // 比對新舊答案，找出實際有變動的欄位（含分支改變被清除的答案；空值視為未填），供 Telegram 通知列出
    const changedFields = editableAll.filter((f) => !sameAnswer(sub.answers[f.key], answers[f.key]));

    updateAnswers(sub.id, answers);
    logAudit('worker', 'answers_edited_by_worker', sub.id, { keys: editable.map((f) => f.key) });

    // 同步 Google Sheet（以 email 為鍵 upsert；失敗不擋住工人，記錄即可）
    try {
      const { row } = await upsertSubmissionRow(getSubmission(sub.id)!);
      if (row) setSheetRow(sub.id, row);
    } catch (err) {
      console.error('[sheets] 修改後同步失敗', err);
      logAudit('worker', 'sheet_write_failed', sub.id, { error: String(err) });
    }

    const fresh = getSubmission(sub.id)!;
    void notifyAnswersUpdated(fresh, changedFields.map((f) => f.label)); // Telegram 群組通知（無變更或未設定則安靜略過）

    renderEdit(res, fresh, editable, fresh.answers, {}, { saved: true });
  } catch (err) {
    next(err);
  }
});
