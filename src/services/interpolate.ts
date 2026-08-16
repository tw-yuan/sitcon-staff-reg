import type { Field } from '../models/fields';

/**
 * 變數帶入所需的最小身分資訊。登入身分（Identity）與已存的登錄（Submission）都符合此形狀，
 * 因此登入表單與免登入的修改頁 /edit/:token 可共用同一套代換邏輯。
 */
export interface IdentityVars {
  googleEmail: string;
  githubLogin: string;
  gitlabUsername: string;
  telegramUsername: string;
  telegramId: string;
}

/**
 * 說明文字（helpText）與「文字說明」內文（content）可帶入身分資訊：
 *   $email / $github / $gitlab / $telegram
 * 也支援 {{email}} 與 {$email} 兩種寫法（與 Telegram 通知模板一致）。未知變數原樣保留。
 */
export function interpolateIdentity(text: string, id: IdentityVars): string {
  if (!text || (text.indexOf('$') < 0 && text.indexOf('{{') < 0)) return text;
  const vars: Record<string, string> = {
    email: id.googleEmail,
    github: id.githubLogin,
    gitlab: id.gitlabUsername,
    telegram: id.telegramUsername ? '@' + id.telegramUsername : id.telegramId,
  };
  const sub = (k: string, m: string) => (k in vars ? vars[k] : m);
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => sub(k, m))
    .replace(/\{\$(\w+)\}/g, (m, k) => sub(k, m))
    .replace(/\$(\w+)/g, (m, k) => sub(k, m));
}

/** 對整份欄位套用變數帶入（不改動原物件；無變數者沿用原參考）。 */
export function interpolateFields(fields: Field[], id: IdentityVars): Field[] {
  return fields.map((f) => {
    const helpText = interpolateIdentity(f.helpText, id);
    const content = interpolateIdentity(f.content, id);
    if (helpText === f.helpText && content === f.content) return f;
    return { ...f, helpText, content };
  });
}
