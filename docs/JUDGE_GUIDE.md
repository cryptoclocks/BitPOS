# BitPOS — reviewer guide

**Cafe checkout that connects a Solana payment to a physical POSClock.**  
Builder: Natthapong Suwanjit · Ecosystem: Solana · Network: devnet

## What to try

1. Open [merchant POS](https://pos.cashlessthailand.com/). Choose Owner, Manager or Staff quick access. Use synthetic contact details only.
2. Select a register. Browse the menu, add items and review the itemized bill. A paired online terminal is needed for the physical counter flow.
3. Alternatively open the [table menu](https://pay.cashlessthailand.com/table/6LSn6twjmnvfGpDwTWm98p8S8o4CQqlZ8CwlK_nk1CY) to order on a phone. Orders retain their table/device assignment.
4. The order website displays the bill and opens the Phantom in-app/provider checkout. Signing requires the correct devnet token balance. Public access does not include a funded reviewer wallet or private signing keys.
5. Backend verification waits for finalized settlement before marking paid and changing inventory. The assigned terminal receives a durable event and acknowledges its render.
6. Incoming orders provides search, status filters and receipts. Settings separates floor/devices, menu prices and payment wallet according to server-enforced roles.

This is a shared devnet evaluation environment, so an online terminal may be busy. Please do not revoke devices, change the receiving wallet or overwrite another evaluator's settings. Software pages can be inspected without owning a terminal; native hardware evidence is linked below.

## What works and what remains

| Area | Current status |
| --- | --- |
| Menu, cart, table ordering and register pairing | Implemented |
| Sponsored sandbox USDG, verification, inventory and durable device events | Implemented; three finalized physical acceptance rounds |
| Native terminal QR, confirming/paid feedback, animation and audio | Implemented; firmware 0.3.6 acceptance evidence |
| Android Phantom on a physical phone | Manual acceptance remains pending; host-wallet payments are separate evidence |
| Native Actions/Blinks checkout | Planned/incomplete; current checkout is a website/provider flow |
| Automatic personalized AI offers, loyalty/NFT rewards | Planned/incomplete |
| Mainnet and redeemable USDG | Not enabled |

## Evidence and source

[Physical payment acceptance](DEPLOYMENT_ACCEPTANCE.md) includes transaction links and native screen captures. Observed backend-to-render ACK times were **404, 344 and 329 ms**. These are three observations, not chain-finalization times or p95 statistics.

[Source provenance](SOURCE_PROVENANCE.md) explains inherited foundations and new work. [Third-party notices](THIRD_PARTY_NOTICES.md) and [photo credits](CAFE_PHOTO_CREDITS.md) identify included assets. [OCI setup](OCI_DEPLOYMENT.md) and the root README explain reproduction.

## Product and business direction

The initial target is independent cafes serving crypto-native customers. BitPOS combines an itemized order, merchant-sponsored transaction and visible physical confirmation, while preserving the table identity needed to serve the order. The intended business model is terminal sales plus recurring merchant software/support. This is a proposed model; pricing, merchant demand, revenue, market size and repeat usage have not been validated in this submission.

The first distribution experiment is a small cafe pilot: measure completed checkouts, approval friction, staff intervention and repeat use. Mainnet rollout, local regulatory requirements and production support need separate work. No merchant traction or revenue is claimed by the seeded catalog or evaluation accounts.
