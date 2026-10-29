# Live render report (2026-10-29/30, Phase A+B web)

Basis: real built `apps/web` + real `apps/api` + Postgres `bitpos_render_fixture` (see README). Screenshots are local and untracked; machine results are the JSON files here.

## What ran (all passing unless listed under Open)
- Overview audit (`overview-audit.mjs`): numbers asserted against direct SQL in an `Asia/Bangkok` and an `America/New_York` browser, for the 13-order merchant (two orders at 23:50 / 21:00 yesterday, the rest from 00:10 today) and a 230-paid-orders merchant. 8 of 8 cases pass after the fix.
- Kanban drag and drop (real mouse, HTML5 DnD) in Order center and Kitchen queue: RECEIVED to PREPARING, PREPARING to READY, READY to COLLECTED. Server status changed, card is in the target lane, detail panel stayed closed in all four; RECEIVED to COLLECTED is refused with "Move one step at a time" and nothing changes (`flows-result-run.json`).
- Product add form with photo upload through the real form, 1440 + 390: product created, `imageUrl` stored, `GET /images/products/<id>` returns `image/png`.
- Promotions library with 3 real campaigns (draft / approved / revoked), 1440 + 390, EN + TH.
- Report exports: local orders CSV (11 rows = SQL), server CSVs sales / net / stock downloaded.
- Sidebar at 1440 and the 390 menu, EN + TH.
- Pay pages: awaiting, expired, paid bills, pay menu, table menu, product sheet, cart, review, confirmed order, bill from a table order, paid (`pay-result.json`).
- POS P01-P38 (1440 + 390, EN + TH, 140 shots), re-run for P02/P04/P13/P31/P33 after the step fixes.

## Overview before / after (`overview-audit-before.json` / `-after.json`)
| Case | Before | After |
|---|---|---|
| Bangkok browser, 13 orders | recent-order numbers wrong (Overview showed the LAST 8 chars of the id, Order center and pickup code show the first 8) | all pass |
| New York browser, 13 orders | 5 orders / 2 paid / USD 9.50 / 2 in progress vs SQL 11 / 8 / USD 52.50 / 6; hours and times shifted | all pass (11 / 8 / 52.50 / 6) |
| Bangkok, 230 paid today | 200 / USD 600.00, no warning (SQL 230 / USD 690.00) | 200 shown **with a notice** that only the newest 200 are returned |
| New York, 230 paid today | 65 / USD 195.00 | same as Bangkok |
(The "hourly" mismatch in the before/Bangkok row is an audit parser artefact for zero-count buckets, fixed in the script; the id mismatch is real.)

Fixes (apps/web only): `lib/pos-overview.ts` (`SHOP_TIME_ZONE='Asia/Bangkok'`, `shopDay`, `shopHour`, `shopTime`, `todayMayBeTruncated`), `PosOverview.tsx` (shop zone, id `slice(0,8)`, truncation notice), `IncomingOrders.tsx` (order time in shop zone), `lib/pos-reports.ts` + `PosReports.tsx` (day buckets and default range in shop zone, matching the server reports). Tests: `tests/web-pos-overview.test.ts` (bangkok midnight, truncation; suite run under TZ=Asia/Bangkok, UTC, America/New_York, Pacific/Kiritimati); 94/94 web tests pass; `astro build` ok.

API-side findings (not changed): `GET /api/orders` is `LIMIT 200` (`apps/api/src/orders.ts` line 303) with no paging or total, so Overview/Reports/Order center are client-derived from at most 200 orders; a busy shop will undercount until a server-side summary exists. Overview attributes an order to its creation day while `/api/reports/export?kind=sales` uses `paid_at`; an order created before and paid after midnight lands on different days (seen at the Bangkok midnight in this run: Overview 8 paid vs server export 7).

## Other bugs / gaps
- **Fixed (major layout):** Promotions put the large "Point rewards" form above the campaign library, so real rows were below the fold; the design opens on the library. Moved the form below the library (`Promotions.tsx`, one line).
- Not a bug but worth knowing: dropping a card within ~100 ms of picking it up is refused with "Loading the order, drop it again" because the drop needs the detail loaded; a human-paced drag works.
- Minor, left as is (already in DEVIATIONS): P07 edit form is single column without the design's preview column; catalog list and Sales grid show no thumbnails; Overview and Order center share the header differences listed in `pos-web-render.md`.

## Open (not evidenced)
- Order-again after paid: the link renders on `/pay/<token>` when opened directly (checked manually on two table orders), but my scripted step did not catch it (`orderAgainLink:false` in `pay-result.json`); not claimed.
- P24 rename-category control is not scrolled into the shot (step miss); P13 at 390 step miss. P40 (rider handoff), delivery and app-pickup orders, P41, wallet connect/approve/pending, refund, consent, recovery, x402 states need a wallet provider, a mobile-created order or operator data and are not rendered. Platform pages PL01-PL11 are not covered.
- Mixed-currency Overview total is covered by the unit test only (the merchant has one currency).

## Checklist evidence (`.omp/work/h2-merchant-pricing-20261026/DIRECT_SESSION_CHECKLIST_TH.md`, actual-render boxes; nothing ticked)
- Now have real-data screenshot evidence, partial scope: line 536 DS22 (P08-P13, P21 with real stock, receipts, suppliers), 559 DS23 (P14-P20 with real orders, CSV downloads), 634 DS26 (P29-P30 board + real drag; P31/P32 empty, P40 missing, so still partial), 688 DS28 (table menu, options sheet, cart, review; W19/W20 join not shown).
- Partial only: 727 DS29 (bill awaiting/paid; no wallet/approval/pending), 754 DS30 (expired/paid; no recovery/refund/consent/ready), 848 DS34 (sidebar and language shared states).
- Still open: 779 DS31, 802 DS32, 825 DS33 (platform, needs operator session data), 846 DS34 viewport/deviation list.
- Already ticked, unaffected: 488 DS20 (Overview now verified against SQL), 513 DS21 (photo upload form), 584 DS24, 609 DS25, 661 DS27 (promotions order fixed).
