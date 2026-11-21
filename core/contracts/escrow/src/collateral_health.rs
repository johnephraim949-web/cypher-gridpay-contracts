use super::*;

const MARGIN_CALL_COOLDOWN_SECS: u64 = 3_600;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CollateralHealthStatus {
    Healthy,
    MarginCall,
    Liquidatable,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralHealthReport {
    pub health_factor_bps: u32,
    pub status: CollateralHealthStatus,
}

#[contractevent]
pub struct CollateralMarginCall {
    #[topic]
    pub escrow_id: u64,
    pub health_factor_bps: u32,
}

#[contractevent]
pub struct CollateralToppedUp {
    #[topic]
    pub escrow_id: u64,
    pub contributor: Address,
    pub amount: i128,
    pub new_health_bps: u32,
}

#[contractimpl]
impl EscrowContract {
    /// The original dispute parties remain the only beneficiaries of collateral.
    pub fn top_up_collateral_for(
        env: Env,
        contributor: Address,
        escrow_id: u64,
        additional_amount: i128,
    ) -> Result<u32, Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Basic(BasicError::ReentrantCallDetected))?;
        contributor.require_auth();
        Self::require_not_paused(&env, "top_up_collateral_for")?;
        if additional_amount <= 0 {
            return Err(Error::Action(ActionError::InsufficientCollateral));
        }
        let (escrow, mut collateral, config) = Self::collateral_position(&env, escrow_id)?;
        let price = Self::get_oracle_price(env.clone(), &config.oracle)?;
        collateral.amount = collateral
            .amount
            .checked_add(additional_amount)
            .ok_or(Error::Action(ActionError::InsufficientCollateral))?;
        let report =
            Self::collateral_health_report(&env, &escrow, &collateral, &config, price.price);
        let key = DataKey::Dispute(DisputeKey::Collateral(escrow_id));
        env.storage().instance().set(&key, &collateral);
        token::Client::new(&env, &collateral.token).transfer(
            &contributor,
            &env.current_contract_address(),
            &additional_amount,
        );
        CollateralToppedUp {
            escrow_id,
            contributor,
            amount: additional_amount,
            new_health_bps: report.health_factor_bps,
        }
        .publish(&env);
        Ok(report.health_factor_bps)
    }

    pub fn check_collateral_health(
        env: Env,
        escrow_id: u64,
    ) -> Result<CollateralHealthReport, Error> {
        let (escrow, collateral, config) = Self::collateral_position(&env, escrow_id)?;
        let price = Self::get_oracle_price(env.clone(), &config.oracle)?;
        Ok(Self::collateral_health_report(
            &env,
            &escrow,
            &collateral,
            &config,
            price.price,
        ))
    }

    /// Returns whether this call emitted a margin-call event.
    pub fn flag_margin_call(env: Env, escrow_id: u64) -> Result<bool, Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Basic(BasicError::ReentrantCallDetected))?;
        let report = Self::check_collateral_health(env.clone(), escrow_id)?;
        if report.status != CollateralHealthStatus::MarginCall {
            return Ok(false);
        }
        let key = DataKey::Dispute(DisputeKey::LastMarginCall(escrow_id));
        let last: Option<u64> = env.storage().instance().get(&key);
        let now = env.ledger().timestamp();
        if last.is_some_and(|last| now.saturating_sub(last) < MARGIN_CALL_COOLDOWN_SECS) {
            return Ok(false);
        }
        env.storage().instance().set(&key, &now);
        CollateralMarginCall {
            escrow_id,
            health_factor_bps: report.health_factor_bps,
        }
        .publish(&env);
        Ok(true)
    }

    pub(super) fn collateral_position(
        env: &Env,
        escrow_id: u64,
    ) -> Result<(Escrow, DisputeCollateral, LiquidationConfig), Error> {
        if !env
            .storage()
            .instance()
            .has(&DataKey::Escrow(EscrowKey::Data(escrow_id)))
        {
            return Err(Error::Escrow(EscrowError::NotFound));
        }
        let escrow = Self::get_escrow(env, escrow_id);
        if escrow.status != EscrowStatus::Disputed {
            return Err(Error::Escrow(EscrowError::InvalidStatus));
        }
        let config = Self::get_liquidation_config(env.clone())
            .ok_or(Error::Escrow(EscrowError::NotFound))?;
        if !config.enabled {
            return Err(Error::Escrow(EscrowError::InvalidStatus));
        }
        let collateral = env
            .storage()
            .instance()
            .get(&DataKey::Dispute(DisputeKey::Collateral(escrow_id)))
            .ok_or(Error::Action(ActionError::InsufficientCollateral))?;
        Ok((escrow, collateral, config))
    }

    pub(super) fn collateral_health_report(
        env: &Env,
        escrow: &Escrow,
        collateral: &DisputeCollateral,
        config: &LiquidationConfig,
        price: i128,
    ) -> CollateralHealthReport {
        // Liquidation's oracle publishes prices pre-scaled for the bps ratio.
        let health_factor_bps = if escrow.amount > 0 {
            let health = soroban_sdk::I256::from_i128(env, collateral.amount)
                .mul(&soroban_sdk::I256::from_i128(env, price))
                .div(&soroban_sdk::I256::from_i128(env, escrow.amount));
            health
                .to_i128()
                .unwrap_or(i128::MAX)
                .clamp(0, i128::from(u32::MAX)) as u32
        } else {
            u32::MAX
        };
        let status = if health_factor_bps <= config.ltv_threshold_bps {
            CollateralHealthStatus::Liquidatable
        } else if health_factor_bps <= config.margin_call_bps {
            CollateralHealthStatus::MarginCall
        } else {
            CollateralHealthStatus::Healthy
        };
        CollateralHealthReport {
            health_factor_bps,
            status,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[contract]
    struct CollateralTestOracle;

    #[contractimpl]
    impl CollateralTestOracle {
        pub fn get_price(env: Env, _feed: BytesN<32>) -> OraclePriceData {
            OraclePriceData {
                price: 13_000,
                timestamp: env.ledger().timestamp(),
            }
        }
    }

    #[test]
    fn top_up_preserves_beneficiaries_and_margin_alert_obeys_cooldown() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(100);
        let address = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &address);
        let admin = Address::generate(&env);
        let customer = Address::generate(&env);
        let vendor = Address::generate(&env);
        let contributor = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let issuer = token::StellarAssetClient::new(&env, &asset);
        issuer.mint(&customer, &200);
        issuer.mint(&contributor, &20);
        client.initialize(&admin);
        client.set_dispute_config(
            &admin,
            &DisputeConfig {
                collateral_token: asset.clone(),
                collateral_amount: 100,
                collateral_enabled: true,
                min_collateral_ratio_bps: 10_000,
            },
        );
        client.set_liquidation_config(
            &admin,
            &LiquidationConfig {
                enabled: true,
                ltv_threshold_bps: 12_000,
                margin_call_bps: 14_000,
                oracle: OracleConfig {
                    oracle_address: env.register(CollateralTestOracle, ()),
                    price_feed_id: BytesN::from_array(&env, &[0; 32]),
                    staleness_threshold: 0,
                },
            },
        );
        let id = client.create_escrow(
            &customer, &vendor, &100, &asset, &10_000, &0, &20_000, &false,
        );
        client.dispute_escrow(&customer, &id);
        assert_eq!(
            client.check_collateral_health(&id).status,
            CollateralHealthStatus::MarginCall
        );
        assert!(client.flag_margin_call(&id));
        assert!(!client.flag_margin_call(&id));
        env.ledger().set_timestamp(3700);
        assert!(client.flag_margin_call(&id));
        assert_eq!(client.top_up_collateral_for(&contributor, &id, &20), 15_600);
        assert!(!client.flag_margin_call(&id));
        assert!(client.try_liquidate_collateral(&contributor, &id).is_err());
        let collateral = client.get_dispute_collateral(&id);
        assert_eq!(collateral.disputing_party, customer);
        assert_eq!(collateral.amount, 120);
        client.resolve_dispute(&admin, &id, &false);
        let balances = token::Client::new(&env, &asset);
        assert_eq!(balances.balance(&customer), 220);
        assert_eq!(balances.balance(&contributor), 0);
    }
}
