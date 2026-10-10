# Source provenance and development history

BitPOS is a standalone product built by Natthapong Suwanjit. Its public Git history begins on 7 October 2026. This document distinguishes prior foundations from the work submitted for Crypto World's Fair (14 September–12 October 2026).

## Pre-existing foundations

- **CryptoClock Pro:** ESP32-S3 board pin definitions, AXS15231B QSPI display and touch foundations. The copied source files and reference hashes are listed in [firmware provenance](FIRMWARE_PROVENANCE.json). Original CryptoClock services and workspace are not required to build BitPOS and were not modified for this product.
- **Cashless Thailand POS:** earlier merchant interface, role and feature-inventory references informed the product. The source snapshots inspected were `d35d4c2` and `ac673c3`; they are prior work, not claimed as new competition output. Full legacy POS parity is not implemented in BitPOS.
- **Brand and visual references:** existing BitPOS product artwork and CryptoClock design references predate this submission. The legacy terminal illustration is not evidence of the new terminal runtime.
- **Third-party foundations:** Solana libraries/protocols, Astro, React, Elysia, PostgreSQL/Supabase, ESP-IDF and LVGL remain attributable to their respective authors.

## BitPOS work during the competition

The new standalone repository includes merchant/customer interfaces, table QR ordering, register-to-device pairing, immutable order routing, versioned quotes, sponsored sandbox USDG transaction construction and verification, finalized settlement, inventory reservations, recovery, durable device delivery, authenticated render acknowledgments and standalone terminal application/provisioning. OCI deployment and physical verification are recorded in [acceptance evidence](DEPLOYMENT_ACCEPTANCE.md).

Use the Git history and source files to inspect these changes. Existing hardware and foundational drivers are not claimed as newly invented hardware. Presentation mockups, generated artwork and test fixtures do not establish implemented features.

## Tools and assets

AI-assisted coding and design tools were used during development. Human product direction and review remain with the submitting builder. Generated concepts are separate from native terminal framebuffer evidence. Cafe product photographs are downloaded Unsplash photographs, with credits in [the photo register](CAFE_PHOTO_CREDITS.md).

## Scope and rights

See [third-party notices](THIRD_PARTY_NOTICES.md). A public repository alone does not grant an open-source license. Any license applied to project-owned work does not replace third-party licenses, grant trademark rights, or establish ownership of prior third-party material. The submitter must confirm rights to inherited code/artwork and disclose relevant prior development in the submission form itself.

Historical Thai planning notes remain in the repository for traceability; this English document is the current reviewer-facing disclosure.
