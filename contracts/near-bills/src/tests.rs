// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{test_vm_config, testing_env, RuntimeFeesConfig};
use std::collections::HashMap;

const T0: u64 = 1_800_000_000_000; // ms

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn contract_id() -> AccountId {
    acc("bills.test")
}
fn ctx(predecessor: &str, at_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(at_ms * 1_000_000)
        .build());
}
fn ctx_callback(at_ms: u64, ok: bool) {
    let result = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(contract_id())
            .predecessor_account_id(contract_id())
            .block_timestamp(at_ms * 1_000_000)
            .build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        vec![result]
    );
}
fn setup() -> Contract {
    ctx("owner.test", T0);
    let mut contract = Contract::new(acc("owner.test"));
    contract.set_token(acc("tusd.test"), true);
    contract.set_merchant(acc("orbit.test"), true);
    contract
}
fn payouts() -> Vec<Payout> {
    vec![
        Payout { account: acc("orbit.test"), amount: U128(3_550_000), role: "owner".into() },
        Payout { account: acc("mai.orbit.test"), amount: U128(500_000), role: "tips".into() },
        Payout { account: acc("tax.orbit.test"), amount: U128(350_000), role: "tax".into() },
        Payout { account: acc("milkfarm.test"), amount: U128(600_000), role: "supplier".into() },
    ]
}
fn device() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn open(contract: &mut Contract, id: &str, witness: bool) {
    ctx("orbit.test", T0);
    let pk = witness.then(|| hex(device().verifying_key().as_bytes()));
    contract.open_bill(id.into(), acc("tusd.test"), U128(5_000_000), payouts(), U64(T0 + 300_000), pk, U64(120_000));
}
fn pay(contract: &mut Contract, id: &str, amount: u128, at_ms: u64, token: &str) -> PromiseOrValue<U128> {
    ctx(token, at_ms);
    contract.ft_on_transfer(acc("alice.test"), U128(amount), format!(r#"{{"m":"orbit.test","b":"{id}"}}"#))
}
fn refunded(result: PromiseOrValue<U128>) -> Option<u128> {
    match result {
        PromiseOrValue::Value(value) => Some(value.0),
        PromiseOrValue::Promise(_) => None,
    }
}
fn state(contract: &Contract, id: &str) -> BillState {
    contract.get_bill(acc("orbit.test"), id.into()).unwrap().state
}

#[test]
fn exact_payment_without_witness_settles_in_one_batch() {
    let mut contract = setup();
    open(&mut contract, "b1", false);
    let result = pay(&mut contract, "b1", 5_000_000, T0 + 1_000, "tusd.test");
    assert!(refunded(result).is_none(), "payout promise expected");
    assert_eq!(state(&contract, "b1"), BillState::Settling);
    ctx_callback(T0 + 2_000, true);
    assert_eq!(contract.on_payout("orbit.test:b1".into()).0, 0);
    assert_eq!(state(&contract, "b1"), BillState::Settled);
}

#[test]
fn wrong_amount_expired_wrong_token_and_double_payment_bounce() {
    let mut contract = setup();
    open(&mut contract, "b2", false);
    assert_eq!(refunded(pay(&mut contract, "b2", 4_999_999, T0 + 1_000, "tusd.test")), Some(4_999_999));
    assert_eq!(refunded(pay(&mut contract, "b2", 5_000_001, T0 + 1_000, "tusd.test")), Some(5_000_001));
    assert_eq!(refunded(pay(&mut contract, "b2", 5_000_000, T0 + 1_000, "evil.test")), Some(5_000_000));
    assert_eq!(refunded(pay(&mut contract, "nope", 5_000_000, T0 + 1_000, "tusd.test")), Some(5_000_000));
    assert_eq!(refunded(pay(&mut contract, "b2", 5_000_000, T0 + 300_001, "tusd.test")), Some(5_000_000));
    assert_eq!(state(&contract, "b2"), BillState::Open);
    assert!(refunded(pay(&mut contract, "b2", 5_000_000, T0 + 2_000, "tusd.test")).is_none());
    assert_eq!(refunded(pay(&mut contract, "b2", 5_000_000, T0 + 3_000, "tusd.test")), Some(5_000_000));
    ctx("tusd.test", T0 + 4_000);
    let garbage = contract.ft_on_transfer(acc("alice.test"), U128(1), "not json".into());
    assert_eq!(refunded(garbage), Some(1));
}

#[test]
fn witness_bill_waits_in_escrow_until_the_device_signs() {
    let mut contract = setup();
    open(&mut contract, "b3", true);
    assert_eq!(refunded(pay(&mut contract, "b3", 5_000_000, T0 + 1_000, "tusd.test")), Some(0));
    assert_eq!(state(&contract, "b3"), BillState::Escrow);
    let message = witness_message(&contract_id(), &acc("orbit.test"), "b3");
    assert_eq!(message, "bitpos-near-ack:v1:bills.test:orbit.test:b3");
    let signature = hex(&device().sign(message.as_bytes()).to_bytes());
    ctx("relayer.test", T0 + 5_000);
    let _ = contract.device_ack(acc("orbit.test"), "b3".into(), signature);
    assert_eq!(state(&contract, "b3"), BillState::Settling);
    ctx_callback(T0 + 6_000, true);
    contract.on_payout("orbit.test:b3".into());
    assert_eq!(state(&contract, "b3"), BillState::Settled);
}

#[test]
#[should_panic(expected = "SIGNATURE_MISMATCH")]
fn a_signature_for_another_bill_is_refused() {
    let mut contract = setup();
    open(&mut contract, "b4", true);
    let _ = pay(&mut contract, "b4", 5_000_000, T0 + 1_000, "tusd.test");
    let other = witness_message(&contract_id(), &acc("orbit.test"), "b5");
    let signature = hex(&device().sign(other.as_bytes()).to_bytes());
    ctx("relayer.test", T0 + 5_000);
    let _ = contract.device_ack(acc("orbit.test"), "b4".into(), signature);
}

#[test]
#[should_panic(expected = "SIGNATURE_MISMATCH")]
fn a_signature_from_another_key_is_refused() {
    let mut contract = setup();
    open(&mut contract, "b6", true);
    let _ = pay(&mut contract, "b6", 5_000_000, T0 + 1_000, "tusd.test");
    let message = witness_message(&contract_id(), &acc("orbit.test"), "b6");
    let signature = hex(&SigningKey::from_bytes(&[9u8; 32]).sign(message.as_bytes()).to_bytes());
    ctx("relayer.test", T0 + 5_000);
    let _ = contract.device_ack(acc("orbit.test"), "b6".into(), signature);
}

#[test]
#[should_panic(expected = "WITNESS_WINDOW_OPEN")]
fn reclaim_is_refused_while_the_witness_window_is_open() {
    let mut contract = setup();
    open(&mut contract, "b7", true);
    let _ = pay(&mut contract, "b7", 5_000_000, T0 + 1_000, "tusd.test");
    ctx("anyone.test", T0 + 1_000 + 120_000);
    let _ = contract.reclaim(acc("orbit.test"), "b7".into());
}

#[test]
fn without_a_witness_the_money_goes_back_to_the_payer() {
    let mut contract = setup();
    open(&mut contract, "b8", true);
    let _ = pay(&mut contract, "b8", 5_000_000, T0 + 1_000, "tusd.test");
    ctx("anyone.test", T0 + 1_000 + 120_001);
    let _ = contract.reclaim(acc("orbit.test"), "b8".into());
    assert_eq!(state(&contract, "b8"), BillState::Refunding);
    ctx_callback(T0 + 130_000, true);
    contract.on_refund("orbit.test:b8".into(), "timeout".into());
    let bill = contract.get_bill(acc("orbit.test"), "b8".into()).unwrap();
    assert_eq!(bill.state, BillState::Refunded);
    assert_eq!(bill.payer, Some(acc("alice.test")));
}

#[test]
fn a_failed_payout_keeps_the_money_for_retry_or_refund() {
    let mut contract = setup();
    open(&mut contract, "b9", false);
    let _ = pay(&mut contract, "b9", 5_000_000, T0 + 1_000, "tusd.test");
    ctx_callback(T0 + 2_000, false);
    assert_eq!(contract.on_payout("orbit.test:b9".into()).0, 0);
    assert_eq!(state(&contract, "b9"), BillState::PayoutFailed);
    ctx("anyone.test", T0 + 3_000);
    let _ = contract.retry_payout(acc("orbit.test"), "b9".into());
    assert_eq!(state(&contract, "b9"), BillState::Settling);
    ctx_callback(T0 + 4_000, false);
    contract.on_payout("orbit.test:b9".into());
    ctx("orbit.test", T0 + 5_000);
    let _ = contract.merchant_refund("b9".into());
    assert_eq!(state(&contract, "b9"), BillState::Refunding);
}

#[test]
#[should_panic(expected = "PAYOUT_SUM_MISMATCH")]
fn payouts_must_add_up_to_the_total() {
    let mut contract = setup();
    ctx("orbit.test", T0);
    contract.open_bill("b10".into(), acc("tusd.test"), U128(5_000_001), payouts(), U64(T0 + 300_000), None, U64(120_000));
}

#[test]
#[should_panic(expected = "MERCHANT_NOT_ACTIVE")]
fn only_registered_merchants_open_bills() {
    let mut contract = setup();
    ctx("stranger.test", T0);
    contract.open_bill("b11".into(), acc("tusd.test"), U128(5_000_000), payouts(), U64(T0 + 300_000), None, U64(120_000));
}

#[test]
#[should_panic(expected = "BILL_EXISTS")]
fn a_bill_id_cannot_be_reused() {
    let mut contract = setup();
    open(&mut contract, "b12", false);
    open(&mut contract, "b12", false);
}

#[test]
fn a_voided_bill_bounces_payments() {
    let mut contract = setup();
    open(&mut contract, "b13", false);
    ctx("orbit.test", T0 + 500);
    contract.void_bill("b13".into());
    assert_eq!(refunded(pay(&mut contract, "b13", 5_000_000, T0 + 1_000, "tusd.test")), Some(5_000_000));
    assert_eq!(state(&contract, "b13"), BillState::Void);
}

#[test]
#[should_panic(expected = "OWNER_ONLY")]
fn only_the_owner_allows_tokens() {
    let mut contract = setup();
    ctx("orbit.test", T0);
    contract.set_token(acc("evil.test"), true);
}

/// The signature below was produced by the BitPOS Mini firmware's own C code (tools/firmware/near-host-test,
/// fixed seed 00..1f). The contract must accept exactly what the device signs.
#[test]
fn the_firmware_signature_vector_releases_a_bill() {
    let contract_account = acc("bills.bitpos-near.testnet");
    let merchant = acc("orbit.bitpos-near.testnet");
    let at = |predecessor: &str, at_ms: u64| {
        testing_env!(VMContextBuilder::new()
            .current_account_id(contract_account.clone())
            .predecessor_account_id(acc(predecessor))
            .block_timestamp(at_ms * 1_000_000)
            .build());
    };
    at("owner.test", T0);
    let mut contract = Contract::new(acc("owner.test"));
    contract.set_token(acc("tusd.test"), true);
    contract.set_merchant(merchant.clone(), true);
    at("orbit.bitpos-near.testnet", T0);
    contract.open_bill(
        "b_host_test_0001".into(),
        acc("tusd.test"),
        U128(5_000_000),
        payouts(),
        U64(T0 + 300_000),
        Some("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8".into()),
        U64(120_000),
    );
    at("tusd.test", T0 + 1_000);
    let _ = contract.ft_on_transfer(
        acc("alice.test"),
        U128(5_000_000),
        r#"{"m":"orbit.bitpos-near.testnet","b":"b_host_test_0001"}"#.into(),
    );
    at("relayer.test", T0 + 2_000);
    let _ = contract.device_ack(
        merchant.clone(),
        "b_host_test_0001".into(),
        "eb8e03ed0378b16870892469166d6f66f2768bc5f65c4028cb4d9286c754a5ace00789a657b5181714f18c623c46d3795a9859d82a5dafed3a3664d125564a04".into(),
    );
    assert_eq!(contract.get_bill(merchant, "b_host_test_0001".into()).unwrap().state, BillState::Settling);
}
