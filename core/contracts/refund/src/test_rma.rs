use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};

#[test]
fn rma_requires_delivery_and_expiry_releases_quota() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RefundContract, ());
    let client = RefundContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let customer = Address::generate(&env);
    let carrier = Address::generate(&env);
    let asset = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(&env, &asset).mint(&contract_id, &100);
    let commitment = BytesN::from_array(&env, &[1; 32]);
    let attestation = BytesN::from_array(&env, &[2; 32]);
    env.ledger().set_timestamp(100);
    client.initialize(&admin);
    client.set_merchant_refund_quota(&admin, &merchant, &300, &1000);
    for (payment_id, verifier) in [(1, &merchant), (2, &carrier)] {
        let id = client.request_refund(
            &merchant,
            &payment_id,
            &customer,
            &50,
            &50,
            &asset,
            &String::from_str(&env, "defect"),
            &RefundReasonCode::ProductDefect,
            &0,
        );
        client.approve_refund_with_rma(&merchant, &id, &carrier, &20);
        assert_eq!(
            client.try_process_refund(&admin, &id),
            Err(Ok(Error::Ext(ExtError::RmaDeliveryPending)))
        );
        client.submit_rma_tracking(&customer, &id, &commitment);
        assert!(client.try_expire_unreturned_rma(&merchant, &id).is_err());
        assert!(client
            .try_confirm_rma_delivery(&customer, &id, &attestation)
            .is_err());
        client.confirm_rma_delivery(verifier, &id, &attestation);
        client.process_refund(&admin, &id);
    }
    assert_eq!(token::Client::new(&env, &asset).balance(&customer), 100);
    let id = client.request_refund(
        &merchant,
        &3,
        &customer,
        &50,
        &50,
        &asset,
        &String::from_str(&env, "return"),
        &RefundReasonCode::CustomerRequest,
        &0,
    );
    client.approve_refund_with_rma(&merchant, &id, &carrier, &20);
    assert_eq!(
        client.get_merchant_refund_quota(&merchant).unwrap().used,
        150
    );
    env.ledger().set_timestamp(121);
    client.expire_unreturned_rma(&merchant, &id);
    assert_eq!(
        client.get_merchant_refund_quota(&merchant).unwrap().used,
        100
    );
}
