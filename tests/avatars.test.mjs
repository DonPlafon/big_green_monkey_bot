import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "./runtime.mjs";

const run = async (r, userId = 1) =>
  (await r.module("endpoints/getChatAvatar")).default(
    { chatId: -1001 },
    { initData: { user: { id: userId } } },
  );

test("public avatar is resolved through Telegram and cached; live rights still apply", async () => {
  const r = await createRuntime();
  await r.connect();
  r.chatInfo.set(-1001, {
    id: -1001,
    username: "public_group",
    photo: { small_file_id: "private-file-id" },
  });
  r.httpResponses.set("https://t.me/public_group", {
    status: 200,
    body: '<meta content="https://cdn1.telesco.pe/file/avatar.jpg" property="og:image">',
  });
  assert.equal(
    (await run(r)).photoUrl,
    "https://cdn1.telesco.pe/file/avatar.jpg",
  );
  assert.equal(
    (await run(r)).photoUrl,
    "https://cdn1.telesco.pe/file/avatar.jpg",
  );
  assert.equal(r.httpCalls.length, 1);
  assert.equal(r.calls.filter((c) => c.method === "getChat").length, 1);
  r.members.set("-1001:1", { status: "member" });
  await assert.rejects(run(r), (e) => e.parameters?.code === "ACTION_DENIED");
  await assert.rejects(
    run(r, 2),
    (e) => e.parameters?.code === "ACTION_DENIED",
  );
  assert.equal(r.httpCalls.length, 1);
});

test("missing photo and private chats use initials without outbound HTTP", async () => {
  for (const info of [
    { username: "public_group" },
    { photo: {} },
    { username: "../bad", photo: {} },
  ]) {
    const r = await createRuntime();
    await r.connect();
    r.chatInfo.set(-1001, info);
    assert.equal((await run(r)).photoUrl, null);
    assert.equal(r.httpCalls.length, 0);
  }
});

test("failed preview uses the best-effort userpic route and refreshes after expiry", async () => {
  const r = await createRuntime();
  await r.connect();
  r.chatInfo.set(-1001, { username: "public_group", photo: {} });
  assert.equal(
    (await run(r)).photoUrl,
    "https://t.me/i/userpic/320/public_group.jpg",
  );
  r.sqlite.exec("UPDATE chat_avatars SET expires_at=0");
  r.chatInfo.set(-1001, { username: "renamed_group", photo: {} });
  r.httpResponses.set("https://t.me/renamed_group", {
    status: 200,
    body: '<meta property="og:image" content="https://cdn2.telesco.pe/file/new.jpg">',
  });
  assert.equal((await run(r)).photoUrl, "https://cdn2.telesco.pe/file/new.jpg");
});

test("avatar metadata accepts only Telegram media URLs, never default logos or external hosts", async () => {
  const r = await createRuntime();
  const { photoFromPage, publicPhotoUrl } = await r.module("lib/avatars");
  for (const url of [
    "https://evil.test/image.jpg",
    "https://cdn1.telesco.pe.evil.test/file/a.jpg",
    "javascript:alert(1)",
    "https://telegram.org/img/t_logo.png",
    "https://t.me@evil.test/i/userpic/320/a.jpg",
    'https://t.me/i/userpic/320/a.jpg" onerror="x',
  ])
    assert.equal(publicPhotoUrl(url), null);
  assert.equal(
    photoFromPage(
      "<meta property='og:image' content='https://t.me/i/userpic/320/abc.jpg'>",
    ),
    "https://t.me/i/userpic/320/abc.jpg",
  );
  assert.equal(photoFromPage("<html>unavailable</html>"), null);
});
