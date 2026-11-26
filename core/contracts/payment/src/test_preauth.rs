#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String,
};

/// Standard test harness: deploys the contract, mints tokens to a customer,
/// and approves the contract to spend them.
fn setup(
    env: &Env,
) -> (
    PaymentContractClient,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(env, &id);
    let admin = Address::generate(env);
    env.mock_all_auths();
    client.initialize(&admin);

    let token_admin_addr = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
    let token_address = token_contract.address();
    let asset_client = token::StellarAssetClient::new(env, &token_address);

    let customer = Address::generate(env);
    let merchant = Address::generate(env);
    asset_client.mint(&customer, &10_000_000i128);
    token::Client::new(env, &token_address).approve(&customer, &id, &10_000_000i128, &100_000);

    (client, admin, merchant, customer, token_address, id)
}

/// Sets a 10 bps fee configuration so fee calculations can be verified.
fn set_fee(
    _env: &Env,
    client: &PaymentContractClient,
    admin: &Address,
    treasury: &Address,
    token: &Address,
) {
    client.set_fee_config(
        admin,
        &FeeConfig {
            fee_bps: 100, // 1%
            min_fee: 0,
            max_fee: 0,
            treasury: treasury.clone(),
            fee_token: token.clone(),
            active: true,
        },
    );
}

// ── Full capture ─────────────────────────────────────────────────────────────

/// Capturing the full authorized amount credits the merchant (net of fee) and
/// leaves zero refund for the customer.
#[test]
fn test_full_capture() {
    let env = Env::default();
    let (client, admin, merchant, customer, token, contract_id) = setup(&env);
    let treasury = Address::generate(&env);
    set_fee(&env, &client, &admin, &treasury, &token);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;
    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "EV charge"),
    );

    // Capture the full amount.
    client.capture_payment(&merchant, &auth_id, &max_amount);

    let preauth = client.get_preauth(&auth_id).unwrap();
    assert_eq!(preauth.status, PreAuthStatus::Captured);
    assert_eq!(preauth.captured_amount, max_amount);

    // Fee = 1% of 5000 = 50; merchant gets 4950.
    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&merchant), 4950);
    // Customer gets no refund (full capture).
    assert_eq!(token_client.balance(&customer), 10_000_000 - 5_000);
    // Fee stays in the contract.
    assert_eq!(token_client.balance(&contract_id), 50);
}

// ── Partial capture with remainder return ────────────────────────────────────

/// Partial capture: merchant receives the captured amount net of fee, and the
/// unused remainder is atomically refunded to the customer.
#[test]
fn test_partial_capture_with_remainder() {
    let env = Env::default();
    let (client, admin, merchant, customer, token, contract_id) = setup(&env);
    let treasury = Address::generate(&env);
    set_fee(&env, &client, &admin, &treasury, &token);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128; // 50 USDC hold
    let capture_amount = 1_840i128; // 18.40 USDC consumed

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "metered"),
    );

    client.capture_payment(&merchant, &auth_id, &capture_amount);

    let preauth = client.get_preauth(&auth_id).unwrap();
    assert_eq!(preauth.status, PreAuthStatus::Captured);
    assert_eq!(preauth.captured_amount, capture_amount);

    let token_client = token::Client::new(&env, &token);
    let refund = max_amount - capture_amount; // 3160
                                              // Fee uses ceiling division: ceil(1840 * 100 / 10000) = ceil(18.4) = 19
    let fee = (capture_amount * 100 + 9999) / 10000; // 19
    let merchant_net = capture_amount - fee; // 1821

    assert_eq!(token_client.balance(&merchant), merchant_net);
    assert_eq!(
        token_client.balance(&customer),
        10_000_000 - max_amount + refund
    );
    assert_eq!(token_client.balance(&contract_id), fee);
}

// ── Merchant void ────────────────────────────────────────────────────────────

/// The merchant can void an active hold at any time before expiry; the full
/// `max_amount` is returned to the customer.
#[test]
fn test_merchant_void() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "hotel"),
    );

    // Merchant voids before expiry.
    client.void_authorization(&merchant, &auth_id);

    let preauth = client.get_preauth(&auth_id).unwrap();
    assert_eq!(preauth.status, PreAuthStatus::Voided);

    let token_client = token::Client::new(&env, &token);
    // Full amount returned to customer.
    assert_eq!(token_client.balance(&customer), 10_000_000);
    // Contract holds nothing.
    assert_eq!(token_client.balance(&contract_id), 0);
    // Merchant received nothing.
    assert_eq!(token_client.balance(&merchant), 0);
}

// ── Post-expiry customer reclaim ──────────────────────────────────────────────

