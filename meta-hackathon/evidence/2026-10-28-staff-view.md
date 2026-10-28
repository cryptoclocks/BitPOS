# 2026-10-28 — Staff view of tap orders (`/meta/staff`)

## What it is
- Address: `https://pay.cashlessthailand.com/meta/staff`. It is served by the `bitpos-meta` container.
- The POS web app on `pos.cashlessthailand.com` and the `bitpos-runtime` containers were not touched. Another stream is deploying the Solana hackathon work there, and no new route was added on the `pos.` host.
- Staff sign in with their POS account, through a Supabase Auth password grant against the existing Auth service.
  - The account must have exactly one membership whose role is owner, manager or staff.
  - The role is re-read from `members` on every request, so removing a member ends access immediately.
- Demo quick sign-in buttons (owner, manager, staff) use the same private demo accounts file as the POS demo. It is mounted read-only.
- Session cookie `bitpos_meta_staff`: HttpOnly, `SameSite=Strict`, `Path=/meta/staff`, Secure, 8 hours. Sessions live in the meta-owned table `meta_staff_sessions`; the inherited POS `sessions` table is not written.
- The list shows the last 24 hours of tap orders. Paid orders that are not yet handed over come first.
  - Each row: pickup code, product, amount, and status (paid via webhook or lookup, waiting for payment, or expired).
  - A row warns when stock was short in the system.
  - "Handed over" works only on paid orders, works once, and records who pressed it.
  - No Messenger identity (PSID) is shown to staff. The page refreshes every 10 s.
- The customer's paid page now shows the same pickup code.
- Every POST must come from the same origin. Sign-in is limited to 10 attempts per client IP per 10 minutes.

## Migration 305 (OCI)
- Backup first: `bitpos-20261028T061948Z.dump` (75,371,469 bytes, sha256 `a4e7a842…1a127d`, archive list verified).
- Ran a dry run that ended in ROLLBACK, then applied in one transaction with a ledger row.
  - Adds `meta_staff_sessions` (RLS by tenant), plus `handed_over_at` and `handed_over_by` on `meta_tap_orders`.
  - Adds the tenant lookup function `meta_staff_session_merchant`.
- Before and after: merchants, products, orders, devices and the non-meta ledger are unchanged, and the orders digest `e120cf05…` is unchanged. Tables went from 283 to 284.

## Validation
- Meta tests 43/43, including 3 new staff tests on PostgreSQL under RLS:
  - wrong password, no membership, and invalid input never reaching Auth
  - another shop's order invisible; hand-over refused for unpaid orders, works once, records who
  - access ends when the membership is removed, and on sign-out
  - cookie attributes, cross-origin and `Origin: null` POSTs refused, no PSID in the HTML
- `tsc` passes.
- Live on OCI: the "Staff" quick sign-in against the real Auth service returned 303 to the list, which showed `#D901 🥛 ลาเต้ Latte · $4.00 ✅ Paid 12:59 (Stripe webhook)` with a "Handed over" button. It was left unpressed for the owner's demo.
