SET search_path TO bitpos, public;
-- Existing explicit controlled-devnet authorization; no ledger reset.
-- Oct8 reconciliation:180M gross reservations,0 pending signed attempts,
-- fee-sponsor97.63M finalized lamports, customer0SOL. Ceiling260M admits
-- at most80M additional worst-case reservations in this reconciled day,
-- below funds. Preserve1M/order,3payer attempts/minute and all proof guards.
-- Snapshot authorization for existing dedicated roles, not a future-day
-- solvency guarantee, mainnet permission or unlimited public sponsorship.
ALTER TABLE sponsor_days DROP CONSTRAINT sponsor_days_reserved_lamports_check;
ALTER TABLE sponsor_days ADD CONSTRAINT sponsor_days_reserved_lamports_check CHECK(reserved_lamports BETWEEN 0 AND 260000000);
