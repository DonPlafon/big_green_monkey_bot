import { api, db, fetch } from "sdk";
import { chatAvatars } from "../schema.js";
import { now } from "./domain.js";

export function publicPhotoUrl(value) {
  if (typeof value !== "string") return null;
  const url = value.replace(/&amp;/g, "&");
  return /^https:\/\/(?:t\.me\/i\/userpic\/\d+\/|cdn\d+\.telesco\.pe\/file\/)[A-Za-z0-9_./%?=&-]+$/.test(
    url,
  )
    ? url
    : null;
}

export function photoFromPage(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\b(?:property|name)\s*=\s*(["'])og:image\1/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    return publicPhotoUrl(content);
  }
  return null;
}

// Called only after live administrator authorization. Cache optional public
// media separately from chat settings; no Bot API token reaches the browser.
export async function chatPhoto(chatId) {
  const cached = await db.get("SELECT * FROM chat_avatars WHERE chat_id=:c", {
    ":c": chatId,
  });
  if (cached && cached.expires_at > now()) return cached.photo_url;
  const info = await api.getChat({ chat_id: chatId });
  const username =
    typeof info.username === "string" &&
    /^[A-Za-z0-9_]{1,32}$/.test(info.username)
      ? info.username
      : null;
  let photo = null,
    ttl = 3600;
  if (username && info.photo) {
    try {
      const response = await fetch(`https://t.me/${username}`);
      if (response.ok)
        photo = photoFromPage((await response.text()).slice(0, 262144));
    } catch {
      /* Public previews are optional and may be unavailable. */
    }
    if (!photo) {
      // Telegram's username userpic route is best-effort, not a Bot API
      // guarantee. The client keeps its initial if the route returns no image.
      photo = `https://t.me/i/userpic/320/${username}.jpg`;
      ttl = 300;
    }
  }
  const values = { chat_id: chatId, photo_url: photo, expires_at: now() + ttl };
  await db
    .insert(chatAvatars)
    .values(values)
    .onConflictDoUpdate({ target: chatAvatars.chat_id, set: values })
    .run();
  return photo;
}
