# big green monkey

[русский](README.md) · [english](README.en.md) · [example bot](https://t.me/big_green_monkey_bot)

A Telegram admission bot with join requests, captcha, per-chat settings and a Mini App dashboard. Runs on Telegram Serverless without a separate server.

**Try it:** [@big_green_monkey_bot](https://t.me/big_green_monkey_bot) → `/start` → **управление** (management).

## Features

- Multiple groups and channels with independent settings.
- Instant join-request approval or a private captcha before admission.
- Inline captcha in supergroups, with messaging restricted until the user passes.
- Native Telegram chat selection that requests the required bot permissions.
- Pending checks, all-time statistics and a filterable moderation log.
- Manual admission and a pause switch for each chat.
- A Mini App and inline bot menus backed by the same settings database.
- Remove groups and channels from your personal list, even after the bot is removed or you lose administrator access.
- Public chat avatars by username, with a coloured initial when a photo is missing or fails to load.

The user interface is currently **Russian**, with concise lowercase text, a black background and rounded cards without borders. Captchas use emoji or simple arithmetic, with 1, 3 or 5 attempts.

## Admission modes

| Mode | Supported chats | Behavior |
| --- | --- | --- |
| automatic approval | groups and channels | approves new join requests immediately |
| private captcha | groups and channels | sends a private challenge and approves the request after a correct answer |
| group captcha | supergroups | restricts a new member's messages and posts an inline challenge in the group |

Each chat uses one mode at a time. Group-captcha mode does not approve join requests itself: members enter through a regular invite link or are admitted by an administrator. Channel captcha is available **before admission**, through private messages.

When attempts run out, request captcha can restart, wait for an administrator or decline the request. Group captcha can restart or remove the member while allowing them to join again.

## Run your own bot

### 1. Prepare Telegram

You need **Node.js 24+**, npm, Git and **Telegram Serverless access** for your bot.

1. Create a separate bot in [@BotFather](https://t.me/BotFather).
2. Open **Serverless → CLI Access → Access token** in the bot's settings.
3. Keep that token for the login step. It has the form `app<id>:<secret>` and is separate from the regular Bot API token.

Start with an empty Serverless project: a deployment synchronizes the complete module set. If the selected bot already runs another project, preserve its source before replacing it.

### 2. Get the source

```sh
git clone https://github.com/DonPlafon/big_green_monkey_bot.git
cd big_green_monkey_bot
npm ci
cp .env.example .env
```

Edit `.env` and set your own bot username, **without `@`**:

```dotenv
VITE_BOT_USERNAME=your_bot_username
```

This is a public username for the “open in Telegram” link. Do not put an access token in this variable. In PowerShell, you can use `Copy-Item .env.example .env` instead of `cp`.

### 3. Connect and deploy

```sh
npx tgcloud init
npx tgcloud login
npm run deploy
npm run setup:bot
```

Paste your bot's **CLI Access token** into the hidden terminal prompt during `login`.

- `init` creates local CLI state without replacing existing source files.
- `deploy` runs backend tests, builds the Mini App, applies safe schema changes, publishes the project and synchronizes its webhook.
- `setup:bot` checks cloud modules and database operations, then sets bot commands, profile descriptions and the **управление** menu button.

The CLI prints the Mini App URL: `https://app<BOT_ID>.tgcloud.ai/`. You do not need a separate VPS, domain, database or long-running bot process. Configuring a Main Mini App in BotFather is optional when launching through the menu button.

CLI credentials are stored in the ignored `.tgcloud/` directory. Your instance gets its own Telegram Serverless database; the example bot's data is not included in this repository.

### 4. Connect a group or channel

1. Open your bot and send `/start`.
2. Select **управление** (management) → **добавить чат** (add chat).
3. Choose a group or channel in Telegram's native picker and confirm the bot's permissions.
4. Choose a mode and enable the bot. Newly connected chats start paused.
5. For request-based modes, generate a **ссылка с заявкой** (join-request link) in settings and share it with new members.

The native Mini App picker requires Telegram Mini Apps API **9.6+**. On older clients, use `/start` → **добавить чат или канал** to open the regular reply-keyboard picker.

Initial connection requires permission to appoint the bot as an administrator. Subsequent management is available to the owner or an administrator who can invite users; groups also require permission to restrict members. Current rights are checked through Telegram on every action, including Mini App reads.

## Settings and behavior

- Each chat has its own mode, pause state, captcha type, attempt count and failure action.
- Only the member assigned to a captcha can answer its buttons.
- Pausing stops new checks. Existing captchas and restrictions remain until an answer, departure or administrator decision.
- Attempt counts and failure actions are recorded when a challenge is created; setting changes apply to new members.
- For join-request captcha, the bot attempts initial contact within Telegram's five-minute contact window. If delivery fails, the request stays pending for an administrator and the error appears in the log. A delivered captcha does not have a five-minute solving deadline.
- Solving a captcha does not automatically undo restrictions changed by another administrator.

Avatars load independently of settings. The bot tries to resolve a public Telegram image URL by username, falling back to `t.me/i/userpic/320/<username>.jpg` when the public page is unavailable. This route is best-effort, not a guaranteed Bot API method; failed images leave the initial visible. Private chats without usernames use initials. Resolved metadata is cached for up to an hour and the fallback URL for five minutes.

## Remove a chat from your list

Open a chat in the Mini App or inline bot menu → **убрать из списка** (remove from list) → **убрать** (remove). If access is lost, only a card with the saved chat title and type, an access retry and the removal action remains. Settings, members, logs and statistics require current administrator rights.

This removes only your account's list entry. Other administrators' lists, shared settings and existing captchas are preserved. **It does not stop an active bot** — pause the chat first to stop new checks. Reconnecting through the chat picker restores the entry with its existing settings.

## Limitations

- **Approval delays, removal timers and broadcasts are not implemented.** The project does not use a scheduler or background jobs.
- Captcha is a basic interaction check, not a defense against targeted automated solving.
- Only newly joining human members are checked; bots and administrators are skipped. Existing requests and complete membership history are not imported from Telegram.
- Restricting messages requires a supergroup. Post-join captcha has a short window between joining and the restriction taking effect.
- Bot API calls and database writes do not share a transaction. Deduplication and recovery are implemented, but exactly-once external actions are not guaranteed.
- Logs, pending checks and deduplication keys have no automatic retention policy. Large deployments need one.

## Updates and diagnostics

After pulling changes into your copy:

```sh
git pull --ff-only
npm ci
npm run deploy
```

Run `npm run setup:bot` again if commands or profile configuration changed.

| Command | Purpose |
| --- | --- |
| `npm run status` | compare local files with the latest local cloud snapshot |
| `npx tgcloud fetch` / `npx tgcloud diff` | refresh the cloud snapshot and inspect differences |
| `npm run check:cloud` | check modules, authentication and real database operations without messaging users |
| `npx tgcloud webhook` | inspect the webhook and subscribed update types |
| `npx tgcloud webhook sync` | restore the project's webhook configuration |

A plain `npx tgcloud push` does not build the frontend. Use `npm run deploy`, or run `npm run build` first, after changing the UI.

**Only an “open in Telegram” screen in a browser?** This is expected: real data requires launching from Telegram with signed init data.

**A chat is missing or inactive?** Connect it from the right account, check administrator and bot permissions, and enable the required mode. Moving to a different bot requires granting that bot its own administrator rights.

## Development

```sh
npm ci
npm run dev
npm test
npx playwright install chromium
npm run test:ui
npm run build
```

Backend tests use real SQLite and a mocked Bot API. Browser tests provide a test-only Telegram bridge. Local tests require no credentials; use a separate test bot to check native client behavior.

GitHub Actions runs backend tests, a production build and browser scenarios for pushes and pull requests. It does not deploy to Telegram automatically.

| Path | Contents |
| --- | --- |
| `tgcloud/schema.js` | tables and indexes |
| `tgcloud/handlers/` | Telegram update handlers |
| `tgcloud/endpoints/` | Mini App server methods |
| `tgcloud/lib/` | captcha, access checks, settings and bot menus |
| `web/` | Mini App UI and Telegram bridge |
| `tgcloud.jsonc` | Serverless hosting configuration for built `dist/` files |
| `tests/` | backend and browser tests |
| `scripts/cloud-check.mjs` | cloud checks and profile setup |

More: [Mini App architecture](docs/miniapp.md), [SDK reference](docs/tgcloud-sdk.md), [contributing](CONTRIBUTING.md).

## Data and license

The database stores chat and user IDs, display names, settings, challenge state, original member permissions and moderation events. Regular message text is not stored. The Mini App log uses the device's local time; inline bot logs use UTC.

Code: [MIT](LICENSE). Manrope font: SIL Open Font License, bundled with `@fontsource-variable/manrope`.

Official documentation: [Telegram Serverless](https://core.telegram.org/bots/serverless) · [Mini Apps](https://core.telegram.org/bots/webapps) · [Bot API](https://core.telegram.org/bots/api).
