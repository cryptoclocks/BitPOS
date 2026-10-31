<!-- PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md. -->
# Deploy the PayPal edition to OCI (runbook)

Status: the owner approved deploying on **31 Oct 2026**, before the Meta deadline, on the shared host. Every step that touches OCI, Cloudflare or the PayPal dashboard still needs the owner's go-ahead at the time, and only project `bitpos-paypal` and migrations `400`–`405` may change.

## What gets deployed

| Piece | Where | Notes |
|---|---|---|
| Front (path router) | `bitpos-paypal-front-1`, `127.0.0.1:3103` | where the tunnel sends both PayPal hostnames |
| API (PayPal edition) | `bitpos-paypal-api-1`, `127.0.0.1:3104` | `tools/paypal/server.ts`; refuses to start unless PayPal is Sandbox |
| PayPal worker | `bitpos-paypal-worker-1` | webhook inbox, checkout reconcile, ends Copilot offers. **No** Solana, expiry or promotion lanes (the existing runtime worker runs those for every shop) |
| Web (prebuilt) | `bitpos-paypal-web-1`, `127.0.0.1:4361` | Astro build for `https://paypal-pos.cashlessthailand.com`, proxies its allow-listed `/api` routes to 3104 |
| Database | existing `bitpos-staging-db-1` | migrations `400`–`405` only, one transaction |
| Demo shop | merchant `70707070-7070-4070-8070-707070707070` "BitPOS PayPal Café" | **not** `33333333-…`, which is Meta's Muse Café on this database |

Compose project `bitpos-paypal` (`infra/paypal/compose.yaml`) uses the runtime image pinned once as `bitpos-paypal-base:pinned`. No image is built and nothing is pruned. The scripts never touch `bitpos-runtime-*`, `bitpos-meta-*`, `bitpos-staging-*` or `ccp-*`.

## Steps

Set once in the shell (the host and key live only on the owner's Mac):

```bash
export OCI_HOST=ubuntu@<host> OCI_SSH_KEY=<path to key>
```

1. **Private PayPal env on the host.** Values are taken from the Mac's private file and never printed:

   ```bash
   { grep -E '^PAYPAL_(ENVIRONMENT|API_BASE_URL|CLIENT_ID|CLIENT_SECRET|MERCHANT_ID)=' ~/.bitpos-paypal/paypal-sandbox.env; echo PUBLIC_URL=https://paypal-pos.cashlessthailand.com; echo BITPOS_CUSTOMER_PUBLIC_URL=https://paypal-pay.cashlessthailand.com; } | ssh -i "$OCI_SSH_KEY" "$OCI_HOST" 'umask 077; mkdir -p ~/bitpos-private/paypal ~/bitpos-paypal; cat > ~/bitpos-private/paypal/paypal.env'
   ```

2. **Preflight** (does not touch running services or the database). It uploads the source to `~/bitpos-paypal/preflight` and runs one throw-away container with no network:

   ```bash
   tools/paypal/deploy-oci.sh
   ```

   It checks:
   - disk space (at least 3 GB free) and the image;
   - ports 3103 and 4361 are free;
   - the env file is mode 600 and has every key (key names only, never values);
   - the state of the other stacks;
   - the ledger for migrations 400–405;
   - that every imported package resolves inside the image.

   Expect "migration … not applied" on the first run.
3. **Backup** with the coordinator tool. Run it from the main checkout:

   ```bash
   cd ~/Desktop/BitPOS && python3 tools/runtime/backup-bitpos-db.py
   ```

4. **Migrations.** Run the script without arguments first to list what it would apply, then apply with the backup file:

   ```bash
   tools/paypal/migrate-oci.sh
   ```

   ```bash
   tools/paypal/migrate-oci.sh --apply --backup ~/Desktop/BitPOS/local/private/db-backups/<file>
   ```

   - All missing files go in one transaction with `lock_timeout` 5 s, and each is recorded in `public.bitpos_migrations` with its sha256.
   - It stops if the live `bitpos.unpaid_order_safe` is no longer the 055 version (401 extends that function).
   - Rehearsed on a scratch copy of every earlier migration: all six applied in one transaction and created 10 `paypal_*` tables.
5. **Deploy:**

   ```bash
   tools/paypal/deploy-oci.sh --apply
   ```

   - Preflight runs again first.
   - The source and web are swapped in atomically, then only `bitpos-paypal` starts.
   - Health checks: `/api/pay/<x>/paypal` returns 404 JSON, the web `/` returns 200, and a webhook POST returns 400 (503 until the webhook id is set).
   - If unhealthy, the previous source is restored.
   - The script confirms the other containers are unchanged.
6. **Seed the demo shop.** Run this inside the PayPal API container; it only touches merchant `70707070-…`:

   ```bash
   ssh -i "$OCI_SSH_KEY" "$OCI_HOST" 'docker compose -p bitpos-paypal -f ~/bitpos-paypal/compose.yaml exec -e BITPOS_PAYPAL_SEED_TARGET=oci api node --import tsx tools/paypal/seed-demo.ts shop'
   ```

7. **Demo owner for judges.** The random password goes only to `~/bitpos-private/paypal/demo-owner.json` (mode 600) on the host. The owner copies it into the Devpost testing instructions; it is never written into the repository.

   ```bash
   ssh -i "$OCI_SSH_KEY" "$OCI_HOST" 'bash -s' < tools/paypal/create-demo-owner.sh
   ```

8. **Cloudflare tunnel.** Nothing to change. The existing tunnel already sends `paypal-pos.cashlessthailand.com` and `paypal-pay.cashlessthailand.com` to `127.0.0.1:3103` (checked 31 Oct). That port is the PayPal front (`tools/paypal/front.ts`), which routes by path:
   - `POST /paypal/webhooks` → API `3104` (raw body unchanged)
   - the `/api/device` WebSocket (BitPOS Mini) → API `3104`
   - everything else → web `4361`
9. **Webhook.** In the sandbox app "BitPOS PayPal Cafe US", add the webhook URL `https://paypal-pay.cashlessthailand.com/paypal/webhooks` with these events:
   - `CHECKOUT.ORDER.APPROVED`
   - `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`
   - `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`

   Then append `PAYPAL_WEBHOOK_ID=…` to the host env file and run `tools/paypal/deploy-oci.sh --apply` again. That restarts only `bitpos-paypal`.
10. **Verify on the hosted demo:**
    - `https://paypal-pos.cashlessthailand.com` signs in with the demo owner.
    - A real sandbox payment shows as PAID / SETTLED in the Ledger.
    - The webhook arrives: the API logs show a 200 for `/paypal/webhooks`, and the inbox row has `processed_at` set.
    - `pay.` and `meta-pay.` still answer 200.
    - Record the results in `paypal-hackathon/evidence/`.

## BitPOS Mini for the PayPal shop (needed before judges can order at a table)

Table and counter orders are routed to the shop's screen. The API refuses a bill while that screen is offline (`DEVICE_OFFLINE`), so the hosted shop needs a real Mini. The decision is to use a real Mini.

**Why the Mini connects to the PayPal API.** The firmware takes its pay/QR origin and table link from the server's `CONFIG` (`paymentOrigin` = the API's customer origin). Connected to the PayPal API (`wss://paypal-pos.cashlessthailand.com/api/device`), the Mini's QR codes open the **PayPal** pay page. Connected to the main API, they would open the Solana page. No firmware change is needed: the firmware accepts any `wss://` endpoint and any `https://` pay origin. Checked locally with `tools/paypal/device-config-check.ts` against the PayPal API: CONFIG gives the PayPal web origin for both the pay and table links.

