# 2026-10-28/29 — Messenger visuals and table booking by chat

## Messenger visuals
- **Menu card carousel**: a generic template with up to 10 square cards.
  - Each card shows the product photo (served from `pay.cashlessthailand.com/images/menu/*.jpg`), name, price, and the offer with its normal price.
  - The "สั่ง / Order" button quotes the item at once, with no model call.
- **Quote card**: photo, item × quantity = server total, offer badge, "Stripe sandbox" label, then Pay and Menu buttons.
- **Receipt**: Messenger receipt template (item, quantity, price, total, pickup code as the order number, "Stripe sandbox (test mode)"). If Messenger refuses the template, the same facts are sent as text.
- **My orders**: chat orders and bookings with status.
- **Persistent menu** (always visible, like a LINE rich menu), set with `tools/meta/messenger-profile.ts`; Graph result `success`:
  - 📋 Menu
  - 🧾 My orders
  - 🗓️ Book a table
  - 🎙️ Voice order (web view)
  - 🔌 Forget me

## Table booking (migration 309)
- **How the customer asks**: in their own words, in the same message flow as ordering.
  - Muse Spark's step gains `book` with bookingDate, bookingTime and partySize (structured; one call per message, within the per-customer cap).
  - A free matcher understands "จองโต๊ะ 2 คน พรุ่งนี้ 1 ทุ่ม", "บ่าย 2", "book for 4 today 19:30", "30/10".
- **Rules**:
  - With a time, the booking is made at once: today, or tomorrow if that time has passed.
  - Without a time or date, the agent asks back, with Today/Tomorrow or time buttons. Answers merge into a 30-minute open request.
  - Party size defaults to 2. Bookings are allowed up to 14 days ahead.
  - A time that has passed or is too far ahead is forgotten so the next answer replaces it.
- **Which tables**: only tables that have a BitPOS device with an NTAG sticker, so the customer can check in.
  - Bookings on one table must not overlap within [start−15 min, start+90 min].
  - Booking decisions for a shop are serialised with an advisory lock.
  - When the table is full, up to three nearby free times are offered as buttons.
- **Check-in**: the booker taps the table's sticker from 15 minutes before to 15 minutes after the booked time; the page then shows "Checked in". Without a check-in by +15 minutes, the minute sweeper marks the booking NO_SHOW once and tells the customer in Messenger (`CONFIRMED_EVENT_UPDATE` tag). The table is then free.
- **Blocking others**: while a table is held (inside the check-in window, or seated for 90 minutes after check-in), other customers' taps are refused with "this table is reserved".
  - The refusal page counts down the minutes left and refreshes every 30 s.
  - An unknown phone gets "I booked this table" through Messenger, where only the booker is checked in.
  - The inherited QR table ordering is not touched (owner decision).
- **Staff page**: table bookings with a countdown to the check-in deadline, and staff cancel.
- **Tests**: meta 64/64, twice. The 5 new booking tests cover the matcher; ask-back and merging; clash, full and alternatives; past and too far; cancel rights; tap check-in; refusing other customers with or without a cookie; Messenger referral by another customer; lapse once with a notice; the chat agent with no model; and model fields with an invocation id.

## OCI
- Backup `bitpos-20261028T145713Z.dump` (75,414,512 bytes, archive list verified). Migration 309 was dry-run first, then applied; inherited data digests are identical.
- Deployed with `tools/meta/deploy-oci.sh` (health 200, migrations 300–309 applied).
- Bookable now: Purple Cafe "Table 1" (device "BitPOSClock demo", tag `sim-counter-01`). "Table 2" has no sticker yet.
- The persistent menu now includes "🗓️ Book a table".

## Open
- Countdown on the BitPOS screen at the table: the firmware has only the idle, cart and order screens. Options are a static "Reserved until HH:MM" image through the inherited promotion playlist (rendered by the `bitpos-runtime` worker), or a firmware and API change for a live countdown. Waiting for the owner's decision.
