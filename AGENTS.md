# BitPOS working instructions

- This is an independent product. GitHub destination belongs to `cryptoclocks`.
- Read `docs/PHASE_PLAN_TH.md` and `docs/CHECKPOINT.md` before implementation. Update the checkpoint with completed work, validation and next steps.
- Current authorization is planning and creating this repository. Phase 1 extraction is planned, not yet performed.
- Store firmware belongs in `device/firmware/` inside this repository. Read `docs/FIRMWARE_EXTRACTION_TH.md` before extraction. It must build independently of the original CryptoClock workspace and have its own product/version/config/provisioning/OTA boundary.
- Treat the existing Cashless Thailand and CryptoClock workspaces as read-only source references. Preserve all their local changes.
- Preserve the full existing POS feature inventory, Thai/English translations and server-side role enforcement. Record any missing feature explicitly; do not silently remove it to reduce scope.
- Extract the smallest dependency closure for POS and store firmware. Do not bulk-copy the full website, unrelated CryptoClock applications/assets/releases, CCP billing domain, root environment files or production data.
- Track source provenance and distinguish inherited functionality from work created during the competition.
- Use isolated local/staging configuration before any production rollout. BitPOS must have its own service identity and data boundary.
- Payments must use canonical server-side quotes and integer minor units. A wallet signature or client callback is not proof of payment.
- Verify chain, token mint/program, successful transaction, intended recipient, exact quoted amount and order attribution. Authenticate payment webhooks and deduplicate effects.
- Paid orders, inventory, rewards and device events must survive duplicate callbacks, disconnected devices and worker restarts. Use transactional database updates, durable outbox and reconciliation.
- Keep AI campaign drafts reviewable; do not give the model unrestricted signing keys or allow it to invent payment or reward facts.
- Notifications to personal devices require an explicit account/device binding and customer opt-in.
- Never commit secrets, wallet private keys, service-role credentials, merchant/customer records or production backups.
