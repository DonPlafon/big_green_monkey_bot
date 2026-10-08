import { api, db, EndpointError } from "sdk";
import { authorize, checkBot, UserError } from "./telegram.js";
import {
  getChat,
  setChat,
  stats,
  pending,
  savePicker,
  getPicker,
} from "./store.js";
import { now } from "./domain.js";
import { manuallyPass } from "./captcha.js";
import { requestButton } from "./ui.js";
import { savedChat, removeSavedChat } from "./chat-list.js";
import { chatPhoto } from "./avatars.js";
import {
  FILTER_COLUMNS,
  GUEST_POLICIES,
  guestPolicy,
  setGuestFilter,
} from "./filter-settings.js";

// Authentication is supplied by Telegram. Live authorization protects chat data
// and moderation; personal list metadata/removal grants no access to either.
export function endpoint(operation) {
  return async (input, context) => {
    const userId = context?.initData?.user?.id;
    if (!Number.isSafeInteger(userId) || userId <= 0)
      throw new EndpointError("открой приложение в telegram", {
        code: "UNAUTHORIZED",
      });
    if (input == null) input = {};
    if (typeof input !== "object" || Array.isArray(input))
      throw new EndpointError("неверный запрос", { code: "INVALID_INPUT" });
    try {
      return await operation(input, userId);
    } catch (error) {
      if (error instanceof EndpointError) throw error;
      if (error instanceof UserError)
        throw new EndpointError(error.message, { code: "ACTION_DENIED" });
      if (error.code === 429)
        throw new EndpointError("слишком быстро · попробуй чуть позже", {
          code: "RATE_LIMITED",
        });
      if ([400, 403].includes(error.code))
        throw new EndpointError("проверь права бота и попробуй ещё раз", {
          code: "TELEGRAM_ERROR",
        });
      throw error;
    }
  };
}
export function chatId(input) {
  if (!Number.isSafeInteger(input.chatId) || input.chatId >= 0)
    throw new EndpointError("чат не найден", { code: "INVALID_INPUT" });
  return input.chatId;
}
function pageNumber(input) {
  const page = input.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000)
    throw new EndpointError("неверная страница", { code: "INVALID_INPUT" });
  return page;
}
function publicChat(row) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    accessible: true,
    mode: row.mode,
    enabled: !!row.enabled,
    available: !!row.available,
    captchaType: row.captcha_type,
    attempts: row.attempts,
    failureAction:
      row.mode === "requestcaptcha" ? row.request_failure : row.failure_action,
    cleanSuccess: !!row.clean_success,
    blockGuest: !!row.block_guest,
    guestMembersOnly: !!row.guest_members_only,
    guestNotice: !!row.guest_notice,
    guestPolicy: guestPolicy(row),
  };
}
export async function getChats(input, userId) {
  const page = pageNumber(input);
  const rows = await db.all(
    "SELECT c.* FROM chats c JOIN managers m ON m.chat_id=c.id WHERE m.user_id=:u ORDER BY c.created_at DESC,c.id LIMIT 13 OFFSET :o",
    { ":u": userId, ":o": page * 12 },
  );
  const items = [];
  for (const row of rows.slice(0, 12)) {
    try {
      items.push(publicChat(await authorize(row.id, userId)));
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      items.push(await savedChat(row.id, userId));
    }
  }
  return { items, page, hasMore: rows.length > 12 };
}
export async function getChatDetails(input, userId) {
  const id = chatId(input);
  let chat;
  try {
    chat = await authorize(id, userId);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    return { chat: await savedChat(id, userId), stats: null };
  }
  const counts = Object.fromEntries(
    (await stats(chat.id)).map((row) => [row.kind, row.total]),
  );
  return {
    chat: publicChat(chat),
    stats: { ...counts, waiting: (await pending(chat.id))?.total || 0 },
  };
}
export async function removeChat(input, userId) {
  return removeSavedChat(chatId(input), userId);
}
export async function getChatAvatar(input, userId) {
  const id = chatId(input);
  await authorize(id, userId);
  return { photoUrl: await chatPhoto(id) };
}
export async function updateChat(input, userId) {
  const id = chatId(input),
    chat = await authorize(id, userId);
  const { key, value } = input;
  if (key === "guestPolicy" || Object.hasOwn(FILTER_COLUMNS, key)) {
    if (
      key === "guestPolicy"
        ? !GUEST_POLICIES.includes(value)
        : typeof value !== "boolean"
    )
      throw new EndpointError("неверная настройка", { code: "INVALID_INPUT" });
    await setGuestFilter(chat, key, value);
    return { chat: publicChat(await getChat(id)) };
  }
  const columns = {
    mode: "mode",
    enabled: "enabled",
    captchaType: "captcha_type",
    attempts: "attempts",
    failureAction:
      chat.mode === "requestcaptcha" ? "request_failure" : "failure_action",
    cleanSuccess: "clean_success",
  };
  const valid = {
    mode:
      chat.kind === "supergroup"
        ? ["requests", "requestcaptcha", "captcha"]
        : ["requests", "requestcaptcha"],
    enabled: [true, false],
    captchaType: ["emoji", "math"],
    attempts: [1, 3, 5],
    failureAction:
      chat.mode === "requestcaptcha"
        ? ["retry", "hold", "decline"]
        : ["retry", "kick"],
    cleanSuccess: [true, false],
  };
  if (!Object.hasOwn(valid, key) || !valid[key].includes(value))
    throw new EndpointError("неверная настройка", { code: "INVALID_INPUT" });
  if (key === "mode" || (key === "enabled" && value))
    await checkBot(id, key === "mode" ? value : chat.mode);
  await setChat(id, {
    [columns[key]]: typeof value === "boolean" ? Number(value) : value,
    ...((key === "enabled" && value) || key === "mode" ? { available: 1 } : {}),
  });
  return { chat: publicChat(await getChat(id)) };
}
export async function getWaiting(input, userId) {
  const id = chatId(input);
  await authorize(id, userId);
  const page = pageNumber(input);
  const rows = await db.all(
    "SELECT id,name,state,kind,created_at FROM challenges WHERE chat_id=:c AND state NOT IN ('passed','failed','left') ORDER BY id DESC LIMIT 13 OFFSET :o",
    { ":c": id, ":o": page * 12 },
  );
  return {
    items: rows.slice(0, 12).map((r) => ({
      id: r.id,
      name: r.name,
      state: r.state,
      kind: r.kind,
      createdAt: r.created_at,
    })),
    page,
    hasMore: rows.length > 12,
  };
}
export async function allowMember(input, userId) {
  const id = chatId(input);
  await authorize(id, userId);
  if (!Number.isSafeInteger(input.challengeId) || input.challengeId < 1)
    throw new EndpointError("проверка не найдена", { code: "INVALID_INPUT" });
  await manuallyPass(input.challengeId, id);
  return { ok: true };
}
export async function getEvents(input, userId) {
  const id = chatId(input);
  await authorize(id, userId);
  const page = pageNumber(input),
    filter = input.filter ?? "all";
  const filters = {
    all: "",
    admissions: " AND kind IN ('request','approved','declined','manual')",
    captcha: " AND kind IN ('captcha','passed','failed','held')",
    filters: " AND kind IN ('guest_deleted','filter_error')",
    errors:
      " AND kind IN ('error','unavailable','delivery_error','filter_error')",
  };
  if (!Object.hasOwn(filters, filter))
    throw new EndpointError("неверный фильтр", { code: "INVALID_INPUT" });
  // Only constant, allowlisted SQL fragments can be interpolated.
  const rows = await db.all(
    `SELECT id,name,kind,created_at FROM events WHERE chat_id=:c${filters[filter]} ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET :o`,
    { ":c": id, ":o": page * 20 },
  );
  return {
    items: rows.slice(0, 20).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      createdAt: r.created_at,
    })),
    page,
    hasMore: rows.length > 20,
  };
}
export async function getInviteLink(input, userId) {
  const chat = await authorize(chatId(input), userId);
  await checkBot(chat.id, "requests");
  if (chat.mode === "captcha")
    throw new UserError("для этого режима используй обычную ссылку группы");
  if (!chat.request_link) {
    const link = await api.createChatInviteLink({
      chat_id: chat.id,
      name: "вход с заявкой",
      creates_join_request: true,
    });
    await setChat(chat.id, { request_link: link.invite_link });
    chat.request_link = link.invite_link;
  }
  return { url: chat.request_link };
}
export async function checkChatRights(input, userId) {
  const chat = await authorize(chatId(input), userId);
  await checkBot(chat.id, chat.mode);
  await setChat(chat.id, { available: 1 });
  return { ok: true };
}
export async function prepareChat(input, userId) {
  if (!["group", "channel"].includes(input.kind))
    throw new EndpointError("выбери группу или канал", {
      code: "INVALID_INPUT",
    });
  const group = Math.floor(Math.random() * 1000000000) + 1,
    channel = group + 1;
  await savePicker(userId, group, channel, "miniapp");
  const prepared = await api.savePreparedKeyboardButton({
    user_id: userId,
    button: requestButton(
      input.kind === "channel",
      input.kind === "channel" ? channel : group,
    ),
  });
  return { id: prepared.id };
}
export async function getConnection(input, userId) {
  const picker = await getPicker(userId);
  if (!picker || picker.source !== "miniapp" || picker.expires_at < now())
    return { status: "expired" };
  if (!picker.result_chat_id) return { status: "pending" };
  await authorize(picker.result_chat_id, userId);
  return { status: "ready", chatId: picker.result_chat_id };
}
