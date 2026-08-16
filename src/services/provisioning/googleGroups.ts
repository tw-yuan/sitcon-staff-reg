import { config } from '../../config';
import { ProvTask } from '../../models/provisioning';
import { Submission } from '../../models/submissions';
import {
  addGroupMember,
  getGroupMemberRole,
  removeGroupMember,
  updateGroupMemberRole,
} from '../googleGroups';
import { ProvResult } from './types';

const GROUP_RANK: Record<string, number> = { MEMBER: 1, MANAGER: 2, OWNER: 3 };
function grank(r: string): number {
  return GROUP_RANK[(r || 'MEMBER').toUpperCase()] || 1;
}

function statusOf(e: unknown): number {
  const anyE = e as { code?: number; response?: { status?: number } };
  return anyE?.code ?? anyE?.response?.status ?? 0;
}
function shortErr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 240 ? s.slice(0, 240) + '…' : s;
}

/** 消費者版 @googlegroups.com 群組不屬於任何 Workspace 網域，Admin SDK Directory API 管不到，
 *  只能人工在 groups.google.com 加/刪成員。這類目標一律落成「待手動處理」而非打 API。 */
function isConsumerGroup(target: string): boolean {
  return target.trim().toLowerCase().endsWith('@googlegroups.com');
}

/** target = Google Group 的 email；role 預設 MEMBER。 */
export async function provisionGroup(task: ProvTask, sub: Submission): Promise<ProvResult> {
  const target = task.target.trim();
  const requested = (task.role.trim() || 'MEMBER').toUpperCase();
  if (isConsumerGroup(target)) {
    const who = sub.googleEmail || '（工人未提供 Google email，請向其索取）';
    return {
      status: 'manual',
      detail: `消費者版 Google 群組無法用 API 開通，請至 groups.google.com 手動將 ${who}（${requested}）加入 ${target}`,
    };
  }
  if (!config.google.workspaceAdminEmail)
    return { status: 'failed', detail: '尚未設定 Workspace 管理員信箱' };
  if (!sub.googleEmail) return { status: 'failed', detail: '工人未提供 Google email' };
  try {
    // 防呆：已是成員且角色同等以上就略過；較低則升級
    const existing = await getGroupMemberRole(target, sub.googleEmail);
    if (existing) {
      if (grank(existing) >= grank(requested)) {
        return { status: 'skipped', detail: `已是群組成員（${existing}），略過授予` };
      }
      await updateGroupMemberRole(target, sub.googleEmail, requested);
      return { status: 'success', detail: `已將群組角色升級為 ${requested}` };
    }
    await addGroupMember(target, sub.googleEmail, requested);
    return { status: 'success', detail: `已加入群組 ${target}（${requested}）` };
  } catch (e) {
    if (statusOf(e) === 409) return { status: 'skipped', detail: `已是群組 ${target} 成員（略過授予）` };
    return { status: 'failed', detail: shortErr(e) };
  }
}

export async function revokeGroup(task: ProvTask, sub: Submission): Promise<ProvResult> {
  if (isConsumerGroup(task.target)) {
    const who = sub.googleEmail || '該工人';
    return {
      status: 'manual',
      detail: `消費者版 Google 群組無法用 API 撤銷，請至 groups.google.com 手動將 ${who} 移出 ${task.target.trim()}`,
    };
  }
  if (!config.google.workspaceAdminEmail)
    return { status: 'failed', detail: '尚未設定 Workspace 管理員信箱' };
  if (!sub.googleEmail) return { status: 'failed', detail: '工人未提供 Google email' };
  try {
    await removeGroupMember(task.target.trim(), sub.googleEmail);
    return { status: 'revoked', detail: `已移出群組 ${task.target}` };
  } catch (e) {
    if (statusOf(e) === 404) return { status: 'revoked', detail: `原本就不在群組 ${task.target}` };
    return { status: 'failed', detail: shortErr(e) };
  }
}
