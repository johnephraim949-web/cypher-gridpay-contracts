use super::*;
use soroban_sdk::testutils::Address as _;

#[test]
fn guarantee_caps_exposure_blocks_double_payment_and_repayment_restores_eligibility() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RefundContract, ());
    let client = RefundContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let customer = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let issuer = token::StellarAssetClient::new(&env, &asset);
    issuer.mint(&admin, &500);
    issuer.mint(&merchant, &150);
    client.initialize(&admin);
    client.set_buyer_protection_config(
        &admin,
        &BuyerProtectionConfig {
            enabled: true,
            max_payout_per_claim: 100,
            max_payout_per_merchant: 150,
            fee_allocation_bps: 0,
        },
    );
    client.fund_buyer_protection_pool(&admin, &asset, &500);
    let mut ids = [0; 3];
    for (index, id) in ids.iter_mut().enumerate() {
        *id = client.request_refund(
            &merchant,
            &((index + 1) as u64),
            &customer,
            &200,
            &200,
            &asset,
            &String::from_str(&env, "adjudicated refund"),
            &RefundReasonCode::Other,
            &0,
        );
        client.approve_refund(&admin, id);
        env.as_contract(&contract_id, || {
            RefundContract::mark_arbitration_award(&env, *id)
        });
    }
    assert_eq!(
        client.try_process_refund(&admin, &ids[0]),
        Err(Ok(Error::Ext(ExtError::RefundInsolvent)))
    );
    assert_eq!(
        client.claim_buyer_protection_payout(&customer, &ids[0]),
        100
    );
    assert_eq!(
        client.get_refund(&ids[0]).status,
        RefundStatus::ProcessedViaGuarantee
    );
    assert!(client.try_process_refund(&admin, &ids[0]).is_err());
    assert!(client
        .try_claim_buyer_protection_payout(&customer, &ids[0])
        .is_err());
    assert_eq!(client.claim_buyer_protection_payout(&admin, &ids[1]), 50);
    assert!(client
        .try_claim_buyer_protection_payout(&customer, &ids[2])
        .is_err());
    assert!(!client.is_merchant_eligible(&merchant));
    client.repay_merchant_protection_debt(&merchant, &asset, &50);
    assert!(!client.is_merchant_eligible(&merchant));
    client.repay_merchant_protection_debt(&merchant, &asset, &100);
    assert!(client.is_merchant_eligible(&merchant));
    assert_eq!(client.get_buyer_protection_balance(&asset), 500);
}
