import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "./runtime.mjs";

const run = async (r, name, input = {}, userId = 1) =>
  (await r.module(`endpoints/${name}`)).default(input, {
    initData: { user: { id: userId } },
  });
const code = (expected) => (error) => error.parameters?.code === expected;

test("Mini App accepts only the platform identity, never an input user id", async () => {
  const r = await createRuntime();
  await r.connect();
  const endpoint = (await r.module("endpoints/getChats")).default;
  for (const ctx of [
    {},
    { initData: { user: { id: "1" } } },
    { initData: { user: { id: 0 } } },
  ]) {
    await assert.rejects(endpoint({ userId: 1 }, ctx), code("UNAUTHORIZED"));
  }
  assert.equal((await run(r, "getChats", { userId: 1 }, 2)).items.length, 0);
  await assert.rejects(
    run(r, "getChatDetails", { chatId: -1001, userId: 1 }, 2),
    code("ACTION_DENIED"),
  );
});

test("every Mini App chat read and write rechecks current administrator rights", async () => {
  const r = await createRuntime();
  await r.connect();
  assert.equal((await run(r, "getChats")).items.length, 1);
  r.members.set("-1001:1", { status: "member" });
  for (const [name, extra] of [
    ["getWaiting", {}],
    ["getEvents", {}],
    ["getInviteLink", {}],
    ["checkChatRights", {}],
    ["updateChat", { key: "enabled", value: true }],
    ["allowMember", { challengeId: 1 }],
  ])
    await assert.rejects(
      run(r, name, { chatId: -1001, ...extra }),
      code("ACTION_DENIED"),
    );
  const list = await run(r, "getChats");
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].accessible, false);
  assert.equal((await run(r, "getChatDetails", { chatId: -1001 })).stats, null);
  assert.equal(r.sqlite.prepare("SELECT enabled FROM chats").get().enabled, 0);
});

test("settings are allowlisted and isolated; channel cannot enable post-join captcha", async () => {
  const r = await createRuntime();
  await r.connect();
  await r.connect(-1002, 1, "channel");
  await run(r, "updateChat", { chatId: -1001, key: "attempts", value: 5 });
  await run(r, "updateChat", { chatId: -1001, key: "enabled", value: true });
  assert.equal(
    (await run(r, "getChatDetails", { chatId: -1001 })).chat.attempts,
    5,
  );
  assert.equal(
    (await run(r, "getChatDetails", { chatId: -1002 })).chat.attempts,
    3,
  );
  for (const [key, value] of [
    ["mode", "captcha"],
    ["attempts", 50],
    ["enabled", 1],
    ["title", "stolen"],
    ["__proto__", {}],
  ]) {
    await assert.rejects(
      run(r, "updateChat", { chatId: -1002, key, value }),
      code("INVALID_INPUT"),
    );
  }
  r.members.set("-1001:999", { status: "member" });
  await assert.rejects(
    run(r, "updateChat", { chatId: -1001, key: "mode", value: "captcha" }),
    code("ACTION_DENIED"),
  );
  assert.equal(
    (await run(r, "getChatDetails", { chatId: -1001 })).chat.mode,
    "requests",
  );
});

test("waiting list omits captcha solutions and manual pass cannot cross chat boundaries", async () => {
  const r = await createRuntime(),
    store = await r.connect();
  await r.connect(-1002, 1, "channel");
  await store.setChat(-1002, { enabled: 1, mode: "requestcaptcha" });
  await r.handle(
    "chat_join_request",
    {
      chat: { id: -1002, type: "channel", title: "channel" },
      from: { id: 42, first_name: "Alice" },
      user_chat_id: 42,
      date: Math.floor(Date.now() / 1000),
    },
    { update: { update_id: 500 } },
  );
  const waiting = await run(r, "getWaiting", { chatId: -1002 });
  assert.equal(waiting.items.length, 1);
  assert.deepEqual(Object.keys(waiting.items[0]).sort(), [
    "createdAt",
    "id",
    "kind",
    "name",
    "state",
  ]);
  const challengeId = waiting.items[0].id;
  await assert.rejects(
    run(r, "allowMember", { chatId: -1001, challengeId }),
    code("ACTION_DENIED"),
  );
  assert.equal(
    r.calls.filter((c) => c.method === "approveChatJoinRequest").length,
    0,
  );
  await run(r, "allowMember", { chatId: -1002, challengeId });
  assert.equal(
    r.calls.filter((c) => c.method === "approveChatJoinRequest").length,
    1,
  );
  assert.equal((await run(r, "getWaiting", { chatId: -1002 })).items.length, 0);
  await assert.rejects(
    run(r, "allowMember", { chatId: -1002, challengeId }),
    code("ACTION_DENIED"),
  );
});

