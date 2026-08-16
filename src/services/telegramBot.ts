import { config } from '../config';
import { getSetting, setSetting } from '../models/settings';
import { sendTelegramMessage } from './telegramNotify';

// 以 long polling 接收 Telegram 指令。目前只回應查詢類指令（/id），用來取得群組 chat_id。
// 刻意不做任何會改狀態的指令，避免變成一個可被亂用的操作介面。

const OFFSET_KEY = 'telegram_update_offset'; // 下一筆要抓的 update_id，存 DB 以免重啟重收

interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}
interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
}

let running = false;

/** 從指令文字取出純指令名：去掉 @BotName 與後面的參數，轉小寫。 */
function commandName(text: string): string {
  const first = text.trim().split(/\s+/)[0] || '';
  return first.split('@')[0].toLowerCase();
}

function chatKindLabel(type: TgChat['type']): string {
  if (type === 'private') return '私訊';
  if (type === 'channel') return '頻道';
  return '群組';
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return;
  const cmd = commandName(text);
  if (cmd !== '/id' && cmd !== '/chatid' && cmd !== '/start') return;

  const chat = msg.chat;
  const title = chat.title || chat.username || chat.first_name || '';
  const reply = [
    '這裡的 chat_id 是：',
    String(chat.id),
    '',
    `型別：${chatKindLabel(chat.type)}${title ? `（${title}）` : ''}`,
    '把上面的數字貼到後台「Telegram 通知」的「通知群組 chat_id」即可。',
  ].join('\n');
  await sendTelegramMessage(String(chat.id), reply);
}

/** 抓一批 update 並處理；回傳是否成功（供錯誤退避判斷）。 */
async function pollOnce(token: string): Promise<boolean> {
  const offset = Number(getSetting(OFFSET_KEY) || '0') || 0;
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout: 30, offset, allowed_updates: ['message', 'channel_post'] }),
  });
  const data = (await res.json()) as { ok: boolean; result?: TgUpdate[]; description?: string };
  if (!data.ok || !data.result) {
    if (data.description) console.error('[telegram-bot] getUpdates:', data.description);
    return false;
  }
  let maxId = offset - 1;
  for (const u of data.result) {
    maxId = Math.max(maxId, u.update_id);
    const msg = u.message || u.channel_post;
    if (msg) {
      try {
        await handleMessage(msg);
      } catch (err) {
        console.error('[telegram-bot] 處理訊息失敗：', err instanceof Error ? err.message : err);
      }
    }
  }
  if (data.result.length) setSetting(OFFSET_KEY, String(maxId + 1)); // 確認收妥才推進 offset
  return true;
}

/**
 * 啟動 Telegram 指令輪詢（long polling）。整個 process 只跑一輪迴圈。
 * Token 於每輪即時讀取：首次設定時在後台填好 token 後無需重啟即會生效。
 * 注意：與 Telegram webhook 互斥；本專案未使用 webhook，故無衝突。
 */
export function startTelegramBot(): void {
  if (running) return;
  running = true;
  console.log('[telegram-bot] 指令輪詢啟動：私訊 Bot 或在群組輸入 /id 即可取得 chat_id');

  const loop = async (): Promise<void> => {
    while (running) {
      const token = config.telegram.botToken;
      if (!token) {
        // 尚未設定 token（可能等後台填入）：稍候再看，不空轉打 API
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      try {
        const ok = await pollOnce(token);
        if (!ok) await new Promise((r) => setTimeout(r, 5000));
      } catch (err) {
        console.error('[telegram-bot] 輪詢錯誤，5 秒後重試：', err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void loop();
}
