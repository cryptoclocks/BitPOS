# 2026-10-28 — Offer on tap (Muse Spark picks from approved offers)

## What exists
- `apps/api/src/meta/offer-select.ts`: candidates are only in-stock products whose server price is below base because of an approved product offer or daily promotion (from the inherited catalog, `effectiveMenu`). Muse Spark gets an id enum plus coarse facts (first visit / returning / regular, time of day, recently shown) and no identity. Its choice is used only if the id is in the enum and both reasons have no digits, currency symbols or links; otherwise, or on any router failure, a deterministic pick (best discount not shown recently).
- `supabase/migrations/303_meta_offers.sql`: one impression per tap with the server price, who chose it, and the model invocation id (FK to the ledger).
- `apps/api/src/meta/identity.ts` `offerForTap`: three phases (read menu and facts → model call outside any transaction → store once). Repeat calls for the same tap return the stored offer without asking the model again.
- `apps/api/src/meta/evidence.ts`: every model attempt (including failures) is written to `meta_ai_invocations`.
- Shown in: the Messenger reply after consent or on a returning tap (sent after commit), the web page after a cookie tap, the sign-in page, and `GET /meta/offer`.
- Router task `offer_selection` added (Meta Model API first).

## Meta Model API facts (dev.meta.ai/docs/overview, read 2026-10-28)
Base URL `https://api.meta.ai/v1`, Bearer key, OpenAI-SDK compatible; Muse Spark `muse-spark-1.3/1.2/1.1`; Muse Image `muse-image-1.0`; Muse Voice Transcribe `muse-voice-transcribe-1.0`; SAM `sam-3.1`.

## Validation
- `tests/meta-offer.test.ts` (4): candidate filtering and order, fallback rotation, model choice accepted only within the enum and with clean reasons (digits, ฿, invented id, outage → fallback), money formatting from integer minor units.
- `tests/meta-identity-flow.test.ts` new test on disposable PostgreSQL under RLS: newly bound tap requests one offer; Muse Spark (stubbed HTTP) choice stored with price ฿72 / ฿80 / 10%; a second call returns the same offer and does not call the model again; impression joined to an `OK` `offer_selection` invocation; another link cannot read it; with no model a different fallback offer is chosen.
- All meta tests 36/36 with the database; `npx tsc --noEmit` pass.

## Found and fixed
- The test cluster is `SQL_ASCII` (created with the C locale), where a Thai-digit range in a CHECK behaves wrongly. The SQL check now covers ASCII digits only; Thai digits are refused in code.

## Not verified
No live Muse Spark call yet: the clipboard held 6 characters, not the API key, so `~/.bitpos-meta/meta-api.env` does not exist. `tools/meta/muse-smoke.ts` is ready for that call. Whether `/v1/chat/completions` accepts `response_format: json_schema` on Meta's API is unconfirmed until that run.
