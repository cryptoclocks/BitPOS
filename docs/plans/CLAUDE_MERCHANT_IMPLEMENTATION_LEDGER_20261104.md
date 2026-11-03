# Merchant feature completion — implementation ledger (M00–M14)

Started 2026-11-04. Source plan: `docs/plans/CLAUDE_MERCHANT_FEATURE_COMPLETION_TH_20261104.md` and the gap report `docs/research/WONGNAI_POS_MANAGER_GAP_TH_20261104.md` (both live, untracked, in the main checkout `/Users/cryptoclock/Desktop/BitPOS`; copied nowhere, read only). Status words: `existing`, `partial`, `missing`, `blocked_external`, `implemented_verified`, `implemented_unverified`, `remaining`.

## M00 — baseline, ownership and mapping (this entry)

**Where the work happens.** The main checkout is branch `codex/bitpos-demo-20261008` at `a79544fc` with 885 uncommitted paths (93 modified, 792 untracked: plans, research, evidence). This session's checkout `/Users/cryptoclock/.codex/worktrees/bitpos-h2-parallel/BitPOS` (branch `codex/bitpos-h2-local-scope-20261027`, PR #2) is 206 commits *ahead* of that HEAD (`git merge-base` = `a79544fc`, nothing on main that the branch lacks as a commit). It already contains Overview, Reports, Catalog editor, Team roles, Stock, Suppliers, Shift close, the cash register, channel (GrabFood) adapter, Bluetooth printer, so the gap report — written against the main checkout, where those tabs are `tab:null` — **over-states the gaps for this branch**. All M-work is therefore done in this checkout, on top of this branch, so nothing in the main checkout's dirty baseline is touched, reset, stashed or overwritten. The 885 uncommitted main-checkout paths are not in this branch and are not merged here; integrating them is a separate decision for the owner.

**Ownership/process check.** `.omp/` exists in the main checkout (agents, foreman, loop, leases directories); no `omp`/`foreman` process is running (`ps` shows only Claude Desktop/Brave). No OMP was started, stopped or modified. No other session was writing in this worktree.

