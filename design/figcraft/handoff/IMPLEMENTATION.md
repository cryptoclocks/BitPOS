>21 October update: OMP remains stopped. Current canonical reference is the native master plus current-native PNG exports. Read PROTOTYPE_REVIEW_20261021.md before implementation. Native variable bindings/overlays supersede flat SVG/action-map limitations; do not rebuild from the old base scripts alone.

# Implement from the current BitPOS UI master

Human authorized Codex to design the four surfaces independently, then explicitly instructed sending the finished set to OMP. This package is now the visual reference for `.omp/work/flutter-delivery-20261016/`, subject to server-side authority and the full approved product scope.

## Integration order

1. Read this document, `../README.md`, `screen-map.json`, `tokens.json`, `interaction-map.json`, `native-components.json` and current structural/render receipts. Open master or read the original SVGs by ID; use previews for exact visual reference. Do not parse a huge base64 SVG/image into every model prompt.
2. Reconcile the current working tree and active tasks at the next normal boundary. Do not interrupt tests, throw away working contracts, restart the goal or spawn a second checkout writer merely to adopt the visuals.
3. Implement the existing P0/P1 customer flow using U01–U19/U22–U34, with `P29` incoming order center and `P31` acceptance/detail. Then U20 tracking and R06–R14 driver delivery. Later complete remaining food operations and planned passenger ride flows. Design adoption must not shrink the full plan to only screens that look finished.
4. POS Desktop is Page 30, **41 screens P01–P41 at 1440×1000**. POS Mobile is Page31. Pay Desktop is Page40, **26 screens WD01–WD26 at 1440×1000**; Pay Mobile is Page41, W01–W22. Desktop must be a proper two-column/full-width layout, not a phone frame enlarged on a computer. Do not duplicate routing or API authority merely for responsive UI.
5. Preserve original POS inventory, bilingual labels and role enforcement. Screens for old missing legacy features are design specifications, not permission to invent financial records or mark full parity complete.

## Design system

Brand purple `#64188A`, secondary action purple `#7145D6`, orange `#FF8500`, dark plum text `#29183F`, pale violet surface `#F8F5FC`; dark-orange foreground `#A94800` when orange text needs contrast. Noto Sans Thai supports Thai and Latin; use registered Flutter font/theme assets and browser font fallback. Mobile uses 24px outer padding, 48–52px controls, 14px control radius, 20px cards, 28px sheets. Native Theme supports Light/Dark; preserve readable foreground accents and white labels on primary buttons.

Native components include primary/secondary/outline/danger/disabled buttons, address/search/phone fields, food/driver cards and money metrics. Use real reusable Flutter/web components and responsive constraints, not absolute-position screen screenshots. A subset of buttons are linked native component instances; the rest are editable grouped artwork. Implement remaining equivalents consistently.

## Current code behavior that design must preserve

- POS counter/table immutable routing, actual assigned Mini destination and independent kitchen states; no device requirement for an online app order.
- The current payment source is `apps/web/src/components/Payment.tsx`, `OrderBill.tsx`, `PayMenu.tsx`, `apps/web/src/lib/payment-assets.ts` and existing canonical server contracts.
- Current Pay is Solana devnet test assets with canonical server quotes. The WD desktop flow shows test USDG/USDC/BitPOS-USDT-test as allowed by runtime config, exact amounts/denominations and merchant-sponsored fee semantics. Never assume all three assets are active or amounts are THB→USD conversion.
- Selection outcome unknown (`WD05`) must retry the same saved selection; pending/saved payment (`WD07/WD08/WD14`) must reconcile the original attempt/signature. No replacement signing, asset changes or second charge while locked.
- `WD11` expiry, `WD12` recovery and `WD13` offline are explicit UI states. Network failure does not prove payment failed. Never let a visually navigated prototype hop mark an order PAID.
- Paid→Done→menu (`WD09→WD26→WD02`) follows actual dismiss semantics and delayed return without modifying old payment history. View-menu must retain original bill/customer capability boundaries.
- Customer-consent UI (`WD15/WD22`) remains optional for payment and uses existing explicit wallet proof and per-merchant consent; app-global identity is separate. Do not infer verified customer identity from a nickname or UI avatar.
- Received/rendered pickup notice/acknowledged/COLLECTED/delivered-to-customer are distinct. `P40` rider handoff is separate from `P31` not-yet-accepted online order. No rider should appear assigned before the underlying workflow actually allows it.
- THB fictional food-app fixtures represent planned commerce functionality. Implement through real currency/quote/provider policy, never change existing historical catalog/quotes to match sample UI totals.
- `WD17` PromptPay, future card/partial-refund/multi-store/schedule/ride artwork is a specification, not implemented-provider evidence. Keep disabled/unavailable/feature flag states truthful until configured and tested.

## Verification

Pick affected acceptance checks and UI screenshots, not a full unrelated route/hardware matrix. Compare representative customer/rider/POS desktop/mobile/Pay desktop/mobile frames and Thai/English layouts. Check nested overflow and actual text widths; frame-bound checks alone don't establish no internal overlap. Use appropriate responsive breakpoints (mobile ~390, tablet ~768–1024, desktop ~1280–1440); stack detail panes and collapse nav on narrow screens. Preserve at least 44px interactive hit areas in implementation even when screenshot icons are smaller.

Financial/auth/tenant/location invariants and durable recovery outrank visual fixtures if they conflict. Update design deviation notes with the concrete reason; don't silently discard the visual system. Physical-device/GPS testing remains deferred by the user's current instruction; implement complete OS/service behavior and verify locally/AVD with labelled evidence. Independent Sol high review remains required.

Record the source/evidence fingerprint and IDs implemented in the mission checkpoint. Do not edit `design/figcraft/` generated source/master during product implementation without a separate clear reason; Codex owns this design deliverable in the current turn. Do not deploy or mutate actual-use data merely to match a mockup.
