import { randomBytes } from 'crypto';
import { applySettings, config } from './config';
import { getAllSettings, getSetting, setSetting } from './models/settings';

/** 以 DB 設定覆蓋 config。設定頁存檔後、啟動時皆會呼叫。 */
export function refreshConfig(): void {
  applySettings(getAllSettings());
}

/**
 * 確保 session secret 與 setup key 存在（首次啟動自動產生並持久化）。
 * 回傳 setup key，供 log 提示首次設定用。
 */
export function bootstrapSecrets(): { setupKey: string } {
  if (!config.sessionSecret) {
    let s = getSetting('session_secret');
    if (!s) {
      s = randomBytes(32).toString('hex');
      setSetting('session_secret', s);
    }
    config.sessionSecret = s;
  }

  let key = getSetting('setup_key');
  if (!key) {
    key = randomBytes(16).toString('hex');
    setSetting('setup_key', key);
  }
  return { setupKey: key };
}

export function getSetupKey(): string {
  return getSetting('setup_key') || '';
}