/// After `expires_at`, the customer can reclaim the expired hold; the full
/// `max_amount` is returned.
#[test]
fn test_post_expiry_customer_reclaim() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;
    let expires_at = now + 100;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &expires_at,
        &String::from_str(&env, "parking"),
    );

    // Advance past expiry.
    env.ledger().set_timestamp(expires_at + 1);

    // Customer reclaims the expired hold.
    client.void_authorization(&customer, &auth_id);

    let preauth = client.get_preauth(&auth_id).unwrap();
    assert_eq!(preauth.status, PreAuthStatus::Expired);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&customer), 10_000_000);
    assert_eq!(token_client.balance(&contract_id), 0);
}

/// After expiry, a random third party may also release the hold (the spec
/// says "customer/anyone to release expired holds").
#[test]
fn test_post_expiry_anyone_can_reclaim() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);
    let stranger = Address::generate(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;
    let expires_at = now + 100;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &expires_at,
        &String::from_str(&env, "rental"),
    );

    env.ledger().set_timestamp(expires_at + 1);

    // After expiry anyone may release (but funds go to customer, not caller).
    client.void_authorization(&stranger, &auth_id);

    let token_client = token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&customer), 10_000_000);
}

// ── Overpayment capture rejection ────────────────────────────────────────────

/// Capturing more than `max_amount` must be rejected.
#[test]
fn test_overpayment_capture_rejected() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );

    let result = client.try_capture_payment(&merchant, &auth_id, &5_001i128);
    assert_eq!(
        result,
        Err(Ok(Error::Payment(PaymentError::CaptureExceedsMax)))
    );
}

// ── Double-capture rejection ─────────────────────────────────────────────────

/// A hold that has already been captured cannot be captured again.
#[test]
fn test_double_capture_rejected() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );

    client.capture_payment(&merchant, &auth_id, &2_000i128);

    let result = client.try_capture_payment(&merchant, &auth_id, &1_000i128);
    assert_eq!(result, Err(Ok(Error::Payment(PaymentError::InvalidStatus))));
}

// ── Capture after expiry rejection ───────────────────────────────────────────

/// Capturing after `expires_at` must be rejected.
#[test]
fn test_capture_after_expiry_rejected() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;
    let expires_at = now + 100;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &expires_at,
        &String::from_str(&env, "ev"),
    );

    env.ledger().set_timestamp(expires_at + 1);

    let result = client.try_capture_payment(&merchant, &auth_id, &1_000i128);
    assert_eq!(
        result,
        Err(Ok(Error::Payment(PaymentError::PreAuthExpired)))
    );
}

// ── Zero / negative capture rejection ────────────────────────────────────────

/// A capture amount of zero must be rejected.
#[test]
fn test_zero_capture_rejected() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );

    let result = client.try_capture_payment(&merchant, &auth_id, &0i128);
    assert_eq!(
        result,
        Err(Ok(Error::Payment(PaymentError::InvalidCaptureAmount)))
    );
}

// ── Unauthorized capture rejection ───────────────────────────────────────────

/// Only the merchant on the hold may capture.
#[test]
fn test_unauthorized_capture_rejected() {
    let env = Env::default();
    let (client, _admin, _merchant, customer, token, _contract_id) = setup(&env);
    let wrong_merchant = Address::generate(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;

    let auth_id = client.authorize_payment(
        &customer,
        &_merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );

    let result = client.try_capture_payment(&wrong_merchant, &auth_id, &1_000i128);
    assert_eq!(result, Err(Ok(Error::Basic(BasicError::Unauthorized))));
}

// ── Non-merchant void before expiry rejected ─────────────────────────────────

/// Before expiry, only the merchant may void; the customer cannot.
#[test]
fn test_customer_cannot_void_before_expiry() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );

    let result = client.try_void_authorization(&customer, &auth_id);
    assert_eq!(result, Err(Ok(Error::Basic(BasicError::Unauthorized))));
}

// ── PreAuth not found ────────────────────────────────────────────────────────

/// Operating on a non-existent auth_id returns PreAuthNotFound.
#[test]
fn test_preauth_not_found() {
    let env = Env::default();
    let (client, _admin, merchant, _customer, _token, _contract_id) = setup(&env);

    let result = client.try_capture_payment(&merchant, &9999u64, &100i128);
    assert_eq!(
        result,
        Err(Ok(Error::Payment(PaymentError::PreAuthNotFound)))
    );

    let result = client.try_void_authorization(&merchant, &9999u64);
    assert_eq!(
        result,
        Err(Ok(Error::Payment(PaymentError::PreAuthNotFound)))
    );
}

