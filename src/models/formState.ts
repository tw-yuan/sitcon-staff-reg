import { getSetting, setSetting } from './settings';

const OPEN_KEY = 'form_open';
const MSG_KEY = 'form_closed_message';
const DEFAULT_CLOSED_MSG = '工人登錄與資料修改目前已截止。如有問題請聯絡行政組。';

/** 表單是否開放（可新填 / 可修改）。未設定過視為「開放」。 */
export function isFormOpen(): boolean {
  return getSetting(OPEN_KEY) !== '0';
}

export function setFormOpen(open: boolean): void {
  setSetting(OPEN_KEY, open ? '1' : '0');
}

/** 截止時顯示給工人的訊息。 */
export function getClosedMessage(): string {
  return (getSetting(MSG_KEY) || '').trim() || DEFAULT_CLOSED_MSG;
}

export function setClosedMessage(msg: string): void {
  setSetting(MSG_KEY, msg.trim());
}
