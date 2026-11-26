#![cfg(test)]

extern crate std;

use crate::{Error, FeatureError, PaymentContract, PaymentContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

fn setup() -> (Env, PaymentContractClient<'static>, Address, Address, token::Client<'static>, token::StellarAssetClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let token_admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_client = token::Client::new(&env, &token_addr);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_addr);
    (env, client, admin, token_addr, token_client, token_admin_client)
}

#[test]
fn test_prepaid_vault_fund_spend_transfer_withdraw() {
    let (env, client, _admin, token_addr, token_client, token_admin) = setup();
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let new_owner = Address::generate(&env);
    token_admin.mint(&funder, &1_000);

    let vault_id = client.deposit_prepaid_vault(&funder, &owner, &None, &token_addr, &500, &None, &true);
    assert_eq!(token_client.balance(&funder), 500);
    assert_eq!(token_client.balance(&client.address), 500);

    let _ = client.pay_from_prepaid_vault(&owner, &vault_id, &merchant, &200);
    assert_eq!(token_client.balance(&merchant), 200);

    client.transfer_prepaid_vault(&owner, &vault_id, &new_owner);
    client.withdraw_unused_prepaid(&new_owner, &vault_id, &300);
    assert_eq!(token_client.balance(&new_owner), 300);

    let vault = client.get_prepaid_vault(&vault_id);
    assert_eq!(vault.owner, new_owner);
    assert_eq!(vault.balance, 0);
}

#[test]
fn test_prepaid_vault_merchant_restriction() {
    let (env, client, _admin, token_addr, _token_client, token_admin) = setup();
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let other = Address::generate(&env);
    token_admin.mint(&funder, &500);

    let vault_id = client.deposit_prepaid_vault(&funder, &owner, &Some(merchant.clone()), &token_addr, &500, &None, &false);
    let err = client.try_pay_from_prepaid_vault(&owner, &vault_id, &other, &100).unwrap_err().unwrap();
    assert_eq!(err, Error::Feature(FeatureError::PrepaidVaultMerchantMismatch));

    let _ = client.pay_from_prepaid_vault(&owner, &vault_id, &merchant, &100);
}

#[test]
fn test_prepaid_vault_withdraw_restrictions_and_transfer_guards() {
    let (env, client, _admin, token_addr, _token_client, token_admin) = setup();
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);
    let new_owner = Address::generate(&env);
    token_admin.mint(&funder, &500);

    let restricted = client.deposit_prepaid_vault(&funder, &owner, &Some(merchant), &token_addr, &200, &None, &false);
    let err = client.try_withdraw_unused_prepaid(&owner, &restricted, &50).unwrap_err().unwrap();
    assert_eq!(err, Error::Basic(crate::BasicError::Unauthorized));

    let err = client.try_transfer_prepaid_vault(&owner, &restricted, &new_owner).unwrap_err().unwrap();
    assert_eq!(err, Error::Feature(FeatureError::PrepaidVaultNotTransferable));
}

#[test]
fn test_fee_sweep_never_encroaches_prepaid_liability() {
    let (env, client, admin, token_addr, token_client, token_admin) = setup();
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);
    let treasury = Address::generate(&env);
    token_admin.mint(&funder, &1_000);

    // Configure fee token; accumulated fees tracked in instance storage.
    client.set_fee_config(&admin, &100, &0, &1_000, &treasury, &token_addr, &true);
    env.as_contract(&client.address, || {
        env.storage().instance().set(&crate::DataKey::Payment(crate::PaymentKey::AccumulatedFees), &300i128);
    });
    // Contract holds 300 fee balance before vault deposit.
    token_admin.mint(&client.address, &300);

    client.deposit_prepaid_vault(&funder, &owner, &None, &token_addr, &500, &None, &true);

    // Contract balance is 800 (300 fees + 500 prepaid). Reserved prepaid is 500, so only 300 available.
    let err = client.try_withdraw_fees(&admin, &400).unwrap_err().unwrap();
    assert_eq!(err, Error::Feature(FeatureError::InsufficientBalanceForSweep));

    client.withdraw_fees(&admin, &300);
    assert_eq!(token_client.balance(&treasury), 300);
    assert_eq!(token_client.balance(&client.address), 500);
}
