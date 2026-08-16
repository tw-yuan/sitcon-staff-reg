import { Router } from 'express';
import { takeFlash } from '../../auth/session';
import { callbackUrl, config, featureReady } from '../../config';
import { getAllSettings, setSettings } from '../../models/settings';
import { refreshConfig } from '../../runtimeConfig';
import { logAudit } from '../../models/audit';
import { TESTS } from '../../services/connectionTests';
import { MAIL_TEMPLATES, sendMail } from '../../services/mailer';

interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
  textarea?: boolean;
  default?: string; // 未儲存時於表單預填（例如信件模板）
}
interface TestDef {
  target: string;
  label: string;
}
interface Group {
  title: string;
  fields: FieldDef[];
  tests?: TestDef[];
  callbackProvider?: 'google' | 'github' | 'gitlab';
  telegramNote?: boolean;
  emailTest?: boolean;
}

export const SETTINGS_GROUPS: Group[] = [
  {
    title: '基本',
    fields: [
      { key: 'base_url', label: 'Base URL', hint: '對外完整網址，例如 https://reg.sitcon.org（OAuth callback 依此組成）' },
      { key: 'admin_emails', label: 'Admin Email allowlist', hint: '可進後台的 Google 帳號，逗號分隔' },
      { key: 'max_upload_mb', label: '單檔上傳上限 (MB)' },
    ],
  },
  {
    title: 'Google 登入（工人 Email + admin）',
    fields: [
      { key: 'google_client_id', label: 'Google Client ID' },
      { key: 'google_client_secret', label: 'Google Client Secret', secret: true },
    ],
    callbackProvider: 'google',
  },
  {
    title: 'GitHub（僅蒐集帳號，不做權限開通）',
    fields: [
      { key: 'github_client_id', label: 'OAuth Client ID' },
      { key: 'github_client_secret', label: 'OAuth Client Secret', secret: true },
    ],
    callbackProvider: 'github',
  },
  {
    title: 'GitLab',
    fields: [
      { key: 'gitlab_base_url', label: 'Base URL', hint: '預設 https://gitlab.com' },
      { key: 'gitlab_client_id', label: 'OAuth Application ID' },
      { key: 'gitlab_client_secret', label: 'OAuth Secret', secret: true },
      { key: 'gitlab_token', label: 'Owner/Maintainer Token（provisioning 用）', secret: true },
    ],
    tests: [{ target: 'gitlab', label: '測試 GitLab token' }],
    callbackProvider: 'gitlab',
  },
  {
    title: 'Telegram',
    fields: [
      { key: 'telegram_bot_username', label: 'Bot username（不含 @）' },
      { key: 'telegram_bot_token', label: 'Bot Token', secret: true },
    ],
    tests: [{ target: 'telegram', label: '測試 Bot token' }],
    telegramNote: true,
  },
  {
    title: 'Telegram 通知（有人完成登錄時發到群組）',
    fields: [
      {
        key: 'telegram_notify_chat_id',
        label: '通知群組 chat_id',
        hint: '沿用上方 Telegram Bot。把 bot 加進群組後，在群組發一則訊息，開 https://api.telegram.org/bot<TOKEN>/getUpdates 找 chat.id（群組通常是負數，例如 -1001234567890）。留空＝不通知。',
      },
      {
        key: 'telegram_notify_nickname_field',
        label: '暱稱要取哪個欄位（選填）',
        hint: '填欄位「標題」或 key，決定 {{nickname}} 取自哪一題；留空則自動抓標題含「暱稱／名字／姓名／name」的欄位。',
      },
      {
        key: 'telegram_notify_template',
        label: '通知訊息模板',
        textarea: true,
        default: '[SITCON 2027 工人登錄]\n{{telegram}} {{nickname}} 已完成登錄',
        hint: '可用變數：{{telegram}}（@username，沒設 username 時退回 email）、{{telegram_username}}、{{email}}、{{nickname}}（也支援 {$var} 寫法）。留空＝用預設。',
      },
    ],
    tests: [{ target: 'telegram_notify', label: '發送測試通知到群組' }],
  },
  {
    title: 'Google Sheets / Drive',
    fields: [
      { key: 'responses_spreadsheet_id', label: '回應試算表 ID' },
      { key: 'responses_sheet_name', label: '分頁名稱（預設 Responses）' },
      { key: 'drive_upload_folder_id', label: '檔案上傳資料夾 ID' },
      {
        key: 'google_drive_impersonate_email',
        label: 'Drive 模擬管理員信箱（Shared Drive 用，選填）',
        hint: '有填則 Drive 分享/上傳改以此人身分執行（模擬一位 Shared Drive 的 Manager，SA 就不用加入硬碟，也能加人到限制存取資料夾）；需在 domain-wide delegation 額外授權 https://www.googleapis.com/auth/drive。留空＝SA 直連（需把資料夾分享給 SA）。',
      },
      {
        key: 'google_service_account_json',
        label: 'Service Account 金鑰 JSON',
        secret: true,
        textarea: true,
        hint: '貼上整份 JSON；記得把試算表與上傳資料夾分享給該 service account 的 email',
      },
    ],
    tests: [
      { target: 'sheets', label: '測試試算表' },
      { target: 'drive', label: '測試上傳資料夾' },
    ],
  },
  {
    title: 'Google Groups（Workspace）',
    fields: [
      {
        key: 'google_workspace_admin_email',
        label: '要模擬的 Workspace 管理員信箱',
        hint: '加入/移出 Google Groups 需 service account 開 domain-wide delegation，並授權 admin.directory.group.member 範圍、模擬一位有權限的管理員',
      },
    ],
    tests: [{ target: 'google_group', label: '測試 Google Groups 授權' }],
  },
  {
    title: 'Email (SMTP)',
    fields: [
      { key: 'smtp_host', label: 'SMTP Host' },
      { key: 'smtp_port', label: 'Port（預設 587）' },
      { key: 'smtp_secure', label: '使用 TLS（true / false）' },
      { key: 'smtp_user', label: '帳號' },
      { key: 'smtp_pass', label: '密碼', secret: true },
      { key: 'smtp_from', label: '寄件人', hint: '可含顯示名稱，例如 SITCON 2027 行政組 <sitcon-reg@ncse.tw>；網域需設好 SPF/DKIM/DMARC' },
      { key: 'smtp_reply_to', label: 'Reply-To（回覆信箱）', hint: '留空＝以寄件人為回覆對象；可填真正收信的信箱，例如 sitcon-reg@ncse.tw' },
    ],
    tests: [{ target: 'smtp', label: '測試 SMTP 連線' }],
    emailTest: true,
  },
  {
    title: '信件模板',
    fields: Object.values(MAIL_TEMPLATES).flatMap((t): FieldDef[] => [
      { key: t.subjectKey, label: `${t.label} — 主旨`, default: t.subject, hint: `可用變數：${t.vars.join('、')}（留空＝用預設）` },
      { key: t.bodyKey, label: `${t.label} — 內文（HTML）`, textarea: true, default: t.body },
    ]),
  },
];

