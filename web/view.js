const icons = {
  shield:
    '<path d="M12 3 4.5 6v5.5c0 4.2 3.1 7.5 7.5 9.5 4.4-2 7.5-5.3 7.5-9.5V6L12 3Z"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/>',
  group:
    '<path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.9"/><circle cx="9.5" cy="6.5" r="3.5"/><path d="M16 3.2a3.5 3.5 0 0 1 0 6.6"/>',
  channel: '<path d="m3 10 15-6v16L3 14v-4Zm3 5 2 6h3l-2-5m12-7v6"/>',
  arrow: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="m10 13 4-4m-6 1L6 12a4 4 0 0 0 6 6l2-2m2-6 2-2a4 4 0 0 0-6-6l-2 2"/>',
  chart: '<path d="M5 20V10m7 10V4m7 16v-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert:
    '<path d="M12 8v5m0 3h.01M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
};
export const icon = (name, className = "") =>
  `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.shield}</svg>`;
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export const lower = (value) =>
  escape(String(value ?? "").toLocaleLowerCase("ru"));
export const modes = {
  requests: "приём заявок",
  requestcaptcha: "капча в личке",
  captcha: "капча в группе",
};
export const failures = {
  retry: "новая капча",
  hold: "ждать решения",
  decline: "отклонить заявку",
  kick: "удалить из группы",
};
export const eventNames = {
  request: "новая заявка",
  approved: "заявка принята",
  captcha: "капча отправлена",
  passed: "капча пройдена",
  manual: "пропущен вручную",
  declined: "заявка отклонена",
  failed: "удалён из группы",
  held: "ждёт решения",
  error: "ошибка проверки",
  unavailable: "не хватает прав",
  delivery_error: "капча не доставлена",
};
export const stateNames = {
  new: "проверка готовится",
  preparing: "капча отправляется",
  pending: "проходит капчу",
  solving: "завершаем проверку",
  kicking: "завершаем проверку",
  waiting_admin: "ждёт твоего решения",
  delivery_failed: "не удалось написать",
};
export const status = (chat) =>
  chat.accessible === false
    ? ["нет доступа", "warning"]
    : !chat.available
      ? ["нет прав", "warning"]
      : chat.enabled
        ? ["работает", "active"]
        : ["пауза", "paused"];
export const badge = (chat) => {
  const [text, type] = status(chat);
  return `<span class="badge ${type}"><i></i>${text}</span>`;
};
export function avatar(chat, large = false) {
  const title = String(
    chat.title || (chat.kind === "channel" ? "канал" : "группа"),
  );
  const initial = title.match(/[\p{L}\p{N}]/u)?.[0] || "·";
  const seed = String(chat.id ?? title);
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const remote =
    chat.accessible !== false && Number.isSafeInteger(chat.id) && chat.id < 0;
  return `<span class="avatar avatar-tone-${hash % 7} ${large ? "large" : ""}" aria-hidden="true"${remote ? ` data-avatar-chat="${chat.id}"` : ""}><span class="avatar-initial">${lower(initial)}</span></span>`;
}
export const row = (label, value, action, options = "") =>
  `<button class="setting row" data-action="${action}" ${options}><span>${label}</span><span class="row-end"><span class="value">${value}</span>${icon("arrow")}</span></button>`;
export const empty = (title, text, name = "shield") =>
  `<div class="empty"><span class="empty-icon">${icon(name)}</span><h2>${title}</h2>${text ? `<p>${text}</p>` : ""}</div>`;
export function dateLabel(timestamp) {
  const date = new Date(timestamp * 1000);
  const today = date.toDateString() === new Date().toDateString();
  return escape(
    new Intl.DateTimeFormat("ru", {
      day: today ? undefined : "numeric",
      month: today ? undefined : "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  );
}
