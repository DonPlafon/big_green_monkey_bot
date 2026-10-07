import { api, db } from "sdk";
import { and, eq, lt } from "sdk/db";
import { filterNotices } from "../schema.js";
import {
  getChat,
  latestChallenge,
  logEvent,
  claimJob,
  finishJob,
  retryJob,
} from "./store.js";
import { hasGuestFilter, isAdmin, isMember, now } from "./domain.js";

// These fields identify a guest bot's RESPONSE. guest_query_id identifies the
// invoking message delivered to that bot; via_bot identifies ordinary inline use.
export function isGuestResponse(message) {
  return !!(message.guest_bot_caller_user || message.guest_bot_caller_chat);
}

async function blockedReason(message, chat) {
  if (chat.block_guest) return "disabled";
  const callerChat = message.guest_bot_caller_chat;
  if (callerChat) {
    // Anonymous administrators act as this group; external channels do not
    // establish membership of the person who controls them.
    return callerChat.id === chat.id ? null : "identity";
  }
  const caller = message.guest_bot_caller_user;
  if (!caller || !Number.isSafeInteger(caller.id) || caller.id <= 0)
    return "identity";
  // Never check message.from: that is the guest BOT, not the invoking person.
  // Lookup failures propagate for retry; they are not proof of non-membership.
  const member = await api.getChatMember({
    chat_id: chat.id,
    user_id: caller.id,
  });
  if (isAdmin(member)) return null;
  if (!isMember(member)) return "join";
  const challenge = await latestChallenge(chat.id, caller.id);
  if (challenge && challenge.state !== "passed") return "captcha";
  // A guest response must not bypass a separate mute set by an administrator.
  if (member.status === "restricted" && !member.can_send_messages)
    return "restricted";
  return null; // Existing members without a bot-issued challenge remain allowed.
}

const NOTICE = {
  disabled: "гостевые боты отключены · отправь сообщение сам",
  join: "сначала вступи в чат",
  captcha: "сначала пройди капчу · если её нет, обратись к админу",
  restricted: "отправка сообщений ограничена",
  identity: "отправь сообщение от своего аккаунта и вступи в чат",
};

export async function claimFilterNotice(chatId) {
  const timestamp = now();
  const inserted = await db
    .insert(filterNotices)
    .values({ chat_id: chatId, next_at: timestamp + 60 })
    .onConflictDoNothing({ target: filterNotices.chat_id })
    .returning()
    .run();
  if (inserted.length) return true;
  const claimed = await db
    .update(filterNotices)
    .set({ next_at: timestamp + 60 })
    .where(
      and(
        eq(filterNotices.chat_id, chatId),
        lt(filterNotices.next_at, timestamp + 1),
      ),
    )
    .returning()
    .run();
  return claimed.length > 0;
}

async function notify(message, reason) {
  if (!(await claimFilterNotice(message.chat.id))) return;
  try {
    // No reply to the guest bot, mentions, quotes, or copied spam. This avoids
    // summoning it again and limits notices to one per chat per minute.
    await api.sendMessage({
      chat_id: message.chat.id,
      ...(message.is_topic_message && message.message_thread_id
        ? { message_thread_id: message.message_thread_id }
        : {}),
      text: NOTICE[reason],
      disable_notification: true,
    });
  } catch (error) {
    // Deletion has already succeeded. Keep the cooldown even if sending fails.
    console.warn("filter notice failed", { code: error.code });
  }
}

export async function filterMessage(message) {
  if (
    !["group", "supergroup"].includes(message.chat?.type) ||
    !isGuestResponse(message) ||
    !Number.isSafeInteger(message.message_id) ||
    message.message_id <= 0 ||
    message.business_connection_id ||
    message.guest_query_id
  )
    return;
  const chat = await getChat(message.chat.id);
  if (!chat?.enabled || !chat.available || !hasGuestFilter(chat)) return;
  const reason = await blockedReason(message, chat);
  if (!reason) return;
  const key = `guest:${chat.id}:${message.message_id}`;
  if (!(await claimJob(key))) return;
  const actor = message.guest_bot_caller_user ||
    message.from || { id: 0, first_name: "гостевой бот" };
  try {
    try {
      await api.deleteMessage({
        chat_id: chat.id,
        message_id: message.message_id,
      });
    } catch (error) {
      // A retry can follow a successful deletion, or another admin deleted it.
      if (!(
        error.code === 400 &&
        /message to delete not found/i.test(error.description || "")
      ))
        throw error;
    }
    await logEvent(`filtered:${key}`, chat.id, actor, "guest_deleted");
    await finishJob(key);
  } catch (error) {
    await retryJob(key);
    await logEvent(`filter-error:${key}`, chat.id, actor, "filter_error");
    throw error;
  }
  if (chat.guest_notice) await notify(message, reason);
}
