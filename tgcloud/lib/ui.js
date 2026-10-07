import { api, db } from 'sdk';
import { lower, escapeHtml, now, adminRights, canManage } from './domain.js';
import { listChats, savePicker, getPicker, clearPicker, completePicker, connectChat, readEvents, stats, pending, setChat } from './store.js';
import { authorize, checkBot, edit, UserError } from './telegram.js';

export const button = (text, data) => ({ text, callback_data: data });
export const requestButton = (isChannel, id) => ({ text:isChannel ? 'канал' : 'группа', request_chat:{
  request_id:id, chat_is_channel:isChannel, request_title:true,
  user_administrator_rights:{...adminRights(isChannel),can_promote_members:true},
  bot_administrator_rights:adminRights(isChannel),
} });
const title = chat => `<b>${escapeHtml(lower(chat.title))}</b>`;
const control = (chat, action, value = '') => `c:${chat.id}:${action}${value === '' ? '' : `:${value}`}`;
const back = chat => [button('‹ настройки', control(chat, 'show'))];
export const pageTarget = message => ({ chatId: message.chat.id, messageId: message.message_id });
export async function render(target, text, rows) {
  const reply_markup = { inline_keyboard: rows };
  if (target.messageId) return edit(target.chatId, target.messageId, text, reply_markup);
  return api.sendMessage({ chat_id: target.chatId, text, parse_mode: 'HTML', reply_markup });
}
export async function home(target, userId, page = 0) {
  const rows = await listChats(userId, page * 6), visible = rows.slice(0, 6);
  const buttons = visible.map(chat => [button(`${chat.enabled && chat.available ? '●' : '○'} ${lower(chat.title).slice(0,45)}`, control(chat,'show'))]);
  const navigation = [];
  if (page > 0) navigation.push(button('‹', `home:${page - 1}`));
  if (rows.length > 6) navigation.push(button('›', `home:${page + 1}`));
  if (navigation.length) buttons.push(navigation);
  const me = await api.getMe();
  buttons.push([{text:'открыть управление',web_app:{url:`https://app${me.id}.tgcloud.ai/`}}],
    [button('+ добавить чат или канал', 'add')], [button('как это работает', 'help')]);
  return render(target, visible.length ? '<b>твои чаты</b>\nвыбери нужный' : '<b>порядок начинается со входа</b>\nдобавь чат или канал', buttons);
}
export async function help(target) {
  return render(target, '<b>три режима</b>\n\nзаявки — принимаю сразу.\nкапча перед принятием — пишу в личку и принимаю после проверки.\nкапча при входе — проверяю новичков внутри группы.\n\nу каждого чата свои настройки. включение — вручную.\n\nкапча без таймера: участник ждёт до ответа или решения администратора.', [[button('‹ твои чаты', 'home:0')]]);
}
export async function settings(target, chat) {
  const requestCaptcha = chat.mode === 'requestcaptcha';
  const mode = requestCaptcha ? 'капча перед принятием' : chat.mode === 'requests' ? 'приём заявок' : 'капча при входе';
  const status = !chat.available ? 'нет доступа' : chat.enabled ? 'работает' : 'на паузе';
  const rows = [[button(chat.enabled ? 'поставить на паузу' : 'включить', control(chat,'enabled',chat.enabled ? 0 : 1))]];
  rows.push([button(`режим · ${mode}`, control(chat,'mode'))]);
  if (chat.mode !== 'requests') rows.push(
    [button(`капча · ${chat.captcha_type === 'emoji' ? 'эмодзи' : 'пример'}`, control(chat,'type'))],
    [button(`попыток · ${chat.attempts}`, control(chat,'attempts'))],
    [button(`при ошибках · ${requestCaptcha ? ({retry:'новая капча',hold:'оставить заявку',decline:'отклонить'}[chat.request_failure]) : chat.failure_action === 'retry' ? 'новая капча' : 'удалить'}`, control(chat,'failure'))],
    ...(requestCaptcha ? [] : [[button(`убирать капчу · ${chat.clean_success ? 'да' : 'нет'}`, control(chat,'clean', chat.clean_success ? 0 : 1))]]),
    [button('ожидают проверки', control(chat,'waiting'))]);
  if (chat.mode !== 'captcha') rows.push([button('ссылка с заявкой', control(chat,'invite'))]);
  if (chat.mode === 'requests') rows.push([button('ожидают проверки',control(chat,'waiting'))]);
  if (chat.kind !== 'channel') rows.push([button('фильтры',control(chat,'filters'))]);
  rows.push([button('статистика', control(chat,'stats')), button('журнал', control(chat,'logs'))],
    [button('проверить права', control(chat,'rights'))],
    [button('убрать из списка', control(chat,'remove'))], [button('‹ твои чаты', 'home:0')]);
  const detail = requestCaptcha ? 'капча в личке · принимаю после верного ответа.' : chat.mode === 'captcha' ? 'новичок не пишет, пока не пройдёт проверку.' : 'принимаю заявки сразу после получения.';
  return render(target, `${title(chat)}\n${status} · ${mode}\n\n${detail}${chat.enabled ? '' : '\nпауза не снимает уже выданные ограничения.'}`, rows);
}
export async function unavailableChat(target, chat) {
  return render(target, `${title(chat)}\nнет доступа\n\nбот или твой аккаунт больше не может управлять чатом.`,
    [[button('проверить снова', control(chat,'show'))],
      [button('убрать из списка', control(chat,'remove'))], [button('‹ твои чаты', 'home:0')]]);
}
export async function filters(target, chat) {
  if (chat.kind === 'channel') throw new UserError('фильтры доступны только в группах');
  const toggle = (label, field, action) => [button(`${chat[field] ? '●' : '○'} ${label}`, control(chat, action, chat[field] ? 0 : 1))];
  return render(target, `${title(chat)}\n<b>guest mode</b>\n\nдля фильтра включи bot-to-bot communication в botfather и дай боту право удалять сообщения.`, [
    toggle('удалять все ответы', 'block_guest', 'guestall'),
    ...(!chat.block_guest ? [toggle('только для участников', 'guest_members_only', 'guestmembers')] : []),
    toggle('объяснять удаление', 'guest_notice', 'guestnotice'),
    back(chat),
  ]);
}
export async function confirmRemoval(target, chat) {
  return render(target, `${title(chat)}\nубрать из твоего списка?\n\nнастройки и работа бота сохранятся. для остановки поставь чат на паузу.`,
    [[button('убрать', control(chat,'forget','yes'))], [button('отмена', control(chat,'show'))]]);
}
export async function choose(target, chat, action) {
  const choices = {
    mode: ['режим работы', [['приём заявок', 'requests'], ['капча перед принятием', 'requestcaptcha'], ...(chat.kind === 'supergroup' ? [['капча при входе', 'captcha']] : [])]],
    type: ['вид капчи', [['эмодзи', 'emoji'], ['пример', 'math']]],
    attempts: ['число попыток', [['1', '1'], ['3', '3'], ['5', '5']]],
    failure: ['если попытки закончились', chat.mode === 'requestcaptcha' ? [['новая капча','retry'],['оставить заявку','hold'],['отклонить заявку','decline']] : [['новая капча','retry'],['удалить из чата','kick']]],
  };
  const [label, options] = choices[action];
  return render(target, `${title(chat)}\n${label}${action === 'failure' && chat.mode !== 'requestcaptcha' ? '\nпосле удаления можно зайти снова.' : ''}`,
    [...options.map(([text,value]) => [button(text, control(chat,action,value))]), back(chat)]);
}
export async function openPicker(userId) {
  const group = Math.floor(Math.random() * 1_000_000_000) + 1, channel = group + 1;
  await savePicker(userId, group, channel);
  return api.sendMessage({ chat_id: userId, text: 'что подключим?', reply_markup: {
    keyboard: [[requestButton(false,group), requestButton(true,channel)], [{ text: 'отмена' }]],
    resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: 'выбери чат или канал',
  } });
}
export async function connectShared(message) {
  const userId = message.from.id, request = message.chat_shared, picker = await getPicker(userId);
  if (!picker || picker.expires_at < now() || ![picker.group_request,picker.channel_request].includes(request.request_id)) {
    throw new UserError('выбор устарел · нажми «добавить» ещё раз');
  }
  const chat = await api.getChat({ chat_id: request.chat_id });
  const wantedChannel = request.request_id === picker.channel_request;
  if ((chat.type === 'channel') !== wantedChannel || !['channel','group','supergroup'].includes(chat.type)) throw new UserError('выбери группу или канал');
  const member = await api.getChatMember({ chat_id: chat.id, user_id: userId });
  if (!canManage(member, chat.type)) throw new UserError('нужны права управления участниками');
  await checkBot(chat.id, wantedChannel ? 'requests' : 'captcha');
  const config = await connectChat(chat, userId);
  if (picker.source === 'miniapp') {
    await completePicker(userId,chat.id);
    return;
  }
  await clearPicker(userId);
  await api.sendMessage({ chat_id: userId, text: 'подключено', reply_markup: { remove_keyboard: true } });
  return settings({ chatId: userId }, config);
}
const EVENT_NAMES = { request:'заявка', approved:'принят', captcha:'капча отправлена', passed:'капча пройдена',
  declined:'заявка отклонена', held:'ожидает решения', delivery_error:'капча не доставлена', failed:'удалён', manual:'пропущен админом', error:'ошибка проверки', unavailable:'нет прав бота', guest_deleted:'гостевое сообщение удалено', filter_error:'ошибка удаления' };
