import { getDoc } from './store.ts';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || '';
const ownerUsername = (process.env.TELEGRAM_OWNER_USERNAME || 'vx_rw').replace(/^@/, '').trim().toLowerCase();

async function send(chatId: string | number, message: string): Promise<void> {
  if (!token) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message.slice(0, 3900), disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (!response.ok) console.error('[telegram] sendMessage failed:', response.status);
  } catch (error) { console.error('[telegram] notification error:', error); }
  finally { clearTimeout(timeout); }
}

export async function notifyOwner(message: string): Promise<void> {
  const linked = ownerUsername ? getDoc('telegramLinks', ownerUsername)?.chatId : undefined;
  const destination = ownerChatId || (linked ? String(linked) : '');
  if (!destination) return;
  await send(destination, message);
}

export async function notifyTelegramUser(username: string | undefined, message: string): Promise<void> {
  const key = String(username || '').replace(/^@/, '').trim().toLowerCase();
  if (!key) return;
  const link = getDoc('telegramLinks', key);
  if (link?.chatId) await send(String(link.chatId), message);
}
