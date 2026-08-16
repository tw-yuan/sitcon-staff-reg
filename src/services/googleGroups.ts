import { directoryClient } from './google';

/** 把使用者加入 Google Group（groupKey/memberKey 皆用 email）。 */
export async function addGroupMember(
  groupEmail: string,
  memberEmail: string,
  role: string,
): Promise<void> {
  const dir = directoryClient();
  await dir.members.insert({
    groupKey: groupEmail,
    requestBody: { email: memberEmail, role: (role || 'MEMBER').toUpperCase() },
  });
}

/** 把使用者移出 Google Group。 */
export async function removeGroupMember(groupEmail: string, memberEmail: string): Promise<void> {
  const dir = directoryClient();
  await dir.members.delete({ groupKey: groupEmail, memberKey: memberEmail });
}

/** 查使用者在群組的角色（不是成員回 null）。供防呆判斷。 */
export async function getGroupMemberRole(
  groupEmail: string,
  memberEmail: string,
): Promise<string | null> {
  const dir = directoryClient();
  try {
    const res = await dir.members.get({ groupKey: groupEmail, memberKey: memberEmail });
    return (res.data.role || 'MEMBER').toUpperCase();
  } catch (e) {
    const status = (e as { code?: number; response?: { status?: number } })?.code ??
      (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw e;
  }
}

/** 升級（或變更）使用者在群組的角色。 */
export async function updateGroupMemberRole(
  groupEmail: string,
  memberEmail: string,
  role: string,
): Promise<void> {
  const dir = directoryClient();
  await dir.members.patch({
    groupKey: groupEmail,
    memberKey: memberEmail,
    requestBody: { role: (role || 'MEMBER').toUpperCase() },
  });
}
