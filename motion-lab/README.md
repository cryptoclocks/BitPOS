# BitPOS device motion prototype

Open index.html directly offline. All fonts, GIFs and sounds are local. Six interactive states and a guided sequence. Display geometry480×320. The QR panel is an icon-labelled allocation for the real live order QR, not a scannable payment. Sample USDG amount is illustrative and not a live quote. Clock shows actual browser Bangkok time. Browser animation is not hardware validation.

Visual direction: deep plum, orange accent, solid/vertical-gradient layers, large segmented clock digits, a breathing colon/orbit, downloaded coffee GIF; eased scene movement; native ring during verification; PAID ring sweep/check settle and12 particles for2.3sec then static receipt. No browser blur or shaders in the device study. Downloaded GIFs are bitmap assets and do not require emoji glyphs. Prototype SVG icon paths map to native line/arc primitives, not LVGL SVG support claims.

Sources: read-only BitTerm_006 page_status.cpp thank-you screen and welcome breathing motion; CryptoClock Pro design skill conventions adapted to user's BitPOS orange/purple identity. No original source modified. BitTerm's referenced levelup.mp3 is absent in that checkout. Prototype audio is the locally synthesized reward-unlocked cue from asset-pack, not a downloaded/copied MP3.

GIFs: Google Animated Noto Emoji, CC BY4.0, attribution and hashes in assets/gif/. Original512px and technically optimized128px candidates retained. 12fps64-color palette. Four128px files total about179KiB. At16-bit LVGL9.2 pinned9.2.2 decoder pixel allocation is81,920 bytes per128×128GIF plus gd_GIF structure and LZW overhead. Runtime limits and actual free PSRAM must still be checked.

Firmware handoff: .omp/work/device-motion-brief.md. Omp owns firmware implementation, actual SD mount/filesystem/GIF enablement, glyph mapping, private backup/device identity checks, app-only flash and physical render ACK measurements. Current product flow never treats a signature or preview animation as payment proof. Sound and one-shot effects should run only on newly accepted PAID, not snapshots, replay or navigation. Reduced-motion and missing-SD fallback retain clear status/amount.

`bitpos-motion-concept.mp4` is a recorded browser concept sequence with a locally synthesized success cue. It is explicitly labelled BROWSER CONCEPT and is not physical device footage.

## Checkout / Blink design revision

`blink.html` adds an English mobile order checkout and an Action metadata card study. Buttons only simulate local preview states. No wallet connection, Action endpoint, sign request, signature or on-chain verification is performed. Wallet/Blink hosts own their actual rendering. Real order checkout remains in apps/web; Actions/Blinks remain roadmap. Photos are copied from the existing cafe catalog; credits in assets/photos/PHOTO-CREDITS.md.

PAID layout v2: small left check, one-line heading, dominant amount, separate bottom receipt/order-ID strip. Firmware adaptation was sent to native omp; this prototype is not flashed-hardware evidence.
