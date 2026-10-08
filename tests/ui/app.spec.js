import { test, expect } from "@playwright/test";

// The Telegram bridge is mocked only in tests, never in the deployed bundle.
async function bridge(page) {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ body: "" }),
  );
  await page.addInitScript(() => {
    const chats = [
      {
        id: -1001,
        title: "Monkey community",
        kind: "supergroup",
        mode: "requestcaptcha",
        enabled: true,
        available: true,
        captchaType: "emoji",
        attempts: 3,
        failureAction: "hold",
        cleanSuccess: true,
        blockGuest: false,
        guestMembersOnly: false,
        guestNotice: false,
      },
      {
        id: -1002,
        title: "Тихие новости",
        kind: "channel",
        mode: "requests",
        enabled: false,
        available: true,
        captchaType: "emoji",
        attempts: 3,
        failureAction: "retry",
        cleanSuccess: true,
      },
      {
        id: -1003,
        title: "<img src=x onerror=alert(1)>",
        kind: "supergroup",
        mode: "captcha",
        enabled: true,
        available: false,
        captchaType: "math",
        attempts: 5,
        failureAction: "retry",
        cleanSuccess: true,
      },
    ];
    window.testChats = chats;
    window.testFailRemove = false;
    window.testPhotoUrls = {};
    window.testCalls = [];
    window.testFailSave = false;
    window.testWaiting = [
      {
        id: 12,
        name: "александр",
        state: "waiting_admin",
        kind: "request",
        createdAt: 1750000000,
      },
    ];
    const methods = {
      getChats: () => ({ items: chats, page: 0, hasMore: false }),
      getChatAvatar: (input) => ({
        photoUrl: window.testPhotoUrls[input.chatId] || null,
      }),
      getChatDetails: (input) => ({
        chat: chats.find((c) => c.id === input.chatId),
        stats: {
          approved: 128,
          passed: 106,
          manual: 8,
          request: 156,
          captcha: 142,
          waiting: window.testWaiting.length,
        },
      }),
      removeChat: (input) => {
        const index = chats.findIndex((c) => c.id === input.chatId);
        if (index !== -1) chats.splice(index, 1);
        return { ok: true };
      },
      updateChat: (input) => {
        const c = chats.find((c) => c.id === input.chatId);
        c[input.key] = input.value;
        return { chat: c };
      },
      getWaiting: () => ({
        items: window.testWaiting,
        page: 0,
        hasMore: false,
      }),
      allowMember: () => {
        window.testWaiting = [];
        return { ok: true };
      },
      getEvents: () => ({
        items: [
          { id: "1", name: "михаил", kind: "approved", createdAt: 1750000000 },
          { id: "2", name: "софия", kind: "passed", createdAt: 1750000000 },
        ],
        page: 0,
        hasMore: false,
      }),
      getInviteLink: () => ({ url: "https://t.me/+test" }),
      checkChatRights: () => ({ ok: true }),
      prepareChat: () => ({ id: "prepared-chat" }),
      getConnection: () => ({ status: "ready", chatId: -1002 }),
    };
    window.Telegram = {
      WebApp: {
        initData: "test-session",
        ready() {},
        expand() {},
        setHeaderColor() {},
        setBackgroundColor() {},
        setBottomBarColor() {},
        isVersionAtLeast() {
          return true;
        },
        BackButton: {
          show() {},
          hide() {},
          onClick(handler) {
            window.testBack = handler;
          },
        },
        HapticFeedback: { selectionChanged() {}, notificationOccurred() {} },
        requestChat(id, callback) {
          window.testPicker = id;
          callback(true);
        },
        Serverless: {
          call(name, input, callback) {
            window.testCalls.push({ name, input });
            setTimeout(() => {
              if (name === "updateChat" && window.testFailSave)
                return callback({
                  type: "ENDPOINT_ERROR",
                  message: "нужны права управления участниками",
                });
              if (name === "removeChat" && window.testFailRemove)
                return callback({
                  type: "ENDPOINT_ERROR",
                  message: "не получилось · попробуй ещё раз",
                });
              callback(null, structuredClone(methods[name](input)));
            }, 20);
          },
        },
      },
    };
  });
}

