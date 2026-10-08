import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "./runtime.mjs";

const caller = { id: 42, first_name: "person" };
const guest = (messageId = 10, extra = {}) => ({
  message_id: messageId,
  chat: { id: -1001, type: "supergroup" },
  from: { id: 700, is_bot: true, first_name: "guest bot" },
  guest_bot_caller_user: caller,
  text: "untrusted content",
  ...extra,
});
const calls = (r, method) => r.calls.filter((c) => c.method === method);
const run = async (r, key, value, chatId = -1001, userId = 1) =>
  (await r.module("endpoints/updateChat")).default(
    { chatId, key, value },
    { initData: { user: { id: userId } } },
  );
async function setup(settings = {}) {
  const r = await createRuntime(),
    store = await r.connect();
  await store.setChat(-1001, { enabled: 1, block_guest: 1, ...settings });
  return { r, store };
}
async function challenge(store, state) {
  return store.createChallenge({
    event_key: "check:42",
    chat_id: -1001,
    user_id: 42,
    name: "person",
    state,
    question: "2 + 2",
    options: '["4","5"]',
    answer: 0,
    attempts_left: 3,
    max_attempts: 3,
    failure_action: "retry",
    original_permissions: "{}",
    created_at: Math.floor(Date.now() / 1000),
  });
}

test("all guest responses are removed, including bot senders, media and administrator callers", async () => {
  const { r } = await setup();
  r.members.set("-1001:42", { status: "creator" });
  await r.handle("message", guest());
  await r.handle(
    "message",
    guest(11, { text: undefined, video: { file_id: "fake" } }),
  );
  await r.handle(
    "message",
    guest(12, {
      guest_bot_caller_user: undefined,
      guest_bot_caller_chat: { id: -1001 },
    }),
  );
  assert.equal(calls(r, "deleteMessage").length, 3);
  assert.equal(calls(r, "getChatMember").length, 0);
  assert.equal(calls(r, "sendMessage").length, 0);
  assert.equal(
    r.sqlite
      .prepare("SELECT count(*) AS n FROM events WHERE kind='guest_deleted'")
      .get().n,
    3,
  );
});

test("ordinary messages, inline results, forwarded replies and guest invocations are untouched", async () => {
  const { r } = await setup();
  for (const extra of [
    { from: caller },
    { via_bot: { id: 700 } },
    { reply_to_message: guest(1) },
    {
      forward_origin: { type: "user", sender_user: { id: 700, is_bot: true } },
    },
    { guest_query_id: "invocation" },
  ])
    await r.handle(
      "message",
      guest(10, { guest_bot_caller_user: undefined, ...extra }),
    );
  assert.equal(r.calls.length, 0);
});

test("disabled filters and paused/unavailable/unconnected chats cause no moderation", async () => {
  const { r, store } = await setup();
  for (const values of [
    { enabled: 0 },
    { enabled: 1, available: 0 },
    { available: 1, block_guest: 0, guest_members_only: 0 },
  ]) {
    await store.setChat(-1001, values);
    await r.handle("message", guest());
  }
  await r.handle(
    "message",
    guest(11, { chat: { id: -1002, type: "supergroup" } }),
  );
  await r.handle(
    "message",
    guest(12, { chat: { id: -1001, type: "channel" } }),
  );
  await r.handle("message", guest(0));
  assert.equal(r.calls.length, 0);
});

test("members-only checks the caller, not the bot, and never trusts an old membership", async () => {
  const { r } = await setup({ block_guest: 0, guest_members_only: 1 });
  r.members.set("-1001:700", { status: "creator" });
  for (const status of ["left", "kicked", "restricted"]) {
    r.members.set("-1001:42", { status, is_member: false });
    await r.handle("message", guest(10 + calls(r, "deleteMessage").length));
  }
  assert.equal(calls(r, "deleteMessage").length, 3);
  r.members.set("-1001:42", { status: "member" });
  await r.handle("message", guest(20));
  assert.equal(calls(r, "deleteMessage").length, 3);
  r.members.set("-1001:42", { status: "left" });
  await r.handle("edited_message", guest(20));
  assert.equal(calls(r, "deleteMessage").length, 4);
  assert.ok(calls(r, "getChatMember").every((c) => c.params.user_id === 42));
});

