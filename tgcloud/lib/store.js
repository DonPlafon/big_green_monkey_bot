import { db } from 'sdk';
import { eq, and, lt } from 'sdk/db';
import { chats, managers, pickers, challenges, events, jobs } from '../schema.js';
import { now, memberKey, displayName } from './domain.js';
export const getChat = id => db.get('SELECT * FROM chats WHERE id = :id', { ':id': id });
export const getChallenge = id => db.get('SELECT * FROM challenges WHERE id = :id', { ':id': id });
export const latestChallenge = (chatId, userId) => db.get(
  'SELECT * FROM challenges WHERE chat_id = :c AND user_id = :u ORDER BY id DESC LIMIT 1', { ':c': chatId, ':u': userId });
export const setChat = (id, values) => db.update(chats).set(values).where(eq(chats.id, id)).run();
export const setChallenge = (id, values) => db.update(challenges).set(values).where(eq(challenges.id, id)).run();
export async function compareChallenge(row, values) {
  const updated = await db.update(challenges).set(values)
    .where(and(eq(challenges.id, row.id), eq(challenges.state, row.state), eq(challenges.version, row.version)))
    .returning().run();
  return updated[0] || null;
}
export async function connectChat(chat, userId) {
  await db.insert(chats).values({ id: chat.id, title: chat.title, kind: chat.type, created_at: now() })
    .onConflictDoUpdate({ target: chats.id, set: { title: chat.title, kind: chat.type, available: 1 } }).run();
  await db.insert(managers).values({ id: memberKey(chat.id, userId), chat_id: chat.id, user_id: userId })
    .onConflictDoNothing({ target: managers.id }).run();
  return getChat(chat.id);
}
export const listChats = (userId, offset = 0) => db.all(
  'SELECT c.* FROM chats c JOIN managers m ON m.chat_id = c.id WHERE m.user_id = :u ORDER BY c.created_at DESC, c.id LIMIT 7 OFFSET :offset',
  { ':u': userId, ':offset': offset });
export const forgetManager = (chatId, userId) => db.delete(managers).where(eq(managers.id, memberKey(chatId, userId))).run();
// Personal list metadata only; this link never grants access to chat settings.
export const getSavedChat = (chatId, userId) => db.get(
  'SELECT c.id,c.title,c.kind FROM chats c JOIN managers m ON m.chat_id=c.id WHERE c.id=:c AND m.user_id=:u',
  { ':c': chatId, ':u': userId });
export async function savePicker(userId, group, channel, source = 'bot') {
  const values = { user_id: userId, group_request: group, channel_request: channel, expires_at: now() + 900, source, result_chat_id:null };
  await db.insert(pickers).values(values).onConflictDoUpdate({ target: pickers.user_id, set: values }).run();
}
export const getPicker = userId => db.get('SELECT * FROM pickers WHERE user_id = :u', { ':u': userId });
export const clearPicker = userId => db.delete(pickers).where(eq(pickers.user_id, userId)).run();
export const completePicker = (userId, chatId) => db.update(pickers).set({result_chat_id:chatId}).where(eq(pickers.user_id,userId)).run();
export async function createChallenge(values) {
  await db.insert(challenges).values(values).onConflictDoNothing({ target: challenges.event_key }).run();
  return db.get('SELECT * FROM challenges WHERE event_key = :k', { ':k': values.event_key });
}
export async function logEvent(id, chatId, user, kind) {
  await db.insert(events).values({ id, chat_id: chatId, user_id: user.id, name: displayName(user), kind, created_at: now() })
    .onConflictDoNothing({ target: events.id }).run();
}
export const readEvents = (chatId, offset = 0) => db.all(
  'SELECT * FROM events WHERE chat_id = :c ORDER BY created_at DESC, id DESC LIMIT 9 OFFSET :offset', { ':c': chatId, ':offset': offset });
export const stats = chatId => db.all('SELECT kind, count(*) AS total FROM events WHERE chat_id = :c GROUP BY kind', { ':c': chatId });
export const pending = chatId => db.get(
  "SELECT count(*) AS total FROM challenges WHERE chat_id = :c AND state NOT IN ('passed','failed','left')", { ':c': chatId });
// Durable leases deduplicate retries; API calls cannot share a DB transaction.
export async function claimJob(id) {
  const inserted = await db.insert(jobs).values({ id, state: 'running', locked_at: now() })
    .onConflictDoNothing({ target: jobs.id }).returning().run();
  if (inserted.length) return true;
  const recovered = await db.update(jobs).set({ locked_at: now() })
    .where(and(eq(jobs.id, id), eq(jobs.state, 'running'), lt(jobs.locked_at, now() - 60))).returning().run();
  return recovered.length > 0;
}
export const finishJob = id => db.update(jobs).set({ state: 'done' }).where(eq(jobs.id, id)).run();
export const retryJob = id => db.update(jobs).set({ locked_at: 0 }).where(eq(jobs.id, id)).run();
