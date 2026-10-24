# FigCraft → BitPOS UI pipeline

> 23 October 2026 latest human sequencing correction: follow `plans/UI_FIRST_IMPLEMENTATION_RESET_TH_20261023.md`. Complete current UI/navigation/visual acceptance before expanding API integrations; preserve existing controllers, backend proofs and same OMP goal/session. Historical “OMP remains stopped” statements below describe 21 October only. UI completion is still unaccepted until current per-screen evidence/review exists.

21 October 2026 — UI-first pipeline in use; bounded IR extraction and first mapped Flutter component executed.

## Verified on this Mac

- Installed CLI0.6.0:552 commands; MCP initialize/tools-list PASS (18 tools).
- Original POC master had14 pages,11299 nodes and33 variables. Current repaired master has14 pages and11741 nodes; use current reports for counts. Current36 variables include3prototype asset-state strings. Canonical SHA256: `c72077d7d91906ab9bf97ecac16db450db923e4d4559ee89691750106e41dfeb`.
- Actual MCP open_file→get_node(U26,node1532,depth4)→variable.export PASS.
- Evidence: design/figcraft/reports/flutter-pipeline-probe.json and reports/flutter-poc/U26.context.json.
- The original POC was read-only. Subsequent FigCraft repairs are recorded separately. This pipeline extraction preserves the master and performs no deployment.
- Installed inspect.code supports css/html/react/leptos/swiftui/compose, not Dart/Flutter.

## Architecture

FigCraft master + semantic handoff tokens → bounded MCP extraction → normalized layout/component IR → Flutter or TSX/CSS presentation → preview catalog → geometry/golden/native/browser review.

Use CLI for repeatable headless extraction/render; use attached MCP for visible editing. Inspect tool schemas and command parameters from the installed version, not blindly from latest documentation. Read node IDs through master info; do not hardcode stale IDs. Keep master hash in every extraction. Do not change global MCP config or restart an existing desktop instance solely for this POC.

IR needs node ID, screen ID, semantic role, bounds, direction/gap/padding, sizing mode, token references, text/font metrics, component/variant references and assets. Resolve variable aliases/modes with cycle/missing-binding errors. Report unsupported nodes explicitly. Explicit coordinates do not reveal responsive intent; add reviewed mappings rather than guess all screens as Stack/Positioned.

Map vertical/horizontal auto layout to Column/Row, padding/gaps to Padding/SizedBox, fill to Expanded only under bounded Flex constraints, hug to intrinsic content where appropriate, wrap to Wrap, scrolling to ListView/CustomScrollView and overlays to limited Stack. Reuse existing BitPOS controls and theme. Keep API/state/payment logic outside generated presentation. POS/Pay remain existing web TSX/CSS; do not replace them with Flutter.

## POC commands

```sh
python3 tools/design/figcraft-probe.py
python3 tools/design/figcraft-screen-context.py --screen U26
/Users/cryptoclock/.local/bin/figcraft-cli commands --json
```

Generic stdio client configuration (client-specific config path/schema must be verified):

```json
{"mcpServers":{"figcraft":{"command":"/Users/cryptoclock/.local/bin/figcraft-cli","args":["mcp"]}}}
```

An attached session uses `mcp --attach PORT` against an app explicitly started with `--control PORT`. Current installed help does not advertise newer filesystem-root flags; verify support before using flags from upstream main.

## UI-first roadmap

1. Freeze master fingerprint, tokens and stable screen IDs; maintain existing design and code boundaries.
2. Validate3 representative views: U26 coupon list, Rider work card, POS/Pay desktop data layout. Confirm tokens, text, components, image assets and layout before widening generation.
3. Create a private local UI catalog for all missing/unjoined screens: current food scope5, passenger presentation10. Passenger capability stays labeled Later and unavailable for actual booking until backend work is complete.
4. Generate modular presentation and typed callbacks/view models in small screen batches, preserving existing logic. Include loading/empty/error/offline/disabled states, Thai/English, keyboard, long text and mobile/desktop behavior.
5. Verify exact reference viewport390×844 or1440×1000, deterministic font/theme, geometry and screenshot/golden review. Then narrow/large-text/adaptive screens. Delete scratch captures; retain one reviewed evidence image per required surface/state.
6. Close UI only when every requested screen is reachable in the catalog, callbacks/navigation work, controls are accessible, no overflow and current visual review passes. Record presentation completion separately from business/API/integration completion.

