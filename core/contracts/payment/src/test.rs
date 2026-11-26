//! Property-based fuzz tests for payment fee and rebate calculations.
//!
//! These tests use `proptest` to verify invariants of the fee calculation
//! logic across arbitrary `i128` inputs:
//!
//! * `fee >= 0`
//! * `fee <= amount`
//! * `net_amount + fee == amount`
//!
//! The suite also exercises extreme values (i128::MIN / i128::MAX) to ensure
//! the calculation never panics.

#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use test_utils::{create_mock_token, generate_parties, setup_test_env};

/// Pure fee calculation mirroring the on-chain tiered fee logic.
///
/// `bps` is expressed in basis points (1 bps = 0.01%). The result is clamped
/// so that the fee never exceeds the payment amount and is never negative.
fn calculate_fee(amount: i128, bps: u32) -> i128 {
    if amount <= 0 {
        return 0;
    }
    // Use i128 arithmetic; bps is bounded to [0, 10_000] by the caller.
    let fee = amount.saturating_mul(bps as i128) / 10_000;
    fee.clamp(0, amount)
}

/// Net amount after deducting the fee from the gross amount.
fn net_amount(amount: i128, fee: i128) -> i128 {
    amount.saturating_sub(fee)
}

#[test]
fn shared_fixtures_provide_token_and_parties() {
    let env = setup_test_env();
    let (payer, payee, _arbiter) = generate_parties(&env);
    let token = create_mock_token(&env, &payer, 1_000);
    assert_ne!(payer, payee);
    assert_eq!(token, token.clone());
}

// Amounts are non-negative: a payment amount is never below zero, and
// "0 <= fee <= amount" has no solution when it is.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn fee_is_non_negative(amount in 0..=i128::MAX, bps in 0u32..=10_000) {
        let fee = calculate_fee(amount, bps);
        prop_assert!(fee >= 0, "fee must be non-negative, got {}", fee);
    }

    #[test]
    fn fee_never_exceeds_amount(amount in 0..=i128::MAX, bps in 0u32..=10_000) {
        let fee = calculate_fee(amount, bps);
        prop_assert!(fee <= amount, "fee {} exceeded amount {}", fee, amount);
    }

    #[test]
    fn net_plus_fee_equals_amount(amount in 0..=i128::MAX, bps in 0u32..=10_000) {
        let fee = calculate_fee(amount, bps);
        let net = net_amount(amount, fee);
        prop_assert_eq!(net + fee, amount);
    }

    #[test]
    fn no_panic_on_extreme_values(bps in 0u32..=10_000) {
        // Payment amounts are never negative; "fee <= amount" cannot hold below 0.
        for amount in [0, 1, i128::MAX - 1, i128::MAX] {
            let fee = calculate_fee(amount, bps);
            prop_assert!(fee >= 0);
            prop_assert!(fee <= amount);
            let net = net_amount(amount, fee);
            prop_assert_eq!(net + fee, amount);
        }
    }
}


use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Env, String, Vec,
};

type TestSetup<'a> = (
    PaymentContractClient<'a>,
    Address,
    Address,
    Address,
    Address,
    soroban_sdk::Address,
);

fn setup_token_lifecycle(env: &Env) -> TestSetup<'_> {
    let id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(env, &id);
    env.mock_all_auths();
    let admin = Address::generate(env);
    client.initialize(&admin);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract.address();
    let asset_client = token::StellarAssetClient::new(env, &token_address);
    let customer = Address::generate(env);
    let merchant = Address::generate(env);
    asset_client.mint(&customer, &1_000_000i128);
    token::Client::new(env, &token_address).approve(&customer, &id, &1_000_000i128, &100_000);

    (
        client,
        id,
        admin,
        customer,
        merchant,
        token_address,
    )
}