test("pending, failed and departed checks block guest use; passing or manual admission allows it", async () => {
  const { r, store } = await setup({ block_guest: 0, guest_members_only: 1 });
  r.members.set("-1001:42", { status: "member" });
  const row = await challenge(store, "pending");
  let id = 10;
  for (const state of [
    "new",
    "preparing",
    "pending",
    "solving",
    "waiting_admin",
    "delivery_failed",
    "failed",
    "left",
  ]) {
    await store.setChallenge(row.id, { state });
    await r.handle("message", guest(id++));
  }
  assert.equal(calls(r, "deleteMessage").length, 8);
  await store.setChallenge(row.id, { state: "passed" });
  await r.handle("message", guest(id++));
  assert.equal(calls(r, "deleteMessage").length, 8);
  // A separate admin mute cannot be bypassed even with a passed captcha.
  r.members.set("-1001:42", {
    status: "restricted",
    is_member: true,
    can_send_messages: false,
  });
  await r.handle("message", guest(id++));
  assert.equal(calls(r, "deleteMessage").length, 9);
  r.members.set("-1001:42", { status: "administrator" });
  await store.setChallenge(row.id, { state: "pending" });
  await r.handle("message", guest(id++));
  assert.equal(calls(r, "deleteMessage").length, 9);
});

test("anonymous group admins are allowed in members-only; external caller chats are not", async () => {
  const { r } = await setup({ block_guest: 0, guest_members_only: 1 });
  await r.handle(
    "message",
    guest(10, {
      guest_bot_caller_user: undefined,
      guest_bot_caller_chat: { id: -1001 },
    }),
  );
  await r.handle(
    "message",
    guest(11, {
      guest_bot_caller_user: undefined,
      guest_bot_caller_chat: { id: -1002 },
    }),
  );
  assert.deepEqual(
    calls(r, "deleteMessage").map((c) => c.params.message_id),
    [11],
  );
});

test("membership API errors retry without deleting legitimate messages or sending a false notice", async () => {
  const { r } = await setup({
    block_guest: 0,
    guest_members_only: 1,
    guest_notice: 1,
  });
  for (const code of [400, 403, 429, 503]) {
    r.failures.set("getChatMember", { code });
    await assert.rejects(r.handle("message", guest()), (e) => e.code === code);
  }
  assert.equal(calls(r, "deleteMessage").length, 0);
  assert.equal(calls(r, "sendMessage").length, 0);
});

test("notices are optional, quiet, unquoted and rate-limited across callers and concurrent messages", async () => {
  const { r, store } = await setup({
    block_guest: 0,
    guest_members_only: 1,
    guest_notice: 1,
  });
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      r.handle(
        "message",
        guest(i + 10, {
          guest_bot_caller_user: { id: 42 + i, first_name: "@untrusted_bot" },
          is_topic_message: true,
          message_thread_id: 7,
        }),
      ),
    ),
  );
  assert.equal(calls(r, "deleteMessage").length, 5);
  assert.equal(calls(r, "sendMessage").length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls(r, "sendMessage")[0].params)),
    {
      chat_id: -1001,
      message_thread_id: 7,
      text: "сначала вступи в чат",
      disable_notification: true,
    },
  );
  r.sqlite.exec("UPDATE filter_notices SET next_at=0");
  await store.setChat(-1001, { guest_notice: 0 });
  await r.handle("message", guest(20));
  assert.equal(calls(r, "sendMessage").length, 1);
  await store.setChat(-1001, { guest_notice: 1 });
  await r.handle("message", guest(21));
  assert.equal(calls(r, "sendMessage").length, 2);
});

