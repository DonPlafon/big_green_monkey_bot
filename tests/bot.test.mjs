import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './runtime.mjs';
import { makePuzzle, parseCaptcha, restoredPermissions, isMember } from '../tgcloud/lib/domain.js';

const query = (id,data,chatId=1,userId=1,messageId=10,type='private') => ({id,from:{id:userId},data,message:{chat:{id:chatId,type},message_id:messageId}});
async function join(r,id=42,updateId=100,chatId=-1001) {
  const user={id,first_name:'Alice'};
  r.members.set(`${chatId}:${id}`,{status:'member',user});
  const payload={chat:{id:chatId,type:'supergroup'},date:updateId,old_chat_member:{status:'left',user},new_chat_member:{status:'member',user}};
  await r.handle('chat_member',payload,{update:{update_id:updateId}});
  return payload;
}
async function captchaRuntime() {
  const r=await createRuntime(), store=await r.connect();
  await store.setChat(-1001,{enabled:1,mode:'captcha'});
  return r;
}
const challenge = r => r.sqlite.prepare('SELECT * FROM challenges ORDER BY id DESC LIMIT 1').get();
const click = row => query(`q${row.id}`,`v:${row.id}:${row.version}:${row.answer}`,row.chat_id,row.user_id,row.message_id,'supergroup');

