import { config } from '../config';
import { getSetting } from '../models/settings';
import { Submission } from '../models/submissions';
import { nicknameOf } from './nickname';

const DEFAULT_TEMPLATE = '[SITCON 2027 工人登錄]\n{{telegram}} {{nickname}} 已完成登錄';
const DEFAULT_EDIT_TEMPLATE =
  '[SITCON 2027 工人登錄]\n{{telegram}} {{nickname}} 更新了以下項目：\n{{fields}}';

/** 代入變數：同時支援 {{var}} 與 {$var} 兩種寫法。 */
function render(tpl: string, vars: Record<string, string>): string {
  return tpl
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/\{\$(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** 直接對指定 chat 發送純文字訊息（測試與通知共用）。 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<{ ok: boolean; message: string }> {
  const token = config.telegram.botToken;
  if (!token) return { ok: false, message: '尚未設定 Telegram Bot Token（在 Telegram 區塊）' };
  if (!chatId) return { ok: false, message: '尚未設定通知群組 chat_id' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (data.ok) return { ok: true, message: '已送出到群組' };
    return { ok: false, message: data.description || `發送失敗（HTTP ${res.status}）` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** 目標 chat_id（供測試用）。 */
export function notifyChatId(): string {
  return (getSetting('telegram_notify_chat_id') || '').trim();
}

function baseVars(sub: Submission): Record<string, string> {
  return {
    email: sub.googleEmail,
    nickname: nicknameOf(sub),
    telegram_username: sub.telegramUsername,
    // Telegram 使用者可以不設 username，此時退回 email 避免訊息只剩「@ 暱稱」
    telegram: sub.telegramUsername ? `@${sub.telegramUsername}` : sub.googleEmail,
  };
}

/** 依模板與答案組出通知訊息（不含發送，方便測試）。 */
export function buildNotifyText(sub: Submission): string {
  const tpl = getSetting('telegram_notify_template') || DEFAULT_TEMPLATE;
  return render(tpl, baseVars(sub));
}

/**
 * 工人更新資料的通知訊息；{{fields}} 為更新欄位清單（每行「- 標題」）。
 * editedBy＝後台管理員的 email（工人自行修改時不帶）。模板若沒用 {{by}}，自動在最後補「由 <email> 修改」。
 */
export function buildEditNotifyText(
  sub: Submission,
  changedLabels: string[],
  editedBy?: string,
): string {
  const tpl = getSetting('telegram_edit_notify_template') || DEFAULT_EDIT_TEMPLATE;
  let text = render(tpl, {
    ...baseVars(sub),
    fields: changedLabels.map((l) => `- ${l}`).join('\n'),
    by: editedBy || '',
  });
  if (editedBy && !/\{\{\s*by\s*\}\}|\{\$by\}/.test(tpl)) text += `\n由 ${editedBy} 修改`;
  return text;
}

/** 有人完成登錄時，發通知到指定群組。未設定 chat_id / token 時安靜略過，不影響主流程。 */
export async function notifyNewSubmission(sub: Submission): Promise<void> {
  const chatId = notifyChatId();
  if (!chatId || !config.telegram.botToken) return;
  const r = await sendTelegramMessage(chatId, buildNotifyText(sub));
  if (!r.ok) console.error('[telegram-notify] 發送失敗：', r.message);
}

/** 資料被更新時發通知到指定群組（editedBy＝後台管理員 email）。沒有實際變更或未設定時安靜略過。 */
export async function notifyAnswersUpdated(
  sub: Submission,
  changedLabels: string[],
  editedBy?: string,
): Promise<void> {
  if (changedLabels.length === 0) return;
  const chatId = notifyChatId();
  if (!chatId || !config.telegram.botToken) return;
  const r = await sendTelegramMessage(chatId, buildEditNotifyText(sub, changedLabels, editedBy));
  if (!r.ok) console.error('[telegram-notify] 發送失敗：', r.message);
}
