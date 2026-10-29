# POS + Pay + Platform web: real render vs FigCraft (2026-10-29, WP1)

Method: the built `apps/web` (PUBLIC_URL baked, `astro build --outDir dist-wp1`, served with `HOST=127.0.0.1 PORT=4482`) was driven by headless Chrome (Playwright from the main checkout's toolchain) against a **synthetic mock API** (`render/mock-api.mjs`, port 3001: 5 sample products, 5 orders, tables, stock, customers; every name and amount is fixture data). `render/serve.sh` rebuilds and serves; `render/capture-pos.mjs`, `render/capture-other.mjs pay|platform` take the shots. Viewports 1440x900 and 390x844, each in EN and TH. FigCraft frames are Thai, so TH 1440 is the comparison pair. The built-in browser pane was not used for capture (scripted headless Chrome is repeatable); no live stack, no real merchant data.

Screenshots: `render/pos/<ID>-<1440|390>-<en|th>.png`, `render/pay/<page>-<w>-<default|alt>.png` (default = Thai, alt = after the language toggle), `render/platform/platform-<page>-<w>-<default|alt>.png`.
Aliases (one capture covers two frames): P10 = Stock tab (movement ledger); P15 = P14 Daily; P16 = Reports > Stock received; P17 = By period; P18 = Analytics.

Verdicts: **match** (same layout and content), **minor** (chrome, wording, extra honest notes, data gaps), **major** (structure/behaviour differs). `viewed` = the real shot and the FigCraft PNG were both looked at; `listed` = rendered, no overflow/crash, classified from structure plus the static report `pos-pay.md` and `DEVIATIONS_20261029.md` (not pixel-inspected: do not read as a pixel claim).

Common to every POS frame (minor, owner-decided in DEVIATIONS): the real header has the merchant name, Guide, language flag, role badge, Log out; the design has branch pill, bell, open-status pill and a "MERCHANT" chip. The app adds an eyebrow line and an honest sub-line ("from loaded orders, not a closed report").

## POS (P01-P41, 1440 + 390, EN + TH)

| Frame | Verdict | Basis | Action | Screenshot |
|---|---|---|---|---|
| P01 Overview | minor | viewed | none. Same KPI row, hourly chart, channel bars, recent table; app shows net as "-" until the server sends it | pos/P01-1440-th.png |
| P02 Sales | minor | listed | none | pos/P02-1440-th.png |
| P03 Order center | minor | listed (board, DEVIATIONS) | none | pos/P03-1440-th.png |
| P04 Bill / order detail | minor | viewed (online order; right panel shows loading because the mock has no acceptance data) | none | pos/P04-1440-th.png |
| P05 Close round | minor | listed | none | pos/P05-1440-th.png |
| P06 Products | minor | listed | 390 horizontal page scroll fixed (see Fixes) | pos/P06-390-th.png |
| P07 Edit product | minor | viewed (form above list, DEVIATIONS) | 390 overflow fixed | pos/P07-1440-th.png |
| P08 Inventory | minor | viewed; app has tabs, a "not ready" cost note and full stock table with Receive / Adjust / Set minimum | 390 overflow fixed | pos/P08-1440-th.png |
| P09 Receive | minor | listed | 390 overflow fixed | pos/P09-1440-th.png |
| P10 Receive history | minor | listed (ledger under the stock table) | none | pos/P10-1440-th.png |
| P11 Adjust stock | minor | listed | 390 overflow fixed | pos/P11-1440-th.png |
| P12 Low stock | minor | viewed; design is a bare list, app adds the movement ledger below | 390 overflow fixed | pos/P12-1440-th.png |
| P13 Stock movements | minor | listed | 390 overflow fixed | pos/P13-1440-th.png |
| P14 Daily report | minor | viewed; app has range pickers, nine report tabs and a fixture-empty hourly chart (mock sends no hourly rows) | none | pos/P14-1440-th.png |
| P15 Sales report | minor | listed (same capture as P14) | none | pos/P15-1440-th.png |
| P16 Receive report | minor | listed (ledger; FigCraft already redrawn in 501e1bf) | none | pos/P16-1440-th.png |
| P17 Period report | minor | listed | none | pos/P17-1440-th.png |
| P18 Analytics | minor | listed | none | pos/P18-1440-th.png |
| P19 Top products | minor | real shot viewed (ranked bars with counts, paid orders only); FigCraft PNG not opened | none | pos/P19-1440-th.png |
| P20 Export | minor | listed (local CSV, DEVIATIONS) | none | pos/P20-1440-th.png |
| P21 Suppliers | minor | listed | 390 overflow fixed | pos/P21-1440-th.png |
| P22 Customers | minor | listed | none | pos/P22-1440-th.png |
| P23 Customer profile | minor | listed | none | pos/P23-1440-th.png |
| P24 Categories | minor | viewed list; the rename control sits below the product table, not scrolled into the shot | none | pos/P24-1440-th.png |
| P25 Users | minor | viewed; member list by short id with role change | 390 overflow fixed | pos/P25-1440-th.png |
| P26 Activity | minor | listed | none | pos/P26-1440-th.png |
| P27 Printer | minor | listed (disabled "not connected" preview, labelled) | none | pos/P27-1440-th.png |
| P28 Settings | minor | listed | none | pos/P28-1440-th.png |
| P29 Order center | minor | listed (design viewed; same board as P30: four columns, "collected" where the design has "delivering", no demo timer) | none | pos/P29-1440-th.png |
| P30 Kitchen queue | minor | viewed; same columns, refresh button and filter link added | none | pos/P30-1440-th.png |
| P31 App orders | minor | listed | none | pos/P31-1440-th.png |
| P32 Delivery | minor | listed (empty board in the mock) | none | pos/P32-1440-th.png |
| P33 Promotions | minor | listed | none | pos/P33-1440-th.png |
| P34 Draft review | minor | listed (empty drafts tab) | none | pos/P34-1440-th.png |
| P35 Floor | minor | listed | none | pos/P35-1440-th.png |
| P36 Opening hours | minor | listed | none | pos/P36-1440-th.png |
| P37 Returns | minor | listed (read only) | none | pos/P37-1440-th.png |
| P38 Net and payouts | minor | listed | none | pos/P38-1440-th.png |
| P39 Sign-in | minor | listed (email form + Owner/Manager/Staff quick buttons, language switch) | none | pos/P39-1440-th.png |
| P40 Rider handoff | NOT RENDERED | needs a delivery order with a pickup proof (`FoodHandoff`); the mock has none. Existing BLOCKED notice for the store-side confirm button is unchanged | none | - |
| P41 Partial refund | NO SCREEN | merchant side is read only by design (BLOCKED) | none | - |

390 result: after the fix no POS shot has page-level horizontal scroll. Mobile reaches Overview/Reports/Products/Menu/Cart/Orders/Promotions/Customers/Settings from the tab grid; Kitchen queue and Delivery through the order-center menu button (the script reported no missed step for P29-P32 at 390, shots not individually viewed).

## Pay / table web (W and WD frames that have a page)

| Frame(s) | Verdict | Basis | Action | Screenshot |
|---|---|---|---|---|
| WD01 / W05 Review and pay | minor | viewed; same two-column layout, bill list, total, wallet card, asset, fee note, primary button. App adds the "not ready" PromptPay/card note, an asset dropdown and Test USDG label; design uses a chevron row | none | pay/pay-bill-1440-default.png, pay-bill-390-default.png |
| W06 Methods | minor | viewed; app shows one wallet method plus a note that PromptPay/card are not ready, design draws the two as disabled rows (already labelled) | none | pay/pay-bill-390-default.png |
| W07 / WD03 Connect | minor | rendered (no wallet provider: "Open in Phantom" button) | none | pay/pay-wallet-390-default.png |
| W09/W10/WD08 Confirming | minor | rendered | none | pay/pay-confirming-390-default.png |
| W11 / WD09 Paid | minor | viewed; check, "payment received", amount, Done button | none | pay/pay-paid-390-default.png |
| W14 / WD11 Expired | minor | rendered | none | pay/pay-expired-390-default.png |
| W16 / WD12 Recovery | minor | rendered | none | pay/pay-recovery-390-default.png |
| WD02 Pay menu | minor | rendered | **fixed: default language** | pay/pay-menu-1440-default.png |
| W02 Table menu | minor | viewed; no photo, rating or badges (data gap, DEVIATIONS) | **fixed: default language** (was English, now Thai like the pay page, choice remembered) | pay/table-menu-390-default.png |
| W03 / WD23 Product / options | blocked | viewed; design carries a "concept" ribbon, the app shows the BLOCKED notice for options and no photo (fixture) | none | pay/table-product-390-default.png |
| W04 / WD24 Cart | NOT CAPTURED | the cart sheet trigger was not reached by the script | none | - |
| WD04 asset list, WD05-WD07, WD06 approval, WD10 receipt, WD13 offline, WD15 consent, WD16 ready, WD18 refund, WD19 loading, WD20 error, WD21 x402, WD22 identity, WD25/W20 join, W21 help, W22 coupon | NOT RENDERED | need a wallet provider, a customer session, a refund obligation, a pickup status feed or a joined table; the earlier static report still applies | none | - |

## Platform (PL01-PL11)

The operator pages sign in through staff OTP and validate every response with the generated zod schemas; the mock has no schema-valid platform data, so only the **signed-out** state of each page and the hub (navigation only, no data) were rendered. Signed-in states of PL02-PL10 are **not rendered**.

| Frame | Verdict | Basis | Action | Screenshot |
|---|---|---|---|---|
| PL01 Hub | major (structure) | viewed; app is a table of 14 tools (OP01-OP14, "Ready" / "Not connected", open link) with the shared sidebar, design draws eight cards | app kept (shows every tool honestly); **FigCraft redraw not done** | platform/platform-hub-1440-default.png |
| PL11 Staff sign-in | major (layout) | viewed; app puts phone + "Request OTP" inside the page under its title with the sidebar visible, design shows a centred card with phone, code, confirm and change-number steps | app kept; FigCraft redraw not done | platform/platform-drivers-1440-default.png |
| PL02 dispatch, PL03 drivers, PL04 incidents, PL05 support, PL06 reviews, PL07 earnings, PL08 cancellations, PL09 rides | signed-out state only (same sign-in as PL11) | rendered 1440 + 390, no overflow | none | platform/platform-*-1440-default.png |
| PL10 Refund reconciliation | NOT RENDERED | embedded panel, needs a platform session | none | - |

## Fixes made in apps/web (no IncomingOrders.tsx edit)

1. **390 horizontal page scroll on every `.catalog-table` page** (Products, Stock, Suppliers, Users, ...): the visually-hidden header label inside the scrollable table was absolutely positioned outside the clipping scroll container, widening the page to 570-780 px. `styles/catalog-list.css`: `.catalog-table{position:relative}`. Re-rendered: no page-level overflow remains.
2. **TableMenu and PayMenu defaulted to English** while the pay page defaults to Thai: both now default to Thai and share the `bitpos.pay.language` key, so one choice carries across bill, menu and table pages (`TableMenu.tsx`, `PayMenu.tsx`).

## Counts

POS frames P01-P41: 39 rendered (1440 + 390, EN + TH) = 156 screenshots; 9 frames (P01, P04, P07, P08, P12, P14, P24, P25, P30) inspected as real-vs-FigCraft pairs plus P19 real-only, the rest listed; verdict totals: match 0, minor 39, major 0, not rendered 1 (P40), no screen 1 (P41). Pay: 9 pages/states rendered (40 shots), 1 minor-blocked (W03/WD23), cart and ~16 other frames not rendered. Platform: hub + 8 signed-out pages (36 shots); 2 major structural differences (PL01, PL11) kept as app; PL02-PL10 signed-in states not rendered.

## Open

- FigCraft redraw of PL01 (table of tools) and PL11 (inline sign-in) if the owner wants the design to follow the app.
- Pay cart sheet, wallet approval, consent, refund and ready states need a mock with a wallet provider / customer session; platform signed-in pages need schema-valid fixtures; P40 needs a delivery fixture.
- Fixture limits: hourly chart and online-order panel look empty because the mock omits those rows; this is not an app defect.