test('puzzles have six distinct options and a valid answer',()=>{
  for (const type of ['emoji','math']) for(let i=0;i<100;i++) {
    const puzzle=makePuzzle(type);
    assert.equal(new Set(puzzle.options).size,6);
    assert.ok(puzzle.answer>=0 && puzzle.answer<6);
    if(type==='math') { const [a,b]=puzzle.question.match(/\d+/g).map(Number); assert.equal(Number(puzzle.options[puzzle.answer]),a+b); }
  }
  assert.equal(parseCaptcha('v:1:0:6'),null);
  assert.equal(parseCaptcha('v:9007199254740992:0:0'),null);
  assert.equal(isMember({status:'restricted',is_member:false}),false);
});
test('native picker binds request ids and asks Telegram to add bot with rights',async()=>{
  const r=await createRuntime(); await r.connect();
  await r.handle('callback_query',query('add','add'));
  const sent=r.calls.findLast(x=>x.method==='sendMessage').params;
  const group=sent.reply_markup.keyboard[0][0].request_chat;
  assert.equal(group.chat_is_channel,false); assert.equal(group.bot_administrator_rights.can_restrict_members,true);
  await r.handle('message',{chat:{id:1,type:'private'},from:{id:1},chat_shared:{chat_id:-1001,request_id:group.request_id}});
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM managers').get().n,1);
  assert.ok(r.calls.some(x=>x.params?.reply_markup?.remove_keyboard));
});
test('untrusted and expired chat_shared cannot connect a chat',async()=>{
  const r=await createRuntime(); await r.connect();
  await r.handle('message',{chat:{id:7,type:'private'},from:{id:7},chat_shared:{chat_id:-1001,request_id:123}});
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM managers WHERE user_id=7').get().n,0);
  const store=await r.module('lib/store');await store.savePicker(7,123,124);
  r.sqlite.exec('UPDATE pickers SET expires_at=1');
  await r.handle('message',{chat:{id:7,type:'private'},from:{id:7},chat_shared:{chat_id:-1001,request_id:123}});
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM managers WHERE user_id=7').get().n,0);
});
test('fresh Telegram permissions prevent another user and demoted admins editing settings',async()=>{
  const r=await createRuntime(); await r.connect();
  for(const userId of [2,1]) {
    if(userId===1)r.members.set('-1001:1',{status:'member'});
    await r.handle('callback_query',query('x','c:-1001:enabled:1',userId,userId));
    assert.equal(r.sqlite.prepare('SELECT enabled FROM chats').get().enabled,0);
    assert.match(r.calls.findLast(x=>x.method==='answerCallbackQuery').params.text,/права/);
  }
});
test('settings are isolated across chats and channels cannot enable captcha',async()=>{
  const r=await createRuntime();await r.connect();await r.connect(-1002,1,'channel');
  await r.handle('callback_query',query('x','c:-1001:attempts:5'));
  await r.handle('callback_query',query('x','c:-1002:mode:captcha'));
  assert.equal(r.sqlite.prepare('SELECT attempts FROM chats WHERE id=-1001').get().attempts,5);
  assert.equal(r.sqlite.prepare('SELECT attempts,mode FROM chats WHERE id=-1002').get().mode,'requests');
  assert.equal(r.sqlite.prepare('SELECT attempts FROM chats WHERE id=-1002').get().attempts,3);
});
test('join retries create one challenge and only owner can solve it',async()=>{
  const r=await captchaRuntime(),payload=await join(r);
  await r.handle('chat_member',payload,{update:{update_id:100}});
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM challenges').get().n,1);
  assert.equal(r.calls.filter(x=>x.method==='sendMessage').length,1);
  const row=challenge(r), forged=click(row); forged.from.id=777;
  await r.handle('callback_query',forged);
  assert.equal(challenge(r).state,'pending');
  await r.handle('callback_query',click(row));
  assert.equal(challenge(r).state,'passed');
  assert.equal(r.members.get('-1001:42').can_send_messages,true);
});
test('concurrent correct clicks release once and count once',async()=>{
  const r=await captchaRuntime();await join(r);const q=click(challenge(r));
  await Promise.all([r.handle('callback_query',q),r.handle('callback_query',q)]);
  assert.equal(r.calls.filter(x=>x.method==='restrictChatMember').length,2);
  assert.equal(r.sqlite.prepare("SELECT count(*) n FROM events WHERE kind='passed'").get().n,1);
});
test('wrong answer rotates puzzle; stale buttons cannot consume another attempt',async()=>{
  const r=await captchaRuntime();await join(r);const row=challenge(r),q=click(row);
  q.data=`v:${row.id}:${row.version}:${(row.answer+1)%6}`;
  await r.handle('callback_query',q);await r.handle('callback_query',q);
  assert.equal(challenge(r).attempts_left,2);assert.equal(challenge(r).version,row.version+1);
});
test('last wrong answer kicks without permanent ban',async()=>{
  const r=await captchaRuntime();const store=await r.module('lib/store');await store.setChat(-1001,{attempts:1,failure_action:'kick'});
  await join(r);const row=challenge(r),q=click(row);q.data=`v:${row.id}:${row.version}:${(row.answer+1)%6}`;
  await r.handle('callback_query',q);
  assert.equal(challenge(r).state,'failed');assert.equal(r.members.get('-1001:42').status,'left');
  assert.equal(r.calls.some(x=>x.method==='banChatMember'),false);
});
test('temporary release error is recoverable by clicking again',async()=>{
  const r=await captchaRuntime();await join(r);const q=click(challenge(r));
  r.failures.set('restrictChatMember',Object.assign(new Error('rate limited'),{code:429}));
  await assert.rejects(r.handle('callback_query',q));
  assert.equal(challenge(r).state,'solving');
  await r.handle('callback_query',q);
  assert.equal(challenge(r).state,'passed');
});
test('pausing new checks does not strand an existing captcha',async()=>{
  const r=await captchaRuntime();await join(r);const q=click(challenge(r));
  const store=await r.module('lib/store');await store.setChat(-1001,{enabled:0});
  await r.handle('callback_query',q);assert.equal(challenge(r).state,'passed');
  await join(r,43,101);assert.equal(r.sqlite.prepare('SELECT count(*) n FROM challenges').get().n,1);
});
test('a departed user and old captcha cannot affect a new join',async()=>{
  const r=await captchaRuntime();await join(r);const old=challenge(r),user={id:42};
  await r.handle('chat_member',{chat:{id:-1001},old_chat_member:{status:'member',user},new_chat_member:{status:'left',user}});
  await join(r,42,102);await r.handle('callback_query',click(old));
  assert.equal(challenge(r).state,'pending');assert.equal(challenge(r).id,2);
});
test('existing individual restrictions are not expanded after passing',()=>{
  const restored=restoredPermissions({was_restricted:1,original_until:0,original_permissions:JSON.stringify({can_send_messages:true,can_send_photos:false})},{can_send_messages:true,can_send_photos:true});
  assert.equal(restored.can_send_photos,false);assert.equal(restored.can_send_messages,true);
});
test('duplicate requests are accepted and counted once',async()=>{
  const r=await createRuntime(),store=await r.connect();await store.setChat(-1001,{enabled:1});
  const req={chat:{id:-1001},from:{id:42,first_name:'alice'},date:100};
  await r.handle('chat_join_request',req);await r.handle('chat_join_request',req);
  assert.equal(r.calls.filter(x=>x.method==='approveChatJoinRequest').length,1);
  assert.equal(r.sqlite.prepare("SELECT count(*) n FROM events WHERE kind='approved'").get().n,1);
});
test('admin can explicitly release a pending member',async()=>{
  const r=await captchaRuntime();await join(r);const row=challenge(r);
  await r.handle('callback_query',query('allow',`c:-1001:confirm:${row.id}`));
  assert.equal(challenge(r).state,'passed');
  assert.equal(r.sqlite.prepare("SELECT count(*) n FROM events WHERE kind='manual'").get().n,1);
});
test('a failed captcha send retries without losing the original permissions',async()=>{
  const r=await captchaRuntime();
  r.failures.set('sendMessage',Object.assign(new Error('temporary failure'),{code:500}));
  await assert.rejects(join(r));assert.equal(challenge(r).state,'new');
  await join(r);assert.equal(challenge(r).state,'pending');
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM challenges').get().n,1);
  await r.handle('callback_query',click(challenge(r)));assert.equal(challenge(r).state,'passed');
});
test('captcha does not undo restrictions changed by another administrator',async()=>{
  const r=await captchaRuntime();await join(r);
  r.members.set('-1001:42',{status:'restricted',is_member:true,can_send_messages:false,until_date:Math.floor(Date.now()/1000)+3600});
  await r.handle('callback_query',click(challenge(r)));
  assert.equal(r.members.get('-1001:42').can_send_messages,false);
  assert.equal(r.calls.filter(x=>x.method==='restrictChatMember').length,1);
});
test('losing bot rights pauses new moderation and is recorded',async()=>{
  const r=await captchaRuntime();
  await r.handle('my_chat_member',{chat:{id:-1001,title:'test',type:'supergroup'},from:{id:1},date:1,new_chat_member:{status:'member'}});
  await join(r);
  assert.equal(r.sqlite.prepare('SELECT available FROM chats').get().available,0);
  assert.equal(r.sqlite.prepare('SELECT count(*) n FROM challenges').get().n,0);
});

