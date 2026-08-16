import { createHash, createHmac } from 'crypto';
import { config } from '../config';

export interface TelegramProfile {
  id: string;
  username: string;
}

/**
 * 驗證 Telegram Login Widget 回傳的資料。
 * 依官方規範：secret = SHA256(bot_token)，比對 HMAC-SHA256(data_check_string)。
 */
export function verifyTelegramAuth(query: Record<string, unknown>): TelegramProfile | null {
  const { botToken } = config.telegram;
  if (!botToken) return null;

  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    data[k] = String(v);
  }
  const hash = data.hash;
  if (!hash) return null;
  delete data.hash;

  const checkString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const hmac = createHmac('sha256', secret).update(checkString).digest('hex');
  if (hmac !== hash) return null;

  const authDate = Number(data.auth_date || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  return { id: String(data.id || ''), username: String(data.username || '') };
}
