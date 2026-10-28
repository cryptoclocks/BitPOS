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
