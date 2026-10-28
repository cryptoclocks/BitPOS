# Design deviations decided on 2026-10-29 (owner: "take whichever is better; if the app changes, FigCraft changes too")

Where the real app and the design differ, each difference was judged and the better one kept. Where the app was kept, the exported
FigCraft source (`source/screens/*.svg`), the PNG preview (`previews/current-native/*.png`) and the `sha256` in `screen-map.json`
were updated to match.

**Important:** the native FigCraft master (the live design file the SVGs are exported from) was not running, so it was *not* updated.
The exported SVG/PNG files were patched directly. When FigCraft is next opened, apply the same edits to the master, otherwise a
re-export will bring the old text back.

## Applied to the exported files (app kept, design updated)

| Screen | Change | Why the app is better |
|---|---|---|
| U01 welcome | top-right bell icon replaced by an "English" language switch | there are no notifications before sign-in, and the language switch is the only control a new visitor needs |
| U02 sign-in | button "get confirmation code" to "request sign-in code"; the consent sentence replaced by a centred "service and privacy" link row | the button says what happens (a sign-in code is sent); a link keeps the legal text one tap away without a wall of small print |
| U03 OTP | button "confirm and continue" to "confirm code"; resend countdown replaced by a centred "change number / ask for a new code" link | the server has no resend-cooldown data to show a true countdown, and the link covers the two real recovery actions |
| U04 location | description centred under the centred title | the left-aligned text under a centred title looked misaligned |

## Differences kept in the app that are data gaps, not design changes (design left as is)

U06 home (address line, promo banner, category tiles, rating / ETA / fee on merchant cards), U09 merchant page (open badge, rating,
ETA and fee chips, item photos and descriptions), U10 product option chips (the fixture product has no option groups) and R06 rider
home content in states other than "online". The app does not invent ratings, delivery times, promotions or photos; the design
stays as the target for when that data exists.

## Larger differences where the app is kept (design to be redrawn in the FigCraft master, not hand-patched)

These are too structural to patch in the exported SVG. The app is the better behaviour; redraw the frames in the master when it is open.

| Frame | App behaviour kept | Design shows |
|---|---|---|
| U20 tracking | "Map unavailable" plus delivery status when no map provider is configured or service access is restricted; no invented ETA or rider rating | live route map, ETA, rider card with rating, chat / details buttons |
| U22 order detail | adds a collapsible "status and history" section and a longer "Cancel review" label | three short buttons, no history section |
| U23 activity | merchant tile icon and a "newest orders" sort control | merchant photos |
| U33 account | superset menu (addresses, settings, ride, group order, order again, and more); no points or name until the account has them | four rows incl. coupons and points, payments |
| P03 bills | order-centre board with columns (new, in progress, ready, collected) and channel filter | a plain bills list |
| P07 / P09 / P13 | product details form above the list; inline receive form; stock ledger with receive and adjust only | two-column edit page with photo preview; receive page with supplier, document number and cost; movement list including sales deductions |
| P20 export | local CSV built from the loaded orders, nothing stored or uploaded | a list of previously generated exports |
| P24 categories | summary card with rename; categories are derived from products | a categories list with visibility and update time |
| P25 users | member list by short id with role change for managers and staff; names and invitations stay in the auth service | member names and an add button |
| P35 devices | richer floor-plan editor with the same facts | plain tables-and-devices list |
