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

## Live Muse Spark (Meta Model API) — 2026-10-28
Key saved only in `~/.bitpos-meta/meta-api.env` (600). Endpoint `https://api.meta.ai/v1/chat/completions`, model `muse-spark-1.3`.
- First run: `PROVIDER_RESPONSE_INVALID`, so the router fell back. A raw call showed why: Muse Spark is a reasoning model, used 298 of the 300-token budget on reasoning, and returned `content: null` with `finish_reason: "length"`.
- Raw calls with `reasoning_effort` `low` / `minimal` and `max_completion_tokens: 2000` returned `finish_reason: "stop"` and JSON that obeyed the `response_format: json_schema` enum (about 3.4 s).
- Fix: the router passes an optional `reasoningEffort`; offer selection uses `minimal`, 2,000 tokens, and an 8 s deadline (was 2.5 s, shorter than the real latency).
- `npx tsx tools/meta/muse-smoke.ts`, 4 runs after the fix, all `OK` and `chosenBy: model`:

| Run | Latency | Prompt / completion tokens | Choice | Reason (EN) |
|---|---|---|---|---|
| 1 | 3,336 ms | 442 / 256 | Iced latte | Start your morning with a smooth iced latte |
| 2 | 3,339 ms | 442 / 254 | Iced latte | Smooth iced latte for a bright fresh morning start |
| 3 | 3,475 ms | 442 / 309 | Iced latte | Start your morning fresh with a smooth iced latte |
| 4 | 3,173 ms | 442 / 264 | Thai tea | Sweet and refreshing, perfect for your morning |

All Thai and English reasons were digit- and price-free, so none was rejected. Meta tests 32 pass + 4 skipped without the DB URL; `tsc` pass.
