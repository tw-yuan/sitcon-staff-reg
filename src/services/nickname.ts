import { getSetting } from '../models/settings';
import { listFields } from '../models/fields';
import { Submission } from '../models/submissions';

/**
 * 取一筆登錄的「暱稱」值：
 * 優先用設定 `telegram_notify_nickname_field` 指定的欄位（可填欄位 key 或標題），
 * 否則自動找標題 / key 含 暱稱 / 名字 / 姓名 / name 的欄位。找不到回空字串。
 * 後台總覽與 Telegram 通知共用此邏輯，維持單一「暱稱欄位」來源。
 */
export function nicknameOf(sub: Submission): string {
  const fields = listFields();
  const cfg = (getSetting('telegram_notify_nickname_field') || '').trim();
  let field = cfg ? fields.find((f) => f.key === cfg || f.label === cfg) : undefined;
  if (!field) {
    field = fields.find((f) => /暱稱|名字|姓名|nick|name/i.test(f.label) || /nick|name/i.test(f.key));
  }
  if (!field) return '';
  const v = sub.answers[field.key];
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return '';
  return String(v);
}
