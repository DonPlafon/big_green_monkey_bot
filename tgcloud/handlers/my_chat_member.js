import { getChat, setChat, logEvent } from '../lib/store.js';
import { missingRights } from '../lib/domain.js';
export default async function (update, context = {}) {
  const chat = await getChat(update.chat.id);
  if (!chat) return; // Adding the bot does not enable moderation before setup.
  const missing = missingRights(update.new_chat_member,chat.mode);
  await setChat(chat.id,{available:missing ? 0 : 1,title:update.chat.title,kind:update.chat.type});
  if (missing) await logEvent(`rights:${chat.id}:${context.update?.update_id ?? update.date}`,chat.id,update.from,'unavailable');
}
