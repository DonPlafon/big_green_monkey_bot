import { setChat } from "./store.js";
import { checkBot, UserError } from "./telegram.js";

export const FILTER_COLUMNS = {
  blockGuest: "block_guest",
  guestMembersOnly: "guest_members_only",
  guestNotice: "guest_notice",
};
export const GUEST_POLICIES = ["block", "members", "allow"];
// Preserve the effective policy of existing chats, including both legacy flags.
export const guestPolicy = (chat) =>
  chat.block_guest ? "block" : chat.guest_members_only ? "members" : "allow";

// Both interfaces call this only after live administrator authorization.
export async function setGuestFilter(chat, key, value) {
  if (!["group", "supergroup"].includes(chat.kind))
    throw new UserError("фильтры доступны только в группах");
  let values;
  if (key === "guestPolicy") {
    if (!GUEST_POLICIES.includes(value))
      throw new UserError("неверная настройка");
    // A single write avoids briefly disabling protection between mode changes.
    values = {
      block_guest: Number(value === "block"),
      guest_members_only: Number(value === "members"),
    };
  } else {
    // Keep already-open older Mini Apps and inline buttons working.
    if (!Object.hasOwn(FILTER_COLUMNS, key) || typeof value !== "boolean")
      throw new UserError("неверная настройка");
    values = { [FILTER_COLUMNS[key]]: Number(value) };
  }
  if (
    key === "guestPolicy" ? value !== "allow" : key !== "guestNotice" && value
  )
    await checkBot(chat.id, chat.mode, { ...chat, ...values });
  await setChat(chat.id, values);
}
