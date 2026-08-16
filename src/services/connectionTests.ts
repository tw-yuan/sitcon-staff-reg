import nodemailer from 'nodemailer';
import { config, featureReady } from '../config';
import { directoryJwt, driveClient, sheetsClient } from './google';
import { notifyChatId, sendTelegramMessage } from './telegramNotify';
import { smtpEhloName } from './mailer';

export interface TestResult {
  ok: boolean;
  message: string;
}

function shortErr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 240 ? s.slice(0, 240) + '…' : s;
}

async function testSheets(): Promise<TestResult> {
  if (!featureReady.sheets()) return { ok: false, message: '尚未設定回應試算表 ID' };
  try {
    const sheets = sheetsClient();
    const res = await sheets.spreadsheets.get({
      spreadsheetId: config.sheets.spreadsheetId,
      fields: 'properties.title,sheets.properties.title',
    });
    const title = res.data.properties?.title || '(無標題)';
    const tabs = (res.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
    const hasTab = tabs.includes(config.sheets.sheetName);
    return {
      ok: true,
      message: `可存取試算表「${title}」；分頁「${config.sheets.sheetName}」${
        hasTab ? '存在' : '不存在——請先在試算表建立此分頁'
      }`,
    };
  } catch (e) {
    return { ok: false, message: shortErr(e) };
  }
}

async function testDrive(): Promise<TestResult> {
  if (!featureReady.driveUpload()) return { ok: false, message: '尚未設定上傳資料夾 ID' };
  try {
    const drive = driveClient();
    const res = await drive.files.get({
      fileId: config.sheets.driveUploadFolderId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    const isFolder = res.data.mimeType === 'application/vnd.google-apps.folder';
    return {
      ok: true,
      message: `可存取「${res.data.name}」${isFolder ? '' : '（注意：這不是資料夾）'}`,
    };
  } catch (e) {
    return { ok: false, message: shortErr(e) };
  }
}

async function testSmtp(): Promise<TestResult> {
  if (!featureReady.smtp()) return { ok: false, message: '尚未設定 SMTP host' };
  try {
    const t = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      name: smtpEhloName(),
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    await t.verify();
    return { ok: true, message: `SMTP 連線成功（${config.smtp.host}:${config.smtp.port}）` };
  } catch (e) {
    return { ok: false, message: shortErr(e) };
  }
}

async function testGithub(): Promise<TestResult> {
  if (!config.github.token) return { ok: false, message: '尚未設定 GitHub token' };
  const headers = {
    Authorization: `Bearer ${config.github.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sitcon-staff-reg',
  };
  try {
    const me = await fetch('https://api.github.com/user', { headers });
    if (!me.ok) return { ok: false, message: `token 無效：HTTP ${me.status}` };
    const user = (await me.json()) as { login?: string };
    let orgMsg = '';
    if (config.github.org) {
      const org = await fetch(`https://api.github.com/orgs/${config.github.org}`, { headers });
      orgMsg = org.ok
        ? `，可存取 org「${config.github.org}」`
        : `，但無法存取 org「${config.github.org}」(HTTP ${org.status})`;
    }
    return { ok: true, message: `token 有效（${user.login}）${orgMsg}` };
  } catch (e) {
    return { ok: false, message: shortErr(e) };
  }
}

async function testGitlab(): Promise<TestResult> {
  if (!config.gitlab.token) return { ok: false, message: '尚未設定 GitLab token' };
  try {
    const res = await fetch(`${config.gitlab.baseUrl}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': config.gitlab.token },
    });
    if (!res.ok) return { ok: false, message: `token 無效：HTTP ${res.status}` };
    const u = (await res.json()) as { username?: string };
    return { ok: true, message: `token 有效（${u.username}）` };
  } catch (e) {
    return { ok: false, message: shortErr(e) };
  }
}

async function testGroups(): Promise<TestResult> {
  if (!config.google.workspaceAdminEmail) {
    return { ok: false, message: '尚未設定 Workspace 管理員信箱' };
  }
  try {
    await directoryJwt().authorize();
    return {
      ok: true,
      message: `domain-wide delegation 正常（可模擬 ${config.google.workspaceAdminEmail}）`,
    };
  } catch (e) {
    return { ok: false, message: shortErr(e) };
  }
}

async function testTelegram(): Promise<TestResult> {
  if (!config.telegram.botToken) return { ok: false, message: '尚未設定 Bot token' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getMe`);
    const j = (await res.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (j.ok && j.result) return { ok: true, message: `Bot 有效：@${j.result.username}` };
    return { ok: false, message: `Bot token 無效：${j.description || res.status}` };
  } catch (e) {
    return { ok: false, message: shortErr(e) };
  }
}

async function testTelegramNotify(): Promise<TestResult> {
  const chatId = notifyChatId();
  if (!chatId) return { ok: false, message: '尚未設定通知群組 chat_id' };
  return sendTelegramMessage(chatId, '✅ SITCON 工人登錄系統：這是一則測試通知。');
}

export const TESTS: Record<string, () => Promise<TestResult>> = {
  sheets: testSheets,
  drive: testDrive,
  smtp: testSmtp,
  github: testGithub,
  gitlab: testGitlab,
  telegram: testTelegram,
  telegram_notify: testTelegramNotify,
  google_group: testGroups,
};