export async function statistics(target, chat) {
  const counts = Object.fromEntries((await stats(chat.id)).map(row => [row.kind, row.total]));
  const waiting = await pending(chat.id);
  return render(target, `${title(chat)}\n<b>статистика · всё время</b>\n\nзаявок: ${counts.request || 0}\nпринято: ${counts.approved || 0}\n\nкапч: ${counts.captcha || 0}\nпрошли: ${counts.passed || 0}\nпропущено вручную: ${counts.manual || 0}\nотклонено: ${counts.declined || 0}\nкапча не доставлена: ${counts.delivery_error || 0}\nудалено: ${counts.failed || 0}\nожидают: ${waiting?.total || 0}\nгостевых сообщений удалено: ${counts.guest_deleted || 0}`,
    [[button('обновить', control(chat,'stats'))],back(chat)]);
}
export async function logs(target, chat, page = 0) {
  const rows = await readEvents(chat.id, page * 8);
  const lines = rows.slice(0,8).map(row => {
    const date = new Date(row.created_at * 1000).toISOString().slice(5,16).replace('T',' ');
    return `${date} · ${EVENT_NAMES[row.kind] || 'событие'}\n${escapeHtml(row.name)} · <code>${row.user_id}</code>`;
  });
  const nav = [];
  if (page > 0) nav.push(button('‹', control(chat,'logs',page-1)));
  if (rows.length > 8) nav.push(button('›', control(chat,'logs',page+1)));
  return render(target, `${title(chat)}\n<b>журнал · utc</b>\n\n${lines.join('\n\n') || 'пока пусто'}`, [...(nav.length ? [nav] : []),back(chat)]);
}
export async function waiting(target, chat, page = 0) {
  const rows = await db.all("SELECT * FROM challenges WHERE chat_id = :c AND state NOT IN ('passed','failed','left') ORDER BY id DESC LIMIT 7 OFFSET :o", { ':c': chat.id, ':o': page*6 });
  const buttons = rows.slice(0,6).map(row => [button(`пропустить · ${row.name.slice(0,30)}`, control(chat,'allow',row.id))]);
  const nav = [];
  if (page > 0) nav.push(button('‹', control(chat,'waiting',page-1)));
  if (rows.length > 6) nav.push(button('›', control(chat,'waiting',page+1)));
  if (nav.length) buttons.push(nav);
  buttons.push([button('обновить',control(chat,'waiting',page))],back(chat));
  return render(target, `${title(chat)}\n<b>ожидают проверки</b>\n\n${rows.length ? 'можно пропустить участника вручную.' : 'все проверены'}`, buttons);
}
export async function invite(target, chat) {
  if (!chat.request_link) {
    const link = await api.createChatInviteLink({ chat_id: chat.id, name: 'вход с заявкой', creates_join_request: true });
    await setChat(chat.id, { request_link: link.invite_link });
    chat.request_link = link.invite_link;
  }
  return render(target, `${title(chat)}\n<b>вход с заявкой</b>\n\n${escapeHtml(chat.request_link)}\n\n${chat.enabled ? (chat.mode === 'requestcaptcha' ? 'новые заявки принимаются после капчи в личке.' : 'новые заявки принимаются автоматически.') : 'приём на паузе · включи его в настройках.'}`, [back(chat)]);
}

export async function freshSettings(target, chatId, userId) {
  return settings(target, await authorize(chatId, userId));
}
