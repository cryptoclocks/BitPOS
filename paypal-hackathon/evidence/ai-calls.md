<!-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md. -->
# Real AI calls (Café Copilot)

Every real model call made for this entry is listed here. Tests use a scripted model and make no AI calls.
Key: owner-provided Gemini API key, stored only in `~/.bitpos-paypal/gemini.env` (chmod 600, outside the repository; rotate after the hackathon).

| When (ICT) | Where | Model | Run | Result |
|---|---|---|---|---|
| 31 Oct ~20:42 | local fixture, `tools/paypal/copilot-live.ts` | `gemini-2.5-flash-lite` | `62df2097` | First model call refused: HTTP 404 "model no longer available to new users; use gemini-3.5-flash-lite". Run recorded as FAILED `PROVIDER_REJECTED`, no draft. Config switched to `gemini-3.5-flash-lite`. |
| 31 Oct ~20:43 | local fixture, US demo shop "BitPOS PayPal Café" | `gemini-3.5-flash-lite` | `61825619` | **DRAFTED in 4.2 s.** Intent "ขายครัวซองต์ที่เหลือ 8 ชิ้นก่อน 22:13 ลดไม่เกิน 10%". 4 model calls (request ids `fPDlavzz…`, `ffDlasKC…`, `fvDlauDa…`, `f_Dlaqiz…`), tools: read_merchant_limits + read_catalog_stock (parallel) → read_recent_sales (24 h: 0 sold) → validate_campaign (8 units, 10%, ends 22:13; server price USD 4.50 → 4.05, no violations) → save_campaign_draft (rationale in Thai citing stock and validation). Envelope `e8bc65c8` DRAFT. |
| 31 Oct ~20:43 | existing promotion generator (worker `runPromotionJob`) | `gemini-3.5-flash-lite` (OpenAI-compatible endpoint) | job `a598fd51` | SUCCEEDED: Thai headline/copy/rationale written for the draft; campaign DRAFT awaiting owner approval. |
| 31 Oct ~20:52 | local preview in the browser (owner clicked "Draft with Copilot") | `gemini-3.5-flash-lite` | `a003cdc9` | **DRAFTED.** Intent "Sell 12 cold brews before 10pm, max 15% off". First `validate_campaign` returned `END_TOO_LATE`; the model corrected the end time and the second validation passed (USD 4.50 → 3.83, 12 units, 4 per order). Generator wrote the copy. Approved, published, sold and settled — see `browser-e2e.md`. |

Observations: the model followed the tool order in the system prompt, called two read tools in parallel, chose `maxUnitsPerOrder` 4 (inside the shop limit), and did not exceed the owner's 10% or 8 units. No publish/charge/refund tool exists, so none could be called.
