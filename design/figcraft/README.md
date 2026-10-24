# BitPOS Platform UI · FigCraft master

Updated21 October 2026 · UI specification v1.1

Open **[BitPOS-Platform-UI.figcraft](BitPOS-Platform-UI.figcraft)** in FigCraft. This is the single editable master. Select Pages on the left; `00 - Start here` has clickable entries for all surfaces, including separate Desktop/Mobile entries for POS and Pay. Select a frame and use Shift+2 to zoom to it. Use the Prototype panel/preview for linked flows.

## Organization inside the single file

| Pages | Content |
|---|---|
| 00–03 | Start here, foundations, native component library, original GitHub UI reference |
| 10–11 | Customer Flutter: 43 screens, food/account first; 5 passenger-ride screens separately labelled Later |
| 20–21 | Rider Flutter: 32 screens, including onboarding, OTP, delivery, proofs, earnings, help; 5 ride screens Later |
| 30 | POS Website — **Desktop**: 41 screens, 1440×1000 |
| 31 | POS Website — **Mobile**: order-list/detail adaptations |
| 40 | Pay Website — **Desktop**: 26 screens, 1440×1000 |
| 41 | Pay Website — **Mobile**: 22 screens, predominantly 390×844, plus an earlier desktop composition for reference |
| 50 | Empty/offline/permission/stock/price/payment states, English and dark-mode studies |
| 60 | Developer handoff and authority rules |

192 original editable screens/boards,8 section-directory boards and3 prototype overlays, plus five original upstream screenshot references. UI shapes/text remain editable; photography/logo are image fills. Native document retains the component library and has36 variables and1,389 interactions. Not every visual element is a component instance or auto-layout container: screens use explicit pixel layouts; implementation must translate them to responsive layouts and real data.

## Source basis

- Customer design starts from Tarikul711's Flutter UI at commit `201e1387c31c3a1cfe4e790680e33b3c9bc6c73b`: home search/category/promoted content, food details/options, cart, login/registration. Original reference screenshots are inside Page 03. The new BitPOS drawings are original editable artwork; they do not copy unverified upstream icons or product photos into product builds.
- POS: inspected `Pos.tsx`, `IncomingOrders.tsx`, current theme/Thai styles, canonical fulfillment contracts, original 25-screen inventory in `docs/PHASE_PLAN_TH.md`. Existing flows inform design; missing legacy screens are proposals preserving that inventory, not claims that all functionality already exists.
- Pay: inspected `Payment.tsx`, `OrderBill.tsx`, `PayMenu.tsx`, payment asset decoding/state journal, wallet/poll/SSE/Done/customer-consent behavior. Desktop has additional current-source state coverage; mobile commerce THB fixtures are forward-looking and must not replace the current devnet USD denomination model.

## Files and handoff

- `source/`: original SVG drawings and deterministic build/finalization scripts.
- `assets/`: project-owned logo reference, existing credited cafe photographs, and font licenses.
- `previews/`: rendered per-screen PNGs; use `index.html` to browse the screen catalogue offline.
- `handoff/screen-map.json`: stable screen IDs, names, dimensions and source paths.
- `handoff/tokens.json`: base brand, typography, geometry and timing values. Native file's semantic theme variables also distinguish foreground accent/onPrimary for light/dark rendering.
- `handoff/interaction-map.json`: navigation intent; prototype hops demonstrate UI flow and do not execute financial/dispatch operations.
- `handoff/IMPLEMENTATION.md`: implementation instructions and the current/planned boundary.
- `reports/`: import/finalization results, render coverage, structure checks and desktop opening evidence.

The native master is canonical after the21 October repairs. The base generators predate the live directory/payment/mobile-detail patches and do not reproduce this revision alone. Do not regenerate over this master. Use private backups and a separate output copy for rebuild experiments; consult `handoff/PROTOTYPE_REVIEW_20261021.md`. System Noto Sans Thai is needed for native Thai text; font files/license are included for portability.

## Honest prototype boundaries

All names, prices, orders, balances, vehicle records, positions and QR graphics are fictional fixtures. QR artwork must never be used for real payment. Simulated maps are editable schematic artwork, not live routes or map-provider exports. THB customer-app prices show a future commerce flow; Pay Desktop preserves devnet/test-asset labelling. PromptPay/card/refund/provider availability is conditional and must remain unavailable until actually implemented/configured/verified. Mockup counters are not financial facts.

All screens rendered successfully and text stayed within their top-level frame bounds. Representative core screens were visually inspected in FigCraft's renderer, including Thai/English/dark/customer/rider/POS/Pay desktop. This is not a pixel-by-pixel review of every screen or proof of working runtime behavior. See reports for exact checks.

Latest verification: all200 manifest boards reachable from A00;203 native exports PASS; no missing native destination IDs. Scoped real presenter clicks and limitations are recorded in `reports/presenter-review.json`. This does not certify every interaction or running-product parity. OMP remains stopped by user instruction.
