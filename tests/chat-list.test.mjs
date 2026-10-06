import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "./runtime.mjs";

const run = async (r, name, input = {}, userId = 1) =>
  (await r.module(`endpoints/${name}`)).default(input, {
    initData: { user: { id: userId } },
  });
const denied = (e) => e.parameters?.code === "ACTION_DENIED";
const query = (data, userId = 1, chatId = userId, type = "private") => ({
  id: "query",
  data,
  from: { id: userId },
  message: { chat: { id: chatId, type }, message_id: 10 },
});
const links = (r) =>
  r.sqlite
    .prepare("SELECT chat_id,user_id FROM managers ORDER BY chat_id,user_id")
    .all();
const sharedData = (r) =>
  ["chats", "challenges", "events", "jobs"].map((t) =>
    r.sqlite.prepare(`SELECT * FROM ${t}`).all(),
  );

test("lost access leaves only removable personal metadata, never settings or statistics", async () => {
  const r = await createRuntime();
  await r.connect();
  for (const code of [400, 403]) {
    r.failures.set("getChatMember", { code });
    const list = await run(r, "getChats");
    assert.deepEqual(Object.keys(list.items[0]).sort(), [
      "accessible",
      "id",
      "kind",
      "title",
    ]);
    assert.equal(list.items[0].accessible, false);
    r.failures.set("getChatMember", { code });
    const details = await run(r, "getChatDetails", { chatId: -1001 });
    assert.equal(details.stats, null);
    assert.deepEqual(Object.keys(details.chat).sort(), [
      "accessible",
      "id",
      "kind",
      "title",
    ]);
  }
  await assert.rejects(run(r, "getChatDetails", { chatId: -1001 }, 2), denied);
  r.failures.set("getChatMember", { code: 429 });
  await assert.rejects(
    run(r, "getChats"),
    (e) => e.parameters?.code === "RATE_LIMITED",
  );
  r.failures.set("getChatMember", { code: 503 });
  await assert.rejects(
    run(r, "getChatDetails", { chatId: -1001 }),
    (e) => e.code === 503,
  );
});

test("a kicked bot does not prevent personal removal; other managers and chat data survive", async () => {
  const r = await createRuntime(),
    store = await r.connect(-1002, 1, "channel");
  await r.connect(-1002, 2, "channel");
  await r.connect(-1003, 1, "supergroup");
  await store.setChat(-1002, { enabled: 1, mode: "requestcaptcha" });
  await r.handle(
    "chat_join_request",
    {
      chat: { id: -1002, title: "channel", type: "channel" },
      from: { id: 42, first_name: "Alice" },
      user_chat_id: 42,
      date: Math.floor(Date.now() / 1000),
    },
    { update: { update_id: 100 } },
  );
  await r.handle("my_chat_member", {
    chat: { id: -1002, title: "channel", type: "channel" },
    from: { id: 1 },
    new_chat_member: { status: "kicked" },
    date: 200,
  });
  const before = sharedData(r),
    callsBefore = r.calls.length;
  await run(r, "removeChat", { chatId: -1002 });
  await run(r, "removeChat", { chatId: -1002 });
  assert.equal(
    r.calls.length,
    callsBefore,
    "personal deletion needs no working Telegram API",
  );
  assert.deepEqual(
    links(r).map((x) => [x.chat_id, x.user_id]),
    [
      [-1003, 1],
      [-1002, 2],
    ],
  );
  assert.deepEqual(sharedData(r), before);
  assert.equal(
    (await run(r, "getChats")).items.some((x) => x.id === -1002),
    false,
  );
  assert.equal(
    (await run(r, "getChats", {}, 2)).items.some((x) => x.id === -1002),
    true,
  );
  // Reconnecting restores the existing settings and list entry once.
  await r.connect(-1002, 1, "channel");
  await r.connect(-1002, 1, "channel");
  assert.equal(
    links(r).filter((x) => x.chat_id === -1002 && x.user_id === 1).length,
    1,
  );
  assert.equal((await store.getChat(-1002)).mode, "requestcaptcha");
});

test("removal uses verified identity and never removes another account's entry", async () => {
  const r = await createRuntime();
  await r.connect();
  const before = links(r);
  const endpoint = (await r.module("endpoints/removeChat")).default;
  await assert.rejects(
    endpoint({ chatId: -1001, userId: 1 }, {}),
    (e) => e.parameters?.code === "UNAUTHORIZED",
  );
  for (const chatId of ["-1001", 0, 1, -Infinity])
    await assert.rejects(
      run(r, "removeChat", { chatId }),
      (e) => e.parameters?.code === "INVALID_INPUT",
    );
  await run(r, "removeChat", { chatId: -1001, userId: 1 }, 2);
  assert.deepEqual(links(r), before);
  r.members.set("-1001:1", { status: "left" });
  await assert.rejects(run(r, "getEvents", { chatId: -1001 }), denied);
  await run(r, "removeChat", { chatId: -1001 });
  assert.equal(links(r).length, 0);
  await assert.rejects(run(r, "getChatDetails", { chatId: -1001 }), denied);
});

test("inline menu keeps an inaccessible chat removable, with confirmation and private ownership", async () => {
  const r = await createRuntime();
  await r.connect();
  await r.connect(-1001, 2);
  r.failures.set("getChatMember", { code: 403 });
  await r.handle("callback_query", query("c:-1001:show"));
  const panel = r.calls.findLast((c) => c.method === "editMessageText").params;
  assert.match(panel.text, /нет доступа/);
  assert.ok(
    panel.reply_markup.inline_keyboard
      .flat()
      .some((b) => b.callback_data === "c:-1001:remove"),
  );
  await r.handle("callback_query", query("c:-1001:remove"));
  const confirm = r.calls.findLast(
    (c) => c.method === "editMessageText",
  ).params;
  assert.match(confirm.text, /убрать из твоего списка/);
  assert.equal(links(r).length, 2);
  // Forwarded/private-other and group callbacks cannot act on the user's list.
  await r.handle("callback_query", query("c:-1001:forget:yes", 1, 2));
  await r.handle(
    "callback_query",
    query("c:-1001:forget:yes", 1, -1001, "supergroup"),
  );
  await r.handle("callback_query", query("c:-1001:forget:yes", 3));
  assert.equal(links(r).length, 2);
  const before = sharedData(r);
  await r.handle("callback_query", query("c:-1001:forget:yes"));
  assert.deepEqual(
    links(r).map((x) => x.user_id),
    [2],
  );
  assert.deepEqual(sharedData(r), before);
  assert.match(
    r.calls.findLast((c) => c.method === "editMessageText").params.text,
    /добавь чат/,
  );
});
