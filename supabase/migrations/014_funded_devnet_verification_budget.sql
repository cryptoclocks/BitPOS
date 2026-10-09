SET search_path TO bitpos, public;
-- Existing explicit authorization: .omp/work/devnet-budget-unblock.md.
-- Oct8 read-only reconciliation: gross historical reservations146M, pending
-- signed attempts0, finalized fee-sponsor97.97M lamports, customer0SOL.
-- New gross ceiling210M admits at most64M additional worst-case reservations,
-- below actual97.97M funds. Preserve ledger,1M/order and3payer attempts/minute.
-- Devnet controlled test roles only; not mainnet/public unlimited sponsoring.
ALTER TABLE sponsor_days DROP CONSTRAINT sponsor_days_reserved_lamports_check;
ALTER TABLE sponsor_days ADD CONSTRAINT sponsor_days_reserved_lamports_check CHECK(reserved_lamports BETWEEN 0 AND 210000000);
