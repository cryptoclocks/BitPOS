# BitPOS product website

- Public: https://bitpos.cashlessthailand.com/
- GitHub: https://github.com/cryptoclocks/BitPOS-Website
- Vercel: https://bitpos-website.vercel.app/ — `cryptoclocks-projects/bitpos-website`
- Local: `/Users/cryptoclock/Desktop/BitPOS/marketing-site` — independent Git repository, not part of the merchant application build.

Vercel serves the static site independently of the Mac. This does not change the hosting/runtime dependency of merchant POS, checkout, database or firmware services.

## Development and publishing

In `marketing-site`: `npm ci`, `npm run build`, `npm run dev` (port 8891). Three.js is bundled locally by esbuild; build output is `dist`. Push this separate repository's main branch to deploy automatically. Do not bulk stage the parent BitPOS workspace or OMP changes. No service credentials or payment keys are required for this website.

## DNS

Cloudflare DNS-only CNAME `bitpos` → `7f4ba2b4e2dd580d.vercel-dns-017.com`. Scoped public ownership TXT `_vercel` was added using the Vercel project's requested verification value. Existing root, pos, pay, guide and other verification records were preserved. Vercel reported Valid Configuration and custom-domain HTTPS returned 200.

## Experience and assets

Purple/orange bilingual product website: cinematic hero; STL-derived rotatable Mini with canvas screen previews; order/pay/paid screen cycling; scroll-scrubbed Blender exploded assembly; café benefit panels with pilot-target counters; pitch and real field-trial videos inline with offscreen pause, muted autoplay, sound/fullscreen controls below the video; merchant workspace and roadmap links.

Asset provenance lives in `marketing-site/public/assets/asset-sources.json`. Model exported from existing BitPOS Blender assembly, whose enclosure derives from original STL. Sources in CryptoClock remain read-only. Viewer is an illustration, not an actual checkout. Video originals unchanged. Preview audio is opt-in; reduced-motion preferences stop automatic screen cycling and video playback. A static product poster remains without WebGL.

Benefit figures (20% repeat-visit uplift, 20% orders paid on Solana) are explicitly illustrative pilot targets, not measured results. Existing field trial is test USDG on devnet. AI, NFT loyalty, pickup and additional stablecoin features are described as development scope until verified separately. Marketing assets do not establish payment support.


2026-10-13 public refresh: website commit0a518c8 adds bilingual real Mini promotion proof while preserving existing videos and 3D sections. Public product evidence: https://github.com/cryptoclocks/BitPOS/blob/main/docs/PRODUCT_UPDATES_20261013.md . Gemini merchant-approved promotion is now evidenced on physical Mini; USDC/x402 and BitPOS USDT-test have devnet runtime evidence. NFT remains concept; Copilot widget remains a simulation. This supersedes the earlier blanket development label without claiming complete physical voice/pickup sound acceptance.
