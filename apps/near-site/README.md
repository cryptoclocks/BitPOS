# BitPOS Living Bill — NEAR edition (presentation site)

NEAR HACKATHON work (2026-11-14). See `near-hackathon/PROVENANCE.md`.

Static, English-only presentation site intended for https://near.cashlessthailand.com.
No build step, no external CDNs, fonts, analytics or scripts. All assets are self-hosted in `assets/`.

## Preview locally

From the repository root:

```sh
python3 -m http.server 8892 --directory apps/near-site
```

Then open http://localhost:8892/.

## Contents

- `index.html` — the page
- `style.css` — styles (NEAR theme: #0B0F1A / #111827, accent #00EC97)
- `app.js` — minimal JS: nav highlight, mobile menu, reveal on scroll, video play/unmute, screen lightbox
- `favicon.svg`
- `assets/img/` — BitPOS logo (from the BitPOS marketing site) and images from `docs/near-images/` resized to at most 1600 px wide
- `assets/video/living-bill-en.mp4` — copy of `BitPOS-Motion/renders/BitPOS-NEAR-Living-Bill-EN.mp4`
- `assets/fonts/` — Montserrat variable font (SIL OFL, license included), copied from the BitPOS marketing site

Photos labelled "Product visualization" are concept renders. Screens are real captures from the running app on NEAR testnet. Test money only.
