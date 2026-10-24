# BitPOS asset pack
Prepared on 2026-10-08 for POS, customer web, counter-screen concepts and video handoff. All new preparation lives in BitPOS. No runtime changes, mint, deploy or flash performed as part of this pack.

Open `index.html` offline to browse.

- brand/: transparent master logo, brand tokens and provenance.
- icons/: 50 sourced Lucide SVG icons, unchanged, 24×24/currentColor. ISC/MIT notice included.
- menu/: 12 real cafe photos, source credits and catalog reference.
- collectibles/: 5 original imagegen cafe reward artworks, square masters. Artwork only, not minted.
- metadata/: download source records, exact generation prompts, local mint drafts and mint handoff notes.
- states/: inherited Thai interface concepts and 12 editable English 480×320 concepts plus PNG exports. Not screenshots of working hardware.
- audio/: 6 original cues with web and device-format WAV variants. Playback integration pending.
- video/: editable opening/closing/flow/roadmap cards, PNG exports, transparent lower third and Thai shot list.
- fonts/: portable font sources and licenses. Generate firmware fonts for required glyphs.
- third-party/: official Solana brand artwork and usage notes. No fabricated Phantom/USDG logos.

## Integration rules
Images do not prove payment or reward entitlement. Generate QR from live order URL. Keep signed challenges, verifier, outbox and duplicate-sound prevention. Device concept PNGs are 480×320, but decode memory/LVGL conversion must be validated before firmware integration. Firmware raw RGB565 frame budget: 307,200 bytes for a 480×320 image. SVG is a web source, not a direct firmware asset.

Manifest lists file hashes, dimensions, provenance and readiness. Source attribution/licensing is included; trademark rules remain separate from open-source licenses. No live customer records, keys or credentials are packaged.
