# Mini App

Vite builds `web/` into `dist/`. Telegram Serverless CLI 0.2+ deploys the static
files and `tgcloud/` modules together. The site lives at
`https://app<BOT_ID>.tgcloud.ai/`; no separate server or API token is used by the
browser. Production contains no demo data. The official Telegram JavaScript SDK
provides `Serverless.call`; other frontend assets, including fonts, are hosted
with the app.

## Identity and permissions

The platform verifies signed Mini App init data before invoking an endpoint.
`endpoint()` takes identity only from `ctx.initData.user.id`. Reading chat settings,
statistics, participants and logs or performing moderation calls `authorize()`,
which asks Telegram for current membership and rights. Manager records are a
personal list index, not an authorization source. An administrator who loses
rights cannot keep accessing chat data through an old Mini App session.

A failed permission check can return only a saved list card (`id`, `title`, `kind`,
`accessible: false`) for that authenticated user's own link. `getChatDetails`
returns `stats: null` in that case. Transient failures and rate limits remain
errors; they do not trigger this fallback. `removeChat` deletes only the verified
user's manager link, without requiring the removed bot to reach Telegram.
It is idempotent and cannot delete shared configuration, checks, or another
account's link. Both interfaces ask for confirmation and explain that moderation
continues until paused. Reconnecting restores the saved settings.

Responses use explicit projections. Challenges expose their local reference,
display name, state and creation time, never answers or original permissions.
Setting names, enum values, filters and pagination are validated on the server.
Dynamic strings are escaped before rendering. A failed or timed-out save never
pretends to have succeeded; the user can reload to reconcile an uncertain result.

## Endpoints

| Name | Input | Result |
|---|---|---|
| `getChats` | `page?` | connected chats or minimal inaccessible list cards, 12 per page |
| `getChatDetails` | `chatId` | public settings and counts, or a minimal saved card with null stats |
| `getChatAvatar` | `chatId` | optional public Telegram image URL; live authorization required |
| `removeChat` | `chatId` | remove only the authenticated user’s list entry |
| `updateChat` | `chatId`, `key`, `value` | saved public settings |
| `getWaiting` | `chatId`, `page?` | active checks, 12 per page |
| `allowMember` | `chatId`, `challengeId` | result of explicit manual admission |
| `getEvents` | `chatId`, `filter?`, `page?` | moderation events, 20 per page |
| `getInviteLink` | `chatId` | request invite link, creates it if needed |
| `checkChatRights` | `chatId` | validates bot rights for the current mode |
| `prepareChat` | `kind: group \| channel` | prepared native picker id |
| `getConnection` | none | pending/expired/ready and connected chat reference |

`updateChat` keys: `enabled`, `mode`, `captchaType`, `attempts`, `failureAction`,
`cleanSuccess`, `blockGuest`, `guestMembersOnly`, `guestNotice`. Guest filter keys
are booleans restricted to groups; enabling deletion verifies bot delete rights.
Group/channel restrictions are enforced server-side. Both bot
menus and Mini App modify the same SQLite records. Existing challenges keep the
attempt/failure policy recorded at creation.

## Public avatars

`getChatAvatar` authorizes the current user before reading the separate
`chat_avatars` cache or calling `getChat`. It never accepts a client-provided
username or URL. Chats without a username or photo return no image. Public
preview metadata is restricted to `t.me/i/userpic/` and `cdn*.telesco.pe/file/`.
If preview fetching fails, a short-lived best-effort username userpic URL is
returned; this is not a guaranteed Bot API route. No token or file download
credential reaches the browser.

The client loads avatars independently, limits concurrent RPC requests to three,
reuses them within the session, and keeps coloured initials for missing or broken
images. Cache expiry permits later username/photo changes to be picked up.

## Native chat selection

1. `prepareChat` records random request IDs with a 15-minute expiry, then calls
   `savePreparedKeyboardButton` with the same `request_chat` rights used by the bot.
2. The frontend calls `Telegram.WebApp.requestChat` (Telegram 9.6+).
3. The bot receives `message.chat_shared`, validates request ID, expiry, chat type,
   administrator rights and bot rights, then connects the chat on pause.
4. A short client poll reads the completed connection and opens its settings.

This poll only waits for delivery of the selection event while the UI is open;
it is not a background scheduler. Bot request approvals and captcha lifecycles
continue independently of the Mini App. Older Telegram clients can connect a
chat using `/start` and the reply-keyboard picker.

## Checks

- `npm test`: actual SQLite + mocked Bot API, including endpoint authorization,
  demoted administrators, forged identity, cross-chat admission, protected fields,
  picker flow, invalid inputs and shared bot/Mini App settings.
- `npm run test:ui`: browser flows with a test-only Telegram bridge. Saves, failures,
  modal confirmation, native picker dispatch, channel modes and escaped names.
- `npm run check:cloud`: compile the real cloud modules, check database operations
  and endpoint authentication without sending messages or changing memberships.

Browser tests do not replace a check inside a real Telegram client. The native
picker and host-specific Telegram UI need that final device check.

References: [Serverless](https://core.telegram.org/bots/serverless),
[Mini Apps](https://core.telegram.org/bots/webapps),
[Bot API](https://core.telegram.org/bots/api).