async function requestRuntime(options={}) {
  const r=await createRuntime(),store=await r.connect(-1002,1,'channel');
  await store.setChat(-1002,{enabled:1,mode:'requestcaptcha',...options});
  return r;
}
const application = (id=42,date=Math.floor(Date.now()/1000)) => ({chat:{id:-1002},from:{id,first_name:'Alice'},user_chat_id:id+1000,date});
const privateClick = row => query('request-answer',`v:${row.id}:${row.version}:${row.answer}`,row.delivery_chat_id,row.user_id,row.message_id,'private');
test('channel request sends captcha to user_chat_id and approves only after a correct answer',async()=>{
  const r=await requestRuntime(),req=application();
  await r.handle('chat_join_request',req);
  assert.equal(r.calls.some(x=>x.method==='approveChatJoinRequest'),false);
  assert.equal(r.calls.findLast(x=>x.method==='sendMessage').params.chat_id,req.user_chat_id);
  await r.handle('callback_query',privateClick(challenge(r)));
  assert.equal(challenge(r).state,'passed');
  assert.equal(r.calls.filter(x=>x.method==='approveChatJoinRequest').length,1);
  assert.equal(r.calls.some(x=>x.method==='restrictChatMember'),false);
  assert.equal(r.sqlite.prepare("SELECT count(*) n FROM events WHERE kind='approved'").get().n,1);
});
test('duplicate requests do not send duplicate private captchas',async()=>{
  const r=await requestRuntime(),req=application();
  await r.handle('chat_join_request',req);await r.handle('chat_join_request',req);
  assert.equal(r.calls.filter(x=>x.method==='sendMessage').length,1);
});
test('private captcha validates sender, destination and message identity',async()=>{
  const r=await requestRuntime();await r.handle('chat_join_request',application());const row=challenge(r);
  for(const change of [q=>q.from.id++,q=>q.message.chat.id++,q=>q.message.message_id++]) {
    const q=privateClick(row);change(q);await r.handle('callback_query',q);
  }
  assert.equal(r.calls.some(x=>x.method==='approveChatJoinRequest'),false);
});
test('exhausted request captcha can wait for the administrator',async()=>{
  const r=await requestRuntime({attempts:1,request_failure:'hold'});
  await r.handle('chat_join_request',application());const row=challenge(r),q=privateClick(row);
  q.data=`v:${row.id}:${row.version}:${(row.answer+1)%6}`;await r.handle('callback_query',q);
  assert.equal(challenge(r).state,'waiting_admin');
  assert.equal(r.calls.some(x=>['approveChatJoinRequest','declineChatJoinRequest'].includes(x.method)),false);
  await r.handle('callback_query',query('admin',`c:-1002:confirm:${row.id}`));
  assert.equal(challenge(r).state,'passed');
});
test('exhausted request captcha can decline without banning or kicking',async()=>{
  const r=await requestRuntime({attempts:1,request_failure:'decline'});
  await r.handle('chat_join_request',application());const row=challenge(r),q=privateClick(row);
  q.data=`v:${row.id}:${row.version}:${(row.answer+1)%6}`;await r.handle('callback_query',q);
  assert.equal(challenge(r).state,'failed');
  assert.equal(r.calls.filter(x=>x.method==='declineChatJoinRequest').length,1);
  assert.equal(r.calls.some(x=>['banChatMember','unbanChatMember'].includes(x.method)),false);
});
test('request captcha retry generates another puzzle without accepting',async()=>{
  const r=await requestRuntime({attempts:1,request_failure:'retry'});
  await r.handle('chat_join_request',application());const row=challenge(r),q=privateClick(row);
  q.data=`v:${row.id}:${row.version}:${(row.answer+1)%6}`;await r.handle('callback_query',q);
  assert.equal(challenge(r).state,'pending');assert.equal(challenge(r).attempts_left,1);
  assert.equal(r.calls.some(x=>x.method==='approveChatJoinRequest'),false);
});
test('failed PM delivery leaves application pending and available for manual approval',async()=>{
  const r=await requestRuntime();
  r.failures.set('sendMessage',Object.assign(new Error('Forbidden'),{code:403}));
  await r.handle('chat_join_request',application());
  assert.equal(challenge(r).state,'delivery_failed');
  assert.equal(r.calls.some(x=>x.method==='approveChatJoinRequest'),false);
  await r.handle('callback_query',query('admin',`c:-1002:confirm:${challenge(r).id}`));
  assert.equal(challenge(r).state,'passed');
});
test('expired initial contact window never auto-accepts the applicant',async()=>{
  const r=await requestRuntime();await r.handle('chat_join_request',application(42,Math.floor(Date.now()/1000)-301));
  assert.equal(challenge(r).state,'delivery_failed');
  assert.equal(r.calls.some(x=>x.method==='sendMessage'),false);
});
test('a newer application invalidates the older private captcha',async()=>{
  const r=await requestRuntime(),req=application();await r.handle('chat_join_request',req);const old=challenge(r);
  await r.handle('chat_join_request',{...req,date:req.date+1});await r.handle('callback_query',privateClick(old));
  assert.equal(r.calls.some(x=>x.method==='approveChatJoinRequest'),false);
  await r.handle('callback_query',privateClick(challenge(r)));assert.equal(challenge(r).state,'passed');
});
test('channel mode picker exposes pre-approval captcha but not post-join captcha',async()=>{
  const r=await requestRuntime();await r.handle('callback_query',query('mode','c:-1002:mode'));
  const rows=r.calls.findLast(x=>x.method==='editMessageText').params.reply_markup.inline_keyboard.flat();
  assert.ok(rows.some(x=>x.callback_data==='c:-1002:mode:requestcaptcha'));
  assert.ok(!rows.some(x=>x.callback_data==='c:-1002:mode:captcha'));
});
test('a withdrawn application closes cleanly without retrying approval forever',async()=>{
  const r=await requestRuntime();await r.handle('chat_join_request',application());
  r.failures.set('approveChatJoinRequest',Object.assign(new Error('missing'),{code:400,description:'Bad Request: HIDE_REQUESTER_MISSING'}));
  await r.handle('callback_query',privateClick(challenge(r)));assert.equal(challenge(r).state,'left');
});