const ALL_FIELDS = SETTINGS_GROUPS.flatMap((g) => g.fields);
const SECRET_KEYS = new Set(ALL_FIELDS.filter((f) => f.secret).map((f) => f.key));

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  const current = getAllSettings();
  const values: Record<string, string> = {};
  const isSet: Record<string, boolean> = {};
  for (const f of ALL_FIELDS) {
    isSet[f.key] = !!current[f.key];
    // 秘密欄位不回填明碼；有預設值的欄位（信件模板）未儲存時顯示預設，方便編輯
    values[f.key] = f.secret ? '' : current[f.key] || f.default || '';
  }
  const callbacks = {
    google: callbackUrl('google'),
    github: callbackUrl('github'),
    gitlab: callbackUrl('gitlab'),
  };
  let telegramDomain = '';
  try {
    telegramDomain = new URL(config.baseUrl).host;
  } catch {
    telegramDomain = config.baseUrl;
  }
  res.render('admin/settings', {
    groups: SETTINGS_GROUPS,
    values,
    isSet,
    callbacks,
    telegramDomain,
    flash: takeFlash(req),
  });
});

settingsRouter.post('/', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const toSave: Record<string, string> = {};
  for (const f of ALL_FIELDS) {
    const raw = body[f.key];
    const val = raw === undefined ? '' : String(raw).trim();
    if (val === '') continue; // 留空 = 不變更 / 沿用預設（避免清掉 base URL 等有預設的欄位）
    toSave[f.key] = val;
  }
  setSettings(toSave);
  refreshConfig();
  logAudit(req.session.admin!.email, 'settings_updated', null, {
    keys: Object.keys(toSave).filter((k) => !SECRET_KEYS.has(k)),
  });
  req.session.flash = '設定已儲存';
  res.redirect('/admin/settings');
});

// 一鍵測試連線（使用「已儲存」的設定；回傳 JSON）
settingsRouter.post('/test/:target', async (req, res) => {
  const fn = TESTS[req.params.target];
  if (!fn) {
    res.status(404).json({ ok: false, message: '未知的測試項目' });
    return;
  }
  try {
    res.json(await fn());
  } catch (e) {
    res.json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

// 寄一封測試信到指定信箱（使用已儲存的 SMTP 設定）
settingsRouter.post('/test-email', async (req, res) => {
  const to = String(req.query.to || '').trim();
  if (!to) {
    res.json({ ok: false, message: '請輸入收件信箱' });
    return;
  }
  if (!featureReady.smtp()) {
    res.json({ ok: false, message: '尚未設定 SMTP' });
    return;
  }
  const ok = await sendMail(
    to,
    '【SITCON 2027】測試信',
    '<p>這是一封來自工人登錄系統的測試信。若你收到，代表 SMTP 設定正常。</p>',
  );
  res.json({
    ok,
    message: ok ? `已寄出測試信到 ${to}` : '寄送失敗，請檢查 SMTP 設定與伺服器 log',
  });
});