**Mapping of the 18 groups** (checked against this branch's source, not against old docs or prototypes; "evidence" = path in this checkout):

| # | Group | Status here | Evidence / what is still missing |
|---|---|---|---|
| 1 | Sales overview | existing | `PosOverview.tsx`, `api/src/overview-summary.ts`, `GET /api/overview/summary` (same definition as the report/CSV). Missing: branch filter, drill-down to the source bill. |
| 2 | Sales reports by type | partial | `PosReports.tsx`, `reports.ts` (per day/hour/source/currency, refund group), `report-exports.ts` CSV incl. cash. Missing: by category, by payment method, by channel name, cash-drawer tab, drill-down. |
| 3 | Cash drawer review | partial | `cash/drawer.ts`, `shifts.ts`, `ShiftClose.tsx`, migrations 183–185 (opening float, expected vs counted). Missing: cash in/out movements with reasons, drawer history list/detail with variance, close-race tests per register. |
| 4 | Bill history and void | partial | `AllOrders.tsx`, order detail, cash `voidSale`, online food return/refund (`food-return.ts`, `merchant-returns.ts`). Missing: searchable store bill history + void/refund for paid card/wallet orders with reasons, one view of void vs refund. |
| 5 | Menu create/edit/delete | existing | `CatalogEditor.tsx`, `CatalogList.tsx`, `catalog-edit.ts` (create, update with expected-revision, archive, image upload). |
| 6 | Categories, groups, ordering | partial | category rename (`/api/categories/rename`), `sort_order` column. Missing: reorder UI/API, groups. |
| 7 | Channel prices / channel availability | missing | prices are one catalog price version plus a separate cash price list; no per-channel price. |
| 8 | Option prices per channel | missing | options + min/max exist (`online-options.ts`, `OnlineOptionsSettings.tsx`); no per-channel option price. |
| 9 | Pause menu/choice | **in progress (M03a)** | no pause existed; stock-out is not pause. |
| 10 | Per-item VAT exemption | missing | VAT is a whole-sale setting in `cash_settings`; `commerce-pricing.ts` tax policy has no per-product flag. |
| 11 | Selling hours (category/channel) | **in progress (M03a, per product)** | `opening-hours.ts` is branch opening hours only. |
| 12 | Staff / roles / PIN | partial | `team.ts`, `TeamSettings.tsx` (owner moves manager/staff between roles, session role updated at once). Missing: staff profile/name, add/disable, PIN, allowed time window, session revocation on disable. |
| 13 | Branch switching | missing for managers | marketplace branches exist for customers (`mobile-food`, migrations 051/052/060); merchant UI/API has a single merchant scope. |
| 14 | Ongoing bills | existing | `IncomingOrders.tsx`, `ShopFloor.tsx`, `table-occupancy.ts`, kitchen/delivery states. |
| 15 | LINE MAN / Wongnai / GrabFood | partial / blocked_external | GrabFood adapter with credentials, order sync, stock + settlement (`api/src/channels/*`); LINE MAN and Wongnai: no official API access in this project. |
| 16 | Finance / POS Pay / banks | blocked_external | no provider access; PromptPay/Stripe remain roadmap. |
| 17 | Owner analytics assistant | partial | promotion AI drafts (`promotion-provider.ts`, `PromotionGenerate.tsx`) and Coffee Copilot (customer side). No sales Q&A assistant. |
| 18 | Merchant support / package | partial / blocked_external | customer/platform support exist (`mobile-support.ts`, `PlatformSupport.tsx`); no merchant audience, no package/subscription provider. |

**Plan for the rest (dependency order, honest sizing).** M03a (pause + selling hours) first because it is central to quotes and everything else reads it; then M04 staff, M05 bill history/void, M06 cash movements, M07 report drill-down/by-category/by-payment, M02 category reorder, M13 merchant support view. M01 branch context, M10 branch comparisons, M11 analytics assistant, M12 provider adapters (LINE MAN/Wongnai/POS Pay) need information or access not present here (branch data model decision, provider docs/credentials). Each is recorded below when started; nothing is called complete until its acceptance checks ran.

## Module ledger

| ID | Status | Changed files | Tests / evidence | Limits / next |
|---|---|---|---|---|
| M00 | implemented_verified (survey) | this file | source reads above; `git merge-base`/`git log` counts; `ps` | none |
| M01 | remaining | – | – | needs a branch data-model decision for the merchant side |
| M02 | partial (existing editor) | – | – | add reorder API/UI; groups |
| M03a (pause + selling hours, group 9 and 11 per product) | implemented_verified (API→SQL, UI visual) / acceptance of an already-issued quote implemented_unverified | `supabase/migrations/186_product_availability.sql`, `apps/api/src/catalog-availability.ts`, `catalog.ts` (menu + `validateQuote`), `cash/sales.ts`, `index.ts` routes, `packages/contracts` codes, `web/lib/api.ts` + `api-routes.ts`, `ProductAvailabilityPanel.tsx`, `CatalogList.tsx`, `styles/catalog-list.css` | `tests/product-availability-db.test.ts` (SQL: pause bounds, local-time windows, midnight crossing, Bangkok + New York DST), `tests/product-availability-http.test.ts` (real HTTP+roles+SQL: staff may pause, window owner/manager only, strict bodies, stale revision 409, 4-way race = 1 winner, menu `available:0`+`unavailable`, cash register refuses, stock/reserved unchanged, timed pause expires, tenant fences 404, audit rows); full suite 833 tests / 609 pass / 0 fail / 224 skipped (need external services); browser: desktop 1100 and true 390 px widths in Chrome (TH). | Pause is per product for all channels (per-channel pause/prices = M03b, remains). Acceptance of an order from a quote issued before the pause is enforced in `validateQuote` but not exercised by an end-to-end order test. Customer/table menu cards already hide unavailable items via `available:0`; no new customer wording. English UI not screenshotted. |
| M03b (per-channel price, option price per channel, per-item VAT) | remaining | – | – | needs a pricing-model decision: base price vs channel override inside canonical quotes/price versions |
| M04–M14 | remaining | – | – | – |
