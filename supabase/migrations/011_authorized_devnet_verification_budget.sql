SET search_path TO bitpos, public;
-- Explicit controlled-devnet authorization: .omp/work/devnet-budget-unblock.md.
-- Oct8 preflight: existing gross reservations80M; unresolved worst-case1M;
-- finalized sponsor balance98.63M. Additional admission80M plus1M outstanding
-- remains below funds81M<98.63M. Historical reservations are not reset/deleted.
-- Gross cumulative reservations are not current unspent SOL liabilities.
-- Keep1M/order,3payer attempts/minute and exact transaction guards unchanged.
ALTER TABLE sponsor_days DROP CONSTRAINT sponsor_days_reserved_lamports_check;
ALTER TABLE sponsor_days ADD CONSTRAINT sponsor_days_reserved_lamports_check CHECK(reserved_lamports BETWEEN 0 AND 160000000);
