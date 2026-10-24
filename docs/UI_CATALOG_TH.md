# BitPOS presentation UI catalog

21 October 2026. UI-first work; full product/backend scope remains active.

## New presentations

| Surface | IDs | Source |
|---|---|---|
| Customer food | U26/U35/U36/U37 | `packages/mobile_shared/lib/presentation/feature_ui.dart` |
| Customer passenger | U39–U43 | `packages/mobile_shared/lib/presentation/ride_ui.dart` |
| Rider passenger | R27–R31 | same shared ride presentation |
| Pay coupon | W22 mobile + desktop adaptation | `apps/web/src/components/CouponSelection.tsx` |

All15 previously missing/unjoined boards now have presentation code. This does not mean full visual parity, production route integration or backend capability. Other existing screens still require current visual acceptance.

## Open locally

From `apps/mobile-customer` or `apps/mobile-driver`:

```sh
/Users/cryptoclock/development/flutter/bin/flutter run -d emulator-5554 --dart-define=BITPOS_UI_CATALOG=true
```

The ordinary root is retained unless the compile-time catalog flag is enabled. No API client, payment, GPS, message sending or dispatch operation is instantiated by the catalog. Passenger screens are later-phase presentations. Use the catalog language action and UI-state menu to inspect Thai/English and ready/loading/empty/error/offline.

For the Pay component, start a local dev server from repository root on a free loopback port:

```sh
pnpm exec astro dev --root apps/web --host 127.0.0.1 --port 4324
```

Open `/dev/ui-coupons`. This route returns404 outside development mode. The preview selection cannot redeem a coupon or change a canonical checkout quote.

## Verification and evidence

- Shared catalog tests5/5 PASS:14screens × TH/EN ×320/390 ×150%text, all4fallback states, coupon/PIN action gating and selected vehicle/fare retained across preview navigation.
- New shared presentation/analyzer clean. App root analyzers no errors/warnings; existing brace-style infos remain.
- Android AVD renders all14 new native presentations; final screenshots retained under `.omp/work/flutter-delivery-20261016/evidence/ui-catalog-20261021/`. Manual review prompted token/white-card/hero/navigation corrections; rerun PASS. No automated whole-page pixel-equality claim.
- W22 component browser test PASS at320/390/1440; selection gated and preview does not redeem. Mobile/desktop screenshots retained in the same evidence folder. Component fixture proof, not the full Astro dev route or production checkout.
- Root TypeScript noEmit and diff-check PASS. AVD resolution/density reset. Temporary contact sheets deleted after review; retained per-screen images are review evidence.

## Still required to close UI

Match all existing/requested Customer/Rider/POS/Pay compositions against FigCraft, reconcile missing states/controls, verify genuine navigation entry points, check desktop/mobile separately, and keep a reviewed per-screen acceptance ledger. Newly generated layouts remain approximate where specified; map artwork is explicitly schematic. Do not use catalog completion as proof of backend integration or payment/dispatch completion.