## Agent prompt

Implement screen <ID> using its extracted context and preview from the pinned master hash. Read existing tokens/components first. Emit modular presentation widgets with immutable typed view data and callbacks; reuse existing BitPOS controls. No network/database/payment/dispatch side effects in generated presentation. Preserve every visible required state and all current features. Do not fabricate financial facts, delivery status, ratings or assets. Report unsupported layout/variable/component nodes with IDs. Verify reference viewport plus large text, keyboard and loading/empty/error. Save evidence and list remaining mismatches explicitly. Do not claim working backend from fixtures.

## Risks and fallback

Pin installed version and snapshot master before upgrades. .fig interchange is best-effort/experimental: use native master as canonical, SVG/PNG as visual reference and per-node/manual component mapping for unsupported nodes. Never silently rasterize interactive screens. Font/layout/alias/variant differences require visual comparison. Unknown properties fail the generation gate. Keep generated output separate from handwritten controllers; do not overwrite whole apps. Newer FigCraft plugin support does not imply compatibility with Figma plugins.

Local files/renderer/MCP can run offline; a cloud LLM still receives supplied context. No measured speedup claim: benchmark extraction/render/generation/review separately. Figma REST/MCP offer their native ecosystem and design context but have access/network dependencies. This is a project-fit choice, not proven universal performance superiority.

## Primary references

- https://github.com/storytold/figcraft/blob/main/docs/mcp.md
- https://github.com/storytold/figcraft/blob/main/docs/cli.md
- https://github.com/storytold/figcraft/blob/main/docs/file-format-parity.md
- https://developers.figma.com/docs/rest-api/file-endpoints/
- https://developers.figma.com/docs/figma-mcp-server/


## Executed continuation after FigCraft repairs

The native master is canonical. Read `design/figcraft/handoff/PROTOTYPE_REVIEW_20261021.md`;200manifest boards include8directories, not200product screens. OMP remains stopped.

```sh
python3 tools/design/figcraft-screen-context.py --screen U26
python3 tools/design/figcraft-screen-context.py --screen R07
python3 tools/design/figcraft-screen-context.py --screen WD01
python3 tools/design/figcraft_layout_ir.py --screens U26 R07 WD01
python3 tools/design/figcraft_layout_ir.py --screens U26 R07 WD01 --check
python3 tools/design/generate_coupon_metrics.py
python3 tools/design/generate_coupon_metrics.py --check
python3 tools/design/test_figcraft_layout_ir.py
```

- Native MCP contexts refreshed for all3representative views. Read-only ZIP extraction writes versioned IR with screen-relative affine bounds, typography, paints, native variables/bindings, layout fields and interactions. Outputs `design/figcraft/reports/layout-ir/`. No rasterization or generated controllers.
- U26:53nodes,11manual mapping warnings; R07:49nodes,11warnings; WD01:78nodes,10warnings. These warnings expose vector/instance mappings requiring review. `automaticWidgetGenerationReady=false` is intentional. Unknown types are retained and flagged; missing children/bindings and alias cycles fail. Aliases/modes remain native metadata; complete resolved-mode generation is still pending.
- Reviewed U26 mapping in `handoff/component-mappings/U26.json` generates `packages/mobile_shared/lib/presentation/figcraft_coupon_metrics.dart`. Stale master/missing or ambiguous selectors fail generation. Amount/title/subtitle font sizes and hero dimensions come from native nodes; responsive flow gaps are explicit reviewed mappings. Only metrics are emitted; no coupon text, prices, IDs or business facts enter generated Dart.
- Existing `CouponOfferBanner` now consumes these metrics using an intrinsic Column/min-height so narrow/large-text content can grow. Existing typed callbacks, eligibility and preview-only boundary remain.
- Python IR contract tests4/4, shared UI suite5/5 and changed Dart analyzer PASS. Native evidence/result is recorded in the project checkpoint after the AVD run. Full-page geometry/pixel certification and actual product route adoption remain separate.