// ── Balance conservation ──────────────────────────────────────────────────────

/// Verifies strict balance conservation: the contract balance decrease equals
/// merchant_net + protocol_fee + customer_refund == max_amount.
#[test]
fn test_balance_conservation_partial_capture() {
    let env = Env::default();
    let (client, admin, merchant, customer, token, contract_id) = setup(&env);
    let treasury = Address::generate(&env);
    set_fee(&env, &client, &admin, &treasury, &token);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;
    let capture_amount = 1_840i128;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );

    let token_client = token::Client::new(&env, &token);
    let customer_before = token_client.balance(&customer);
    let merchant_before = token_client.balance(&merchant);
    let contract_before = token_client.balance(&contract_id);

    client.capture_payment(&merchant, &auth_id, &capture_amount);

    let customer_after = token_client.balance(&customer);
    let merchant_after = token_client.balance(&merchant);
    let contract_after = token_client.balance(&contract_id);

    // merchant_net + fee + customer_refund == max_amount
    let merchant_gain = merchant_after - merchant_before;
    let customer_gain = customer_after - customer_before;

    let refund = max_amount - capture_amount;
    let fee = (capture_amount * 100 + 9999) / 10000; // ceiling: ceil(1840*100/10000)=19
    let merchant_net = capture_amount - fee;

    // Merchant receives the captured amount net of fee.
    assert_eq!(merchant_gain, merchant_net);
    // Customer receives the unused remainder as refund.
    assert_eq!(customer_gain, refund);
    // Contract retains only the fee; the rest was paid out.
    assert_eq!(contract_after, fee);

    // Conservation: merchant_net + fee + refund == max_amount
    assert_eq!(merchant_net + fee + refund, max_amount);
}

// ── Reentrancy resistance ────────────────────────────────────────────────────

/// Sequential guarded calls must succeed: the reentrancy guard is released
/// after each call, so a second guarded call does not trip the guard.
#[test]
fn test_sequential_guarded_calls_succeed() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();

    // First authorize (guarded entry point).
    let auth1 = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &5_000i128,
        &(now + 3600),
        &String::from_str(&env, "a"),
    );

    // Second authorize immediately after (guard must be released).
    let auth2 = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &3_000i128,
        &(now + 3600),
        &String::from_str(&env, "b"),
    );

    // Capture first (guarded).
    client.capture_payment(&merchant, &auth1, &2_000i128);

    // Void second (guarded) — must not trip the guard from the capture.
    client.void_authorization(&merchant, &auth2);

    let p1 = client.get_preauth(&auth1).unwrap();
    assert_eq!(p1.status, PreAuthStatus::Captured);
    let p2 = client.get_preauth(&auth2).unwrap();
    assert_eq!(p2.status, PreAuthStatus::Voided);
}

// ── No-fee path ──────────────────────────────────────────────────────────────

/// When no fee config is set, the full capture_amount goes to the merchant.
#[test]
fn test_capture_without_fee_config() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let max_amount = 5_000i128;
    let capture_amount = 2_000i128;

    let auth_id = client.authorize_payment(
        &customer,
        &merchant,
        &token,
        &max_amount,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );

    client.capture_payment(&merchant, &auth_id, &capture_amount);

    let token_client = token::Client::new(&env, &token);
    // No fee: merchant gets the full capture_amount.
    assert_eq!(token_client.balance(&merchant), capture_amount);
    // Customer gets the remainder.
    assert_eq!(
        token_client.balance(&customer),
        10_000_000 - max_amount + (max_amount - capture_amount)
    );
}

// ── Invalid authorize parameters ─────────────────────────────────────────────

/// Authorizing with a zero or negative amount must fail.
#[test]
fn test_authorize_zero_amount_rejected() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let result = client.try_authorize_payment(
        &customer,
        &merchant,
        &token,
        &0i128,
        &(now + 3600),
        &String::from_str(&env, "ev"),
    );
    assert_eq!(result, Err(Ok(Error::Basic(BasicError::InvalidAmount))));
}

/// Authorizing with an expiry in the past must fail.
#[test]
fn test_authorize_past_expiry_rejected() {
    let env = Env::default();
    let (client, _admin, merchant, customer, token, _contract_id) = setup(&env);

    let now = env.ledger().timestamp();
    let result = client.try_authorize_payment(
        &customer,
        &merchant,
        &token,
        &5_000i128,
        &now, // expires now (not in the future)
        &String::from_str(&env, "ev"),
    );
    assert_eq!(
        result,
        Err(Ok(Error::Payment(PaymentError::InvalidScheduleTime)))
    );
}