Steps (after deploy and seed):

1. **Issue the device credential on the host.** It goes into a private file only; the token is never shown:

   ```bash
   ssh -i "$OCI_SSH_KEY" "$OCI_HOST" 'umask 077; docker compose -p bitpos-paypal -f ~/bitpos-paypal/compose.yaml exec -T -e BITPOS_PAYPAL_SEED_TARGET=oci api node --import tsx tools/paypal/device-credential.ts "Terminal Table 2" > ~/bitpos-private/paypal/mini-table2.json'
   ```

2. **Copy it to the Mac's private folder** (mode 600, not displayed):

   ```bash
   (umask 077; scp -i "$OCI_SSH_KEY" "$OCI_HOST:bitpos-private/paypal/mini-table2.json" ~/Desktop/BitPOS/local/private/paypal-mini-table2.json)
   ```

3. **Check what the Mini will get, before flashing.** Expect `paymentOrigin` `https://paypal-pay.cashlessthailand.com`:

   ```bash
   pnpm exec tsx tools/paypal/device-config-check.ts ~/Desktop/BitPOS/local/private/paypal-mini-table2.json
   ```

4. **Provision the board** with the existing coordinator tool in the main checkout (`tools/firmware/provision.py --device-config local/private/paypal-mini-table2.json`, dry run first, then `--write`). Two constraints of that tool decide which board to use:
   - It is pinned to one board: MAC `14:c1:9f:4e:62:48` and its original full-flash backup.
   - It refuses a board whose BitPOS NVS already holds state. This protects paid-order sound dedup.

   So the café board that is already provisioned cannot be reused by this tool. A second board needs its own install and backup first, plus `provision.py` extended to its MAC and backup.
5. Power the Mini on the café Wi-Fi.
   - In **PayPal · Copilot → Send to all screens**, it should show as online and supported.
   - A table order shows a QR that opens `https://paypal-pay…/pay/…`.
   - Record the result in `evidence/`.

## Rollback

- **Code:** `docker compose -p bitpos-paypal -f ~/bitpos-paypal/compose.yaml stop` (this project only). Or swap `src.old`/`web.old` back and restart this project.
- **Database:** 400–405 are additive.
  - To switch PayPal off: `UPDATE bitpos.paypal_merchant_settings SET enabled=false`.
  - The only trigger on a pre-existing table is `paypal_block_solana_attempt` on `payment_attempts` (drop it if needed).
  - Never restore the whole schema: it would overwrite Meta's and Solana's data.
- **Tunnel:** no PayPal-specific routes were added. Stopping project `bitpos-paypal` makes both PayPal hostnames return 502.