test("retries and edits deduplicate deletion, notices and journal entries", async () => {
  const { r } = await setup({ guest_notice: 1 });
  await Promise.all([
    r.handle("message", guest()),
    r.handle("message", guest()),
  ]);
  await r.handle("edited_message", guest());
  assert.equal(calls(r, "deleteMessage").length, 1);
  assert.equal(calls(r, "sendMessage").length, 1);
  assert.equal(r.sqlite.prepare("SELECT count(*) AS n FROM events").get().n, 1);
});

test("failed deletion is recorded as an error, remains retryable and sends no success notice", async () => {
  const { r } = await setup({ guest_notice: 1 });
  r.failures.set("deleteMessage", { code: 403 });
  await assert.rejects(r.handle("message", guest()), (e) => e.code === 403);
  assert.equal(calls(r, "sendMessage").length, 0);
  assert.equal(
    r.sqlite
      .prepare("SELECT count(*) AS n FROM events WHERE kind='guest_deleted'")
      .get().n,
    0,
  );
  await r.handle("message", guest());
  assert.equal(calls(r, "sendMessage").length, 1);
  assert.deepEqual(
    r.sqlite
      .prepare("SELECT kind FROM events ORDER BY kind")
      .all()
      .map((r) => r.kind),
    ["filter_error", "guest_deleted"],
  );
});

test("already deleted messages and failed notices do not loop or block future deletion", async () => {
  const { r } = await setup({ guest_notice: 1 });
  r.failures.set("deleteMessage", {
    code: 400,
    description: "Bad Request: message to delete not found",
  });
  r.failures.set("sendMessage", { code: 429 });
  await r.handle("message", guest());
  await r.handle("message", guest(11));
  assert.equal(calls(r, "deleteMessage").length, 2);
  assert.equal(calls(r, "sendMessage").length, 1);
});

test("filter settings are opt-in, per chat, boolean, authorized and require delete rights", async () => {
  const r = await createRuntime();
  await r.connect();
  await r.connect(-1002);
  await r.connect(-1003, 1, "channel");
  assert.equal(
    r.sqlite
      .prepare(
        "SELECT sum(block_guest+guest_members_only+guest_notice) AS n FROM chats",
      )
      .get().n,
    0,
  );
  for (const key of ["blockGuest", "guestMembersOnly", "guestNotice"]) {
    await assert.rejects(
      run(r, key, true, -1001, 2),
      (e) => e.parameters.code === "ACTION_DENIED",
    );
    await assert.rejects(
      run(r, key, "true"),
      (e) => e.parameters.code === "INVALID_INPUT",
    );
    await assert.rejects(
      run(r, key, true, -1003),
      (e) => e.parameters.code === "ACTION_DENIED",
    );
  }
  r.members.get("-1001:999").can_delete_messages = false;
  await assert.rejects(run(r, "blockGuest", true), /право удалять/);
  await assert.rejects(run(r, "guestMembersOnly", true), /право удалять/);
  r.members.get("-1001:999").can_delete_messages = true;
  assert.equal((await run(r, "blockGuest", true)).chat.blockGuest, true);
  assert.equal(
    r.sqlite.prepare("SELECT block_guest FROM chats WHERE id=-1002").get()
      .block_guest,
    0,
  );
  r.members.get("-1001:999").can_delete_messages = false;
  await assert.rejects(run(r, "enabled", true), /право удалять/);
  // Turning a filter off must remain possible after the bot loses deletion rights.
  assert.equal((await run(r, "blockGuest", false)).chat.blockGuest, false);
});

