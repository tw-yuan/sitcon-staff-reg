import fs from 'fs';
import { google } from 'googleapis';
import { config } from '../config';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

/** 以 service account 金鑰建立 Google API 授權（Sheets + Drive）。
 *  優先使用設定頁貼上的 JSON，否則退回掛載的金鑰檔。 */
export function getGoogleAuth() {
  const json = config.sheets.serviceAccountJson.trim();
  if (json) {
    return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES });
  }
  return new google.auth.GoogleAuth({ keyFile: config.sheets.keyFile, scopes: SCOPES });
}

// googleapis 的 auth 泛型（AuthClient vs JSONClient）在型別上較嚴格，
// runtime 傳入 GoogleAuth 實例即可運作，這裡以 any 略過泛型摩擦。
export function sheetsClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.sheets({ version: 'v4', auth: getGoogleAuth() as any });
}

export function driveClient() {
  const impersonate = config.google.driveImpersonateEmail.trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth: any = impersonate ? driveJwt(impersonate) : getGoogleAuth();
  return google.drive({ version: 'v3', auth });
}

/** 以 domain-wide delegation 模擬某使用者操作 Drive（Shared Drive / 限制存取資料夾用）。
 *  需在該 SA 的 domain-wide delegation 授權 https://www.googleapis.com/auth/drive 範圍。 */
export function driveJwt(subject: string) {
  const { client_email, private_key } = loadServiceCreds();
  return new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject,
  });
}

function loadServiceCreds(): { client_email: string; private_key: string } {
  const json = config.sheets.serviceAccountJson.trim();
  const raw = json || fs.readFileSync(config.sheets.keyFile, 'utf8');
  const c = JSON.parse(raw) as { client_email: string; private_key: string };
  return { client_email: c.client_email, private_key: c.private_key };
}

const DIRECTORY_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.group.member',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
];

/** Google Groups 加/移除成員需以 domain-wide delegation 模擬 Workspace 管理員。 */
export function directoryJwt() {
  const { client_email, private_key } = loadServiceCreds();
  return new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: DIRECTORY_SCOPES,
    subject: config.google.workspaceAdminEmail,
  });
}

export function directoryClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.admin({ version: 'directory_v1', auth: directoryJwt() as any });
}
