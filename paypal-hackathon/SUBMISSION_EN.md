# BitPOS Café Copilot — PayPal submission draft

Prepared 12 October 2026. **Planning draft. The PayPal and AI features below are intended scope, not completed functionality. Do not submit this document as implementation evidence.**

## Proposed title and tagline

**BitPOS Café Copilot**  
Sell today's surplus with a bounded AI agent and verified PayPal payments.

## Proposed story

The proposed problem is specific: a café owner wants to sell a limited quantity of remaining stock before a chosen time, while retaining control over discounts, inventory and payment. Discovery with merchants must validate that this problem matters before the entry claims demand.

For example, a merchant might ask: “Help sell the eight remaining croissants by 4 pm, with no more than a 10% discount.” This is an illustrative fixture, not an observed merchant result. A real model would read authorized stock and policy tools and propose a draft within a quantity, time and discount envelope. The server validates the draft, and the merchant reviews it and explicitly chooses a display before publishing. A customer scans the QR, orders and approves a PayPal Sandbox checkout. The backend verifies the capture before committing payment, inventory and a durable display event. An evidence trace connects the approved intent, quote, capture and display acknowledgment. Campaign results are calculated from verified payments; paid, collected and refunded counts remain distinct.

Existing BitPOS provides the POS, table ordering, device-routing and Solana devnet foundations. The proposed extension adds PayPal processing, typed AI tools, a merchant-approved campaign envelope and verified outcomes. The physical BitPOS Mini is an optional customer display; a working browser terminal must give judges a path without special hardware. The entry must explain its demonstrated difference from existing merchant AI and surplus-food products rather than claiming either category is new.

No sales uplift, waste reduction, production PayPal readiness or live-money operation is claimed. Planned formative tests compare manual/rule-based and AI-assisted offer creation and customer checkout, with sample sizes and failures disclosed. An internal readiness score or usability completion target is not a probability of winning. Rewrite the story in completed tense only for features that pass acceptance before submission.

## Fields to complete with evidence

| Field | Required content before submission |
|---|---|
| What we built | Exact accepted features; remove unfinished promises |
| How we built it | Actual PayPal APIs/SDK, AI provider/model and role, database/outbox and display path |
| Prior work and significant updates | Inherited foundations, shared work, new commits during the submission period, prior competition disclosure |
| Challenges | Actual failures and resolutions, with test evidence |
| Impact | Specific café problem; distinguish observed field trial from proposed business benefit |
| Tools and AI disclosure | In-product model usage plus development assistance; do not substitute coding assistance for product AI |
| Repository | Public repository plus exact entry tag/commit and root license |
| Demo and testing | Tested URL or complete fresh setup/run guide, evaluator access method, sandbox buyer instructions |
| Video | Publicly visible YouTube URL, under three minutes, English narration/captions |

## Proposed 2:50 video

| Time | What to show |
|---|---|
| 0:00–0:15 | The time-limited stock problem and the merchant's quantity/discount intent |
| 0:15–0:45 | Real model/tool trace, bounded draft, server checks and merchant review |
| 0:45–1:05 | Explicit target selection, display/menu QR and the approved envelope |
| 1:05–1:45 | Customer order, PayPal Sandbox approval, backend-verified capture and matching receipt |
| 1:45–2:10 | Correct Mini paid display and pickup; label any browser simulator footage |
| 2:10–2:30 | Verified campaign outcome, duplicate/recovery result and one measured usability finding if available |
| 2:30–2:50 | What is reused versus new, platform/AI stack, repo and judge access |

Use actual functioning footage, not conceptual animations presented as proof. Re-record if the final flow differs. Do not promise PayPal response time or physical audio deduplication beyond observed evidence. Show Sandbox prominently, hide private account details, and use media/brands/music only with appropriate rights.

## Readiness checklist

- [ ] Every human entrant's eligibility, team representative, account access and prior-event obligations checked.
- [ ] Joined the hackathon and completed all current Devpost form fields; a repository push is not a submission.
- [ ] Meaningful PayPal Sandbox and in-product AI features work end to end.
- [ ] Canonical pricing, capture verification, webhook authentication, durable recovery and duplicate handling pass focused tests.
- [ ] Real model/provider/budget approved and documented; fixtures/fallbacks explicitly labeled.
- [ ] Quantity/time/discount caps and stock reservations hold across concurrent orders/campaigns; approval changes require review.
- [ ] Merchant discovery and formative manual/rules/AI comparison documented, including sample sizes, failures and limitations.
- [ ] Product comparison supports the specific differentiation claim; no “world first” or unsupported revenue/waste-reduction claim.
- [ ] Evidence supports every claimed hardware/browser feature; firmware version and entry build pinned.
- [ ] Public source contains required assets, complete English setup/run/test instructions and visible open-source license.
- [ ] Fresh evaluator run succeeds with the documented sandbox and AI access method. Public documentation contains no secrets.
- [ ] Inherited material, shared competition work, AI assistance and significant new changes disclosed in the submission itself.
- [ ] English text/video/test instructions and translations cover all submitted materials.
- [ ] YouTube video publicly visible and under 3:00; images/music/people/third-party rights verified.
- [ ] Judge access remains free and functional through **15 December 2026, 23:00 Asia/Bangkok**.
- [ ] Latest official rules and form checked; entry commit/tag and evidence frozen before the deadline.
- [ ] Actual submission receipt/status recorded privately after the submitter submits.

Official requirements: [Rules](https://paypalaihackathon.devpost.com/rules), [Overview](https://paypalaihackathon.devpost.com/), [FAQ](https://paypalaihackathon.devpost.com/details/faqs). Internal target: 11 November 2026, 18:00 Asia/Bangkok. Official deadline: **13 November 2026, 03:00 Asia/Bangkok**.
