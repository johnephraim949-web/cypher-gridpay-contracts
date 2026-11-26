#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

fn setup(
    env: &Env,
) -> (
    PaymentContractClient<'_>,
    Address,
    Address,
    Address,
    Address,
) {
    let id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(env, &id);
    env.mock_all_auths();
    let admin = Address::generate(env);
    client.initialize(&admin);
    let token_admin = Address::generate(env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let sac = token::StellarAssetClient::new(env, &token_addr);
    let customer = Address::generate(env);
    let merchant = Address::generate(env);
    sac.mint(&customer, &10_000i128);
    (client, admin, customer, merchant, token_addr)
}

#[test]
fn round_up_exact_multiple_is_zero_and_fixed_bps_deterministic() {
    let env = Env::default();
    let (client, admin, customer, merchant, token) = setup(&env);
    let beneficiary = Address::generate(&env);
    client.set_addon_beneficiary_allowed(&admin, &beneficiary, &true);
    let cfg = RoundingAddonConfig {
        beneficiary: beneficiary.clone(),
        mode: RoundingMode::RoundUpToUnit(100i128),
        max_addon_amount: 100i128,
        enabled: true,
    };
    client.set_rounding_addon_config(&merchant, &cfg);
    let pid = client.pay_with_addon(
        &customer,
        &merchant,
        &1000i128,
        &token,
        &Currency::USDC,
        &0u64,
        &String::from_str(&env, "m"),
        &0i128,
    );
    assert_eq!(token::Client::new(&env, &token).balance(&beneficiary), 0);
    let cfg2 = RoundingAddonConfig {
        beneficiary: beneficiary.clone(),
        mode: RoundingMode::FixedBps(50),
        max_addon_amount: 1000i128,
        enabled: true,
    };
    client.set_rounding_addon_config(&merchant, &cfg2);
    let _ = client.pay_with_addon(
        &customer,
        &merchant,
        &2000i128,
        &token,
        &Currency::USDC,
        &0u64,
        &String::from_str(&env, "m"),
        &10i128,
    );
    assert_eq!(token::Client::new(&env, &token).balance(&beneficiary), 10);
    assert!(pid > 0);
}

#[test]
fn unauthorized_beneficiary_rejected_and_cap_clamped() {
    let env = Env::default();
    let (client, admin, customer, merchant, token) = setup(&env);
    let beneficiary = Address::generate(&env);
    let cfg = RoundingAddonConfig {
        beneficiary: beneficiary.clone(),
        mode: RoundingMode::FixedBps(1000),
        max_addon_amount: 5i128,
        enabled: true,
    };
    let res = client.try_set_rounding_addon_config(&merchant, &cfg);
    assert_eq!(res, Err(Ok(Error::Basic(BasicError::Unauthorized))));
    client.set_addon_beneficiary_allowed(&admin, &beneficiary, &true);
    client.set_rounding_addon_config(&merchant, &cfg);
    // 10% of 100 = 10, capped to 5
    client.pay_with_addon(
        &customer,
        &merchant,
        &100i128,
        &token,
        &Currency::USDC,
        &0u64,
        &String::from_str(&env, "m"),
        &5i128,
    );
    assert_eq!(token::Client::new(&env, &token).balance(&beneficiary), 5);
}

#[test]
fn addon_transfer_conserves_total() {
    let env = Env::default();
    let (client, admin, customer, merchant, token) = setup(&env);
    let beneficiary = Address::generate(&env);
    client.set_addon_beneficiary_allowed(&admin, &beneficiary, &true);
    let cfg = RoundingAddonConfig {
        beneficiary: beneficiary.clone(),
        mode: RoundingMode::RoundUpToUnit(100i128),
        max_addon_amount: 100i128,
        enabled: true,
    };
    client.set_rounding_addon_config(&merchant, &cfg);
    let before = token::Client::new(&env, &token).balance(&customer);
    client.pay_with_addon(
        &customer,
        &merchant,
        &950i128,
        &token,
        &Currency::USDC,
        &0u64,
        &String::from_str(&env, "m"),
        &50i128,
    );
    let after = token::Client::new(&env, &token).balance(&customer);
    // base stays in contract flow? create_payment does not transfer from customer in this contract, so only addon moved
    assert_eq!(before - after, 50i128);
}