Next batches: review R07work-card mapping against existing Rider presentation; map WD01 to existing web components/CSS, then widen the per-screen ledger. Do not emit Stack/Positioned for whole screens or claim all200boards generated from this initial3view slice.

AVD follow-up PASS:14native catalog screens captured after U26metric change; current U26image manually reviewed. Standard banner/layout remains readable; all-pixel equality is not claimed. Latest receipt `.omp/work/flutter-delivery-20261016/evidence/ui-catalog-20261021/receipt.json` pins the master and changed Dart fingerprints. AVD overrides restored; per-screen output paths overwritten, no scratch screenshots added.


## Direct implementation: R07 and WD01

`python3 tools/design/generate_surface_metrics.py` maps reviewed R07sheet/action bounds to Dart padding/radius/minimum action height and WD01two-card geometry to CSS variables. `--check` rejects stale IR/output. IR now retains native corner metadata. Outputs are styles only, with the canonical master SHA embedded.

`DriverFoodOfferCard` is used by actual FoodWorkPage. The existing frozen/deadline guard, exact integer money formatting, pickup coordinates, claim command and all5decline reasons remain in the owner. No map/ETA/countdown/recipient or paid-earning fixtures were added. The native R07component fixture and callback smoke PASS; scoped UI/navigation/realtime regressions22/22PASS. Dart has0errors/warnings and17existing brace-style infos. This does not renew API-backed acceptance after the refactor.

Pay checkout CSS now consumes WD01geometry variables. Browser measurement at1440matches native x96/872, widths744/472, gap32 and minimum680card heights;320Thai/enlarged-breakdown case has no horizontal overflow and frozen amounts remain aligned. Actual OrderBill component with fixture data, not complete Payment/wallet state. Two final screenshots reviewed and retained; root typecheck PASS. Receipts under `.omp/work/flutter-delivery-20261016/evidence/`: `rider-offer-ui-20261021/receipt.json`, `customer-bill-component-browser-20261021.json`. All-page pixel parity and genuine route/API acceptance remain open. OMP remains stopped.


Fresh joined verification: actual FoodWorkPage offer refusal now passes native→local API→SQL with a single SAFETY effect and no assignment/lease; paid seam is an explicit SQL fixture, not chain proof. Actual built Astro Payment route now passes canonical local order/API/SQL layout checks at1440/390/320, with zero payment attempts and verified fixture cleanup. Product changes: compact Rider deadline/connection details and readable Pay asset label/exact amount, technical denomination inside Payment details. Scoped Rider tests23PASS. See latest project checkpoint and evidence/dispatch077-offer-decline-avd-20261021.json, evidence/pay-layout-http-browser-20261021.json. Full UI/product acceptance remains open; OMP remains stopped.

### U35/U36/U37 commerce flow mapping —21 October2026

`python3 tools/design/figcraft_layout_ir.py --screens U35 U36 U37` extracts pinned native boards; `python3 tools/design/generate_commerce_metrics.py --check` verifies the shared138px hero,52px fields and82px rows against current native geometry before checking generated Dart. Reviewed responsive flow uses20px/1.5 hero copy,14px icon gap,9px label/field gap,38px group-field/member gap and100px multi-merchant row rhythm. These gaps are a reviewed mapping, not automatic recovery of native Auto Layout intent. All copy, membership, totals and callbacks remain caller supplied; generation emits geometry only.

Shared `feature_ui.dart` adopts mapped hero typography for commerce screens, separate Group name label with accessible input, and MultiMerchant card/note spacing. Focused390px widget geometry plus existing14screen TH/EN320/390/150% and state/selection suite7/7PASS; analyzer clean. This does not admit unavailable coupon/group/scheduling APIs or claim live group creation/reservations/multi-merchant checkout. Native render review recorded in checkpoint after actual runner completion.