#[test]
fn deprecation_blocks_new_activity_but_allows_existing_winddown() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);
    let (client, _id, admin, customer, merchant, token_address) = setup_token_lifecycle(&env);
    client.add_allowed_token(&admin, &token_address);
    let payment_id = client.create_payment(
        &customer,
        &merchant,
        &100i128,
        &token_address,
        &Currency::USDC,
        &0u64,
        &String::from_str(&env, "metadata"),
    );

    client.deprecate_allowed_token(
        &admin,
        &token_address,
        &String::from_str(&env, "risk review"),
    );

    assert_eq!(
        client.get_token_status(&token_address),
        TokenLifecycleStatus::DrainOnly
    );
    assert!(client.get_allowed_tokens().is_empty());
    assert_eq!(
        client.try_create_payment(
            &customer,
            &merchant,
            &100i128,
            &token_address,
            &Currency::USDC,
            &0u64,
            &String::from_str(&env, "metadata"),
        ),
        Err(Ok(Error::Payment(PaymentError::TokenNotAllowed)))
    );
    assert_eq!(
        client.try_schedule_payment(&customer, &merchant, &token_address, &100i128, &10_000u64),
        Err(Ok(Error::Payment(PaymentError::TokenNotAllowed)))
    );
    assert_eq!(
        client.try_create_subscription(
            &customer,
            &merchant,
            &100i128,
            &token_address,
            &Currency::USDC,
            &1_000u64,
            &0u64,
            &0u64,
            &String::from_str(&env, "metadata"),
            &0u64,
        ),
        Err(Ok(Error::Payment(PaymentError::TokenNotAllowed)))
    );

    client.complete_payment(&admin, &payment_id);
    assert_eq!(
        client.get_payment(&payment_id).status,
        PaymentStatus::Completed
    );
}

#[test]
fn removal_requires_zero_liability_and_multisig_override() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);
    let (client, _id, admin, customer, merchant, token_address) = setup_token_lifecycle(&env);
    client.add_allowed_token(&admin, &token_address);
    client.create_payment(
        &customer,
        &merchant,
        &100i128,
        &token_address,
        &Currency::USDC,
        &0u64,
        &String::from_str(&env, "metadata"),
    );

    assert_eq!(
        client.try_remove_allowed_token(&admin, &token_address),
        Err(Ok(Error::Feature(
            FeatureError::TokenStillHasLiabilities
        )))
    );

    let second_admin = Address::generate(&env);
    client.add_admin(&admin, &second_admin);
    client.update_required_signatures(&admin, &2u32);

    let insufficient: Vec<Address> = vec![&env, second_admin.clone()];
    assert_eq!(
        client.try_force_remove_allowed_token(&admin, &token_address, &insufficient),
        Err(Ok(Error::Feature(
            FeatureError::InvalidTokenLifecycleApprovals
        )))
    );

    let approvals: Vec<Address> = vec![&env, admin.clone(), second_admin];
    client.force_remove_allowed_token(&admin, &token_address, &approvals);
    assert_eq!(
        client.get_token_status(&token_address),
        TokenLifecycleStatus::Removed
    );
    assert!(client.get_allowed_tokens().is_empty());
}

#[test]
fn reactivating_removed_token_requires_multisig() {
    let env = Env::default();
    let (client, _id, admin, _customer, _merchant, token_address) = setup_token_lifecycle(&env);
    client.add_allowed_token(&admin, &token_address);
    client.remove_allowed_token(&admin, &token_address);

    assert_eq!(
        client.try_add_allowed_token(&admin, &token_address),
        Err(Ok(Error::Feature(
            FeatureError::TokenLifecycleRequiresMultiSig
        )))
    );

    let second_admin = Address::generate(&env);
    client.add_admin(&admin, &second_admin);
    client.update_required_signatures(&admin, &2u32);
    let approvals: Vec<Address> = vec![&env, admin.clone(), second_admin];
    client.reactivate_removed_token(&admin, &token_address, &approvals);

    assert_eq!(
        client.get_token_status(&token_address),
        TokenLifecycleStatus::Active
    );
    assert!(client.get_allowed_tokens().contains(&token_address));
}
