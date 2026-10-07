# AGENTS.md

Orientation for AI coding assistants (and humans) working in this project.
This file is auto-loaded by Claude Code, Cursor, and similar tools — keep it short
and true. For the full SDK reference (db, Bot API, fetch), see
[docs/tgcloud-sdk.md](docs/tgcloud-sdk.md).

## What this project is

Big Green Monkey is a multi-chat admission bot: instant request approval, pre-approval private
captcha, or inline post-join captcha. User-facing copy is concise lowercase Russian. See README.md
for intentional limits (no scheduler, broadcasts, or timeout enforcement).
Run `npm test` on Node 24+ before deploying. Never deploy the temporary
`tgcloud/handlers/poll_answer.js` created by `scripts/cloud-check.mjs` while it is running.
Chat permissions must be verified live on every administrator action.
Guest filters run on `message` and `edited_message`, before ignoring bot senders.
Identify guest replies by `guest_bot_caller_user/chat`; check the caller, not
`message.from`. Never treat `via_bot` or a nested reply as a guest response.
Bot-to-Bot Communication Mode in BotFather and delete rights are prerequisites.
Keep notices rate-limited and never reply to/quote a guest bot or repeat spam.

A **Telegram bot with a Mini App** running on Telegram's serverless platform. You write
JavaScript modules (database schema, shared library code, update handlers); the
platform runs them in a V8 isolate. The `tgcloud` CLI syncs this local project
with the bot's cloud environment — think `wrangler`/`vercel` + `drizzle-kit`.

There is no server to run locally and no `node_modules` to import from at runtime:
the only things available inside a module are the platform SDK and other modules
in this project.

## Layout

| Path            | What it is                                                        |
|-----------------|-------------------------------------------------------------------|
| `tgcloud/schema.js` | SQLite schema, named exports. |
| `tgcloud/lib/` | Shared server modules. |
| `tgcloud/handlers/` | Telegram update handlers, one level. |
| `tgcloud/endpoints/` | Mini App RPC methods, one level. |
| `web/`, `index.html` | Vite client; no credentials or server-only data. |
| `tgcloud.jsonc` | Static hosting configuration (`dist`). |
| `tests/` | SQLite integration tests and browser tests. |
| `.tgcloud/` | CLI state and credentials. **Never read or edit manually.** |

Only `tgcloud/` JavaScript and the built `dist/` site are deployed.
Run `npm run build` before `tgcloud push`; push does not run Vite.

## Modules and identity

- CLI 0.2+ supports relative ESM paths with `.js`, which this project uses.
  Bare platform imports stay `sdk` / `sdk/db`. Legacy project imports such as
  `lib/store` are still supported (used in the temporary cloud probe).
- No filesystem or npm packages in server modules. npm dependencies are build,
  test, and frontend tooling only.
- Update handlers receive the update payload; the full Update is `ctx.update`.
- Endpoints receive `(input, ctx)`; `ctx.initData.user.id` is verified by Telegram.
  Never accept identity or authorization from client input or `initDataUnsafe`.
- All Mini App reads and writes must use live `authorize`; manager records only
  index the user's connected chats. Never return raw challenge rows/answers.
- Every mutation accepts explicit keys and values; no client SQL or column names.
- UI: lowercase Russian, compact rounded cards, no decorative borders, centered
  headings. Keep bot and Mini App using the same database/settings.

## Platform SDK (`import … from 'sdk'`)

- **`db`** — the database (query builder + schema DSL). Full API: [docs/tgcloud-sdk.md](docs/tgcloud-sdk.md).
- **`api`** — the Telegram Bot API. `api.<method>({...})` (e.g. `api.sendMessage`,
  `api.getMe`) returns the **unwrapped** result and **throws `BotApiError`** on
  failure (`import { BotApiError } from 'sdk'`; it has `.code`/`.description`/`.parameters`).
- **`fetch`** — outbound HTTP, web-`fetch`-like (`res.status/ok`, `res.json()`,
  `res.text()`, streaming via `for await`, redirects followed).

## Database — the rules that bite

Full API in [docs/tgcloud-sdk.md](docs/tgcloud-sdk.md). The non-obvious parts:

- **Every DB call is async — always `await`.** `.all()`, `.get()`, `.values()`,
  `.run()`, `db.$count()` and the raw `db.run/all/get` all return Promises.
- **No foreign keys.** `.references()` and `foreignKey()` **throw at declaration**
  — the runtime runs with FKs off, so they'd be silently inert. Enforce integrity
  in application code (delete children before parents, etc.).
- **Drops happen only via `.deprecated('reason')`** on a column/table/index.
  Deleting the declaration does *not* drop anything.
- **Type changes aren't automatic** — do them by hand with `db.run(...)`.

## Deploy & migrate workflow

**Deploying never touches the database.** Schema sync is a separate, explicit step.

The CLI is a local dev-dependency, so run it with `npx tgcloud <command>` (or use
the `npm run` scripts in package.json — e.g. `npm run deploy`):

```
npx tgcloud status     # what changed locally vs the cloud
npm run build         # build the Mini App
npx tgcloud push       # deploy modules and the built Mini App
npx tgcloud migrate    # apply tgcloud/schema.js changes to the database (interactive)
npx tgcloud run <module> [args]   # execute a handler server-side
npx tgcloud pull       # bring the local project in line with the cloud
npx tgcloud login      # link this project to a bot
npx tgcloud webhook    # show the bot's webhook and whether it matches your handlers
```

After you change `tgcloud/schema.js`, `push` reports what the DB *would* change but applies
nothing — run `npx tgcloud migrate` to actually apply it.

The platform manages the bot's webhook for you, derived from your deployed
`handlers/*`, and refreshes it on `push`. If it ever drifts — e.g. someone called
`setWebhook` with the raw bot token — `npx tgcloud webhook` shows the mismatch and
`npx tgcloud webhook sync` repairs it.
