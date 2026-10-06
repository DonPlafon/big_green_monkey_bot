import { api } from 'sdk';
import { getChat, claimJob, finishJob, retryJob, logEvent } from '../lib/store.js';
import { isMember } from '../lib/domain.js';
import { startRequestCaptcha } from '../lib/captcha.js';

export default async function (request, context = {}) {
  const chat = await getChat(request.chat.id);
  if (!chat?.enabled || !chat.available || !['requests','requestcaptcha'].includes(chat.mode)) {
    if (request.query_id) await api.answerChatJoinRequestQuery({ chat_join_request_query_id:request.query_id,result:'queue' });
    return;
  }
  if (chat.mode === 'requestcaptcha') {
    // Guard queries have a 10-second response deadline. Queue the request;
    // this bot is also an admin and later uses the normal approve/decline API.
    if (request.query_id) await api.answerChatJoinRequestQuery({chat_join_request_query_id:request.query_id,result:'queue'});
    return startRequestCaptcha(request,chat,context);
  }
  const key = `request:${chat.id}:${request.from.id}:${context.update?.update_id ?? request.date}`;
  if (!await claimJob(key)) return;
  try {
    await logEvent(key,chat.id,request.from,'request');
    if (request.query_id) await api.answerChatJoinRequestQuery({ chat_join_request_query_id:request.query_id,result:'approve' });
    else {
      try { await api.approveChatJoinRequest({chat_id:chat.id,user_id:request.from.id}); }
      catch (e) {
        if (e.code !== 400) throw e;
        const member = await api.getChatMember({chat_id:chat.id,user_id:request.from.id});
        if (!isMember(member)) {
          if (/HIDE_REQUESTER_MISSING|join request.*not found/i.test(e.description || '')) { await finishJob(key); return; }
          throw e;
        }
      }
    }
    await logEvent(`approved:${key}`,chat.id,request.from,'approved');
    await finishJob(key);
  } catch (e) { await retryJob(key); throw e; }
}
