// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
//! BitPOS Living Bill.
//!
//! A merchant opens a bill (exact total, token, expiry, who gets paid). The customer pays it with
//! `ft_transfer_call`. Anything that is not exactly this open bill bounces back to the payer.
//! With a witness key the money waits in escrow until the table device signs that it showed
//! "paid"; without that signature it can be reclaimed for the payer after a timeout.
//! On release every recipient is paid in one batched receipt: all transfers happen or none.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue, PromiseResult,
};

pub const VERSION: &str = "bitpos-near-bills/0.2.0";
const MAX_PAYOUTS: usize = 10;
const MIN_WITNESS_TIMEOUT_MS: u64 = 30_000;
const MAX_WITNESS_TIMEOUT_MS: u64 = 3_600_000;
const MAX_BILL_LIFETIME_MS: u64 = 86_400_000;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(8);
const GAS_CALLBACK: Gas = Gas::from_tgas(12);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// The only spending-pass lengths offered: 30 minutes, 1 hour, 1 day, 1 week, 30 days.
pub const PASS_TTLS_MS: [u64; 5] = [1_800_000, 3_600_000, 86_400_000, 604_800_000, 2_592_000_000];
/// Passes live under their own storage prefix so the contract's existing state layout is unchanged.
const PASS_PREFIX: &[u8] = b"P";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Tokens,
    Merchants,
    Bills,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BillState {
    Open,
    Escrow,
    Settling,
    Settled,
    PayoutFailed,
    Refunding,
    Refunded,
    Void,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Payout {
    pub account: AccountId,
    pub amount: U128,
    /// Short label shown on receipts, for example "owner", "tax", "tips", "supplier".
    pub role: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Bill {
    pub merchant: AccountId,
    pub bill_id: String,
    pub token: AccountId,
    pub total: U128,
    pub payouts: Vec<Payout>,
    pub expires_at_ms: U64,
    /// ed25519 public key (64 hex chars) of the table device that must witness the payment.
    pub witness_pk: Option<String>,
    pub witness_timeout_ms: U64,
    pub state: BillState,
    pub payer: Option<AccountId>,
    pub paid_at_ms: U64,
    pub closed_at_ms: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    tokens: LookupMap<AccountId, bool>,
    merchants: LookupMap<AccountId, bool>,
    bills: LookupMap<String, Bill>,
    bill_count: u64,
}

/// An AI spending pass: the owner deposits a capped amount and lets one agent account pay exact
/// bills from it until the pass expires. The agent can only call `pass_pay`; refunds of bills paid
/// through a pass go to the owner, never to the agent; the unspent balance goes back to the owner
/// when the pass is closed (by the owner at any time, or by anyone after expiry).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Pass {
    pub owner: AccountId,
    pub pass_id: String,
    pub agent: AccountId,
    pub token: AccountId,
    pub cap: U128,
    pub balance: U128,
    pub max_bill: U128,
    /// When set, the agent may pay only this merchant's bills.
    pub merchant: Option<AccountId>,
    pub created_at_ms: U64,
    pub expires_at_ms: U64,
    pub bills_paid: u32,
    pub closed: bool,
}

/// Raw storage for passes (prefix + key, borsh value): written at once, outside the state struct.
struct Passes;
impl Passes {
    fn slot(key: &str) -> Vec<u8> {
        [PASS_PREFIX, key.as_bytes()].concat()
    }
    fn get(&self, key: &String) -> Option<Pass> {
        env::storage_read(&Self::slot(key)).map(|raw| near_sdk::borsh::from_slice(&raw).unwrap_or_else(|_| env::panic_str("PASS_CORRUPT")))
    }
    fn insert(&mut self, key: &String, pass: &Pass) {
        env::storage_write(&Self::slot(key), &near_sdk::borsh::to_vec(pass).unwrap_or_else(|_| env::panic_str("PASS_ENCODE")));
    }
}
fn passes() -> Passes {
    Passes
}

fn pass_key(owner: &AccountId, pass_id: &str) -> String {
    format!("{owner}:{pass_id}")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn bill_key(merchant: &AccountId, bill_id: &str) -> String {
    format!("{merchant}:{bill_id}")
}

fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "bitpos-near", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn decode_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    let bytes = text.as_bytes();
    if bytes.len() != N * 2 {
        return None;
    }
    let nibble = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; N];
    for (index, slot) in out.iter_mut().enumerate() {
        *slot = (nibble(bytes[index * 2])? << 4) | nibble(bytes[index * 2 + 1])?;
    }
    Some(out)
}

