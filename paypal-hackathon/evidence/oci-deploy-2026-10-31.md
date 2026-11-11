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

| Quick sign-in | Owner, manager and staff buttons, as on the Solana and Meta demos. `demo-auth` opts in `paypal-pos` separately, bound to the PayPal shop and its `@paypal-cafe.test` accounts. Manager and staff were created; the existing owner was reused. Passwords are only in `~/bitpos-private/paypal/demo-login-paypal.json`. Checked through the public site: all three roles sign in to `70707070-…`; the same POST from the `paypal-pay` origin is refused with 403; the Solana demo's quick sign-in is unchanged. In the browser, Staff signs in and Café Copilot shows "Owner or manager only". |

Not done yet:
- BitPOS Mini for the shop. Until it is online, table orders are refused with `DEVICE_OFFLINE`, so no hosted PayPal payment has been made yet.

## 11 Nov 2026 — simulated screens (commit dac74646)

The organizer's note said the entry did not appear to use the PayPal developer platform. One cause: judges could not pay on the hosted demo, because table bills need an online screen and no Mini was plugged in. The owner approved a clearly labelled simulated screen.

- `deploy-oci.sh --apply`: preflight passed. The new service `bitpos-paypal-sim-screen-1` started, health was 404/200/400 as expected, and other stacks were unchanged.
- The credentials were issued with `device-credential.ts --simulated` into `~/bitpos-private/paypal/sim-screen/{table2,counter}.json` (mode 600, folder 700). The tokens were never displayed. The devices are now labelled "Terminal Table 2 (simulated)" and "Counter screen (simulated)".
- The database shows both devices online and idle.
- **Hosted table run, built-in browser:**
  - opened the Table 2 link on `paypal-pay.cashlessthailand.com`;
  - added a croissant, reviewed and confirmed;
  - the PayPal pay page appeared: "PayPal Sandbox — test money only", **Pay with PayPal · USD 4.50**.
  - The PayPal popup approval needs a person with a Sandbox buyer account.
- **Local fixture run of the same path:**
  - the simulator ACKed the new bill (`AWAITING_WALLET v1`);
  - a test-only PAID update (the same method as `tests/backend-device.test.ts`) produced `PAID v2`;
  - the simulator sent `ORDER_DISMISS` 5 s later (20 s on OCI), the server accepted it, and the screen returned to `idle` while staying online.

## 11 Nov 2026 — incident: playlist flip-flop on the shared database (found, stopped, fixed)

**What happened.**
- At 21:29 UTC on 10 Nov an approved Copilot offer was sent to "all screens" while the simulated Table 2 screen was connected.
- The shared `bitpos-runtime` worker (customer origin `pay.cashlessthailand.com`) and the PayPal API (`paypal-pay.cashlessthailand.com`) both rebuilt that screen's promotion playlist. The menu link and image URL carry the origin, so each process saw the other's playlist as changed.
- Each pass bumped the generation and emitted a new CONFIG, about 70 per minute.
- The server then dropped the socket roughly every minute (1008 Resynchronize). Every reconnect copies all of the device's outbox events into `device_event_deliveries` as `superseded`.
- By 03:40 UTC on 11 Nov this had produced 12,268 outbox events and **13.9 million delivery rows (~4 GB)** for that one demo device. The host disk was at 97%.

**Response.**
- 03:41 UTC: the `sim-screen` service was stopped and growth stopped. No other stack was touched.
- With the owner's go-ahead, only the `superseded` delivery rows of that demo device were deleted (13.39 M rows; `rendered`/`sent` rows and every outbox event kept), followed by a plain `VACUUM (ANALYZE)` with no table lock.
- Disk usage is unchanged (97%). Postgres reuses the freed space, so the table does not grow further.

**Fix (commit dd993272).**
- `BITPOS_SHARED_PLAYLIST_ORIGIN=https://pay.cashlessthailand.com` in the private PayPal env: the PayPal API builds playlists with the shared worker's origin, so both agree. Unset means unchanged behaviour.
- `sim-screen` declares the firmware's promotion capabilities once per connection and ACKs promotion frames.
- `sim-screen` has a circuit breaker: more than 6 CONFIGs per minute, or more than 15 connections in 30 minutes, pauses that screen for 10 minutes.

**Verification.**
- Locally the flip reproduced and the breaker tripped.
- On OCI after the fix, with the offer sent to both screens: both report RENDERED, and Table 2's playlist generation moved once (20922 → 20923).
- Over the next 30 minutes: 7 CONFIGs, versus about 2,100 per hour before, and no disconnects other than the deploy restart.

**Known limit.** With a real Mini, offer QR links in the playlist open `pay.cashlessthailand.com`. A full fix needs the shared worker to use per-shop origins, which is outside this entry.