test("compact chat list, safe rendering and native chat selection", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "твои чаты" })).toBeVisible();
  await expect(page.locator(".chat-row")).toHaveCount(3);
  await expect(page.locator(".chat-row img")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("home.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "добавить чат", exact: true }).click();
  await page.getByRole("button", { name: "канал", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "тихие новости" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.testPicker)).toBe("prepared-chat");
});

test("settings persist, errors preserve state and channel modes are constrained", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await page.getByRole("button", { name: /monkey community/ }).click();
  await expect(
    page.getByRole("button", { name: "задание эмодзи" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("settings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "попытки 3" }).click();
  await page.getByRole("button", { name: "пять", exact: true }).click();
  await expect(page.getByRole("button", { name: "попытки 5" })).toBeVisible();
  await page.evaluate(() => (window.testFailSave = true));
  await page.getByRole("switch", { name: /бот включён/ }).click();
  await expect(page.getByRole("status")).toHaveText(
    "нужны права управления участниками",
  );
  await expect(
    page.getByRole("switch", { name: /бот включён/ }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("button", { name: "твои чаты", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.testBack());
  await page.getByRole("button", { name: /тихие новости/ }).click();
  await page.getByRole("button", { name: "режим приём заявок" }).click();
  await expect(
    page.getByRole("button", { name: /капча в группе/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /капча в личке/ }),
  ).toBeVisible();
});

test("manual pass requires confirmation; journal and stats are reachable", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/#/chat/-1001/settings");
  await page.getByRole("button", { name: "участники", exact: true }).click();
  await page.getByRole("button", { name: "пропустить", exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.testCalls.some((c) => c.name === "allowMember"),
    ),
  ).toBe(false);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "пропустить", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "все на месте" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "журнал", exact: true }).click();
  await expect(page.getByText("заявка принята", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ошибки", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.testCalls.findLast((c) => c.name === "getEvents")?.input
            .filter,
      ),
    )
    .toBe("errors");
  await page.getByRole("button", { name: "вся статистика" }).click();
  await expect(
    page.getByRole("heading", { name: "статистика", exact: true }),
  ).toBeVisible();
});

test("outside Telegram only a launch screen is shown", async ({ page }) => {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ body: "" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "открыть в telegram" }),
  ).toHaveAttribute("href", "https://t.me/big_green_monkey_bot");
  await expect(page.locator(".chat-row")).toHaveCount(0);
});

test("minimal layout loads public avatars and keeps coloured initials when images fail", async ({
  page,
}) => {
  await bridge(page);
  await page.addInitScript(() => {
    window.testPhotoUrls = {
      "-1001": "https://cdn1.telesco.pe/file/test.jpg",
      "-1002": "https://t.me/i/userpic/320/missing.jpg",
    };
  });
  await page.route("https://cdn1.telesco.pe/file/test.jpg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#678c61"/></svg>',
    }),
  );
  await page.route("https://t.me/i/userpic/320/missing.jpg", (route) =>
    route.fulfill({ status: 404, body: "not found" }),
  );
  await page.goto("/");
  await expect(
    page.locator(".topbar,.wordmark,.footer-note,.microcopy"),
  ).toHaveCount(0);
  const first = page.locator('[data-avatar-chat="-1001"]');
  const second = page.locator('[data-avatar-chat="-1002"]');
  await expect(first.locator("img")).toBeVisible();
  await expect(second.locator(".avatar-initial")).toHaveText("т");
  await expect(second.locator("img")).toHaveCount(0);
  await expect(
    page.locator(".chat-row").last().locator(".avatar-initial"),
  ).toHaveText("i");
  await page.getByRole("button", { name: /monkey community/ }).click();
  await expect(page.locator(".avatar.large img")).toBeVisible();
  await expect(
    page.getByText("без таймера · до ответа или твоего решения"),
  ).toHaveCount(0);
  await expect(
    page.locator(".topbar,.wordmark,.microcopy,.status-card small"),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("avatars.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        window.testCalls.filter(
          (c) => c.name === "getChatAvatar" && c.input.chatId === -1001,
        ).length,
    ),
  ).toBe(1);
});

