use super::*;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuyerProtectionConfig {
    pub enabled: bool,
    pub max_payout_per_claim: i128,
    pub max_payout_per_merchant: i128,
    pub fee_allocation_bps: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuyerProtectionPaid {
    #[topic]
    pub refund_id: u64,
    pub merchant: Address,
    pub customer: Address,
    pub token: Address,
    pub amount: i128,
}

#[contractimpl]
impl RefundContract {
    pub fn set_buyer_protection_config(
        env: Env,
        admin: Address,
        config: BuyerProtectionConfig,
    ) -> Result<(), Error> {
        admin.require_auth();
        let owner: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        if owner.as_ref() != Some(&admin) {
            return Err(Error::Core(CoreError::Unauthorized));
        }
        if config.max_payout_per_claim <= 0
            || config.max_payout_per_merchant <= 0
            || config.fee_allocation_bps > 10_000
        {
            return Err(Error::Core(CoreError::InvalidAmount));
        }
        env.storage()
            .instance()
            .set(&DataKey::BuyerProtectionConfig, &config);
        Ok(())
    }

    pub fn get_buyer_protection_config(env: Env) -> Option<BuyerProtectionConfig> {
        env.storage()
            .instance()
            .get(&DataKey::BuyerProtectionConfig)
    }

    pub fn get_buyer_protection_balance(env: Env, token: Address) -> i128 {
        storage::get_persistent(&env, &DataKey::BuyerProtectionBalance(token)).unwrap_or(0)
    }

    pub fn get_merchant_protection_debt(env: Env, merchant: Address, token: Address) -> i128 {
        storage::get_persistent(&env, &DataKey::MerchantProtectionDebt(merchant, token))
            .unwrap_or(0)
    }

    pub fn is_merchant_eligible(env: Env, merchant: Address) -> bool {
        Self::get_merchant_status(env, merchant) == MerchantStatus::Active
    }

    pub fn fund_buyer_protection_pool(
        env: Env,
        funder: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Ext(ExtError::ReentrantCallDetected))?;
        funder.require_auth();
        let contract = env.current_contract_address();
        if amount <= 0 || funder == contract {
            return Err(Error::Core(CoreError::InvalidAmount));
        }
        Self::credit_protection_pool(&env, &token, amount)?;
        token::Client::new(&env, &token).transfer(&funder, &contract, &amount);
        Ok(())
    }

    /// Applies an authenticated supreme-council ruling relayed by the refund admin.
    pub fn apply_supreme_refund_ruling(
        env: Env,
        admin: Address,
        refund_id: u64,
        approved: bool,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env, "apply_supreme_refund_ruling")?;
        admin.require_auth();
        let owner: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        if owner.as_ref() != Some(&admin) {
            return Err(Error::Core(CoreError::Unauthorized));
        }
        let mut refund = Self::get_refund(&env, refund_id)?;
        if refund.status != RefundStatus::EscalatedToSupremeCouncil {
            return Err(Error::Core(CoreError::InvalidStatus));
        }
        let source_key = DataKey::SupremeSourceStatus(refund_id);
        let state = env.storage().instance();
        let (source, indexed_status) = match state.get::<_, RefundStatus>(&source_key) {
            Some(source) => (source, RefundStatus::EscalatedToSupremeCouncil),
            None => {
                // Legacy escalations changed the record but left its prior index intact.
                let index: u64 = state
                    .get(&DataKey::RefundStatusIndex(refund_id))
                    .ok_or(Error::Core(CoreError::InvalidStatus))?;
                let source = if state
                    .get::<_, u64>(&DataKey::RefundsByStatus(RefundStatus::Rejected, index))
                    == Some(refund_id)
                {
                    RefundStatus::Rejected
                } else if state.get::<_, u64>(&DataKey::RefundsByStatus(
                    RefundStatus::PendingAppeal,
                    index,
                )) == Some(refund_id)
                {
                    RefundStatus::PendingAppeal
                } else {
                    return Err(Error::Core(CoreError::InvalidStatus));
                };
                (source.clone(), source)
            }
        };
        let now = env.ledger().timestamp();
        if approved {
            if source == RefundStatus::Rejected {
                Self::check_accumulated_refunds(
                    &env,
                    refund.payment_id,
                    refund.amount,
                    refund.original_payment_amount,
                )?;
                Self::check_payment_refund_cap(&env, refund.payment_id, refund.amount)?;
                Self::update_payment_refund_usage(&env, refund.payment_id, refund.amount);
            }
            Self::record_merchant_quota_usage(&env, &refund.merchant, refund.amount)?;
            Self::mark_arbitration_award(&env, refund_id);
            refund.status = RefundStatus::Approved;
            refund.approved_at = Some(now);
            refund.escrow_lock_ref = state.get(&SystemKey::PaymentEscrowLock(refund.payment_id));
        } else {
            if source == RefundStatus::PendingAppeal {
                Self::release_payment_refund_usage(&env, refund.payment_id, refund.amount);
            }
            refund.status = RefundStatus::PermanentlyDenied;
            refund.rejected_at = Some(now);
        }
        Self::remove_from_status_index(&env, indexed_status, refund_id)?;
        state.remove(&source_key);
        state.set(&DataKey::Refund(refund_id), &refund);
        Self::add_to_status_index(&env, refund.status.clone(), refund_id);
        if approved {
            RefundApprovedEvent {
                refund_id,
                payment_id: refund.payment_id,
                customer: refund.customer,
                merchant: refund.merchant,
                amount: refund.amount,
                reason_code: refund.reason_code,
                approved_by: admin,
                approved_at: now,
            }
            .publish(&env);
            Self::invoke_hooks(&env, RefundEventType::Approved, refund_id);
        }
        Ok(())
    }

    pub fn claim_buyer_protection_payout(
        env: Env,
        admin_or_customer: Address,
        refund_id: u64,
    ) -> Result<i128, Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Ext(ExtError::ReentrantCallDetected))?;
        Self::require_not_paused(&env, "claim_buyer_protection_payout")?;
        admin_or_customer.require_auth();
        let mut refund = Self::get_refund(&env, refund_id)?;
        let admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        if admin_or_customer != refund.customer && admin.as_ref() != Some(&admin_or_customer) {
            return Err(Error::Core(CoreError::Unauthorized));
        }
        let award = ConfigKey::ArbitrationAward(refund_id);
        let payment_locked = env
            .storage()
            .instance()
            .has(&SystemKey::PaymentEscrowLock(refund.payment_id));
        if refund.status != RefundStatus::Approved
            || refund.escrow_lock_ref.is_some()
            || payment_locked
            || !env.storage().instance().has(&award)
            || env
                .storage()
                .instance()
                .has(&VoucherKey::RefundVoucherIssued(refund_id))
        {
            return Err(Error::Core(CoreError::InvalidStatus));
        }
        Self::require_rma_delivery(&env, refund_id)?;
        Self::can_refund_payment(
            &env,
            refund.payment_id,
            refund.amount,
            refund.original_payment_amount,
        )?;
        let config = Self::get_buyer_protection_config(env.clone())
            .filter(|config| config.enabled)
            .ok_or(Error::Ext(ExtError::BuyerProtectionUnavailable))?;

        // A failed invocation rolls back its ledger writes. Prove the same
        // shortfall again here, using the same funding check as processing.
        let pool = Self::get_buyer_protection_balance(env.clone(), refund.token.clone());
        if Self::refund_funding_available(&env, &refund) {
            return Err(Error::Ext(ExtError::RefundStillFunded));
        }
        let after_fee = Self::preview_net_refund(env.clone(), refund.amount).net_amount;
        let arbitration_fee = fixed_math::mul_div_ceil_or_panic(
            &env,
            after_fee,
            Self::get_arbitration_protocol_fee(env.clone()) as i128,
            10_000,
        );
        let after_arbitration = after_fee - arbitration_fee;
        let net = after_arbitration - Self::restocking_fee(&env, &refund).min(after_arbitration);
        let debt = Self::get_merchant_protection_debt(
            env.clone(),
            refund.merchant.clone(),
            refund.token.clone(),
        );
        let exposure_left = config.max_payout_per_merchant.saturating_sub(debt);
        let amount = net
            .min(config.max_payout_per_claim)
            .min(pool)
            .min(exposure_left);
        if amount <= 0 {
            return Err(Error::Ext(ExtError::BuyerProtectionUnavailable));
        }
        Self::write_protection_debt(&env, &refund.merchant, &refund.token, debt, debt + amount)?;
        storage::set_persistent(
            &env,
            &DataKey::BuyerProtectionBalance(refund.token.clone()),
            &(pool - amount),
        );

        env.storage().instance().remove(&award);
        Self::remove_from_status_index(&env, RefundStatus::Approved, refund_id)?;
        refund.status = RefundStatus::ProcessedViaGuarantee;
        refund.processed_at = Some(env.ledger().timestamp());
        env.storage()
            .instance()
            .set(&DataKey::Refund(refund_id), &refund);
        Self::add_to_status_index(&env, RefundStatus::ProcessedViaGuarantee, refund_id);
        Self::reset_customer_denied_attempts(&env, &refund.customer);
        Self::invalidate_analytics_cache_for(&env, refund.requested_at);

        token::Client::new(&env, &refund.token).transfer(
            &env.current_contract_address(),
            &refund.customer,
            &amount,
        );
        BuyerProtectionPaid {
            refund_id,
            merchant: refund.merchant,
            customer: refund.customer,
            token: refund.token,
            amount,
        }
        .publish(&env);
        Self::invoke_hooks(&env, RefundEventType::Processed, refund_id);
        Ok(amount)
    }

    pub fn repay_merchant_protection_debt(
        env: Env,
        merchant: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Ext(ExtError::ReentrantCallDetected))?;
        merchant.require_auth();
        let debt = Self::get_merchant_protection_debt(env.clone(), merchant.clone(), token.clone());
        if amount <= 0 || amount > debt {
            return Err(Error::Core(CoreError::InvalidAmount));
        }
        Self::write_protection_debt(&env, &merchant, &token, debt, debt - amount)?;
        Self::credit_protection_pool(&env, &token, amount)?;
        token::Client::new(&env, &token).transfer(
            &merchant,
            &env.current_contract_address(),
            &amount,
        );
        Ok(())
    }

    pub(super) fn protection_debt_active(env: &Env, merchant: &Address) -> bool {
        let count: u32 =
            storage::get_persistent(env, &DataKey::ProtectionDebtCount(merchant.clone()))
                .unwrap_or(0);
        count > 0
    }

    fn write_protection_debt(
        env: &Env,
        merchant: &Address,
        token: &Address,
        old: i128,
        new: i128,
    ) -> Result<(), Error> {
        let count_key = DataKey::ProtectionDebtCount(merchant.clone());
        let count: u32 = storage::get_persistent(env, &count_key).unwrap_or(0);
        let next = match (old == 0, new == 0) {
            (true, false) => count.checked_add(1),
            (false, true) => count.checked_sub(1),
            _ => Some(count),
        }
        .ok_or(Error::Core(CoreError::InvalidAmount))?;
        storage::set_persistent(env, &count_key, &next);
        storage::set_persistent(
            env,
            &DataKey::MerchantProtectionDebt(merchant.clone(), token.clone()),
            &new,
        );
        Ok(())
    }

    pub(super) fn refund_funding_available(env: &Env, refund: &Refund) -> bool {
        let debit = match Self::get_refund_fee_config(env.clone()) {
            Some(config) if config.active && config.fee_token != refund.token => {
                Self::preview_net_refund(env.clone(), refund.amount).net_amount
            }
            _ => refund.amount,
        };
        Self::unreserved_refund_balance(env, &refund.token) >= debit
    }

    pub(super) fn unreserved_refund_balance(env: &Env, token: &Address) -> i128 {
        let reserve = Self::get_buyer_protection_balance(env.clone(), token.clone());
        let fees = Self::get_accumulated_protocol_fees(env.clone(), token.clone());
        token::Client::new(env, token)
            .balance(&env.current_contract_address())
            .saturating_sub(reserve)
            .saturating_sub(fees)
    }

    pub(super) fn allocate_protection_fee(env: &Env, token: &Address, fee: i128) -> i128 {
        let bps = Self::get_buyer_protection_config(env.clone())
            .filter(|config| config.enabled)
            .map_or(0, |config| config.fee_allocation_bps);
        let allocated = fixed_math::mul_div_floor_or_panic(env, fee, i128::from(bps), 10_000);
        if allocated > 0 {
            Self::credit_protection_pool(env, token, allocated)
                .unwrap_or_else(|error| soroban_sdk::panic_with_error!(env, error));
        }
        allocated
    }

    fn credit_protection_pool(env: &Env, token: &Address, amount: i128) -> Result<(), Error> {
        let balance = Self::get_buyer_protection_balance(env.clone(), token.clone())
            .checked_add(amount)
            .ok_or(Error::Core(CoreError::InvalidAmount))?;
        storage::set_persistent(
            env,
            &DataKey::BuyerProtectionBalance(token.clone()),
            &balance,
        );
        Ok(())
    }
}
