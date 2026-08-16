import { config } from '../../config';
import { ProvTask } from '../../models/provisioning';
import { Submission } from '../../models/submissions';
import { ProvResult } from './types';

const ACCESS_LEVELS: Record<string, number> = {
  guest: 10,
  reporter: 20,
  developer: 30,
  maintainer: 40,
  owner: 50,
};

/**
 * target 慣例（預設為 project）：
 *   '<path-or-id>' 或 'project:<path-or-id>' → project
 *   'group:<path-or-id>'                     → group
 */
function parseTarget(target: string): { kind: 'projects' | 'groups'; ref: string } {
  const t = target.trim();
  if (t.startsWith('group:')) return { kind: 'groups', ref: t.slice('group:'.length) };
  if (t.startsWith('project:')) return { kind: 'projects', ref: t.slice('project:'.length) };
  return { kind: 'projects', ref: t };
}

async function gl(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`${config.gitlab.baseUrl}/api/v4/${path}`, {
    method,
    headers: { 'PRIVATE-TOKEN': config.gitlab.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 查使用者在 group/project 目前的 access level（含繼承；非成員回 null）。防呆用。 */
async function getMemberLevel(
  kind: 'groups' | 'projects',
  encRef: string,
  userId: number,
): Promise<number | null> {
  const res = await gl(`${kind}/${encRef}/members/all/${userId}`, 'GET');
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as { access_level?: number };
  return typeof data.access_level === 'number' ? data.access_level : null;
}

export async function provisionGitlab(task: ProvTask, sub: Submission): Promise<ProvResult> {
  if (!config.gitlab.token) return { status: 'failed', detail: 'GITLAB_TOKEN 未設定' };
  if (!sub.gitlabId) return { status: 'failed', detail: '工人未提供 GitLab 帳號' };

  const { kind, ref } = parseTarget(task.target);
  const enc = encodeURIComponent(ref);
  const uid = Number(sub.gitlabId);
  const level = ACCESS_LEVELS[task.role.trim().toLowerCase()] ?? 30; // 預設 developer
  try {
    // 防呆：已有同等以上（含繼承）就略過
    const existing = await getMemberLevel(kind, enc, uid);
    if (existing !== null && existing >= level) {
      return { status: 'skipped', detail: `已有同等以上權限（access ${existing}），略過授予` };
    }
    const res = await gl(`${kind}/${enc}/members`, 'POST', { user_id: uid, access_level: level });
    if (res.status === 201) return { status: 'success', detail: `${kind} ${ref}（access ${level}）` };
    if (res.status === 409) {
      // 已是直接成員但等級較低 → 升級
      const up = await gl(`${kind}/${enc}/members/${uid}`, 'PUT', { access_level: level });
      if (up.ok) return { status: 'success', detail: `已升級 ${kind} ${ref} 為 access ${level}` };
      return { status: 'failed', detail: `HTTP ${up.status}: ${(await up.text()).slice(0, 300)}` };
    }
    return { status: 'failed', detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
  } catch (e) {
    return { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function revokeGitlab(task: ProvTask, sub: Submission): Promise<ProvResult> {
  if (!config.gitlab.token) return { status: 'failed', detail: 'GITLAB_TOKEN 未設定' };
  if (!sub.gitlabId) return { status: 'failed', detail: '工人未提供 GitLab 帳號' };

  const { kind, ref } = parseTarget(task.target);
  try {
    const res = await gl(`${kind}/${encodeURIComponent(ref)}/members/${sub.gitlabId}`, 'DELETE');
    if (res.status === 204) return { status: 'revoked', detail: `已移出 ${kind} ${ref}` };
    if (res.status === 404) return { status: 'revoked', detail: `原本就不是 ${kind} ${ref} 成員` };
    return { status: 'failed', detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
  } catch (e) {
    return { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}