test("inline settings share filters and rights checks with the Mini App", async () => {
  const r = await createRuntime();
  await r.connect();
  const query = (data) => ({
    id: "query",
    from: { id: 1 },
    data,
    message: { chat: { id: 1, type: "private" }, message_id: 1 },
  });
  await r.handle("callback_query", query("c:-1001:guestmembers:1"));
  assert.equal(
    r.sqlite.prepare("SELECT guest_members_only FROM chats").get()
      .guest_members_only,
    1,
  );
  assert.match(calls(r, "editMessageText").at(-1).params.text, /гостевые боты/);
  await r.handle("callback_query", query("c:-1001:guestmode:block"));
  assert.equal(
    r.sqlite
      .prepare("SELECT block_guest+guest_members_only AS n FROM chats")
      .get().n,
    1,
  );
  await r.handle("callback_query", query("c:-1001:guestmode:allow"));
  assert.equal(
    r.sqlite
      .prepare("SELECT block_guest+guest_members_only AS n FROM chats")
      .get().n,
    0,
  );
  r.members.set("-1001:1", { status: "member" });
  await r.handle("callback_query", query("c:-1001:guestall:1"));
  assert.equal(
    r.sqlite.prepare("SELECT block_guest FROM chats").get().block_guest,
    0,
  );
});

test("one guest policy preserves existing protection and changes both flags together", async () => {
  const { r, store } = await setup({
    block_guest: 1,
    guest_members_only: 1,
    guest_notice: 1,
  });
  const details = (await r.module("endpoints/getChatDetails")).default;
  assert.equal(
    (await details({ chatId: -1001 }, { initData: { user: { id: 1 } } })).chat
      .guestPolicy,
    "block",
  );
  for (const [policy, block, members] of [
    ["members", 0, 1],
    ["block", 1, 0],
    ["allow", 0, 0],
  ]) {
    const result = await run(r, "guestPolicy", policy);
    const row = await store.getChat(-1001);
    assert.equal(result.chat.guestPolicy, policy);
    assert.equal(row.block_guest, block);
    assert.equal(row.guest_members_only, members);
    assert.equal(row.guest_notice, 1);
  }
  await run(r, "guestPolicy", "block");
  r.members.get("-1001:999").can_delete_messages = false;
  await assert.rejects(run(r, "guestPolicy", "members"), /право удалять/);
  assert.equal((await store.getChat(-1001)).block_guest, 1);
  assert.equal(
    (await run(r, "guestPolicy", "allow")).chat.guestPolicy,
    "allow",
  );
});

test("guest policy rejects invalid modes, channels and unauthorized users", async () => {
  const { r, store } = await setup();
  await r.connect(-1002, 1, "channel");
  for (const value of [true, 1, null, {}, "__proto__", "invalid"])
    await assert.rejects(
      run(r, "guestPolicy", value),
      (e) => e.parameters.code === "INVALID_INPUT",
    );
  await assert.rejects(
    run(r, "guestPolicy", "allow", -1001, 2),
    (e) => e.parameters.code === "ACTION_DENIED",
  );
  await assert.rejects(
    run(r, "guestPolicy", "block", -1002),
    (e) => e.parameters.code === "ACTION_DENIED",
  );
  assert.equal((await store.getChat(-1001)).block_guest, 1);
});

test("losing deletion rights updates availability and filter journal stays scoped", async () => {
  const { r, store } = await setup();
  await r.handle("message", guest());
  await r.connect(-1002, 2);
  await store.logEvent("other-chat", -1002, caller, "guest_deleted");
  const endpoint = (await r.module("endpoints/getEvents")).default;
  const result = await endpoint(
    { chatId: -1001, filter: "filters" },
    { initData: { user: { id: 1 } } },
  );
  assert.equal(result.items.length, 1);
  await r.handle("my_chat_member", {
    chat: { id: -1001, title: "group", type: "supergroup" },
    from: { id: 1 },
    date: 100,
    new_chat_member: {
      status: "administrator",
      can_invite_users: true,
      can_restrict_members: true,
      can_delete_messages: false,
    },
  });
  assert.equal((await store.getChat(-1001)).available, 0);
});
