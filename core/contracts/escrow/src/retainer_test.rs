use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};

#[test]
fn retainer_caps_rollover_and_notice() {
    for rollover in [false, true] {
        let env = Env::default();
        env.mock_all_auths();
        let address = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &address);
        let client = Address::generate(&env);
        let vendor = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        token::StellarAssetClient::new(&env, &asset).mint(&client, &300);
        let balance = token::Client::new(&env, &asset);
        let digest = BytesN::from_array(&env, &[1; 32]);
        env.ledger().set_timestamp(100);
        let id =
            contract.create_retainer_escrow(&client, &vendor, &asset, &300, &10, &100, &rollover);
        contract.draw_retainer_funds(&vendor, &id, &40, &digest);
        assert!(contract
            .try_draw_retainer_funds(&vendor, &id, &61, &digest)
            .is_err());
        env.ledger().set_timestamp(110);
        let next_draw = if rollover { 160 } else { 100 };
        contract.draw_retainer_funds(&vendor, &id, &next_draw, &digest);
        assert!(contract
            .try_draw_retainer_funds(&vendor, &id, &1, &digest)
            .is_err());
        contract.terminate_retainer_escrow(&client, &id, &10);
        assert!(contract
            .try_withdraw_retainer_balance(&client, &id)
            .is_err());
        env.ledger().set_timestamp(120);
        assert!(contract
            .try_draw_retainer_funds(&vendor, &id, &1, &digest)
            .is_err());
        assert_eq!(
            contract.withdraw_retainer_balance(&client, &id),
            260 - next_draw
        );
        assert!(contract
            .try_withdraw_retainer_balance(&client, &id)
            .is_err());
        assert_eq!(balance.balance(&vendor), 40 + next_draw);
        assert_eq!(balance.balance(&address), 0);
    }
}
