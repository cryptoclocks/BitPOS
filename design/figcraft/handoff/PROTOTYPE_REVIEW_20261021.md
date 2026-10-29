# FigCraft prototype repair —21 October2026

Canonical editable master: `../BitPOS-Platform-UI.figcraft`.

- Original192boards preserved;8readable directory boards added on Start here;3explicit simulation overlays.200manifest boards and203native render targets.
- Graph: all200manifest boards reachable from A00,1389interactions,0missing destinations. Directory reachability is distinct from a complete end-user journey.
- Fixed Back history, Customer order-detail subflows, cancellation-review wording, group invitation, passenger/food context, overlapping rider offer hotspots, saved-payment recovery and Pay Desktop selected-asset continuity using3native string variables.
- Replaced duplicate S12 mobile list with dedicated merchant detail. S11 first order now stays on mobile S12; acceptance opens a disclosed prototype overlay. This does not accept a real order.
- Removed welcome headlines hidden behind artwork; corrected sampled Thai orphan lines, merchant/cover logo contrast and inconsistent rider fixture totals.

## Evidence

`../reports/current-navigation-audit.json`, `current-native-render.json`, `current-structural-validation.json` and `presenter-review.json` pin the master SHA. Native CLI renders203/203 PASS. All product/state montages reviewed at reduced size; key changed screens reviewed at full size. Native click samples cover Customer entry/Back, order cancellation overlay/Back, group overlay/directory return, Pay Desktop USDC→pending, Rider passenger PIN/trip completion, POS Mobile detail/overlay and Pay Mobile entry/menu/cart.

## Boundaries and handoff

Not every1389interaction was clicked. All-pixel certification, responsive runtime composition and complete code/API route adoption remain open. PNG exports are static default USDG fixtures; dynamic selected-asset state must be checked in FigCraft Preview. SVGs preserve artwork and flat intent but do not encode all native variable/overlay behavior. Never infer backend/payment/dispatch success from a prototype.

Use native master as source of truth. Base build/finalize scripts predate later live MCP patches; rebuilding them alone will lose repairs. Repairs have private backups outside Git under `~/.local/share/bitpos-design-backups/`. Per-step repair scripts are migration records, not a certified one-command full rebuild pipeline. Screenshot contact sheets used for review were temporary and removed; final per-board previews are deliberate handoff artifacts.

OMP stays stopped. Next software work: adopt the repaired compositions and real routes in Customer/Rider/POS/Pay with runtime evidence, retaining full existing features and physical-testing deferral.
