# BitPOS — latest product evidence

Updated 13 October 2026. These extensions are separate from the submitted competition build and original cafe recordings. This page describes the deployed release; it does not claim that all extension source is included in the public baseline.

[Product website](https://bitpos.cashlessthailand.com/) · [Merchant POS](https://pos.cashlessthailand.com/) · [Customer table menu](https://pay.cashlessthailand.com/table/6LSn6twjmnvfGpDwTWm98p8S8o4CQqlZ8CwlK_nk1CY)

[Two-minute English pitch](https://youtu.be/q8YXIrsTWXw) · [Four-clip cafe demo](https://youtu.be/yuSbXrgXSh8) · [Original field-trial gallery](../RealUse/README.md)

## AI draft → merchant approval → Mini

![Physical Mini native promotion frame](media/mini-ai-promotion-20261013.png)

Gemini produced an Espresso Deal draft with a 10% discount. The merchant explicitly approved publication. The server validated the USD 0.10 base price and USD 0.09 offer price. The physical ESP32 Mini, firmware 0.3.9, acknowledged the current playlist through an authenticated SNAPSHOT render ACK at 16:02:26 UTC on 13 October 2026.

This is a native framebuffer after successful LCD transfer, not an optical photograph or proof of sound/touch. The coffee photo is an existing menu image; Gemini generated the structured offer, not the photo. The daily campaign covers the merchant's devices; a separate offline target remained deferred and has no physical rendering claim. An earlier failed provider attempt was retained rather than relabeled as success.

Daily drafts use stock and aggregate purchase history by weekday. The demonstrated history bucket had no verified paid orders, so this example does not prove repeat-customer prediction. Personal offers use explicit recipient/visit selection and table-scoped eligibility. Staff inspect a Mini from the floor plan, preview a change and confirm it. Existing bills retain frozen prices.

## Payments and Coffee Copilot

| Area | Evidence and limits |
| --- | --- |
| USDG | Sponsored devnet settlement; historical physical payment acceptance retained |
| Circle USDC | Actual finalized devnet HTTP x402 settlement; official Circle devnet asset |
| USDT-test | Actual finalized devnet payments; issued by BitPOS, not official Tether USDT |
| Coffee Copilot | Gemini proposals and reviewed repeat orders; microphone input exists, human voice acceptance remains separate |
| x402 V2 | Actual SDK HTTP verification/settlement with durable reconciliation on devnet |
| Bounded permission | Owner approved 5.40 USDC once; two explicit 2.70 USDC orders finalized without another owner signature per order, followed by on-chain revoke |
| Pickup | Deployed fulfillment lifecycle and exact-device notification consumer; sound and full physical pickup acceptance remain separate |

Delegation uses an SPL allowance and a trusted BitPOS signer. The token program enforces allowance and owner revocation; merchant, per-order and time restrictions are service-enforced, not an on-chain expiry rule. Manual wallet payment remains available. Delegated-order evidence uses a host wallet and virtual display acknowledgment, not a physical Phantom phone.

## Review and scope

Floor-plan source passed independent native review. Subsequent provider/ACK fixes passed a separate scoped independent Codex review, focused provider/current-playlist ACK checks and type checking. The physical promotion proof closes that direct scope; it is not blanket completion of the native OMP goal or every feature.

NFT loyalty, mainnet payments, official mainnet USDT, native Blink checkout and commercial revenue are not established by this evidence. The website's 20% figures are illustrative pilot targets, not measured results. Private customer records, API keys, delegate keys, runtime configuration and backups are excluded.

[Source history](SOURCE_PROVENANCE.md) · [Original payment acceptance](DEPLOYMENT_ACCEPTANCE.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
