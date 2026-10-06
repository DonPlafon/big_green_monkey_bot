import { api } from 'sdk';
import { now, makePuzzle, displayName, escapeHtml, isAdmin, isMember, permissions,
  mutedPermissions, restoredPermissions, parseCaptcha } from './domain.js';
import { getChat, getChallenge, latestChallenge, createChallenge, compareChallenge, setChallenge, logEvent } from './store.js';
import { answer, edit, removeMessage, UserError } from './telegram.js';

const destination = row => row.delivery_chat_id ?? row.chat_id;
const missingRequest = e => e.code === 400 && /HIDE_REQUESTER_MISSING|join request.*not found|USER_ALREADY_PARTICIPANT/i.test(e.description || '');

export function captchaView(row) {
  const options = JSON.parse(row.options).map((text, i) => ({ text, callback_data: `v:${row.id}:${row.version}:${i}` }));
  return {
    text: `${row.kind === 'request' ? `<b>${escapeHtml(row.chat_title)}</b>\nпроверка перед входом\n\n` : ''}<a href="tg://user?id=${row.user_id}">${escapeHtml(row.name)}</a> · ${row.question}\nпопыток: ${row.attempts_left}`,
    reply_markup: { inline_keyboard: [options.slice(0,3), options.slice(3)] },
  };
}
async function show(row) {
  const view = captchaView(row);
  if (row.message_id) {
    try { await edit(destination(row), row.message_id, view.text, view.reply_markup); return; }
    catch (e) { if (e.code !== 400 || !/message to edit not found/i.test(e.description || '')) throw e; }
  }
  if (row.kind === 'request' && now() >= row.delivery_deadline) throw new UserError('время отправки капчи истекло');
  const message = await api.sendMessage({ chat_id: destination(row), ...view, parse_mode: 'HTML' });
  await setChallenge(row.id, { message_id: message.message_id,
    ...(row.kind === 'request' ? {delivery_chat_id:message.chat.id} : {}) });
}

export async function startRequestCaptcha(request, chat, context = {}) {
  const key = `request:${chat.id}:${request.from.id}:${context.update?.update_id ?? request.date}`;
  await logEvent(key,chat.id,request.from,'request');
  const puzzle = makePuzzle(chat.captcha_type);
  const previous = await latestChallenge(chat.id,request.from.id);
  let row = await createChallenge({ event_key:key, kind:'request', chat_id:chat.id,
    user_id:request.from.id, name:displayName(request.from), chat_title:chat.title.toLocaleLowerCase('ru'),
    delivery_chat_id:request.user_chat_id, delivery_deadline:request.date + 300,
    question:puzzle.question, options:JSON.stringify(puzzle.options), answer:puzzle.answer,
    attempts_left:chat.attempts, max_attempts:chat.attempts, failure_action:chat.request_failure,
    original_permissions:'{}', created_at:now() });
  const latest = await latestChallenge(chat.id,request.from.id);
  if (latest?.id !== row.id) return;
  if (previous && previous.id < row.id && !['passed','failed','left'].includes(previous.state)) {
    const closed = await compareChallenge(previous,{state:'left',version:previous.version+1});
    if (closed) await removeMessage(destination(previous),previous.message_id);
  }
  if (row.state === 'pending') {
    await logEvent(`captcha:${row.id}`,chat.id,request.from,'captcha');
    return;
  }
  if (row.state !== 'new' && !(row.state === 'preparing' && row.locked_at < now()-60)) return;
  row = await compareChallenge(row,{state:'preparing',locked_at:now(),version:row.version+1});
  if (!row) return;
  try {
    await show(row);
    await setChallenge(row.id,{state:'pending',locked_at:0});
    await logEvent(`captcha:${row.id}`,chat.id,request.from,'captcha');
  } catch (e) {
    // Failure to contact a user must never approve or reject their application.
    const permanent = e instanceof UserError || e.code === 403
      || (e.code === 400 && /chat not found|USER_IS_BLOCKED|PEER_ID_INVALID/i.test(e.description || ''));
    await setChallenge(row.id,{state:permanent ? 'delivery_failed' : 'new',locked_at:0});
    await logEvent(`error:${row.id}`,chat.id,request.from,'delivery_error');
    if (!permanent) throw e;
  }
}

async function requestNotice(row, text) {
  if (!row.message_id) return;
  try { await edit(destination(row),row.message_id,`<b>${escapeHtml(row.chat_title)}</b>\n${text}`,{inline_keyboard:[]}); }
  catch (e) { console.warn('request result display failed',{id:row.id,code:e.code}); }
}

