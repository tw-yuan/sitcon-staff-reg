import { Readable } from 'stream';
import { config, featureReady } from '../config';
import { driveClient } from './google';

export interface UploadedFile {
  id: string;
  name: string;
  link: string;
}

/** 上傳檔案到指定 Google Drive 資料夾，回傳檔案連結。 */
export async function uploadBuffer(
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<UploadedFile> {
  if (!featureReady.driveUpload()) {
    throw new Error('Google Drive 上傳資料夾尚未設定（DRIVE_UPLOAD_FOLDER_ID）');
  }
  const drive = driveClient();
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [config.sheets.driveUploadFolderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });
  return {
    id: res.data.id || '',
    name: res.data.name || filename,
    link: res.data.webViewLink || '',
  };
}

/**
 * 將 Drive 資源分享給某 email（provisioning 用）。
 * role: reader | writer | commenter
 */
export async function shareWithEmail(
  fileId: string,
  email: string,
  role: string,
): Promise<void> {
  const drive = driveClient();
  await drive.permissions.create({
    fileId,
    requestBody: { type: 'user', role: role || 'reader', emailAddress: email },
    sendNotificationEmail: true,
    supportsAllDrives: true,
  });
}

/** 查某 email 對 Drive 資源目前的角色（找不到回 null）。供防呆判斷。 */
export async function getPermissionRole(fileId: string, email: string): Promise<string | null> {
  const drive = driveClient();
  const list = await drive.permissions.list({
    fileId,
    fields: 'permissions(id,emailAddress,role)',
    supportsAllDrives: true,
  });
  const perm = (list.data.permissions || []).find(
    (p) => (p.emailAddress || '').toLowerCase() === email.toLowerCase(),
  );
  return perm ? perm.role || null : null;
}

/** 移除某 email 對 Drive 資源的協作權限（撤銷用）。找不到視為已移除。 */
export async function unshareWithEmail(fileId: string, email: string): Promise<void> {
  const drive = driveClient();
  const list = await drive.permissions.list({
    fileId,
    fields: 'permissions(id,emailAddress)',
    supportsAllDrives: true,
  });
  const perm = (list.data.permissions || []).find(
    (p) => (p.emailAddress || '').toLowerCase() === email.toLowerCase(),
  );
  if (!perm || !perm.id) return;
  await drive.permissions.delete({ fileId, permissionId: perm.id, supportsAllDrives: true });
}