test("native Mini App picker connects through chat_shared without extra bot messages", async () => {
  const r = await createRuntime();
  await r.connect();
  const result = await run(r, "prepareChat", { kind: "group" });
  assert.equal(result.id, "prepared-chat-picker");
  const prepared = r.calls.find(
    (c) => c.method === "savePreparedKeyboardButton",
  ).params;
  assert.equal(prepared.user_id, 1);
  assert.equal(
    prepared.button.request_chat.bot_administrator_rights.can_restrict_members,
    true,
  );
  assert.equal((await run(r, "getConnection")).status, "pending");
  assert.equal((await run(r, "getConnection", {}, 2)).status, "expired");
  await r.handle("message", {
    chat: { id: 1, type: "private" },
    from: { id: 1 },
    chat_shared: {
      chat_id: -1001,
      request_id: prepared.button.request_chat.request_id,
    },
  });
  assert.equal((await run(r, "getConnection")).chatId, -1001);
  assert.equal(r.calls.filter((c) => c.method === "sendMessage").length, 0);
  r.members.set("-1001:1", { status: "member" });
  await assert.rejects(run(r, "getConnection"), code("ACTION_DENIED"));
});

test("journal pagination and filters stay scoped to authorized chat", async () => {
  const r = await createRuntime(),
    store = await r.connect();
  await r.connect(-1002, 2);
  for (let n = 0; n < 24; n++)
    await store.logEvent(
      `event:${n}`,
      -1001,
      { id: n + 10, first_name: `person ${n}` },
      n % 2 ? "approved" : "error",
    );
  await store.logEvent(
    "private",
    -1002,
    { id: 500, first_name: "private person" },
    "approved",
  );
  const first = await run(r, "getEvents", { chatId: -1001 });
  const next = await run(r, "getEvents", { chatId: -1001, page: 1 });
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(next.items.length, 4);
  assert.equal(next.hasMore, false);
  assert.equal(
    new Set([...first.items, ...next.items].map((x) => x.id)).size,
    24,
  );
  assert.equal(
    (await run(r, "getEvents", { chatId: -1001, filter: "errors" })).items
      .length,
    12,
  );
  assert.equal(
    (await run(r, "getChatDetails", { chatId: -1001 })).stats.approved,
    12,
  );
  await assert.rejects(
    run(r, "getEvents", { chatId: -1001, filter: "all' OR 1=1--" }),
    code("INVALID_INPUT"),
  );
  await assert.rejects(
    run(r, "getEvents", { chatId: -1001, page: -1 }),
    code("INVALID_INPUT"),
  );
  await assert.rejects(run(r, "getChats", []), code("INVALID_INPUT"));
});

test("Mini App settings and inline bot settings use the same persistence", async () => {
  const r = await createRuntime();
  await r.connect();
  await run(r, "updateChat", {
    chatId: -1001,
    key: "mode",
    value: "requestcaptcha",
  });
  await run(r, "updateChat", {
    chatId: -1001,
    key: "failureAction",
    value: "hold",
  });
  const row = r.sqlite.prepare("SELECT * FROM chats").get();
  assert.equal(row.request_failure, "hold");
  assert.equal(row.failure_action, "retry");
  await r.handle("callback_query", {
    id: "change",
    from: { id: 1 },
    data: "c:-1001:attempts:1",
    message: { message_id: 1, chat: { id: 1, type: "private" } },
  });
  assert.equal(
    (await run(r, "getChatDetails", { chatId: -1001 })).chat.attempts,
    1,
  );
});
