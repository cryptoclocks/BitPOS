# BitPOS OCI runtime

The production deployment compose file, host paths and operations scripts are kept privately by the project owner and are not part of this public repository. `infra/oci/Dockerfile` and the Python proxies in `infra/oci/` show how the application image and public boundaries are built. It reuses the single existing dedicated BitPOS Supabase installation.

## Private prerequisites

Provision the application environment (database/auth loopback URLs, app secret and devnet RPC), the devnet fee sponsor key, optional evaluation logins and the tunnel credential with mode 600 in an owner-only directory outside any repository or image build context.

The app image uses Node 24 and frozen pnpm dependencies. All listeners are loopback-only; Cloudflare Tunnel provides public HTTPS/WSS. Containers restart unless stopped. Stop the previous worker and named tunnel connector before cutover to avoid two active deployment owners.

## Host routing

| Host | Local origin | Boundary |
| --- | --- | --- |
| pos.cashlessthailand.com | 127.0.0.1:4324 | Merchant website and authenticated API |
| pay.cashlessthailand.com | 127.0.0.1:4323 | Customer capability URLs and assets only |
| guide.cashlessthailand.com | 127.0.0.1:4325 | Allowlisted offline-guide assets only |
| device.cashlessthailand.com | 127.0.0.1:3001 | Tunnel path regex `^/api/device$`, Bearer-authenticated WebSocket |

Keep service credentials outside images and build contexts. Python public proxies do not log requests or capabilities. Node containers have 768 MiB memory limits; proxies 128 MiB; tunnel 256 MiB. Application logs rotate at 10 MiB, three files.

Public role shortcuts are an explicitly authorized devnet evaluation feature. Keep them disabled for a hardened merchant deployment; `NODE_ENV=production` disables them. This deployment does not authorize mainnet or production funds.

## Physical terminal

Firmware 0.3.6 converts the previously pinned private LAN endpoint to `wss://device.cashlessthailand.com/api/device` in memory, retaining the existing Bearer credential and all NVS payment deduplication. Other configured WSS endpoints retain their configured value. Use the identity-checked app-only installer after a private backup; never erase NVS or flash all partitions.

The terminal still needs a compatible 2.4 GHz WiFi network and power. A hotspot must match its configured network or the terminal must be provisioned for that hotspot. WSS removes dependence on the Mac's LAN address.

## Acceptance

Verify all public hosts after stopping Mac runtime services; authenticate all three roles, reject foreign-origin shortcut requests, check customer/guide/device route separation, and verify a finalized sponsored devnet payment and the assigned physical render ACK. Check Done releases that device and returns the product carousel. Retain failed/slow observations. Do not equate a web status or firmware build with a physical render.
