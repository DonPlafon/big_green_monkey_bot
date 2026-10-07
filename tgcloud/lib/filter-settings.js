import { setChat } from "./store.js";
import { checkBot, UserError } from "./telegram.js";

export const FILTER_COLUMNS = {
  blockGuest: "block_guest",
  guestMembersOnly: "guest_members_only",
  guestNotice: "guest_notice",
};

// Both interfaces call this only after live administrator authorization.
export async function setGuestFilter(chat, key, value) {
  if (!["group", "supergroup"].includes(chat.kind))
    throw new UserError("фильтры доступны только в группах");
  if (!Object.hasOwn(FILTER_COLUMNS, key) || typeof value !== "boolean")
    throw new UserError("неверная настройка");
  const values = { [FILTER_COLUMNS[key]]: Number(value) };
  if (key !== "guestNotice" && value)
    await checkBot(chat.id, chat.mode, { ...chat, ...values });
  await setChat(chat.id, values);
}
