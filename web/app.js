import "@fontsource-variable/manrope";
import "./style.css";
import { hydrateAvatars } from "./avatars.js";
import {
  telegram,
  botUrl,
  isTelegram,
  initialize,
  call,
  feedback,
  selectChat,
} from "./telegram.js";
import {
  icon,
  escape,
  lower,
  modes,
  failures,
  eventNames,
  stateNames,
  badge,
  avatar,
  row,
  empty,
  dateLabel,
} from "./view.js";

const app = document.querySelector("#app");
const sheet = document.querySelector("#sheet");
const toastNode = document.querySelector("#toast");
let toastTimer,
  requestVersion = 0,
  busy = false,
  sheetFocus;
const state = {
  chat: null,
  stats: {},
  tab: "settings",
  items: [],
  page: 0,
  hasMore: false,
  filter: "all",
  loading: true,
  error: null,
};
const selectedId = () =>
  Number(location.hash.match(/^#\/chat\/(-\d+)/)?.[1]) || null;
const activeTabs = {
  settings: "настройки",
  waiting: "участники",
  events: "журнал",
};
const admitted = () => state.stats.approved || 0;
const solved = () => (state.stats.passed || 0) + (state.stats.manual || 0);
const count = (value) => new Intl.NumberFormat("ru").format(value || 0);

function toast(message, error = false) {
  if (error && sheet.open) {
    let notice = sheet.querySelector(".sheet-error");
    if (!notice) {
      notice = document.createElement("p");
      notice.className = "sheet-error";
      notice.setAttribute("role", "alert");
      sheet.querySelector(".sheet-content").prepend(notice);
    }
    notice.textContent = message;
    return;
  }
  clearTimeout(toastTimer);
  toastNode.textContent = message;
  toastNode.classList.add("visible");
  toastNode.classList.toggle("error", error);
  toastTimer = setTimeout(() => toastNode.classList.remove("visible"), 4200);
}
function navigate(id = null, tab = "settings") {
  const hash = id ? `#/chat/${id}/${tab}` : "#/";
  if (location.hash === hash) return load();
  location.hash = hash;
}
function back() {
  if (sheet.open) closeSheet();
  else navigate();
}
function closeSheet() {
  if (!sheet.open) return;
  sheet.close();
  if (sheetFocus?.isConnected) sheetFocus.focus();
}
function openSheet(title, body, description = "") {
  sheetFocus = document.activeElement;
  sheet.innerHTML = `<div class="sheet-handle" aria-hidden="true"></div><button class="icon-button sheet-close" data-action="close" aria-label="закрыть">${icon("close")}</button><h2 id="sheet-title">${title}</h2>${description ? `<p class="sheet-description">${description}</p>` : ""}<div class="sheet-content">${body}</div>`;
  sheet.showModal();
  sheet.querySelector("button")?.focus();
}
function choice(value, label, description, selected, key) {
  return `<button class="choice row" data-action="save" data-key="${key}" data-value="${value}" ${selected ? 'aria-current="true"' : ""}><span><span class="choice-title">${label}</span>${description ? `<small>${description}</small>` : ""}</span><span class="radio ${selected ? "selected" : ""}">${selected ? icon("check") : ""}</span></button>`;
}
function chooseSetting(key) {
  const c = state.chat;
  const options = {
    mode: [
      "режим входа",
      [
        ["requests", "приём заявок", "одобрять новые заявки сразу"],
        [
          "requestcaptcha",
          "капча в личке",
          "принимать после правильного ответа",
        ],
        ...(c.kind === "supergroup"
          ? [["captcha", "капча в группе", "ограничивать сообщения до ответа"]]
          : []),
      ],
    ],
    captchaType: [
      "задание",
      [
        ["emoji", "эмодзи", ""],
        ["math", "пример", ""],
      ],
    ],
    attempts: [
      "попытки",
      [
        [1, "одна", ""],
        [3, "три", ""],
        [5, "пять", ""],
      ],
    ],
    failureAction: [
      "если не прошёл",
      c.mode === "requestcaptcha"
        ? [
            ["retry", "новая капча", "дать ещё один набор попыток"],
            ["hold", "ждать решения", "оставить заявку администратору"],
            ["decline", "отклонить заявку", "участник сможет подать её снова"],
          ]
        : [
            ["retry", "новая капча", "дать ещё один набор попыток"],
            ["kick", "удалить из группы", "участник сможет зайти снова"],
          ],
    ],
  };
  const [title, values] = options[key];
  openSheet(
    title,
    values
      .map(([value, label, description]) =>
        choice(value, label, description, c[key] === value, key),
      )
      .join(""),
  );
}

const guestChoices = [
  ["block", "запретить", "удалять все сообщения гостевых ботов"],
  [
    "members",
    "только для участников",
    "человек вступил в чат и прошёл капчу, если она ему выдавалась",
  ],
  ["allow", "разрешить всем", "не удалять гостевые сообщения"],
];
const currentGuestPolicy = (c) =>
  c.guestPolicy ||
  (c.blockGuest ? "block" : c.guestMembersOnly ? "members" : "allow");
const guestPolicyLabel = (c) =>
  guestChoices.find(([value]) => value === currentGuestPolicy(c))?.[1] ||
  "разрешить всем";
function guestFiltersBody(c) {
  const policy = currentGuestPolicy(c);
  const choices = guestChoices
    .map(
      ([value, label, description]) =>
        `<button class="choice row" data-action="guest-policy" data-key="guestPolicy" data-value="${value}" role="radio" aria-checked="${policy === value}"><span><span class="choice-title">${label}</span><small>${description}</small></span><span class="radio ${policy === value ? "selected" : ""}" aria-hidden="true">${policy === value ? icon("check") : ""}</span></button>`,
    )
    .join("");
  return `<div role="radiogroup" aria-label="гостевые боты">${choices}</div><p class="guest-scope">обычные сообщения не затрагиваются</p><div class="card"><button class="setting row" data-action="guest-toggle" data-key="guestNotice" role="switch" aria-checked="${!!c.guestNotice}"><span>показывать причину удаления</span><span class="toggle ${c.guestNotice ? "on" : ""}" aria-hidden="true"><i></i></span></button></div>`;
}
function showGuestFilters() {
  openSheet("гостевые боты", guestFiltersBody(state.chat));
}

function skeleton() {
  return `<div class="skeleton-stack" aria-label="загрузка"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
}
function errorView() {
  return `${empty("не получилось загрузить", escape(state.error), "alert")}<button class="primary" data-action="refresh">попробовать снова</button>`;
}
function renderHome() {
  app.innerHTML = `<main class="shell home"><header class="page-heading"><h1>твои чаты</h1></header><section class="list-section" aria-label="подключённые чаты">${state.loading ? skeleton() : state.error ? errorView() : !state.items.length ? empty("добавь первый чат", "", "plus") : `<div class="section-heading"><span>подключены</span><span>${state.items.length}${state.hasMore ? "+" : ""}</span></div><div class="chat-list">${state.items.map((c) => `<button class="chat-row" data-action="open" data-id="${c.id}">${avatar(c)}<span class="chat-title">${lower(c.title)}</span>${badge(c)}${icon("arrow", "chevron")}</button>`).join("")}</div>${state.hasMore ? '<button class="more" data-action="more">показать ещё</button>' : ""}`}</section><footer class="home-footer"><button class="primary" data-action="add">${icon("plus")} добавить чат</button></footer></main>`;
}
function settingsView() {
  const c = state.chat;
  return `<div class="settings-stack"><div class="card">${row("режим", modes[c.mode], "choose", 'data-key="mode"')}</div>${c.mode !== "requests" ? `<div class="section-heading"><span>проверка</span></div><div class="card">${row("задание", c.captchaType === "emoji" ? "эмодзи" : "пример", "choose", 'data-key="captchaType"')}${row("попытки", c.attempts, "choose", 'data-key="attempts"')}${row("если не прошёл", failures[c.failureAction], "choose", 'data-key="failureAction"')}${c.mode === "captcha" ? `<button class="setting row" data-action="clean" role="switch" aria-checked="${c.cleanSuccess}"><span>убирать капчу</span><span class="toggle ${c.cleanSuccess ? "on" : ""}" aria-hidden="true"><i></i></span></button>` : ""}</div>` : ""}${c.kind !== "channel" ? `<div class="card utility">${row("гостевые боты", guestPolicyLabel(c), "guest-filters")}</div>` : ""}<div class="card utility">${c.mode !== "captcha" ? `<button class="setting row" data-action="invite"><span class="row-label">${icon("link")} ссылка с заявкой</span>${icon("arrow")}</button>` : ""}<button class="setting row" data-action="rights"><span class="row-label">${icon("shield")} проверить права</span>${icon("arrow")}</button></div><div class="card utility"><button class="setting row remove-action" data-action="remove"><span class="row-label">${icon("close")} убрать из списка</span>${icon("arrow")}</button></div></div>`;
}
function waitingView() {
  if (!state.items.length)
    return empty("все на месте", "сейчас никто не ждёт проверки", "check");
  return `<div class="card member-list">${state.items.map((item) => `<div class="member-row"><span class="person-avatar">${lower(item.name).slice(0, 1) || "·"}</span><span class="member-copy"><strong>${lower(item.name)}</strong><small>${stateNames[item.state] || "ждёт проверки"}</small></span><button class="small-button" data-action="allow" data-id="${item.id}">пропустить</button></div>`).join("")}</div>${state.hasMore ? '<button class="more" data-action="more">показать ещё</button>' : ""}`;
}
function eventsView() {
  const filters = {
    all: "все",
    admissions: "приём",
    captcha: "капча",
    filters: "фильтры",
    errors: "ошибки",
  };
  const filterBar = `<div class="filter-bar" aria-label="фильтр журнала">${Object.entries(
    filters,
  )
    .map(
      ([key, label]) =>
        `<button class="chip ${state.filter === key ? "selected" : ""}" data-action="filter" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`,
    )
    .join("")}</div>`;
  if (!state.items.length)
    return (
      filterBar + empty("пока тихо", "новые события появятся здесь", "clock")
    );
  return `${filterBar}<div class="card event-list">${state.items.map((item) => `<div class="event-row"><span class="event-icon ${["error", "delivery_error", "unavailable", "declined", "failed", "filter_error"].includes(item.kind) ? "warn" : ""}">${icon(["approved", "passed", "manual"].includes(item.kind) ? "check" : ["error", "delivery_error", "unavailable", "filter_error"].includes(item.kind) ? "alert" : "clock")}</span><span class="member-copy"><strong>${lower(item.name)}</strong><small>${eventNames[item.kind] || "событие"}</small></span><time datetime="${new Date(item.createdAt * 1000).toISOString()}">${dateLabel(item.createdAt)}</time></div>`).join("")}</div>${state.hasMore ? '<button class="more" data-action="more">показать ещё</button>' : ""}`;
}
function renderDetail() {
  const c = state.chat;
  if (!c) {
    app.innerHTML = `<main class="shell"><header class="page-heading compact"><h1>твой чат</h1></header>${state.error ? errorView() : skeleton()}</main>`;
    return;
  }
  if (c.accessible === false) {
    app.innerHTML = `<main class="shell detail"><header class="page-heading compact">${avatar(c, true)}<h1>${lower(c.title)}</h1><p>${c.kind === "channel" ? "канал" : "группа"}</p></header>${empty("нет доступа", "бот или твой аккаунт больше<br>не может управлять чатом", "alert")}<div class="card utility"><button class="setting row" data-action="refresh"><span>проверить снова</span>${icon("arrow")}</button><button class="setting row remove-action" data-action="remove"><span>убрать из списка</span>${icon("close")}</button></div></main>`;
    return;
  }
  app.innerHTML = `<main class="shell detail"><header class="page-heading compact">${avatar(c, true)}<h1>${lower(c.title)}</h1><p>${c.kind === "channel" ? "канал" : "группа"}</p></header><button class="status-card ${c.enabled && c.available ? "enabled" : ""}" data-action="enable" role="switch" aria-checked="${c.enabled}"><span><strong>${!c.available ? "проверь права бота" : c.enabled ? "бот включён" : "бот на паузе"}</strong></span><span class="toggle ${c.enabled ? "on" : ""}" aria-hidden="true"><i></i></span></button><div class="quick-stats"><button data-action="stats"><strong>${count(c.mode === "captcha" ? solved() : admitted())}</strong><span>${c.mode === "captcha" ? "прошли проверку" : "принято"}</span></button><button data-action="tab" data-tab="waiting"><strong>${count(state.stats.waiting)}</strong><span>ожидают</span></button><button class="stats-link" data-action="stats" aria-label="вся статистика">${icon("chart")}${icon("arrow")}</button></div><nav class="tabs" aria-label="разделы чата">${Object.entries(
    activeTabs,
  )
    .map(
      ([key, label]) =>
        `<button class="${state.tab === key ? "selected" : ""}" data-action="tab" data-tab="${key}" aria-current="${state.tab === key ? "page" : "false"}">${label}${key === "waiting" && state.stats.waiting ? `<span class="tab-dot"></span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><section class="tab-content" aria-label="${activeTabs[state.tab]}">${state.loading ? skeleton() : state.error ? errorView() : state.tab === "settings" ? settingsView() : state.tab === "waiting" ? waitingView() : eventsView()}</section></main>`;
}
function render() {
  selectedId() ? renderDetail() : renderHome();
  hydrateAvatars(app);
  app.setAttribute("aria-busy", String(state.loading));
  app.classList.toggle("is-saving", busy);
  if (busy)
    for (const button of app.querySelectorAll(
      '[data-action="enable"],[data-action="choose"],[data-action="clean"],[data-action="allow"],[data-action="remove"]',
    ))
      button.disabled = true;
  if (isTelegram)
    selectedId() ? telegram.BackButton.show() : telegram.BackButton.hide();
}
async function load(append = false) {
  const version = ++requestVersion,
    id = selectedId();
  const tab = location.hash.split("/")[3];
  state.tab = Object.hasOwn(activeTabs, tab) ? tab : "settings";
  if (state.chat?.id !== id) {
    state.chat = null;
    state.stats = {};
    state.filter = "all";
  }
  if (!append) {
    state.items = [];
    state.page = 0;
    state.loading = true;
  }
  state.error = null;
  render();
  try {
    const page = append ? state.page + 1 : 0;
    let result;
    if (!id) result = await call("getChats", { page });
    else {
      const detail = await call("getChatDetails", { chatId: id });
      if (version !== requestVersion) return;
      state.chat = detail.chat;
      state.stats = detail.stats || {};
      if (detail.chat.accessible !== false && state.tab !== "settings")
        result = await call(
          state.tab === "waiting" ? "getWaiting" : "getEvents",
          { chatId: id, page, filter: state.filter },
        );
    }
    if (version !== requestVersion) return;
    if (result) {
      state.items = append ? [...state.items, ...result.items] : result.items;
      state.page = result.page;
      state.hasMore = result.hasMore;
    }
  } catch (error) {
    if (version !== requestVersion) return;
    state.error = error.message;
  }
  if (version === requestVersion) {
    state.loading = false;
    render();
  }
}
async function save(key, value, keepSheet = false) {
  if (busy || !state.chat) return;
  const id = state.chat.id;
  if (!keepSheet) closeSheet();
  busy = true;
  render();
  try {
    const result = await call("updateChat", { chatId: id, key, value });
    if (selectedId() === id) {
      state.chat = result.chat;
      if (keepSheet && sheet.open) {
        sheet.querySelector(".sheet-content").innerHTML = guestFiltersBody(
          result.chat,
        );
        sheet
          .querySelector(
            key === "guestPolicy"
              ? '[role="radio"][aria-checked="true"]'
              : `[data-key="${key}"]`,
          )
          ?.focus();
      }
    }
    feedback("success");
    toast("сохранено");
  } finally {
    busy = false;
    render();
  }
}
function showStats() {
  const stats = [
    ["заявки", state.stats.request],
    ["принято", state.stats.approved],
    ["капчи отправлены", state.stats.captcha],
    ["капча пройдена", state.stats.passed],
    ["пропущено вручную", state.stats.manual],
    ["ожидают", state.stats.waiting],
    ["заявки отклонены", state.stats.declined],
    ["удалено из группы", state.stats.failed],
    ["капча не доставлена", state.stats.delivery_error],
    ["гостевых сообщений удалено", state.stats.guest_deleted],
  ];
  openSheet(
    "статистика",
    `<div class="stats-table">${stats.map(([label, value]) => `<div><span>${label}</span><strong>${count(value)}</strong></div>`).join("")}</div>`,
    "за всё время",
  );
}
async function action(button) {
  const name = button.dataset.action;
  if (name === "close") return closeSheet();
  feedback();
  if (name === "refresh") return load();
  if (name === "open") return navigate(Number(button.dataset.id));
  if (name === "tab") return navigate(selectedId(), button.dataset.tab);
  if (name === "more") {
    button.disabled = true;
    return load(true);
  }
  if (name === "filter") {
    state.filter = button.dataset.filter;
    return load();
  }
  if (name === "choose") return chooseSetting(button.dataset.key);
  if (name === "guest-filters") {
    if (!busy) return showGuestFilters();
    return;
  }
  if (name === "guest-toggle" || name === "guest-policy") {
    if (busy) return;
    button.disabled = true;
    try {
      return await save(
        button.dataset.key,
        name === "guest-policy"
          ? button.dataset.value
          : !state.chat.guestNotice,
        true,
      );
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }
  if (name === "save")
    return save(
      button.dataset.key,
      button.dataset.key === "attempts"
        ? Number(button.dataset.value)
        : button.dataset.value,
    );
  if (name === "enable") return save("enabled", !state.chat.enabled);
  if (name === "clean") return save("cleanSuccess", !state.chat.cleanSuccess);
  if (name === "stats") return showStats();
  if (name === "add")
    return openSheet(
      "добавить чат",
      `<button class="choice row" data-action="connect" data-kind="group"><span class="row-label">${avatar({ kind: "supergroup", title: "группа" })} группу</span>${icon("arrow")}</button><button class="choice row" data-action="connect" data-kind="channel"><span class="row-label">${avatar({ kind: "channel", title: "канал" })} канал</span>${icon("arrow")}</button>`,
    );
  if (name === "connect") {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      const id = await selectChat(button.dataset.kind);
      closeSheet();
      if (id) {
        navigate(id);
        toast("чат подключён · выбери режим и включи бота");
      }
    } finally {
      busy = false;
      button.disabled = false;
    }
    return;
  }
  if (name === "rights") {
    button.disabled = true;
    try {
      await call("checkChatRights", { chatId: selectedId() });
      toast("все нужные права есть");
      await load();
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (name === "invite") {
    const id = selectedId();
    button.disabled = true;
    try {
      const result = await call("getInviteLink", { chatId: id });
      if (selectedId() !== id) return;
      openSheet(
        "ссылка с заявкой",
        `<input class="link-input" aria-label="ссылка с заявкой" readonly value="${escape(result.url)}"><button class="primary" data-action="copy">${icon("link")} скопировать</button>`,
      );
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (name === "copy") {
    const input = sheet.querySelector("input");
    input.select();
    input.setSelectionRange(0, input.value.length);
    try {
      await navigator.clipboard.writeText(input.value);
      toast("ссылка скопирована");
    } catch {
      if (document.execCommand("copy")) toast("ссылка скопирована");
      else toast("выдели и скопируй ссылку");
    }
    return;
  }
  if (name === "remove") {
    if (busy || !state.chat) return;
    return openSheet(
      "убрать из твоего списка?",
      `<button class="primary remove-confirm" data-action="confirm-remove" data-chat="${state.chat.id}">убрать</button><button class="more" data-action="close">отмена</button>`,
      `${lower(state.chat.title)}<br>настройки и работа бота сохранятся.<br>для остановки поставь чат на паузу.`,
    );
  }
  if (name === "confirm-remove") {
    if (busy) return;
    const id = Number(button.dataset.chat);
    busy = true;
    button.disabled = true;
    try {
      await call("removeChat", { chatId: id });
      closeSheet();
      feedback("success");
      toast("убрано из списка");
      if (selectedId() === id) navigate();
    } finally {
      busy = false;
      button.disabled = false;
      render();
    }
    return;
  }
  if (name === "allow") {
    const item = state.items.find(
      (item) => item.id === Number(button.dataset.id),
    );
    return openSheet(
      "пропустить участника?",
      `<button class="primary" data-action="confirm-allow" data-id="${item.id}" data-chat="${state.chat.id}">пропустить</button><button class="more" data-action="close">отмена</button>`,
      lower(item.name),
    );
  }
  if (name === "confirm-allow") {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      await call("allowMember", {
        chatId: Number(button.dataset.chat),
        challengeId: Number(button.dataset.id),
      });
      closeSheet();
      feedback("success");
      toast("участник пропущен");
      await load();
    } finally {
      busy = false;
      button.disabled = false;
      render();
    }
  }
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  action(button).catch((error) => {
    toast(error.message, true);
    feedback("error");
  });
});
sheet.addEventListener("click", (event) => {
  if (event.target === sheet) {
    const box = sheet.getBoundingClientRect();
    if (
      event.clientY < box.top ||
      event.clientX < box.left ||
      event.clientX > box.right
    )
      closeSheet();
  }
});
sheet.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSheet();
});
window.addEventListener("hashchange", () => {
  closeSheet();
  load();
  window.scrollTo(0, 0);
});
initialize(back);
if (isTelegram) load();
else
  app.innerHTML = `<main class="shell welcome"><span class="brand-mark">${icon("shield")}</span><h1>big green monkey</h1><a class="primary" href="${botUrl}">открыть в telegram ${icon("arrow")}</a></main>`;
