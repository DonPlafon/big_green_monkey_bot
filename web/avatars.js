import { call } from "./telegram.js";

const cache = new Map();
const queue = [];
let active = 0;

function paint(node, url) {
  if (!node.isConnected || !url || node.querySelector("img")) return;
  const image = document.createElement("img");
  image.alt = "";
  image.hidden = true;
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.onload = () => {
    image.hidden = false;
  };
  image.onerror = () => {
    image.remove();
  };
  node.append(image);
  image.src = url;
}

function safeUrl(value) {
  return typeof value === "string" &&
    /^https:\/\/(?:t\.me\/i\/userpic\/\d+\/|cdn\d+\.telesco\.pe\/file\/)[A-Za-z0-9_./%?=&-]+$/.test(
      value,
    )
    ? value
    : null;
}

function pump() {
  while (active < 3 && queue.length) {
    const [id, entry] = queue.shift();
    active++;
    call("getChatAvatar", { chatId: id })
      .then((result) => {
        entry.url = safeUrl(result.photoUrl);
      })
      .catch(() => {}) // Optional media never blocks settings or navigation.
      .finally(() => {
        entry.done = true;
        for (const node of entry.nodes) paint(node, entry.url);
        entry.nodes.clear();
        active--;
        pump();
      });
  }
}

export function hydrateAvatars(root) {
  for (const node of root.querySelectorAll("[data-avatar-chat]")) {
    const id = Number(node.dataset.avatarChat);
    let entry = cache.get(id);
    if (!entry) {
      entry = { nodes: new Set(), done: false, url: null };
      cache.set(id, entry);
      queue.push([id, entry]);
    }
    if (entry.done) paint(node, entry.url);
    else entry.nodes.add(node);
  }
  pump();
}