async function resolveRequest(row, approve, admin = false) {
  try {
    if (approve) await api.approveChatJoinRequest({chat_id:row.chat_id,user_id:row.user_id});
    else await api.declineChatJoinRequest({chat_id:row.chat_id,user_id:row.user_id});
  } catch (e) {
    if (!missingRequest(e)) throw e;
    const member = await api.getChatMember({chat_id:row.chat_id,user_id:row.user_id});
    if (!approve || !isMember(member)) {
      await setChallenge(row.id,{state:'left',locked_at:0});
      await requestNotice(row,'заявка уже закрыта');
      return;
    }
  }
  const user = {id:row.user_id,first_name:row.name};
  if (approve) {
    await logEvent(`approved:${row.event_key}`,row.chat_id,user,'approved');
    await logEvent(`passed:${row.id}`,row.chat_id,user,admin ? 'manual' : 'passed');
  } else await logEvent(`failed:${row.id}`,row.chat_id,user,'declined');
  await setChallenge(row.id,{state:approve ? 'passed' : 'failed',locked_at:0});
  await requestNotice(row,approve ? 'проверка пройдена · заявка принята' : 'заявка отклонена · можно подать снова');
}

export async function startCaptcha(update, context = {}) {
  const chat = await getChat(update.chat.id), user = update.new_chat_member.user;
  if (!chat?.enabled || !chat.available || chat.mode !== 'captcha' || chat.kind !== 'supergroup' || user.is_bot) return;
  if (isMember(update.old_chat_member) || !isMember(update.new_chat_member) || isAdmin(update.new_chat_member)) return;
  const key = `join:${chat.id}:${user.id}:${context.update?.update_id ?? update.date}`;
  const current = await api.getChatMember({ chat_id: chat.id, user_id: user.id });
  if (!isMember(current) || isAdmin(current)) return;
  const puzzle = makePuzzle(chat.captcha_type);
  let row = await createChallenge({ event_key: key, chat_id: chat.id, user_id: user.id, name: displayName(user),
    question: puzzle.question, options: JSON.stringify(puzzle.options), answer: puzzle.answer,
    attempts_left: chat.attempts, max_attempts: chat.attempts, failure_action: chat.failure_action,
    original_permissions: JSON.stringify(permissions(update.new_chat_member)),
    was_restricted: update.new_chat_member.status === 'restricted' ? 1 : 0,
    original_until: update.new_chat_member.until_date || 0, created_at: now() });
  const latest = await latestChallenge(chat.id,user.id);
  if (latest?.id !== row.id) return;
  if (row.state === 'pending') {
    await show(row);
    await logEvent(`captcha:${row.id}`,chat.id,user,'captcha');
    return;
  }
  if (row.state !== 'new' && !(row.state === 'preparing' && row.locked_at < now() - 60)) return;
  row = await compareChallenge(row, { state: 'preparing', locked_at: now(), version: row.version + 1 });
  if (!row) return;
  try {
    await api.restrictChatMember({ chat_id: chat.id, user_id: user.id, permissions: mutedPermissions(),
      use_independent_chat_permissions: true, until_date: 0 });
    await show(row);
    await setChallenge(row.id, { state: 'pending', locked_at: 0 });
    await logEvent(`captcha:${row.id}`, chat.id, user, 'captcha');
  } catch (e) {
    await setChallenge(row.id, { state: 'new', locked_at: 0 });
    await logEvent(`error:${row.id}`, chat.id, user, 'error');
    throw e;
  }
}

async function complete(row, admin = false) {
  if (row.kind === 'request') return resolveRequest(row,true,admin);
  const current = await api.getChatMember({ chat_id: row.chat_id, user_id: row.user_id });
  if (!isMember(current)) {
    await setChallenge(row.id, { state: 'left', locked_at: 0 });
    await removeMessage(row.chat_id, row.message_id);
    return;
  }
  // An administrator may have changed permissions while the captcha was open.
  // Only undo the exact indefinite mute that this bot installs.
  const ourMute = current.status === 'restricted' && !current.until_date
    && Object.keys(mutedPermissions()).every(key => current[key] !== true);
  if (!isAdmin(current) && ourMute) {
    const chat = await api.getChat({ chat_id: row.chat_id });
    await api.restrictChatMember({ chat_id: row.chat_id, user_id: row.user_id,
      permissions: restoredPermissions(row, chat.permissions || {}), use_independent_chat_permissions: true,
      until_date: row.original_until > now() + 30 ? row.original_until : 0 });
  }
  await setChallenge(row.id, { state: 'passed', locked_at: 0 });
  await logEvent(`passed:${row.id}`, row.chat_id, { id: row.user_id, first_name: row.name }, admin ? 'manual' : 'passed');
  const config = await getChat(row.chat_id);
  if (config?.clean_success) await removeMessage(row.chat_id, row.message_id);
  else if (row.message_id) {
    try { await edit(row.chat_id, row.message_id, `${escapeHtml(row.name)} · проверка пройдена`, { inline_keyboard: [] }); }
    catch (e) { console.warn('completed captcha display failed', { id: row.id, code: e.code }); }
  }
}

