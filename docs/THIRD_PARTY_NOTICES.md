# Third-party notices

Project-owned source code is licensed under [Apache-2.0](../LICENSE), with scope described in [NOTICE](../NOTICE). Logos, brand artwork and product illustrations are excluded from that grant.

This is a source/asset register, not a certification that every transitive dependency or presentation asset has been legally cleared.

| Material | Attribution / license | Evidence |
| --- | --- | --- |
| AXS15231B display driver | Espressif Systems; Apache-2.0 | Original SPDX/copyright headers in `device/firmware/components/display_engine/esp_lcd_axs15231b.{c,h}`; [license text](licenses/Apache-2.0.txt) |
| Sarabun font and generated glyphs | Sarabun Project Authors; SIL OFL 1.1 | `device/firmware/fonts/OFL.txt`, `team-guide/assets/fonts/OFL.txt` |
| Montserrat font | Authors identified in bundled notice; SIL OFL 1.1 | `team-guide/assets/fonts/Montserrat-OFL.txt` |
| DSEG fonts | keshikan; SIL OFL 1.1 | `team-guide/assets/fonts/DSEG-LICENSE.txt` |
| Cafe photographs | Individual Unsplash photographers; Unsplash License | [Per-photo credits](CAFE_PHOTO_CREDITS.md); photographs are not covered by a project source-code license |
| CryptoClock/Cashless foundations and existing illustration | Inherited material; ownership/permission must be confirmed by submitter | [Source history](SOURCE_PROVENANCE.md), `FIRMWARE_PROVENANCE.json`, `team-guide/assets/provenance.json` |
| JavaScript and firmware dependencies | Respective upstream authors and licenses | `pnpm-lock.yaml`, `device/firmware/dependencies.lock`; managed packages are not vendored as project-authored code |
| Flutter/Dart dependencies | Respective upstream authors and licenses | `apps/mobile-customer/pubspec.lock`, `apps/mobile-driver/pubspec.lock`; packages are fetched by `flutter pub get` and are not vendored |
| Inter and Noto Sans Thai fonts | The Inter Project Authors; Noto Project Authors; SIL OFL 1.1 | `apps/web/public/fonts/OFL-*.txt`, `packages/mobile_shared/assets/fonts/OFL-*.txt`, `design/figcraft/assets/fonts/OFL-NotoSansThai.txt` |
| Animated Noto Emoji GIFs | Google Noto Emoji; CC BY 4.0; resized/re-paletted only | `motion-lab/assets/gif/ATTRIBUTION.md`, `motion-lab/assets/gif/sources.json` |
| Lucide icons | Lucide Contributors; ISC (portions Feather, MIT) | `asset-pack/third-party/LUCIDE-LICENSE.txt` |
| Solana logos | Solana Foundation trademark assets under its brand guidelines, not a software license | `asset-pack/third-party/SOLANA-USAGE.md` |
| Menu and motion photographs | Individual Unsplash photographers; Unsplash License | `asset-pack/menu/PHOTO-CREDITS.md`, `motion-lab/assets/photos/PHOTO-CREDITS.md` |
| Diagram renderer style (pele) | kepano; MIT | `docs/diagrams/bitpos-20261024/pele-LICENSE.txt` |
| Customer food-app UI reference | Tarikul711/flutter-food-delivery-app-ui has no license; used only as an information-architecture reference. Its screenshots and source are not included | `design/figcraft/assets/provenance.json` |

### Direct dependencies added after the 13 October submission

Licenses were checked against each installed package's manifest and LICENSE file, or the upstream repository where the package ships none.

| Package | Version | License | Copyright / source |
| --- | --- | --- | --- |
| `@noble/curves` | 1.9.7 | MIT | Paul Miller; github.com/paulmillr/noble-curves |
| `@x402/core`, `@x402/svm` | 2.28.0 | Apache-2.0 | x402 Foundation; github.com/x402-foundation/x402 (no LICENSE in the npm tarball) |
| `sharp` | 0.35.5 | Apache-2.0 | Lovell Fuller and contributors; github.com/lovell/sharp |
| `@img/sharp-libvips-*` (installed by `sharp`) | 1.3.4 | LGPL-3.0-or-later | libvips; prebuilt shared library downloaded at install time, not redistributed by this repository |
| `@solana-program/token`, `token-2022`, `compute-budget` (via x402) | 0.9.0 / 0.6.1 / 0.11.0 | Apache-2.0 | Solana program clients |
| `flutter_map` | 8.3.2 | BSD-3-Clause | the flutter_map authors and maintainers |
| `geolocator` | 14.1.1 | MIT | Baseflow |
| `flutter_secure_storage` | 11.2.0 | BSD-3-Clause | German Saprykin |
| `image_picker`, `path_provider`, `url_launcher` | 1.2.2 / 2.1.6 / 6.3.3 | BSD-3-Clause | The Flutter Authors |
| `crypto`, `http` | 3.0.7 / 1.6.0 | BSD-3-Clause | the Dart project authors |
| `firebase_core`, `firebase_messaging`, `firebase_messaging_platform_interface` | 5.0.0 / 17.0.0 / 4.11.0 | BSD-3-Clause | The Chromium Authors |
| `uuid` | 4.6.0 | MIT | Yulian Kuncheff |
| `cupertino_icons` | 1.0.9 | MIT | Vladimir Kharlampidi |

Transitive JavaScript packages added with these dependencies are MIT or Apache-2.0 (`pnpm licenses list --prod`).

Original notices must remain intact. Project licensing excludes third-party materials covered by their own terms. BitPOS, Phantom, Solana, USDG and other names/logos do not imply endorsement; no trademark rights are granted. Do not add unlicensed music, GIFs or identifiable-person footage to the submission video. A photo license alone may not cover separate publicity, trademark or depicted-artwork rights.

Separate presentation folders/ZIPs are not this repository's verified runtime evidence. Review their images, audio and permissions before submitting them.
