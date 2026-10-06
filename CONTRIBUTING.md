# Contributing

Run `npm ci`, `npm test` and `npm run build` with Node.js 24+. For UI changes,
install Chromium with `npx playwright install chromium`, then run `npm run test:ui`.
No credentials are needed for local tests.

Keep [Russian](README.md) and [English](README.en.md) setup instructions in sync.

Production modules use Telegram's sandbox SDK and relative ESM paths with `.js`.
Platform imports remain `sdk` / `sdk/db`. Keep pure
domain logic independent from the SDK. Check current Telegram admin rights at
every privileged entry point; never trust callback data or a stored manager link.
Preserve other administrators' restrictions and keep state transitions atomic.

All bot UI copy is concise Russian in lowercase. Escape dynamic HTML. Keep
callback payloads below Telegram's 64-byte limit. Database relationships are
application-managed because the platform has no foreign-key enforcement.

Test observable moderation behavior, including failures and retried updates.
Never add secrets, `.tgcloud`, or test-only control paths to deployed modules.
Use a separate bot for changes involving real API actions.
