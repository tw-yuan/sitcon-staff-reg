import { ProvTask } from '../../models/provisioning';
import { Submission } from '../../models/submissions';
import { getPermissionRole, shareWithEmail, unshareWithEmail } from '../drive';
import { ProvResult } from './types';

const ROLE_MAP: Record<string, string> = {
  viewer: 'reader',
  reader: 'reader',
  檢視者: 'reader',
  commenter: 'commenter',
  加註者: 'commenter',
  editor: 'writer',
  writer: 'writer',
  collaborator: 'writer',
  contributor: 'writer',
  協作者: 'writer',
  貢獻者: 'writer',
  // 內容管理員（Content manager）= Drive API 的 fileOrganizer；僅適用於「共用雲端硬碟」內的項目
  fileorganizer: 'fileOrganizer',
  content_manager: 'fileOrganizer',
  'content manager': 'fileOrganizer',
  內容管理員: 'fileOrganizer',
  // 管理員（Manager）= organizer；同樣僅限共用雲端硬碟
  organizer: 'organizer',
  manager: 'organizer',
  管理員: 'organizer',
};

// 角色高低（用於防呆：已有同等以上就略過）
const ROLE_RANK: Record<string, number> = {
  reader: 1,
  commenter: 2,
  writer: 3,
  fileorganizer: 4,
  organizer: 5,
  owner: 6,
};
function rank(r: string): number {
  return ROLE_RANK[(r || '').toLowerCase()] || 0;
}

function shortErr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 240 ? s.slice(0, 240) + '…' : s;
}

/** target = Drive 資料夾或檔案的 ID。 */
export async function provisionDrive(task: ProvTask, sub: Submission): Promise<ProvResult> {
  if (!sub.googleEmail) return { status: 'failed', detail: '工人未提供 Google email' };
  const role = ROLE_MAP[task.role.trim().toLowerCase()] || 'writer';
  const target = task.target.trim();
  try {
    // 防呆：已有同等或更高權限就略過
    const existing = await getPermissionRole(target, sub.googleEmail).catch(() => null);
    if (existing && rank(existing) >= rank(role)) {
      return { status: 'skipped', detail: `已有同等以上權限（${existing}），略過授予` };
    }
    await shareWithEmail(target, sub.googleEmail, role);
    return { status: 'success', detail: `已加入協作者（${role}）：${sub.googleEmail}` };
  } catch (e) {
    return { status: 'failed', detail: shortErr(e) };
  }
}

export async function revokeDrive(task: ProvTask, sub: Submission): Promise<ProvResult> {
  if (!sub.googleEmail) return { status: 'failed', detail: '工人未提供 Google email' };
  try {
    await unshareWithEmail(task.target.trim(), sub.googleEmail);
    return { status: 'revoked', detail: `已移除 ${sub.googleEmail} 對 ${task.target} 的協作權限` };
  } catch (e) {
    return { status: 'failed', detail: shortErr(e) };
  }
}
