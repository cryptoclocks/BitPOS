# Design deviations decided on 2026-10-29 (owner: "take whichever is better; if the app changes, FigCraft changes too")

Where the real app and the design differ, each difference was judged and the better one kept. Where the app was kept, the exported
FigCraft source (`source/screens/*.svg`), the PNG preview (`previews/current-native/*.png`) and the `sha256` in `screen-map.json`
were updated to match.

**Master status:** the exported SVG/PNG/sha256 were patched first. The native master was then edited too, headlessly with `figcraft-cli run` (the first note here that the master "could not be opened" was wrong: FigCraft is installed and the CLI edits .figcraft files without the app window). The edited copy is `BitPOS-Platform-UI.edited-20261029.figcraft` next to this folder's exports and the exact steps are in `master-edit-20261029.json` (U01 bell replaced by an "English" text, U02 and U03 button labels and link rows, U04 centred description). With the owner's OK the master at `design/figcraft/BitPOS-Platform-UI.figcraft` in the main checkout was replaced by the edited copy (the original is kept as `BitPOS-Platform-UI.before-20261029.figcraft` beside it). Later edits (P20 and P25 text) are appended to `master-edit-20261029.json`; replay with `figcraft-cli run master-edit-20261029.json --in <master> --out <master>`. The exported SVG/PNG/sha256 of P10, P12, P13, P20, P24, P25 and P37 were patched to match (the CLI's own SVG export uses outlines, unlike the existing text-based exports, so the text was patched in place).

## Applied to the exported files (app kept, design updated)

| Screen | Change | Why the app is better |
|---|---|---|
| U01 welcome | top-right bell icon replaced by an "English" language switch | there are no notifications before sign-in, and the language switch is the only control a new visitor needs |
| U02 sign-in | button "get confirmation code" to "request sign-in code"; the consent sentence replaced by a centred "service and privacy" link row | the button says what happens (a sign-in code is sent); a link keeps the legal text one tap away without a wall of small print |
| U03 OTP | button "confirm and continue" to "confirm code"; resend countdown replaced by a centred "change number / ask for a new code" link | the server has no resend-cooldown data to show a true countdown, and the link covers the two real recovery actions |
| U04 location | description centred under the centred title | the left-aligned text under a centred title looked misaligned |

## Differences kept in the app that are data gaps, not design changes (design left as is)

U06 home (address line, promo banner, category tiles, rating / ETA / fee on merchant cards), U09 merchant page (open badge, rating,
ETA and fee chips, item photos and descriptions), U10 product option chips (the fixture product has no option groups) and R06 rider
home content in states other than "online". The app does not invent ratings, delivery times, promotions or photos; the design
stays as the target for when that data exists.

## Larger differences where the app is kept (design to be redrawn in the FigCraft master, not hand-patched)

These are too structural to patch in the exported SVG. The app is the better behaviour; redraw the frames in the master when it is open.

| Frame | App behaviour kept | Design shows |
|---|---|---|
| U20 tracking | "Map unavailable" plus delivery status when no map provider is configured or service access is restricted; no invented ETA or rider rating | live route map, ETA, rider card with rating, chat / details buttons |
| U22 order detail | adds a collapsible "status and history" section and a longer "Cancel review" label | three short buttons, no history section |
| U23 activity | merchant tile icon and a "newest orders" sort control | merchant photos |
| U33 account | superset menu (addresses, settings, ride, group order, order again, and more); no points or name until the account has them | four rows incl. coupons and points, payments |
| P03 bills | order-centre board with columns (new, in progress, ready, collected) and channel filter | a plain bills list |
| P07 / P09 / P13 | product details form above the list; inline receive form; stock ledger with receive and adjust only | two-column edit page with photo preview; receive page with supplier, document number and cost; movement list including sales deductions |
| P20 export | local CSV built from the loaded orders, nothing stored or uploaded | a list of previously generated exports |
| P24 categories | summary card with rename; categories are derived from products | a categories list with visibility and update time |
| P25 users | member list by short id with role change for managers and staff; names and invitations stay in the auth service | member names and an add button |
| P35 devices | richer floor-plan editor with the same facts | plain tables-and-devices list |

## Text-level alignments applied to the master (2026-10-29, second step)

- **P20 export:** the two sample "stored exports" became one row that says what the app does: orders of the chosen range, CSV built on this device, nothing uploaded; count text "1 item". The "add item" button is still drawn (the app has none).
- **P25 users:** sample names replaced by short ids with the real role descriptions; the "last update" column became "actions" with "make staff" / "make manager". The "add item" button is still drawn (invitations are not offered).

## Third step (2026-10-29): list frames aligned to the app, master and exports

- "Add item" buttons deleted from P10, P12, P13, P20, P24, P25, P37 (the app has none; P21 suppliers keeps its button because the app has "Add supplier").
- P13 movement list now shows only receive and adjust entries (the ledger does not record sales); P10 rows carry no cost; P12 shows "left / minimum" without a unit and an action column; P24 categories show "from menu items" and no update time.
- Still superset or structural, not redrawn: U20, U22, U23, U33, P03, P07, P09, P35 (app kept).

## Fourth step (2026-10-29): frames redrawn where the app is more complete

Drawn in the master with `figcraft-cli` (replay: `master-edit-20261029.json`, applied to the master with the owner's OK):

- **P03** now an order-centre board: channel chips and four status columns with sample order cards (the title became "Order center").
- **P35** now a floor-plan editor: counts, plan / list switch, plan canvas with tables and the counter, and a side panel with the drag note.
- **U22** now one item plus the "status and history" row (totals recomputed: 95 + 35 - 20 + 20 = 130).
- **U23** gained the "sort by: latest orders" control; **U33** shows the app's own entries (addresses, account settings, ride, group order) and a scroll hint.
- The exported SVG / PNG / sha256 of these five were produced with `figcraft-cli export` (outline-based SVG, unlike the older text-based exports).
- Still different, deliberately: U20 (app shows a "map unavailable" state), P07, P09, P11 (the design has more than the app) and item photos.

## Fifth step (2026-10-29): frames added for app screens that had no FigCraft frame

Owner: "leave the frames that exist; draw only the ones that do not exist". Existing frames were not touched in this step (the five redraws above were done earlier, before this instruction).

Added to the master (and exported to `source/screens/`, `previews/current-native/` and registered in `screen-map.json`; `generators/` holds the scripts that cloned the template frames):

- **Platform operator (new surface "platform", 1440x1000, page "35 - Platform Operations"):** PL01 hub, PL02 dispatch and riders, PL03 driver verification, PL04 incidents and help, PL05 customer support, PL06 review moderation, PL07 driver earnings and payout rounds, PL08 delivery cancellation reviews, PL09 passenger rides and fares, PL10 refund reconciliation. The web app has these operator screens (`PlatformHub`, `PlatformFoodDispatch`, `PlatformDrivers`, `PlatformFoodIncidents`, `PlatformSupport`, `PlatformReviews`, `PlatformDriverEarnings`, `PlatformFoodCancellationReviews`, `PlatformRides`, `RefundReconciliationPanel`); the design had none. Drawn as list frames with the app's own titles and columns; sample rows are marked as samples.
- **Customer app:** U44 signed-in devices (sessions), U45 order again, U46 merchant reviews.
- **Rider app:** R33 payout account (beneficiary), R34 food compensation requests.
- Layout is a clone of the existing list frames with the app's wording, not a new visual language; the platform sidebar lists the ten tools. Replace with richer layouts when the operator screens get their own design pass.
- Not added because they already have a frame: account data copy (inside U34 privacy), support cases (U30 help), coupon and checkout screens, ride screens.

## Sixth step (2026-10-29): platform operator frames upgraded to full designs

PL01 to PL10 are no longer list clones. Each is laid out for what the operator does, with the app's own labels and rules, and a footer that states the screen's safety rule:
PL01 hub (eight tool cards, one not connected), PL02 dispatch (store and branch selectors, shipment table, job controls, auto-search policy), PL03 driver verification (queue and application detail with evidence reference, validity, approve / reject), PL04 incidents (queue and incident detail with acknowledge / allow-to-continue and the "not a handover, refund or payment" warning), PL05 support (queue, thread, reply, close), PL06 reviews (status tabs, review text, decision reason, publish / not publish), PL07 driver earnings (three money cards, ledger facts, payout draft controls, "accounting receipt, not a transfer confirmation"), PL08 cancellation reviews (queue, purpose-before-reading, audited private detail, "review result, not a refund"), PL09 rides (fare form, announced fares, "no payments, earnings, refunds or penalties from this page"), PL10 refund reconciliation (cases, extra-inflow check, "adds an obligation, does not transfer money"); new PL11 staff sign-in (phone, OTP, separate from shop accounts).
Master, exported SVG/PNG, `screen-map.json` (sha256, PL11 added) and `generators/` were updated. Sample rows and ids are illustrative.

### Step 7 – operator pages follow PL01–PL11; refund reconciliation is a panel (2026-10-29)
- App changed to match the design: one shared left menu (`PlatformSidebar`, `lib/platform-nav.ts`) on all nine operator pages (the three older pages had no menu, five others each had their own different list); the hub is a table (tool / purpose-or-need / status / entry) with the sidebar. Role checks and every server call are unchanged.
- FigCraft changed to match the app: the menu has nine entries (the design's tenth "กระทบยอดคืนเงิน" is removed from PL01–PL10 because reconciliation is a panel inside the incidents page, not a page); PL01's "เปิดล่าสุด" column became "ทางเข้า" (the app keeps no last-opened data); PL10's subtitle says it is a panel in the incidents page. Generator: `generators/gen_pl_nav9.py`.
- Static comparison of the remaining mobile, POS and Pay frames against the source by three read-only reviewers: reports in `comparison-20261029/` (customer, rider, pos-pay). Nothing there was ticked in the checklist; the findings are a work list (most frames need a FigCraft redraw because the app is the honest side).

### Step 8 – frames made honest about what the app has (2026-10-29, demo scope)
Owner direction: demo-ready, not production. Text/overlay patches rather than full redraws (the original card text is outlined vectors, so new text is laid over a cover):
- U16 and W06 payment methods: PromptPay and card are "ยังไม่เปิดใช้งาน", only the Solana wallet is enabled, footnote "หน้านี้ไม่ยืนยันการชำระเงิน".
- U24 cancel: safety note and button "ส่งคำขอตรวจสอบ — ไม่ใช่ยกเลิกทันที". U25: "มีการบันทึกภาระคืนเงินไว้แล้ว / ยังไม่มีหลักฐานยืนยันการโอนคืน".
- U26 coupons: sample-page wording ("ตัวอย่างหน้าจอ · ยังไม่เชื่อมระบบจริง", conditions come from the server, two sample rows). U27 rewards: live points wording, redeem not enabled. U31 review: app wording (completed meal, optional rider rating).
- Yellow ribbon "ภาพแนวคิด · ยังไม่มีในแอป" on frames of unbuilt features: U39–U43, R27–R31, W03, W13, W21, W22, WD16, WD23, P41; "ตัวเลขตัวอย่าง · ไม่ใช่ข้อมูลจริง" on R16–R18.
- Owner questions decided by the assistant for the demo: guest option picker (W03/WD23) and P41 partial refund stay planned (ribbon), the English default of TableMenu/PayMenu is kept (browser tests rely on it).
- Still open from the reports: P16/P19 bodies are copies of P14, U07/U08 search/filters, U32/U34 toggles, U36 group order, U44–U46 chips, R11/R13 PIN boxes, R20/R21/R25/R26 hubs, S11/S12 default 15 minutes. Generator: `generators/gen_honest.py`.
