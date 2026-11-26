#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String, Symbol,
};

fn setup() -> (
    Env,
    PaymentContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    let contract_id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token = token_contract.address();
    let customer = Address::generate(&env);
    let merchant = Address::generate(&env);
    let destination = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&customer, &1_000_000i128);
    token::Client::new(&env, &token).approve(&customer, &contract_id, &1_000_000i128, &100_000);

    (
        env,
        client,
        admin,
        customer,
        merchant,
        token,
        destination,
    )
}

fn register(
    client: &PaymentContractClient<'_>,
    merchant: &Address,
    id: &str,
    destination: &Address,
) -> Symbol {
    let storefront_id = Symbol::new(&client.env, id);
    client.register_storefront(merchant, &storefront_id, destination);
    storefront_id
}

#[test]
fn test_storefront_balances_are_isolated_and_conserved() {
    let (env, client, admin, customer, merchant, token, destination) = setup();
    let north = register(&client, &merchant, "north", &destination);
    let south = register(&client, &merchant, "south", &destination);

    let p1 = client.create_storefront_payment(
        &customer,
        &merchant,
        &north,
        &300i128,
        &token,
        &Currency::XLM,
        &0u64,
        &String::from_str(&env, "north order"),
    );
    let p2 = client.create_storefront_payment(
        &customer,
        &merchant,
        &south,
        &500i128,
        &token,
        &Currency::XLM,
        &0u64,
        &String::from_str(&env, "south order"),
    );
    client.complete_payment(&admin, &p1);
    client.complete_payment(&admin, &p2);

    assert_eq!(
        client.get_storefront_balance(&merchant, &north, &token),
        300i128
    );
    assert_eq!(
        client.get_storefront_balance(&merchant, &south, &token),
        500i128
    );
    // Storefront settlement bypasses the flat parent payout pool.
    assert_eq!(client.get_accumulated_balance(&merchant), 0i128);

    let token_client = token::Client::new(&env, &token);
    let before = token_client.balance(&destination);
    assert_eq!(
        client.sweep_storefront_balance(&merchant, &north, &token, &300i128),
        0i128
    );
    assert_eq!(token_client.balance(&destination) - before, 300i128);
    assert_eq!(
        client.get_storefront_balance(&merchant, &north, &token),
        0i128
    );
    assert_eq!(
        client.get_storefront_balance(&merchant, &south, &token),
        500i128
    );

    client.sweep_storefront_balance(&merchant, &south, &token, &500i128);
    assert_eq!(
        client.get_storefront_balance(&merchant, &south, &token),
        0i128
    );
    assert_eq!(token_client.balance(&destination) - before, 800i128);
}

#[test]
fn test_deactivated_storefront_rejects_payments_but_allows_sweep() {
    let (env, client, admin, customer, merchant, token, destination) = setup();
    let id = register(&client, &merchant, "closed", &destination);

    let payment = client.create_storefront_payment(
        &customer,
        &merchant,
        &id,
        &200i128,
        &token,
        &Currency::XLM,
        &0u64,
        &String::from_str(&env, "before deactivation"),
    );
    client.complete_payment(&admin, &payment);

    client.deactivate_storefront(&merchant, &id);
    assert_eq!(
        client.get_storefront_config(&merchant, &id).unwrap().active,
        false
    );
    let result = client.try_create_storefront_payment(
        &customer,
        &merchant,
        &id,
        &100i128,
        &token,
        &Currency::XLM,
        &0u64,
        &String::from_str(&env, "after deactivation"),
    );
    assert_eq!(
        result,
        Err(Ok(Error::Storefront(StorefrontError::Inactive)))
    );

    assert_eq!(
        client.sweep_storefront_balance(&merchant, &id, &token, &200i128),
        0i128
    );
}

#[test]
fn test_storefront_volume_aggregates_under_parent_tier_limit() {
    let (env, client, admin, customer, merchant, token, destination) = setup();
    env.ledger().set_timestamp(1000);
    client.set_merchant_verification_level(&admin, &merchant, &MerchantVerificationLevel::Basic);
    client.set_verification_tier_limits(
        &admin,
        &VerificationTierLimits {
            level: MerchantVerificationLevel::Basic,
            tx_per_period: 0,
            volume_limit: 1000,
        },
    );

    let a = register(&client, &merchant, "a", &destination);
    let b = register(&client, &merchant, "b", &destination);

    client.create_storefront_payment(
        &customer,
        &merchant,
        &a,
        &600i128,
        &token,
        &Currency::XLM,
        &0u64,
        &String::from_str(&env, ""),
    );
    let blocked = client.try_create_storefront_payment(
        &customer,
        &merchant,
        &b,
        &500i128,
        &token,
        &Currency::XLM,
        &0u64,
        &String::from_str(&env, ""),
    );
    assert_eq!(
        blocked,
        Err(Ok(Error::Payment(PaymentError::AmountRateLimitExceeded)))
    );

    // A fresh day restores the shared parent allowance.
    env.ledger().set_timestamp(1000 + 86400);
    let ok = client.try_create_storefront_payment(
        &customer,
        &merchant,
        &b,
        &500i128,
        &token,
        &Currency::XLM,
        &0u64,
        &String::from_str(&env, ""),
    );
    assert!(ok.is_ok());
}

#[test]
fn test_storefront_cap_and_oversweep_rejected() {
    let (_env, client, _admin, _customer, merchant, token, destination) = setup();
    for i in 0..MAX_STOREFRONTS_PER_MERCHANT {
        let name = std::format!("sf{}", i);
        client.register_storefront(&merchant, &Symbol::new(&client.env, &name), &destination);
    }
    let extra = Symbol::new(&client.env, "overflow");
    assert_eq!(
        client.try_register_storefront(&merchant, &extra, &destination),
        Err(Ok(Error::Storefront(StorefrontError::LimitExceeded)))
    );

    let id = Symbol::new(&client.env, "sf0");
    assert_eq!(
        client.try_sweep_storefront_balance(&merchant, &id, &token, &1i128),
        Err(Ok(Error::Storefront(
            StorefrontError::InsufficientBalance
        )))
    );
}

#[test]
fn test_storefront_registration_requires_parent_auth() {
    let env = Env::default();
    let contract_id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &contract_id);
    let merchant = Address::generate(&env);
    let destination = Address::generate(&env);
    let id = Symbol::new(&env, "unauthorized");

    assert!(client
        .try_register_storefront(&merchant, &id, &destination)
        .is_err());
    assert!(client.get_storefront_config(&merchant, &id).is_none());
}
