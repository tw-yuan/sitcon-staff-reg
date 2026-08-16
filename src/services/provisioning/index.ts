import { getSubmission, Submission } from '../../models/submissions';
import {
  getTask,
  listTasks,
  replaceTasks,
  setTaskStatus,
  NewTask,
  ProvTask,
} from '../../models/provisioning';
import { listGrants, PLATFORM_LABELS } from '../../models/workgroups';
import { provisionDrive, revokeDrive } from './googleDrive';
import { provisionGroup, revokeGroup } from './googleGroups';
import { provisionGitlab, revokeGitlab } from './gitlab';
import { ProvResult } from './types';

/** 由工作組權限範本產生 provisioning 任務清單。 */
export function tasksFromWorkgroup(workgroupId: number): NewTask[] {
  return listGrants(workgroupId).map((g) => ({
    platform: g.platform,
    target: g.target,
    role: g.role,
    // 自訂通知：不自動開通，直接標記為待手動處理，只會出現在通知信。
    status: g.platform === 'note' ? ('manual' as const) : undefined,
  }));
}

/** 依核准時的工作組範本，建立該工人的 provisioning 任務。 */
export function seedTasks(submissionId: number, workgroupId: number | null): void {
  replaceTasks(submissionId, workgroupId ? tasksFromWorkgroup(workgroupId) : []);
}

async function grantOne(task: ProvTask, sub: Submission): Promise<ProvResult> {
  switch (task.platform) {
    case 'drive':
      return provisionDrive(task, sub);
    case 'google_group':
      return provisionGroup(task, sub);
    case 'gitlab':
      return provisionGitlab(task, sub);
    case 'note':
      return { status: 'manual', detail: '自訂通知（不自動開通）' };
    default:
      return { status: 'failed', detail: `未知平台 ${task.platform}` };
  }
}

async function revokeOne(task: ProvTask, sub: Submission): Promise<ProvResult> {
  switch (task.platform) {
    case 'drive':
      return revokeDrive(task, sub);
    case 'google_group':
      return revokeGroup(task, sub);
    case 'gitlab':
      return revokeGitlab(task, sub);
    case 'note':
      return { status: 'manual', detail: '' }; // 自訂通知無需撤銷
    default:
      return { status: 'failed', detail: `未知平台 ${task.platform}` };
  }
}

/** 執行（或重試失敗的）授予任務；已成功/已邀請/已具備(略過)/已撤銷/待手動的會略過。 */
export async function runProvisioning(submissionId: number): Promise<ProvTask[]> {
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error('submission not found');
  for (const t of listTasks(submissionId)) {
    if (
      t.status === 'success' ||
      t.status === 'invited' ||
      t.status === 'skipped' ||
      t.status === 'revoked' ||
      t.status === 'manual'
    )
      continue;
    const r = await grantOne(t, sub);
    setTaskStatus(t.id, r.status, r.detail);
  }
  return listTasks(submissionId);
}

/** 重試（重新授予）單一任務。 */
export async function retryTask(taskId: number): Promise<ProvTask | undefined> {
  const t = getTask(taskId);
  if (!t) return undefined;
  const sub = getSubmission(t.submissionId);
  if (!sub) return undefined;
  const r = await grantOne(t, sub);
  setTaskStatus(t.id, r.status, r.detail);
  return getTask(taskId);
}

/** 撤銷單一任務。只有本系統實際開通過（success/invited）的才會真的去移除權限；
 *  skipped（工人本來就有的權限）等其他狀態不動，避免撤掉不是我們授予的權限。 */
export async function revokeTask(taskId: number): Promise<ProvTask | undefined> {
  const t = getTask(taskId);
  if (!t) return undefined;
  if (t.status !== 'success' && t.status !== 'invited') return t;
  const sub = getSubmission(t.submissionId);
  if (!sub) return undefined;
  const r = await revokeOne(t, sub);
  setTaskStatus(t.id, r.status, r.detail);
  return getTask(taskId);
}

/** 撤銷該工人所有已開通（success/invited）的權限。 */
export async function revokeAll(submissionId: number): Promise<ProvTask[]> {
  const sub = getSubmission(submissionId);
  if (!sub) throw new Error('submission not found');
  for (const t of listTasks(submissionId)) {
    if (t.status !== 'success' && t.status !== 'invited') continue;
    const r = await revokeOne(t, sub);
    setTaskStatus(t.id, r.status, r.detail);
  }
  return listTasks(submissionId);
}

/**
 * 給通知信用的「已開通項目」摘要。
 * 自訂通知(note)也一併列入（就直接用管理者寫的文字），與自動開通的項目放在同一份清單。
 */
export function grantedSummaryLines(tasks: ProvTask[]): string[] {
  return tasks
    .filter((t) =>
      t.platform === 'note'
        ? t.target.trim() !== ''
        : t.status === 'success' || t.status === 'invited' || t.status === 'skipped',
    )
    .map((t) =>
      t.platform === 'note'
        ? t.target
        : `${PLATFORM_LABELS[t.platform]}：${t.target}（${t.role}）${
            t.status === 'invited' ? ' — 待接受邀請' : ''
          }`,
    );
}
