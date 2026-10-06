export const telegram = window.Telegram?.WebApp;
export const botUrl = `https://t.me/${import.meta.env.VITE_BOT_USERNAME || "big_green_monkey_bot"}`;
export const isTelegram = !!(telegram?.initData && telegram?.Serverless?.call);

export function initialize(onBack) {
  if (!isTelegram) return;
  telegram.ready();
  telegram.expand();
  telegram.setHeaderColor?.("#000000");
  telegram.setBackgroundColor?.("#000000");
  if (telegram.isVersionAtLeast?.("7.10"))
    telegram.setBottomBarColor?.("#000000");
  telegram.BackButton.onClick(onBack);
}

export function call(name, input = {}) {
  return new Promise((resolve, reject) => {
    if (!isTelegram) return reject(new Error("открой приложение в telegram"));
    // A timeout never retries a mutation: the server may have already saved it.
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "ответ задерживается · обнови экран, чтобы проверить результат",
          ),
        ),
      25000,
    );
    try {
      telegram.Serverless.call(name, input, (error, result) => {
        clearTimeout(timeout);
        if (!error) return resolve(result);
        const message =
          error.type === "ENDPOINT_ERROR"
            ? error.message
            : error.type === "UNAUTHORIZED"
              ? "открой приложение заново в telegram"
              : "не удалось загрузить · попробуй ещё раз";
        reject(new Error(message));
      });
    } catch {
      clearTimeout(timeout);
      reject(new Error("обнови telegram и открой приложение заново"));
    }
  });
}

export function feedback(type = "selection") {
  if (type === "selection") telegram?.HapticFeedback?.selectionChanged();
  else telegram?.HapticFeedback?.notificationOccurred(type);
}

export async function selectChat(kind) {
  if (!telegram?.requestChat || !telegram.isVersionAtLeast?.("9.6")) {
    throw new Error(
      "обнови telegram для выбора чата · или добавь его через меню бота",
    );
  }
  const prepared = await call("prepareChat", { kind });
  const selected = await new Promise((resolve, reject) => {
    try {
      telegram.requestChat(prepared.id, resolve);
    } catch {
      reject(new Error("не удалось открыть выбор чата"));
    }
  });
  if (!selected) return null;
  // chat_shared arrives as a bot update independently of the Mini App callback.
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await call("getConnection");
    if (result.status === "ready") return result.chatId;
    if (result.status === "expired") break;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(
    "чат ещё подключается · обнови список через несколько секунд",
  );
}
