<!-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md. -->
# 31 Oct 2026 — PayPal edition deployed to OCI

The owner approved deploying before the Meta deadline. Times are ICT.

| Step | Result |
|---|---|
| Read-only check | disk 20 GB free (90 % used), ~7 GB RAM available; runtime, Meta, staging and ccp containers running |
| Private env | `~/bitpos-private/paypal/paypal.env` written over SSH from the Mac's private file (mode 600; only key names shown) |
| Preflight | all checks passed except the expected missing migrations; 229 imports resolve inside the pinned runtime image |
| Backup | `bitpos-20261031T161312Z.dump`, 104 MB, archive list verified (coordinator tool) |
| Migrations | 400–405 in one transaction, `lock_timeout` 5 s, recorded with sha256; live `unpaid_order_safe` was the 055 version; 10 `paypal_*` tables |
| Existing sites after migration | `pos.` 200, `pay.` 302, `meta-pay.` 200, `meta-pos.` 200 |
| Deploy | project `bitpos-paypal`: front 3103, API 3104, worker, web 4361, on `bitpos-paypal-base:pinned` (`sha256:9887bcf8e790…`); health OK; other containers unchanged |
| Tunnel | no change: both PayPal hostnames already reached `127.0.0.1:3103`; the new front routes webhooks and `/api/device` to the API and pages to the web |
| Public | `https://paypal-pos.cashlessthailand.com/` 200 (POS), `https://paypal-pay.cashlessthailand.com/` 200 |
| Demo shop | `70707070-…` seeded (6 sample products, Table 1/2, Counter, Terminal Table 2); owner `owner@paypal-cafe.test` created (password only in `~/bitpos-private/paypal/demo-owner.json`); sign-in checked through the API |
| Café Copilot on OCI | First run FAILED `PROVIDER_RESPONSE_INVALID`: `gemini-2.5-flash-lite` (runtime model) returned an empty turn after a tool result. Second run NEEDS_INPUT: the model wrote reasoning text instead of a tool call. Both fixed (empty turns tolerated; function calling mode ANY with an `ask_owner` tool), tests added, redeployed. Third run **DRAFTED in 3.5 s** (run `be733ed0`): limits → stock → validate (`END_TOO_LATE`, corrected) → save. The runtime worker then wrote the offer copy (job SUCCEEDED). |

| Webhook (owner approved) | Registered through the sandbox REST API from inside the PayPal API container: `https://paypal-pay.cashlessthailand.com/paypal/webhooks`, id `6VF6543551710091K`, 7 events (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`/`PENDING`/`DENIED`/`DECLINED`/`REFUNDED`/`REVERSED`). The id was added to the host env and the project redeployed: an unsigned POST now returns 400. |
| Webhook simulator | `PAYMENT.CAPTURE.COMPLETED` via `/v1/notifications/simulate-event` (202). The event `WH-58D329510W468432D-…` arrived through Cloudflare → front → API, its signature verified offline, and it was stored and processed: 1 delivery, `processed_at` set, no error. No effect, because its `custom_id` is not a BitPOS checkout. Simulator events are not payment proof. |

Not done yet:
- BitPOS Mini for the shop. Until it is online, table orders are refused with `DEVICE_OFFLINE`, so no hosted PayPal payment has been made yet.
