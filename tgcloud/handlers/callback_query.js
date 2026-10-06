import { api } from 'sdk';
import { home, help, settings, choose, openPicker, pageTarget, statistics, logs, waiting, invite, render, button, unavailableChat, confirmRemoval } from '../lib/ui.js';
import { getChat, setChat } from '../lib/store.js';
import { authorize, checkBot, answer, UserError } from '../lib/telegram.js';
import { solveCaptcha, manuallyPass } from '../lib/captcha.js';
import { savedChat, removeSavedChat } from '../lib/chat-list.js';

export default async function (query) {
  if (query.from.is_bot) return;
  if (query.data?.startsWith('v:')) return solveCaptcha(query);
  if (query.message?.chat.type !== 'private' || query.message.chat.id !== query.from.id) return answer(query,'открой настройки в личке');
  let acknowledged = false;
  try {
    const target = pageTarget(query.message), data = query.data || '';
    if (/^home:\d{1,6}$/.test(data)) { await answer(query); acknowledged = true; return await home(target,query.from.id,Number(data.split(':')[1])); }
    if (data === 'help') { await answer(query); acknowledged = true; return await help(target); }
    if (data === 'add') { await answer(query); acknowledged = true; return await openPicker(query.from.id); }
    const match = /^c:(-\d+):([a-z]+)(?::([a-z0-9]+))?$/.exec(data);
    if (!match) return answer(query,'кнопка устарела');
    const [,id,action,value] = match, chatId = Number(id);
    if (!Number.isSafeInteger(chatId)) return answer(query,'чат не найден');
    if (action === 'remove' && !value) {
      const saved = await savedChat(chatId,query.from.id);
      await answer(query); acknowledged = true;
      return await confirmRemoval(target,saved);
    }
    if (action === 'forget' && value === 'yes') {
      await removeSavedChat(chatId,query.from.id);
      await answer(query,'убрано из списка'); acknowledged = true;
      return await home(target,query.from.id);
    }
    let chat;
    try { chat = await authorize(chatId,query.from.id); }
    catch (error) {
      if (action !== 'show' || !(error instanceof UserError)) throw error;
      const saved = await savedChat(chatId,query.from.id);
      await answer(query); acknowledged = true;
      return await unavailableChat(target,saved);
    }
    if (action === 'enabled') {
      if (!['0','1'].includes(value)) throw new UserError('кнопка устарела');
      if (value === '1') await checkBot(chatId,chat.mode);
      await setChat(chatId,{ enabled:Number(value), ...(value === '1' ? {available:1} : {}) });
    } else if (['mode','type','attempts','failure'].includes(action)) {
      if (!value) { await answer(query); acknowledged = true; return await choose(target,chat,action); }
      const allowed = { mode:['requests','captcha','requestcaptcha'], type:['emoji','math'], attempts:['1','3','5'], failure:chat.mode === 'requestcaptcha' ? ['retry','hold','decline'] : ['retry','kick'] };
      if (!allowed[action].includes(value)) throw new UserError('кнопка устарела');
      if (action === 'mode' && value === 'captcha') {
        if (chat.kind !== 'supergroup') throw new UserError(chat.kind === 'channel' ? 'капча доступна только в группах' : 'для капчи нужна супергруппа');
        await checkBot(chatId,'captcha');
      }
      const column = {mode:'mode',type:'captcha_type',attempts:'attempts',failure:chat.mode === 'requestcaptcha' ? 'request_failure' : 'failure_action'}[action];
      await setChat(chatId,{ [column]:action === 'attempts' ? Number(value) : value });
    } else if (action === 'clean') {
      if (!['0','1'].includes(value)) throw new UserError('кнопка устарела');
      await setChat(chatId,{ clean_success:Number(value) });
    } else if (action === 'rights') {
      await checkBot(chatId,chat.mode);
      await setChat(chatId,{available:1});
      await answer(query,'все права на месте'); acknowledged = true;
    } else if (action === 'allow') {
      if (!/^\d+$/.test(value || '')) throw new UserError('кнопка устарела');
      return await render(target,'пропустить участника без капчи?',[[button('пропустить',`c:${chatId}:confirm:${value}`)],[button('‹ назад',`c:${chatId}:waiting`)]]).then(() => answer(query));
    } else if (action === 'confirm') {
      if (!/^\d+$/.test(value || '')) throw new UserError('кнопка устарела');
      await manuallyPass(Number(value),chatId);
      await answer(query,'готово'); return await waiting(target,chat);
    } else if (!['show','stats','logs','waiting','invite'].includes(action)) throw new UserError('кнопка устарела');
    if (!acknowledged) { await answer(query); acknowledged = true; }
    if (action === 'stats') return await statistics(target,chat);
    if (action === 'logs') return await logs(target,chat,/^\d{1,6}$/.test(value || '') ? Number(value) : 0);
    if (action === 'waiting') return await waiting(target,chat,/^\d{1,6}$/.test(value || '') ? Number(value) : 0);
    if (action === 'invite') { await checkBot(chatId,'requests'); return await invite(target,chat); }
    chat = await getChat(chatId);
    return await settings(target,chat);
  } catch (e) {
    const text = e instanceof UserError ? e.message : 'не получилось · проверь права и попробуй ещё раз';
    if (!(e instanceof UserError)) console.error('admin action failed', { code:e.code, message:e.message });
    if (!acknowledged) await answer(query,text,true);
    else await api.sendMessage({chat_id:query.from.id,text});
  }
}