async function kick(row) {
  if (row.kind === 'request') return resolveRequest(row,false);
  const current = await api.getChatMember({ chat_id: row.chat_id, user_id: row.user_id });
  // unbanChatMember with only_if_banned=false removes a present member without
  // banning future joins. Never unban someone already banned by an administrator.
  if (isMember(current) && !isAdmin(current)) {
    await api.unbanChatMember({ chat_id: row.chat_id, user_id: row.user_id, only_if_banned: false });
  }
  await setChallenge(row.id, { state: 'failed', locked_at: 0 });
  await logEvent(`failed:${row.id}`, row.chat_id, { id: row.user_id, first_name: row.name }, 'failed');
  await removeMessage(row.chat_id, row.message_id);
}

export async function solveCaptcha(query) {
  const data = parseCaptcha(query.data);
  if (!data) return answer(query, 'кнопка устарела');
  let row = await getChallenge(data.id);
  if (!row || query.from.id !== row.user_id) return answer(query, 'эта проверка для другого участника');
  if (query.message?.chat.id !== destination(row) || query.message?.message_id !== row.message_id) return answer(query, 'кнопка устарела');
  const latest = await latestChallenge(row.chat_id, row.user_id);
  if (latest?.id !== row.id || ['passed','failed','left'].includes(row.state)) return answer(query, 'проверка уже завершена');
  if (row.state === 'waiting_admin') return answer(query,'заявка ожидает решения администратора');
  // A previous successful answer may have hit a temporary Bot API error.
  if (['solving','kicking'].includes(row.state) && row.locked_at < now() - 60) {
    const recovering = await compareChallenge(row, { locked_at: now(), version: row.version + 1 });
    if (!recovering) return answer(query, 'уже проверяю');
    await answer(query, 'проверяю');
    try { await (row.state === 'solving' ? complete(recovering) : kick(recovering)); }
    catch (e) { await setChallenge(row.id, { locked_at: 0 }); throw e; }
    return;
  }
  if (row.state !== 'pending') return answer(query, 'проверка готовится · попробуй ещё раз');
  if (data.version !== row.version) { await answer(query, 'задание обновлено'); await show(row); return; }
  if (data.answer === row.answer) {
    row = await compareChallenge(row, { state: 'solving', locked_at: now(), version: row.version + 1 });
    if (!row) return answer(query, 'уже проверяю');
    await answer(query, 'верно');
    try { await complete(row); }
    catch (e) { await setChallenge(row.id, { locked_at: 0 }); throw e; }
    return;
  }
  const remaining = row.attempts_left - 1;
  if (remaining <= 0 && row.kind === 'request' && row.failure_action === 'hold') {
    row = await compareChallenge(row,{state:'waiting_admin',version:row.version+1,attempts_left:0});
    if (!row) return answer(query,'уже проверяю');
    await answer(query,'заявка останется на рассмотрении');
    await logEvent(`held:${row.id}`,row.chat_id,{id:row.user_id,first_name:row.name},'held');
    await requestNotice(row,'попытки закончились · жди решения администратора');
    return;
  }
  if (remaining <= 0 && ['kick','decline'].includes(row.failure_action)) {
    row = await compareChallenge(row, { state: 'kicking', locked_at: now(), version: row.version + 1 });
    if (!row) return answer(query, 'уже проверяю');
    await answer(query, row.kind === 'request' ? 'попытки закончились' : 'попытки закончились · можно зайти снова');
    try { await kick(row); }
    catch (e) { await setChallenge(row.id, { locked_at: 0 }); throw e; }
    return;
  }
  const config = await getChat(row.chat_id), puzzle = makePuzzle(config?.captcha_type || 'emoji');
  row = await compareChallenge(row, { attempts_left: remaining > 0 ? remaining : row.max_attempts,
    question: puzzle.question, options: JSON.stringify(puzzle.options), answer: puzzle.answer, version: row.version + 1 });
  if (!row) return answer(query, 'задание уже обновлено');
  await answer(query, remaining > 0 ? 'неверно · попробуй ещё' : 'новая проверка');
  await show(row);
}

export async function manuallyPass(id, chatId) {
  let row = await getChallenge(id);
  if (!row || row.chat_id !== chatId) throw new UserError('проверка не найдена');
  if (['passed','left','failed'].includes(row.state)) throw new UserError('проверка уже завершена');
  const latest = await latestChallenge(row.chat_id, row.user_id);
  if (latest?.id !== row.id) throw new UserError('есть более новая проверка');
  if (['preparing','solving','kicking'].includes(row.state) && row.locked_at > now() - 60) throw new UserError('уже обрабатываю · попробуй позже');
  row = await compareChallenge(row, { state: 'solving', version: row.version + 1, locked_at: now() });
  if (!row) throw new UserError('уже обрабатываю');
  try { await complete(row, true); }
  catch (e) { await setChallenge(row.id, { locked_at: 0 }); throw e; }
}

export async function memberLeft(update) {
  if (!isMember(update.old_chat_member) || isMember(update.new_chat_member)) return;
  const row = await latestChallenge(update.chat.id, update.new_chat_member.user.id);
  if (row && !['passed','left','failed'].includes(row.state)) {
    await compareChallenge(row, { state: 'left', version: row.version + 1 });
    await removeMessage(destination(row), row.message_id);
  }
}
