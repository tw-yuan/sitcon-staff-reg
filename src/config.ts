import dotenv from 'dotenv';

dotenv.config();

const env = process.env;

function list(v: string | undefined): string[] {
  return (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// config 為可變物件：先以 env 當預設，啟動後再由 DB 設定覆蓋（applySettings）。
export const config = {
  port: parseInt(env.PORT || '3000', 10),
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || '', // 若空，啟動時由 DB 產生並持久化
  databaseFile: env.DATABASE_FILE || './data/app.db', // 僅能由 env 設定
  maxUploadMb: parseInt(env.MAX_UPLOAD_MB || '10', 10),
  isProd: env.NODE_ENV === 'production',

  adminEmails: list(env.ADMIN_EMAILS).map((s) => s.toLowerCase()),

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    // Google Groups 加人需模擬的 Workspace 管理員信箱（domain-wide delegation）
    workspaceAdminEmail: env.GOOGLE_WORKSPACE_ADMIN_EMAIL || '',
    // 有填則 Drive 操作改以此人身分執行（模擬一位 Shared Drive Manager），SA 不必加入硬碟
    driveImpersonateEmail: env.GOOGLE_DRIVE_IMPERSONATE_EMAIL || '',
  },
  github: {
    clientId: env.GITHUB_CLIENT_ID || '',
    clientSecret: env.GITHUB_CLIENT_SECRET || '',
    org: env.GITHUB_ORG || '',
    token: env.GITHUB_TOKEN || '',
  },
  gitlab: {
    baseUrl: (env.GITLAB_BASE_URL || 'https://gitlab.com').replace(/\/$/, ''),
    clientId: env.GITLAB_CLIENT_ID || '',
    clientSecret: env.GITLAB_CLIENT_SECRET || '',
    token: env.GITLAB_TOKEN || '',
  },
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    botUsername: env.TELEGRAM_BOT_USERNAME || '',
  },
  sheets: {
    keyFile: env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './secrets/service-account.json',
    serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || '', // 可改由設定頁貼上
    spreadsheetId: env.RESPONSES_SPREADSHEET_ID || '',
    sheetName: env.RESPONSES_SHEET_NAME || 'Responses',
    driveUploadFolderId: env.DRIVE_UPLOAD_FOLDER_ID || '',
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || 'SITCON <no-reply@example.com>',
    replyTo: env.SMTP_REPLY_TO || '',
  },
};

// 設定鍵 → 套用到 config 的方式。未在 DB 出現的鍵維持 env 預設。
const SETTING_APPLIERS: Record<string, (v: string) => void> = {
  base_url: (v) => { config.baseUrl = v.replace(/\/$/, ''); },
  admin_emails: (v) => { config.adminEmails = list(v).map((s) => s.toLowerCase()); },
  max_upload_mb: (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) config.maxUploadMb = n; },
  session_secret: (v) => { if (!config.sessionSecret) config.sessionSecret = v; },

  google_client_id: (v) => { config.google.clientId = v; },
  google_client_secret: (v) => { config.google.clientSecret = v; },
  google_workspace_admin_email: (v) => { config.google.workspaceAdminEmail = v; },
  google_drive_impersonate_email: (v) => { config.google.driveImpersonateEmail = v; },

  github_client_id: (v) => { config.github.clientId = v; },
  github_client_secret: (v) => { config.github.clientSecret = v; },
  github_org: (v) => { config.github.org = v; },
  github_token: (v) => { config.github.token = v; },

  gitlab_base_url: (v) => { config.gitlab.baseUrl = v.replace(/\/$/, ''); },
  gitlab_client_id: (v) => { config.gitlab.clientId = v; },
  gitlab_client_secret: (v) => { config.gitlab.clientSecret = v; },
  gitlab_token: (v) => { config.gitlab.token = v; },

  telegram_bot_token: (v) => { config.telegram.botToken = v; },
  telegram_bot_username: (v) => { config.telegram.botUsername = v; },

  responses_spreadsheet_id: (v) => { config.sheets.spreadsheetId = v; },
  responses_sheet_name: (v) => { config.sheets.sheetName = v || 'Responses'; },
  drive_upload_folder_id: (v) => { config.sheets.driveUploadFolderId = v; },
  google_service_account_json: (v) => { config.sheets.serviceAccountJson = v; },

  smtp_host: (v) => { config.smtp.host = v; },
  smtp_port: (v) => { const n = parseInt(v, 10); if (!Number.isNaN(n)) config.smtp.port = n; },
  smtp_secure: (v) => { config.smtp.secure = v === 'true' || v === 'on' || v === '1'; },
  smtp_user: (v) => { config.smtp.user = v; },
  smtp_pass: (v) => { config.smtp.pass = v; },
  smtp_from: (v) => { config.smtp.from = v; },
  smtp_reply_to: (v) => { config.smtp.replyTo = v; },
};

/** 以 DB 設定覆蓋 config（未設定或空字串的鍵維持 env 預設，避免清空 base URL 等有預設的欄位）。 */
export function applySettings(map: Record<string, string>): void {
  for (const [k, v] of Object.entries(map)) {
    const fn = SETTING_APPLIERS[k];
    if (fn && v !== undefined && v !== null && String(v) !== '') fn(String(v));
  }
}

export function callbackUrl(provider: 'google' | 'github' | 'gitlab'): string {
  return `${config.baseUrl}/auth/${provider}/callback`;
}

/** 各功能是否已設定完成，供 UI 顯示與流程判斷。 */
export const featureReady = {
  googleOAuth: () => !!(config.google.clientId && config.google.clientSecret),
  githubOAuth: () => !!(config.github.clientId && config.github.clientSecret),
  gitlabOAuth: () => !!(config.gitlab.clientId && config.gitlab.clientSecret),
  telegramLogin: () => !!(config.telegram.botToken && config.telegram.botUsername),
  sheets: () => !!config.sheets.spreadsheetId,
  driveUpload: () => !!config.sheets.driveUploadFolderId,
  googleGroups: () => !!config.google.workspaceAdminEmail,
  gitlabProvisioning: () => !!config.gitlab.token,
  smtp: () => !!config.smtp.host,
};
