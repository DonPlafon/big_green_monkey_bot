import { table, integer, text, index } from 'sdk/db';

export const chats = table('chats', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  mode: text('mode').notNull().default('requests'),
  enabled: integer('enabled').notNull().default(0),
  available: integer('available').notNull().default(1),
  captcha_type: text('captcha_type').notNull().default('emoji'),
  attempts: integer('attempts').notNull().default(3),
  failure_action: text('failure_action').notNull().default('retry'),
  request_failure: text('request_failure').notNull().default('hold'),
  clean_success: integer('clean_success').notNull().default(1),
  block_guest: integer('block_guest').notNull().default(0),
  guest_members_only: integer('guest_members_only').notNull().default(0),
  guest_notice: integer('guest_notice').notNull().default(0),
  request_link: text('request_link'),
  created_at: integer('created_at').notNull(),
});
export const managers = table('managers', {
  id: text('id').primaryKey(), chat_id: integer('chat_id').notNull(), user_id: integer('user_id').notNull(),
}, t => ({ userIdx: index('managers_user').on(t.user_id) }));
export const chatAvatars = table('chat_avatars', {
  chat_id: integer('chat_id').primaryKey(),
  photo_url: text('photo_url'),
  expires_at: integer('expires_at').notNull(),
});
export const pickers = table('pickers', {
  user_id: integer('user_id').primaryKey(),
  group_request: integer('group_request').notNull(), channel_request: integer('channel_request').notNull(),
  expires_at: integer('expires_at').notNull(),
  source: text('source').notNull().default('bot'),
  result_chat_id: integer('result_chat_id'),
});
export const challenges = table('challenges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  event_key: text('event_key').notNull().unique(),
  kind: text('kind').notNull().default('join'),
  delivery_chat_id: integer('delivery_chat_id'),
  delivery_deadline: integer('delivery_deadline'),
  chat_title: text('chat_title'),
  chat_id: integer('chat_id').notNull(), user_id: integer('user_id').notNull(), name: text('name').notNull(),
  state: text('state').notNull().default('new'),
  question: text('question').notNull(), options: text('options').notNull(), answer: integer('answer').notNull(),
  attempts_left: integer('attempts_left').notNull(), max_attempts: integer('max_attempts').notNull(),
  failure_action: text('failure_action').notNull(),
  original_permissions: text('original_permissions').notNull(), original_until: integer('original_until').notNull().default(0),
  was_restricted: integer('was_restricted').notNull().default(0), message_id: integer('message_id'),
  version: integer('version').notNull().default(0), locked_at: integer('locked_at').notNull().default(0),
  created_at: integer('created_at').notNull(),
}, t => ({ memberIdx: index('challenges_member').on(t.chat_id, t.user_id, t.id) }));
export const events = table('events', {
  id: text('id').primaryKey(), chat_id: integer('chat_id').notNull(), user_id: integer('user_id').notNull(),
  name: text('name').notNull(), kind: text('kind').notNull(), created_at: integer('created_at').notNull(),
}, t => ({ chatIdx: index('events_chat_time').on(t.chat_id, t.created_at) }));
export const jobs = table('jobs', {
  id: text('id').primaryKey(), state: text('state').notNull(), locked_at: integer('locked_at').notNull(),
});
// One durable cooldown per chat, shared by all callers and concurrent updates.
export const filterNotices = table('filter_notices', {
  chat_id: integer('chat_id').primaryKey(),
  next_at: integer('next_at').notNull(),
});