/// The exact ASCII message a witness device signs for a bill.
pub fn witness_message(contract: &AccountId, merchant: &AccountId, bill_id: &str) -> String {
    format!("bitpos-near-ack:v1:{contract}:{merchant}:{bill_id}")
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            tokens: LookupMap::new(StorageKey::Tokens),
            merchants: LookupMap::new(StorageKey::Merchants),
            bills: LookupMap::new(StorageKey::Bills),
            bill_count: 0,
        }
    }

    // ---- administration -------------------------------------------------

    pub fn set_token(&mut self, token: AccountId, allowed: bool) {
        self.assert_owner();
        self.tokens.insert(token.clone(), allowed);
        emit("token_set", json!({"token": token, "allowed": allowed}));
    }

    pub fn set_merchant(&mut self, merchant: AccountId, active: bool) {
        self.assert_owner();
        self.merchants.insert(merchant.clone(), active);
        emit("merchant_set", json!({"merchant": merchant, "active": active}));
    }

    // ---- merchant -------------------------------------------------------

    /// Opens a bill. Called by the merchant account, normally with a function-call access key
    /// that can only call `open_bill` and `void_bill`.
    #[allow(clippy::too_many_arguments)]
    pub fn open_bill(
        &mut self,
        bill_id: String,
        token: AccountId,
        total: U128,
        payouts: Vec<Payout>,
        expires_at_ms: U64,
        witness_pk: Option<String>,
        witness_timeout_ms: U64,
    ) -> Bill {
        let merchant = env::predecessor_account_id();
        require!(self.merchants.get(&merchant).copied().unwrap_or(false), "MERCHANT_NOT_ACTIVE");
        require!(self.tokens.get(&token).copied().unwrap_or(false), "TOKEN_NOT_ALLOWED");
        require!(
            !bill_id.is_empty()
                && bill_id.len() <= 64
                && bill_id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'),
            "BILL_ID_INVALID"
        );
        require!(total.0 > 0, "TOTAL_INVALID");
        require!(!payouts.is_empty() && payouts.len() <= MAX_PAYOUTS, "PAYOUTS_INVALID");
        let mut sum: u128 = 0;
        for payout in &payouts {
            require!(payout.amount.0 > 0, "PAYOUT_AMOUNT_INVALID");
            require!(
                !payout.role.is_empty()
                    && payout.role.len() <= 24
                    && payout.role.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-'),
                "PAYOUT_ROLE_INVALID"
            );
            sum = sum.checked_add(payout.amount.0).unwrap_or_else(|| env::panic_str("PAYOUT_SUM_OVERFLOW"));
        }
        require!(sum == total.0, "PAYOUT_SUM_MISMATCH");
        let now = now_ms();
        require!(expires_at_ms.0 > now && expires_at_ms.0 - now <= MAX_BILL_LIFETIME_MS, "EXPIRY_INVALID");
        require!(
            (MIN_WITNESS_TIMEOUT_MS..=MAX_WITNESS_TIMEOUT_MS).contains(&witness_timeout_ms.0),
            "WITNESS_TIMEOUT_INVALID"
        );
        if let Some(pk) = &witness_pk {
            require!(decode_hex::<32>(pk).is_some(), "WITNESS_KEY_INVALID");
        }
        let key = bill_key(&merchant, &bill_id);
        require!(self.bills.get(&key).is_none(), "BILL_EXISTS");
        let bill = Bill {
            merchant: merchant.clone(),
            bill_id: bill_id.clone(),
            token,
            total,
            payouts,
            expires_at_ms,
            witness_pk,
            witness_timeout_ms,
            state: BillState::Open,
            payer: None,
            paid_at_ms: U64(0),
            closed_at_ms: U64(0),
        };
        self.bills.insert(key, bill.clone());
        self.bill_count += 1;
        emit(
            "bill_opened",
            json!({"merchant": merchant, "bill_id": bill_id, "token": bill.token, "total": bill.total,
                   "expires_at_ms": bill.expires_at_ms, "witness": bill.witness_pk.is_some(), "payouts": bill.payouts}),
        );
        bill
    }

    pub fn void_bill(&mut self, bill_id: String) {
        let merchant = env::predecessor_account_id();
        let key = bill_key(&merchant, &bill_id);
        let mut bill = self.load(&key);
        require!(bill.state == BillState::Open, "BILL_NOT_OPEN");
        bill.state = BillState::Void;
        bill.closed_at_ms = U64(now_ms());
        self.bills.insert(key, bill);
        emit("bill_voided", json!({"merchant": merchant, "bill_id": bill_id}));
    }

    /// The merchant gives the money back while it is still held by the contract.
    pub fn merchant_refund(&mut self, bill_id: String) -> Promise {
        let merchant = env::predecessor_account_id();
        let key = bill_key(&merchant, &bill_id);
        let bill = self.load(&key);
        require!(matches!(bill.state, BillState::Escrow | BillState::PayoutFailed), "BILL_NOT_HELD");
        self.start_refund(key, bill, "merchant")
    }

    // ---- payment --------------------------------------------------------

    /// NEP-141 receiver. `msg` is `{"m":"<merchant account>","b":"<bill id>"}`.
    /// Returns the amount to give back to the payer: all of it unless this is exactly an open bill.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        if msg.contains("\"pass\"") {
            return match self.create_pass(&token, &sender_id, amount, &msg) {
                Ok(pass) => {
                    emit("pass_created", json!({"owner": pass.owner, "pass_id": pass.pass_id, "agent": pass.agent,
                        "token": pass.token, "cap": pass.cap, "max_bill": pass.max_bill, "merchant": pass.merchant,
                        "expires_at_ms": pass.expires_at_ms}));
                    PromiseOrValue::Value(U128(0))
                }
                Err(reason) => {
                    emit("payment_bounced", json!({"token": token, "payer": sender_id, "amount": amount, "reason": reason}));
                    PromiseOrValue::Value(amount)
                }
            };
        }
        match self.accept_payment(&token, &sender_id, amount, &msg) {
            Err(reason) => {
                emit(
                    "payment_bounced",
                    json!({"token": token, "payer": sender_id, "amount": amount, "reason": reason}),
                );
                PromiseOrValue::Value(amount)
            }
            Ok((key, bill)) => {
                emit(
                    "bill_paid",
                    json!({"merchant": bill.merchant, "bill_id": bill.bill_id, "token": bill.token, "payer": sender_id,
                           "amount": amount, "escrow": bill.state == BillState::Escrow}),
                );
                if bill.state == BillState::Escrow {
                    PromiseOrValue::Value(U128(0))
                } else {
                    PromiseOrValue::Promise(self.payout(&key, &bill))
                }
            }
        }
    }

    /// Releases an escrowed bill. Anyone may relay it; the signature of the bill's witness
    /// device over `witness_message` is what authorises the release.
    pub fn device_ack(&mut self, merchant: AccountId, bill_id: String, signature: String) -> Promise {
        let key = bill_key(&merchant, &bill_id);
        let mut bill = self.load(&key);
        require!(bill.state == BillState::Escrow, "BILL_NOT_IN_ESCROW");
        let pk_hex = bill.witness_pk.clone().unwrap_or_else(|| env::panic_str("BILL_HAS_NO_WITNESS"));
        let pk = decode_hex::<32>(&pk_hex).unwrap_or_else(|| env::panic_str("WITNESS_KEY_INVALID"));
        let sig = decode_hex::<64>(&signature).unwrap_or_else(|| env::panic_str("SIGNATURE_INVALID"));
        let message = witness_message(&env::current_account_id(), &merchant, &bill_id);
        require!(env::ed25519_verify(&sig, message.as_bytes(), &pk), "SIGNATURE_MISMATCH");
        emit("device_ack", json!({"merchant": merchant, "bill_id": bill_id, "witness_pk": pk_hex}));
        bill.state = BillState::Settling;
        self.bills.insert(key.clone(), bill.clone());
        self.payout(&key, &bill)
    }

    /// Gives the money back to the payer when the witness never confirmed (or the payout
    /// failed) and the witness timeout has passed. Anyone may call it.
    pub fn reclaim(&mut self, merchant: AccountId, bill_id: String) -> Promise {
        let key = bill_key(&merchant, &bill_id);
        let bill = self.load(&key);
        require!(matches!(bill.state, BillState::Escrow | BillState::PayoutFailed), "BILL_NOT_HELD");
        require!(now_ms() > bill.paid_at_ms.0 + bill.witness_timeout_ms.0, "WITNESS_WINDOW_OPEN");
        self.start_refund(key, bill, "timeout")
    }

    /// Tries the split payout again after a failed batch (for example a recipient that was not
    /// registered on the token). Only bills without a witness, or already witnessed, get here.
    pub fn retry_payout(&mut self, merchant: AccountId, bill_id: String) -> Promise {
        let key = bill_key(&merchant, &bill_id);
        let mut bill = self.load(&key);
        require!(bill.state == BillState::PayoutFailed, "BILL_NOT_FAILED");
        bill.state = BillState::Settling;
        self.bills.insert(key.clone(), bill.clone());
        self.payout(&key, &bill)
    }

    // ---- AI spending pass -----------------------------------------------

    /// Pays an open bill from a pass. Only the pass's agent may call it, only before expiry, only
    /// for an exact open bill in the pass token, within the per-bill limit and the balance. The bill's
    /// payer is the pass owner, so a witness timeout or a merchant refund pays the owner back.
    pub fn pass_pay(&mut self, owner: AccountId, pass_id: String, merchant: AccountId, bill_id: String) -> PromiseOrValue<U128> {
        let pkey = pass_key(&owner, &pass_id);
        let mut map = passes();
        let mut pass = map.get(&pkey).unwrap_or_else(|| env::panic_str("PASS_NOT_FOUND"));
        require!(env::predecessor_account_id() == pass.agent, "AGENT_ONLY");
        require!(!pass.closed, "PASS_CLOSED");
        require!(now_ms() <= pass.expires_at_ms.0, "PASS_EXPIRED");
        if let Some(only) = &pass.merchant {
            require!(only == &merchant, "PASS_MERCHANT_MISMATCH");
        }
        let key = bill_key(&merchant, &bill_id);
        let mut bill = self.load(&key);
        require!(bill.state == BillState::Open, "BILL_NOT_OPEN");
        require!(bill.token == pass.token, "WRONG_TOKEN");
        require!(now_ms() <= bill.expires_at_ms.0, "BILL_EXPIRED");
        require!(bill.total.0 <= pass.max_bill.0, "PASS_BILL_LIMIT");
        require!(bill.total.0 <= pass.balance.0, "PASS_BALANCE_LOW");
        pass.balance = U128(pass.balance.0 - bill.total.0);
        pass.bills_paid += 1;
        map.insert(&pkey, &pass);
        bill.payer = Some(owner.clone());
        bill.paid_at_ms = U64(now_ms());
        bill.state = if bill.witness_pk.is_some() { BillState::Escrow } else { BillState::Settling };
        self.bills.insert(key.clone(), bill.clone());
        emit("bill_paid", json!({"merchant": bill.merchant, "bill_id": bill.bill_id, "token": bill.token, "payer": owner,
            "amount": bill.total, "escrow": bill.state == BillState::Escrow, "pass_id": pass_id, "agent": pass.agent}));
        if bill.state == BillState::Escrow {
            PromiseOrValue::Value(U128(0))
        } else {
            PromiseOrValue::Promise(self.payout(&key, &bill))
        }
    }

    /// Ends a pass and sends the unspent balance to its owner. The owner may close it at any
    /// time; after expiry anyone may, so an expired pass never keeps the money.
    pub fn pass_close(&mut self, owner: AccountId, pass_id: String) -> PromiseOrValue<()> {
        let pkey = pass_key(&owner, &pass_id);
        let mut map = passes();
        let mut pass = map.get(&pkey).unwrap_or_else(|| env::panic_str("PASS_NOT_FOUND"));
        require!(!pass.closed, "PASS_CLOSED");
        require!(env::predecessor_account_id() == owner || now_ms() > pass.expires_at_ms.0, "PASS_STILL_ACTIVE");
        let amount = pass.balance;
        pass.closed = true;
        pass.balance = U128(0);
        map.insert(&pkey, &pass);
        let reason = if now_ms() > pass.expires_at_ms.0 { "expired" } else { "owner" };
        if amount.0 == 0 {
            emit("pass_closed", json!({"owner": owner, "pass_id": pass_id, "refunded": amount, "reason": reason}));
            return PromiseOrValue::Value(());
        }
        let args = json!({"receiver_id": owner, "amount": amount, "memo": format!("bitpos:pass:{pass_id}:refund")});
        PromiseOrValue::Promise(
            Promise::new(pass.token.clone())
                .function_call("ft_transfer".to_string(), args.to_string().into_bytes(), ONE_YOCTO, GAS_FT_TRANSFER)
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_pass_close(pkey, amount, reason.to_string())),
        )
    }

    pub fn get_pass(&self, owner: AccountId, pass_id: String) -> Option<Pass> {
        passes().get(&pass_key(&owner, &pass_id))
    }

    pub fn pass_ttls_ms(&self) -> Vec<U64> {
        PASS_TTLS_MS.iter().map(|t| U64(*t)).collect()
    }

    // ---- callbacks ------------------------------------------------------

    #[private]
    pub fn on_pass_close(&mut self, key: String, amount: U128, reason: String) {
        let mut map = passes();
        let mut pass = map.get(&key).unwrap_or_else(|| env::panic_str("PASS_NOT_FOUND"));
        if matches!(env::promise_result(0), PromiseResult::Successful(_)) {
            emit("pass_closed", json!({"owner": pass.owner, "pass_id": pass.pass_id, "refunded": amount, "reason": reason}));
        } else {
            // The transfer failed: put the money back on the pass and end it now, so the agent can no
            // longer spend and anyone may call `pass_close` again to send it to the owner.
            pass.balance = amount;
            pass.closed = false;
            pass.expires_at_ms = U64(now_ms().saturating_sub(1).min(pass.expires_at_ms.0));
            map.insert(&key, &pass);
            emit("pass_refund_failed", json!({"owner": pass.owner, "pass_id": pass.pass_id, "amount": amount}));
        }
    }

    #[private]
    pub fn on_payout(&mut self, key: String) -> U128 {
        let mut bill = self.load(&key);
        require!(bill.state == BillState::Settling, "BILL_NOT_SETTLING");
        if matches!(env::promise_result(0), PromiseResult::Successful(_)) {
            bill.state = BillState::Settled;
            bill.closed_at_ms = U64(now_ms());
            emit(
                "bill_settled",
                json!({"merchant": bill.merchant, "bill_id": bill.bill_id, "token": bill.token, "total": bill.total,
                       "payouts": bill.payouts}),
            );
        } else {
            bill.state = BillState::PayoutFailed;
            emit("payout_failed", json!({"merchant": bill.merchant, "bill_id": bill.bill_id}));
        }
        self.bills.insert(key, bill);
        // The contract keeps the whole payment either way: nothing goes back through the token's
        // resolve step. A failed payout stays here for `retry_payout` or `reclaim`.
        U128(0)
    }

    #[private]
    pub fn on_refund(&mut self, key: String, reason: String) {
        let mut bill = self.load(&key);
        require!(bill.state == BillState::Refunding, "BILL_NOT_REFUNDING");
        if matches!(env::promise_result(0), PromiseResult::Successful(_)) {
            bill.state = BillState::Refunded;
            bill.closed_at_ms = U64(now_ms());
            emit(
                "bill_refunded",
                json!({"merchant": bill.merchant, "bill_id": bill.bill_id, "token": bill.token, "payer": bill.payer,
                       "amount": bill.total, "reason": reason}),
            );
        } else {
            bill.state = BillState::PayoutFailed;
            emit("refund_failed", json!({"merchant": bill.merchant, "bill_id": bill.bill_id}));
        }
        self.bills.insert(key, bill);
    }

    // ---- views ----------------------------------------------------------

    pub fn get_bill(&self, merchant: AccountId, bill_id: String) -> Option<Bill> {
        self.bills.get(&bill_key(&merchant, &bill_id)).cloned()
    }

    pub fn get_config(&self) -> Value {
        json!({"version": VERSION, "owner": self.owner, "bill_count": U64(self.bill_count), "max_payouts": MAX_PAYOUTS})
    }

    pub fn is_token_allowed(&self, token: AccountId) -> bool {
        self.tokens.get(&token).copied().unwrap_or(false)
    }

    pub fn is_merchant_active(&self, merchant: AccountId) -> bool {
        self.merchants.get(&merchant).copied().unwrap_or(false)
    }

    pub fn witness_message_for(&self, merchant: AccountId, bill_id: String) -> String {
        witness_message(&env::current_account_id(), &merchant, &bill_id)
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "OWNER_ONLY");
    }

    fn load(&self, key: &String) -> Bill {
        self.bills.get(key).cloned().unwrap_or_else(|| env::panic_str("BILL_NOT_FOUND"))
    }

    fn create_pass(&mut self, token: &AccountId, owner: &AccountId, amount: U128, msg: &str) -> Result<Pass, &'static str> {
        if !self.tokens.get(token).copied().unwrap_or(false) {
            return Err("TOKEN_NOT_ALLOWED");
        }
        let parsed: Value = serde_json::from_str(msg).map_err(|_| "MSG_INVALID")?;
        let p = &parsed["pass"];
        let pass_id = p["id"].as_str().filter(|id| valid_id(id)).ok_or("PASS_ID_INVALID")?;
        let agent: AccountId = p["agent"].as_str().and_then(|a| a.parse().ok()).ok_or("PASS_AGENT_INVALID")?;
        if &agent == owner {
            return Err("PASS_AGENT_IS_OWNER");
        }
        let ttl = p["ttl_ms"].as_str().and_then(|t| t.parse::<u64>().ok()).or_else(|| p["ttl_ms"].as_u64()).ok_or("PASS_TTL_INVALID")?;
        if !PASS_TTLS_MS.contains(&ttl) {
            return Err("PASS_TTL_INVALID");
        }
        let max_bill = p["max_bill"].as_str().and_then(|t| t.parse::<u128>().ok()).unwrap_or(amount.0);
        if amount.0 == 0 || max_bill == 0 || max_bill > amount.0 {
            return Err("PASS_LIMIT_INVALID");
        }
        let merchant = match p["merchant"].as_str() {
            None => None,
            Some(m) => Some(m.parse::<AccountId>().map_err(|_| "PASS_MERCHANT_INVALID")?),
        };
        let key = pass_key(owner, pass_id);
        let mut map = passes();
        if map.get(&key).is_some() {
            return Err("PASS_EXISTS");
        }
        let now = now_ms();
        let pass = Pass {
            owner: owner.clone(),
            pass_id: pass_id.to_string(),
            agent,
            token: token.clone(),
            cap: amount,
            balance: amount,
            max_bill: U128(max_bill),
            merchant,
            created_at_ms: U64(now),
            expires_at_ms: U64(now + ttl),
            bills_paid: 0,
            closed: false,
        };
        map.insert(&key, &pass);
        Ok(pass)
    }

    fn accept_payment(
        &mut self,
        token: &AccountId,
        payer: &AccountId,
        amount: U128,
        msg: &str,
    ) -> Result<(String, Bill), &'static str> {
        if !self.tokens.get(token).copied().unwrap_or(false) {
            return Err("TOKEN_NOT_ALLOWED");
        }
        let parsed: Value = serde_json::from_str(msg).map_err(|_| "MSG_INVALID")?;
        let merchant: AccountId = parsed["m"].as_str().and_then(|m| m.parse().ok()).ok_or("MSG_INVALID")?;
        let bill_id = parsed["b"].as_str().ok_or("MSG_INVALID")?;
        let key = bill_key(&merchant, bill_id);
        let mut bill = self.bills.get(&key).cloned().ok_or("BILL_NOT_FOUND")?;
        if bill.state != BillState::Open {
            return Err("BILL_NOT_OPEN");
        }
        if &bill.token != token {
            return Err("WRONG_TOKEN");
        }
        if now_ms() > bill.expires_at_ms.0 {
            return Err("BILL_EXPIRED");
        }
        if amount != bill.total {
            return Err("WRONG_AMOUNT");
        }
        bill.payer = Some(payer.clone());
        bill.paid_at_ms = U64(now_ms());
        bill.state = if bill.witness_pk.is_some() { BillState::Escrow } else { BillState::Settling };
        self.bills.insert(key.clone(), bill.clone());
        Ok((key, bill))
    }

    /// One receipt on the token contract holding every transfer: all recipients are paid or none.
    fn payout(&self, key: &str, bill: &Bill) -> Promise {
        let mut batch = Promise::new(bill.token.clone());
        for payout in &bill.payouts {
            let args = json!({
                "receiver_id": payout.account,
                "amount": payout.amount,
                "memo": format!("bitpos:{}:{}", bill.bill_id, payout.role),
            });
            batch = batch.function_call("ft_transfer".to_string(), args.to_string().into_bytes(), ONE_YOCTO, GAS_FT_TRANSFER);
        }
        batch.then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_payout(key.to_string()))
    }

    fn start_refund(&mut self, key: String, mut bill: Bill, reason: &str) -> Promise {
        let payer = bill.payer.clone().unwrap_or_else(|| env::panic_str("BILL_HAS_NO_PAYER"));
        bill.state = BillState::Refunding;
        self.bills.insert(key.clone(), bill.clone());
        let args = json!({"receiver_id": payer, "amount": bill.total, "memo": format!("bitpos:{}:refund", bill.bill_id)});
        Promise::new(bill.token.clone())
            .function_call("ft_transfer".to_string(), args.to_string().into_bytes(), ONE_YOCTO, GAS_FT_TRANSFER)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_refund(key, reason.to_string()),
            )
    }
}

#[cfg(test)]
mod tests;
