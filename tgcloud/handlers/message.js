import { api } from 'sdk';
import { home, help, connectShared } from '../lib/ui.js';
import { clearPicker, getPicker } from '../lib/store.js';
import { UserError } from '../lib/telegram.js';

export default async function (message) {
  if (message.chat.type !== 'private' || !message.from || message.from.is_bot) return;
  try {
    if (message.chat_shared) return await connectShared(message);
    const command = (message.text || '').trim().split(/\s/)[0].split('@')[0];
    if (command === '/help') return await help({ chatId: message.chat.id });
    const picker = await getPicker(message.from.id);
    await clearPicker(message.from.id);
    if (message.text === 'отмена' || picker) {
      await api.sendMessage({ chat_id: message.chat.id, text: message.text === 'отмена' ? 'отменено' : 'готово', reply_markup: { remove_keyboard: true } });
    }
    return await home({ chatId: message.chat.id }, message.from.id);
  } catch (e) {
    if (!(e instanceof UserError)) { console.error('private message failed', { code: e.code, message: e.message }); throw e; }
    await api.sendMessage({ chat_id: message.chat.id, text: e.message });
  }
}
