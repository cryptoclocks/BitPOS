# Research sources — 12 October 2026

Primary sources used for this planning package. Links are references, not copied rulebooks. Recheck mutable pages before implementation and submission.

| Source | Used for | Observation / limitation |
|---|---|---|
| [Official Rules](https://paypalaihackathon.devpost.com/rules) | Timing, eligibility, required PayPal/AI, existing work, access, English, IP, judging and prize limits | Controlling source over overview; eligibility and significant update remain organizer decisions |
| [Hackathon Overview](https://paypalaihackathon.devpost.com/) | Theme, tools disclosure, prize presentation | No prescribed tracks; total prize figures appear in different forms, so the plan uses individual rules-table amounts |
| [FAQ](https://paypalaihackathon.devpost.com/details/faqs) | Team size, account-country versus eligibility, optional sponsor tools | No maximum team size stated; successful Devpost registration does not establish eligibility |
| [Resources](https://paypalaihackathon.devpost.com/resources) | Core PayPal, JS SDK v6, AI toolkit/MCP links and business-solution inspiration | Official starting points; linked toolkit installation is not a competition requirement |
| [PayPal JavaScript SDK setup](https://developer.paypal.com/sdk/js/set-up) | Current browser SDK and sandbox script | v6 documented; some authentication prose/examples on the page differ, so implementation needs a real sandbox spike rather than copying blindly |
| [Checkout integration](https://developer.paypal.com/docs/checkout/standard/integrate/) | Server create/capture pattern | Redirects to a platforms guide with marketplace examples; do not infer partner headers/onboarding are required for a single-merchant MVP |
| [Orders v2](https://developer.paypal.com/api/orders/v2) | API reference entry point | Dynamic endpoint schemas were not fully exposed by the text reader; inspect current full schemas during implementation |
| [Webhooks Management v1](https://developer.paypal.com/api/webhooks/v1) | Webhook management/verification API entry point | Dynamic schemas likewise require implementation-time inspection |
| [Integrate webhooks](https://developer.paypal.com/api/rest/webhooks/rest/) | Raw-body signatures, registered webhook ID, mock-versus-sandbox distinction, verification methods | Postback verification does not support simulator mock events; actual sandbox events still required |
| [REST idempotency](https://developer.paypal.com/api/rest/reference/idempotency/) | Stored request IDs, retry semantics, API-specific retention | Header support and retention depend on the specific API; local durable dedup still required |
| [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) | Optional in-product tool integration and sandbox configuration | Official README search extract inspected; full GitHub page fetch failed. Version/API/security spike pending; not installed |
| [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit) | Distinguishing coding plugin from product AI | Coding assistance/MCP alone is not the proposed customer/merchant AI feature; not installed |
| [Devpost Terms](https://info.devpost.com/terms) | Additional terms incorporated by the rules | Linked for submitter review; not separately certified in this research task |
| [Square AI](https://squareup.com/us/en/ai) | Strategy revision: existing merchant AI insights/content features | Official page search extract inspected 12 October; not a full product or regional availability audit |
| [Too Good To Go — How it works](https://www.toogoodtogo.com/en-us/how-does-the-app-work) | Strategy revision: existing surplus-food purchase/pickup model | Official page search extract inspected 12 October; do not infer a complete competitive feature gap |

The resources page's `docs.paypal.ai` quickstart/MCP/tool-reference links returned reader errors in this session. Do not claim those pages were fully verified. The plan uses accessible PayPal developer docs and the official toolkit repository search extract, with an implementation spike required.

Local sources inspected: root `AGENTS.md`, `docs/PHASE_PLAN_TH.md`, latest sections of `docs/CHECKPOINT.md`, `docs/plans/POST_SUBMISSION_PAYMENTS_AI_READY_TH.md`, `docs/SOURCE_PROVENANCE.md`, `docs/SUBMISSION_CHECKLIST.md`, payment/order types and initial schema, plus active `.omp` ownership/checkpoint/process metadata. Historical checkpoint entries are historical evidence, not a fresh runtime/physical verification.

Not performed: Devpost/PayPal sign-in, account creation, form submission, organizer messaging, credential inspection, PayPal API transactions, AI calls, schema migration, deployment, firmware flash or new hardware tests. Cross-competition obligations and actual team eligibility remain to be checked before submitting.

Strategy revision adds `WIN_STRATEGY_TH.md`, a narrower merchant problem, bounded tools/envelope, formative manual/rules/AI comparison and an internal readiness rubric. These are proposed targets. No participant interview, comparative user test or probability calibration was performed; the requested 80% win probability remains unsupported.

## Merchant cashflow follow-up — 13 October 2026

See [MERCHANT_CASHFLOW_RESEARCH_TH.md](MERCHANT_CASHFLOW_RESEARCH_TH.md) for endpoint links and distinctions between merchant receivables, supplier payments, utility billers and ad spend. Newly inspected primary sources include the accessible PayPal MCP quickstart and official tool inventory, the 16 September WebMCP announcement (Store Sync limitation), Transaction Search daily/net summaries and their scopes, Payouts eligibility, the currently published PayPal Thailand relaunch FAQ, Google Ads country-specific payment methods, x402 v2 launch/spec, and Solana's PYUSD page.

The Thailand FAQ describes the 2022 migration; its published Payouts restriction remains a planning constraint pending account-specific verification. No universal utility bill-payment endpoint or official ready-to-use PayPal x402 facilitator was established from the inspected sources. Absence from this research is not proof that a future or private integration is impossible. Summary endpoints in current documentation were not assigned an unverified launch date. No authenticated API, participant interview, expense payment or new product acceptance was performed.