test("chat removal requires confirmation, supports cancellation and retries after errors", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/#/chat/-1002/settings");
  await page.getByRole("button", { name: "убрать из списка" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "настройки и работа бота сохранятся",
  );
  await page.getByRole("button", { name: "отмена", exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.testCalls.some((c) => c.name === "removeChat"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "убрать из списка" }).click();
  await page.evaluate(() => (window.testFailRemove = true));
  await page.getByRole("button", { name: "убрать", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "не получилось",
  );
  expect(await page.evaluate(() => window.testChats.length)).toBe(3);
  await page.evaluate(() => (window.testFailRemove = false));
  await page.getByRole("button", { name: "убрать", exact: true }).click();
  await expect(page.getByRole("heading", { name: "твои чаты" })).toBeVisible();
  await expect(page.locator(".chat-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /тихие новости/ })).toHaveCount(
    0,
  );
});

test("inaccessible chat exposes no management controls and can be removed from a stale deep link", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await expect(page.locator(".chat-row")).toHaveCount(3);
  await page.evaluate(() => {
    window.testChats[2] = {
      id: -1003,
      title: "<img src=x onerror=alert(1)>",
      kind: "supergroup",
      accessible: false,
    };
    location.hash = "#/chat/-1003/events";
  });
  await expect(
    page.getByRole("heading", { name: "нет доступа", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.locator(".quick-stats,.tabs,main img")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.testCalls.some((c) => c.name === "getEvents"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "убрать из списка" }).click();
  await page.screenshot({
    path: test.info().outputPath("remove-chat.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "убрать", exact: true }).click();
  await expect(page.getByRole("heading", { name: "твои чаты" })).toBeVisible();
  await expect(page.locator(".chat-row")).toHaveCount(2);
});

test("guest policy has one selection, preserves notices and survives failed saves", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/#/chat/-1001/settings");
  await page
    .getByRole("button", { name: "гостевые боты разрешить всем" })
    .click();
  const dialog = page.getByRole("dialog");
  const members = dialog.getByRole("radio", { name: /^только для участников/ });
  const block = dialog.getByRole("radio", { name: /^запретить/ });
  const allow = dialog.getByRole("radio", { name: /^разрешить всем/ });
  const notice = dialog.getByRole("switch", {
    name: "показывать причину удаления",
  });
  await expect(allow).toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "как включить" }),
  ).toHaveCount(0);
  await members.click();
  await expect(members).toBeChecked();
  await expect(allow).not.toBeChecked();
  await notice.click();
  await expect(notice).toBeChecked();
  await block.click();
  await expect(block).toBeChecked();
  await expect(members).not.toBeChecked();
  await expect(
    dialog.locator('[role="radio"][aria-checked="true"]'),
  ).toHaveCount(1);
  await page.screenshot({
    path: test.info().outputPath("guest-policy.png"),
    fullPage: true,
  });
  await page.evaluate(() => (window.testFailSave = true));
  await allow.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(block).toBeChecked();
  await expect(allow).not.toBeChecked();
  await page.evaluate(() => (window.testFailSave = false));
  await allow.click();
  await expect(allow).toBeChecked();
  await expect(notice).toBeChecked();
  await dialog.getByRole("button", { name: "закрыть" }).click();
  await page
    .getByRole("button", { name: "гостевые боты разрешить всем" })
    .click();
  await expect(allow).toBeChecked();
  await expect(notice).toBeChecked();
  const saved = await page.evaluate(() =>
    window.testCalls.filter((c) => c.name === "updateChat"),
  );
  expect(
    saved.every(
      (c) =>
        c.input.chatId === -1001 &&
        ["guestPolicy", "guestNotice"].includes(c.input.key),
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "закрыть" }).click();
  await page.goto("/#/chat/-1002/settings");
  await expect(
    page.getByRole("button", { name: /^гостевые боты/ }),
  ).toHaveCount(0);
});
