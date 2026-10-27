# 2026-10-28 — Tap route, Messenger webhook and customer session

## What exists
- `supabase/migrations/302_meta_identity.sql`: Messenger page per shop, consented customer links (page-scoped id only), one-time m.me refs, consent requests, single-use sign-in links, 30-day web sessions, webhook event ledger; tap sessions can be bound to a customer. Unauthenticated entry points only resolve which shop a page/token belongs to (SECURITY DEFINER); all checks and writes run inside that shop's RLS transaction.
- `apps/api/src/meta/messenger.ts`: `X-Hub-Signature-256` check over raw bytes, subscription handshake, event parsing (referral, consent postback/quick reply, stop words), Send API with the page token in the `Authorization` header.
- `apps/api/src/meta/identity.ts`: tap → (cookie: known) or (m.me ref) → consent → link → sign-in link → session; STOP or "Forget me" revokes the link and all sessions. Messenger replies are an outbox sent after commit.
- `apps/api/src/meta/routes.ts`, mounted in `apps/api/src/index.ts`: `GET /meta/t/:tagId`, `GET|POST /meta/messenger/webhook`, `GET /meta/login`, `GET /meta/me`, `POST /meta/me/revoke` (same-origin only). Disabled (503) unless `META_TAP_MASTER_KEY`, `META_PUBLIC_URL` and the Messenger variables are set.

## Validation
- `tests/meta-messenger.test.ts` (4): signature over exact bytes, handshake, event parsing and filtering, token never in URL.
- `tests/meta-identity-flow.test.ts` (3, disposable PostgreSQL 17 with 001–137 + 300–302, application queries as `bitpos_app` under RLS): new customer end to end; replayed tap and forged MAC refused; duplicate webhook delivery ignored; ref single-use; consent decided once; sign-in link single-use; cookie makes the next tap "known"; the same cookie is useless at another shop; returning customer recognised in Messenger without a second consent; STOP revokes sessions; decline stores no link; HTTP 303 to m.me, 409 on replay, webhook 401 on bad signature with nothing sent, 200 with one reply sent, cross-origin revoke 403. Ran 3 times in a row: 3/3 each time.
- All meta tests 31/31 (28 + 3 skipped without the DB URL); `npx tsc --noEmit` pass.

## Bugs found and fixed
- Inserts computed `expires_at` from a separate clock read than `created_at`, occasionally exceeding the exact TTL checks by microseconds; every insert now reads the clock once.
- Test fixtures reused timestamps and sticker UIDs across runs; now unique per run.

## Not verified
No real Messenger app, page or webhook delivery; the Graph API version (`v24.0` default) and Bearer-header auth on the Send API need a live check. The Astro web proxy is untouched: `/meta/*` must be routed straight to the API process (port 3001) by the tunnel or reverse proxy.
