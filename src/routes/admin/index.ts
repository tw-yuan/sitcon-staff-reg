import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { requireAdmin, takeFlash } from '../../auth/session';
import { config, featureReady } from '../../config';
import { getSetupKey } from '../../runtimeConfig';
import { listSubmissions, setSheetRow, Status } from '../../models/submissions';
import { upsertSubmissionRow } from '../../services/sheets';
import { isFormOpen, setFormOpen, getClosedMessage, setClosedMessage } from '../../models/formState';
import { nicknameOf } from '../../services/nickname';
import { logAudit } from '../../models/audit';
import { formsRouter } from './forms';
import { workgroupsRouter } from './workgroups';
import { reviewRouter } from './review';
import { settingsRouter } from './settings';

export const adminRouter = Router();

function featureSummary() {
  return [
    { key: 'Google OAuth', ok: featureReady.googleOAuth() },
    { key: 'GitHub OAuth', ok: featureReady.githubOAuth() },
    { key: 'GitLab OAuth', ok: featureReady.gitlabOAuth() },
    { key: 'Telegram 登入', ok: featureReady.telegramLogin() },
    { key: 'Google Sheet', ok: featureReady.sheets() },
    { key: 'Drive 上傳', ok: featureReady.driveUpload() },
    { key: 'Google Groups 開通', ok: featureReady.googleGroups() },
    { key: 'GitLab 開通', ok: featureReady.gitlabProvisioning() },
    { key: 'SMTP 寄信', ok: featureReady.smtp() },
  ];
}

// setup key 為首次設定用的 break-glass，只在「尚未設定任何正式 admin」時開放；
// 一旦設好 admin_emails 就關閉此入口，避免成為永久後門。
function setupLoginAllowed(): boolean {
  return config.adminEmails.length === 0;
}

// 簡易速率限制：同一來源在時間窗內限制設定金鑰嘗試次數，擋線上暴力嘗試。
const SETUP_MAX_ATTEMPTS = 5;
const SETUP_WINDOW_MS = 15 * 60 * 1000;
const setupAttempts = new Map<string, { count: number; first: number }>();

function setupRateLimited(ip: string): boolean {
  const rec = setupAttempts.get(ip);
  if (!rec || Date.now() - rec.first > SETUP_WINDOW_MS) return false;
  return rec.count >= SETUP_MAX_ATTEMPTS;
}

function noteSetupAttempt(ip: string): void {
  const now = Date.now();
  const rec = setupAttempts.get(ip);
  if (!rec || now - rec.first > SETUP_WINDOW_MS) {
    setupAttempts.set(ip, { count: 1, first: now });
  } else {
    rec.count += 1;
  }
}

adminRouter.get('/login', (req, res) => {
  if (req.session.admin) {
    res.redirect('/admin');
    return;
  }
  res.render('admin/login', {
    flash: takeFlash(req),
    googleReady: featureReady.googleOAuth(),
    setupAllowed: setupLoginAllowed(),
  });
});

// 首次設定：以 setup key 登入（Google OAuth 尚未設定前的 break-glass）
adminRouter.post('/setup-login', (req, res) => {
  if (!setupLoginAllowed()) {
    req.session.flash = '已設定行政組帳號，請改用 Google 登入';
    res.redirect('/admin/login');
    return;
  }
  const ip = req.ip || 'unknown';
  if (setupRateLimited(ip)) {
    req.session.flash = '嘗試次數過多，請稍後再試';
    res.redirect('/admin/login');
    return;
  }
  const provided = String(req.body.key || '');
  const actual = getSetupKey();
  const ok =
    !!actual &&
    provided.length === actual.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(actual));
  if (ok) {
    setupAttempts.delete(ip);
    req.session.admin = { email: 'setup' };
    res.redirect('/admin/settings');
    return;
  }
  noteSetupAttempt(ip);
  req.session.flash = '設定金鑰不正確';
  res.redirect('/admin/login');
});

// 以下所有 admin 頁面皆需登入
adminRouter.use(requireAdmin);

adminRouter.get('/', (req, res) => {
  const statusParam = String(req.query.status || '');
  const status = (['pending', 'approved', 'rejected'] as string[]).includes(statusParam)
    ? (statusParam as Status)
    : undefined;
  const q = String(req.query.q || '');
  const submissions = listSubmissions({ status, q }).map((s) => ({ ...s, nickname: nicknameOf(s) }));
  res.render('admin/dashboard', {
    admin: req.session.admin,
    submissions,
    status: statusParam,
    q,
    flash: takeFlash(req),
    features: featureSummary(),
    formOpen: isFormOpen(),
    closedMessage: getClosedMessage(),
    sheetsReady: featureReady.sheets(),
  });
});

// 把資料庫裡「所有」登錄一次 upsert 進 Google Sheet（以 Email 為鍵：有列就更新、沒列就新增）。
// 用途：試算表剛分享給 service account、或本地資料重建後，一次補齊 Sheet。
// 失敗不整批中斷；逐筆累計成功／失敗，最後回報摘要與第一個錯誤原因。
adminRouter.post('/sheet-upsert-all', async (req, res) => {
  if (!featureReady.sheets()) {
    req.session.flash = 'Google Sheet 尚未設定，無法寫入';
    res.redirect('/admin');
    return;
  }
  const subs = listSubmissions();
  let ok = 0;
  let failed = 0;
  let firstError = '';
  for (const sub of subs) {
    try {
      const { row } = await upsertSubmissionRow(sub);
      if (row) setSheetRow(sub.id, row);
      ok += 1;
    } catch (err) {
      failed += 1;
      if (!firstError) firstError = err instanceof Error ? err.message : String(err);
    }
  }
  logAudit(req.session.admin!.email, 'sheet_upsert_all', null, {
    total: subs.length,
    ok,
    failed,
    firstError: firstError || undefined,
  });
  req.session.flash =
    failed === 0
      ? `已同步全部 ${ok} 筆到 Google Sheet`
      : `Google Sheet 同步完成：成功 ${ok} 筆、失敗 ${failed} 筆（第一個錯誤：${firstError}）`;
  res.redirect('/admin');
});

// 表單總開關：截止後工人不能新填、也不能用修改連結編輯。
adminRouter.post('/form-state', (req, res) => {
  const open = String(req.body.open) === '1';
  setFormOpen(open);
  logAudit(req.session.admin!.email, open ? 'form_opened' : 'form_closed', null, {});
  req.session.flash = open ? '表單已開放（可新填 / 可修改）' : '表單已截止（不再接受新填與修改）';
  res.redirect('/admin');
});

adminRouter.post('/form-closed-message', (req, res) => {
  setClosedMessage(String(req.body.message || ''));
  req.session.flash = '已更新截止訊息';
  res.redirect('/admin');
});

adminRouter.use('/forms', formsRouter);
adminRouter.use('/workgroups', workgroupsRouter);
adminRouter.use('/submissions', reviewRouter);
adminRouter.use('/settings', settingsRouter);
