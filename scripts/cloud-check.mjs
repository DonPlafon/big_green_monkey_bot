import { writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const path = new URL('../tgcloud/handlers/poll_answer.js', import.meta.url);
const setup = process.argv.includes('--setup');
// Temporary handler is never deployed. It compiles all production imports and
// checks the actual SDK without sending messages or changing chat memberships.
const source = `
import { api, db, EndpointError } from 'sdk';
import message from 'handlers/message';
import edited from 'handlers/edited_message';
import callback from 'handlers/callback_query';
import joined from 'handlers/chat_member';
import request from 'handlers/chat_join_request';
import membership from 'handlers/my_chat_member';
import { chats } from 'schema';
import { claimJob, finishJob } from 'lib/store';
import { claimFilterNotice } from 'lib/filters';
import * as miniapp from 'lib/miniapp';
export default async function () {
  const me = await api.getMe();
  const count = await db.$count(chats);
  const probeId = 'healthcheck:' + Date.now();
  const noticeProbeId = Date.now(); // real group IDs are negative
  let persistence;
  try {
    const claimed = await claimJob(probeId);
    const duplicate = await claimJob(probeId);
    await finishJob(probeId);
    const row = await db.get('SELECT state FROM jobs WHERE id = :id', {':id':probeId});
    persistence = claimed && !duplicate && row.state === 'done';
    persistence = persistence && await claimFilterNotice(noticeProbeId)
      && !await claimFilterNotice(noticeProbeId);
    if (!persistence) throw new Error('database round-trip failed');
  } finally {
    await db.run('DELETE FROM jobs WHERE id = :id', {':id':probeId});
    await db.run('DELETE FROM filter_notices WHERE chat_id = :id', {':id':noticeProbeId});
  }
  let authentication = false;
  try { await miniapp.endpoint(miniapp.getChats)({},{}); }
  catch (error) { authentication = error instanceof EndpointError; }
  if (!authentication) throw new Error('endpoint identity check failed');
  ${setup ? `await api.setMyCommands({ commands: [{command:'start',description:'твои чаты'},{command:'help',description:'как это работает'}] });
  await api.setMyDescription({description:'заявки и капча для твоих чатов. отдельные настройки, статистика и журнал — всё здесь.'});
  await api.setMyShortDescription({short_description:'спокойный вход в твои чаты'});
  await api.setChatMenuButton({menu_button:{type:'web_app',text:'управление',web_app:{url:'https://app'+me.id+'.tgcloud.ai/'}}});` : ''}
  const menu = await api.getChatMenuButton({});
  return { username: me.username, tablesReady: true, persistence, authentication, chats: count, menu: menu.type, compiledHandlers: [message,edited,callback,joined,request,membership].length };
}`;
await writeFile(path, source, { flag:'wx' });
try {
  const result = spawnSync('npx',['tgcloud','run','handlers/poll_answer','{}'], {stdio:'inherit'});
  process.exitCode = result.status ?? 1;
} finally { await unlink(path); }
