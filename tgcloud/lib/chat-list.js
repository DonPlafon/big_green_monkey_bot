import { getSavedChat, forgetManager } from "./store.js";
import { UserError } from "./telegram.js";

// A user can manage their own list even when Telegram can no longer verify
// chat permissions. Never use this projection to authorize moderation or reads.
export async function savedChat(chatId, userId) {
  const chat = await getSavedChat(chatId, userId);
  if (!chat) throw new UserError("чата нет в твоём списке");
  return { id: chat.id, title: chat.title, kind: chat.kind, accessible: false };
}

export async function removeSavedChat(chatId, userId) {
  // Delete only the authenticated user's link; retries are harmless. Shared
  // settings and active challenges must survive removal by any manager.
  await forgetManager(chatId, userId);
  return { ok: true };
}
