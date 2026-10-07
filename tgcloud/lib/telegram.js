import { api } from 'sdk';
import { canManage, missingRights } from './domain.js';
import { getChat } from './store.js';
export class UserError extends Error {}
export async function authorize(chatId, userId) {
  const chat = await getChat(chatId);
  if (!chat) throw new UserError('чат не найден');
  let member;
  try { member = await api.getChatMember({ chat_id: chatId, user_id: userId }); }
  catch (error) {
    if ([400,403].includes(error.code)) throw new UserError('нет доступа к чату · проверь права бота');
    throw error;
  }
  if (!canManage(member, chat.kind)) throw new UserError('нужны права управления участниками');
  return chat;
}
export async function checkBot(chatId, mode, config) {
  const me = await api.getMe(), member = await api.getChatMember({ chat_id: chatId, user_id: me.id });
  const missing = missingRights(member, mode, config ?? await getChat(chatId));
  if (missing) throw new UserError(missing);
  return member;
}
export async function answer(query, text = '', alert = false) {
  try { await api.answerCallbackQuery({ callback_query_id: query.id, text, show_alert: alert }); }
  catch (e) {
    if (e.code !== 400 || !/query is too old|query id is invalid/i.test(e.description || '')) throw e;
  }
}
export async function removeMessage(chatId, messageId) {
  if (!messageId) return;
  try { await api.deleteMessage({ chat_id: chatId, message_id: messageId }); }
  catch (e) { console.warn('message cleanup failed', { chatId, code: e.code }); }
}
export async function edit(chatId, messageId, text, reply_markup) {
  try { return await api.editMessageText({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup }); }
  catch (e) {
    if (e.code === 400 && /message is not modified/i.test(e.description || '')) return;
    throw e;
  }
}
