import { config } from '../../config';
import { ProvTask } from '../../models/provisioning';
import { Submission } from '../../models/submissions';
import { ProvResult } from './types';

async function gh(path: string, method: string, body?: unknown): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sitcon-staff-reg',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function failFrom(res: Response): Promise<ProvResult> {
  return { status: 'failed', detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
}

/**
 * target 慣例：
 *   'org'                 → 加入 GITHUB_ORG 組織
 *   'team:<team-slug>'    → 加入該 org 的 team
 *   'repo:<owner>/<repo>' → 加為 repo 協作者
 */
export async function provisionGithub(task: ProvTask, sub: Submission): Promise<ProvResult> {
  if (!config.github.token) return { status: 'failed', detail: 'GITHUB_TOKEN 未設定' };
  const username = sub.githubLogin;
  if (!username) return { status: 'failed', detail: '工人未提供 GitHub 帳號' };
  const org = config.github.org;
  const target = task.target.trim();
  const role = task.role.trim();

  try {
    if (target.startsWith('team:')) {
      const teamSlug = target.slice('team:'.length);
      const res = await gh(`/orgs/${org}/teams/${teamSlug}/memberships/${username}`, 'PUT', {
        role: role || 'member',
      });
      if (!res.ok) return failFrom(res);
      const data = (await res.json()) as { state?: string };
      return {
        status: data.state === 'pending' ? 'invited' : 'success',
        detail: `team ${teamSlug}（${data.state}）`,
      };
    }

    if (target.startsWith('repo:')) {
      const repo = target.slice('repo:'.length);
      const res = await gh(`/repos/${repo}/collaborators/${username}`, 'PUT', {
        permission: role || 'push',
      });
      if (res.status === 204) return { status: 'skipped', detail: `repo ${repo}（已是協作者，略過授予）` };
      if (res.status === 201) return { status: 'invited', detail: `repo ${repo}（已送出邀請）` };
      return failFrom(res);
    }

    // 預設：org membership
    const res = await gh(`/orgs/${org}/memberships/${username}`, 'PUT', { role: role || 'member' });
    if (!res.ok) return failFrom(res);
    const data = (await res.json()) as { state?: string };
    return {
      status: data.state === 'pending' ? 'invited' : 'success',
      detail: `org ${org}（${data.state}）`,
    };
  } catch (err) {
    return { status: 'failed', detail: String(err) };
  }
}
