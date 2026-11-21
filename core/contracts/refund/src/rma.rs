use super::*;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RmaRequirement {
    pub tracking_commitment: Option<BytesN<32>>,
    pub carrier_oracle: Address,
    pub return_deadline: u64,
    pub delivered: bool,
    pub delivered_at: Option<u64>,
}

#[contractimpl]
impl RefundContract {
    pub fn approve_refund_with_rma(
        env: Env,
        merchant: Address,
        refund_id: u64,
        carrier_oracle: Address,
        return_window_secs: u64,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env, "approve_refund_with_rma")?;
        merchant.require_auth();
        let refund = Self::get_refund(&env, refund_id)?;
        if refund.merchant != merchant {
            return Err(Error::Core(CoreError::Unauthorized));
        }
        Self::require_merchant_active(&env, &merchant)?;
        if refund.status != RefundStatus::Requested
            || !matches!(
                refund.reason_code,
                RefundReasonCode::ProductDefect | RefundReasonCode::CustomerRequest
            )
            || return_window_secs == 0
        {
            return Err(Error::Core(CoreError::InvalidStatus));
        }
        let return_deadline = env
            .ledger()
            .timestamp()
            .checked_add(return_window_secs)
            .ok_or(Error::Core(CoreError::InvalidAmount))?;
        env.storage().instance().set(
            &DataKey::RefundRma(refund_id),
            &RmaRequirement {
                tracking_commitment: None,
                carrier_oracle,
                return_deadline,
                delivered: false,
                delivered_at: None,
            },
        );
        Self::approve_refund_internal(&env, merchant, refund_id)
    }

    pub fn get_refund_rma(env: Env, refund_id: u64) -> Option<RmaRequirement> {
        env.storage().instance().get(&DataKey::RefundRma(refund_id))
    }

    pub fn submit_rma_tracking(
        env: Env,
        customer: Address,
        refund_id: u64,
        tracking_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        customer.require_auth();
        let (refund, mut rma) = Self::pending_rma(&env, refund_id)?;
        if customer != refund.customer {
            return Err(Error::Core(CoreError::Unauthorized));
        }
        if env.ledger().timestamp() > rma.return_deadline || rma.tracking_commitment.is_some() {
            return Err(Error::Core(CoreError::InvalidStatus));
        }
        rma.tracking_commitment = Some(tracking_commitment);
        env.storage()
            .instance()
            .set(&DataKey::RefundRma(refund_id), &rma);
        Ok(())
    }

    pub fn confirm_rma_delivery(
        env: Env,
        verifier: Address,
        refund_id: u64,
        delivery_attestation_hash: BytesN<32>,
    ) -> Result<(), Error> {
        verifier.require_auth();
        let (refund, mut rma) = Self::pending_rma(&env, refund_id)?;
        if verifier != refund.merchant && verifier != rma.carrier_oracle {
            return Err(Error::Core(CoreError::Unauthorized));
        }
        let now = env.ledger().timestamp();
        if rma.tracking_commitment.is_none() || now > rma.return_deadline {
            return Err(Error::Core(CoreError::InvalidStatus));
        }
        rma.delivered = true;
        rma.delivered_at = Some(now);
        env.storage()
            .instance()
            .set(&DataKey::RefundRma(refund_id), &rma);
        env.storage().instance().set(
            &DataKey::RmaAttestation(refund_id),
            &delivery_attestation_hash,
        );
        Ok(())
    }

    pub fn expire_unreturned_rma(env: Env, merchant: Address, refund_id: u64) -> Result<(), Error> {
        merchant.require_auth();
        let (mut refund, rma) = Self::pending_rma(&env, refund_id)?;
        if merchant != refund.merchant {
            return Err(Error::Core(CoreError::Unauthorized));
        }
        let now = env.ledger().timestamp();
        if now <= rma.return_deadline {
            return Err(Error::Core(CoreError::RefundWindowExpired));
        }
        let reservation: Option<u64> = env
            .storage()
            .instance()
            .get(&DataKey::RmaQuotaPeriod(refund_id));
        let quota_key = DataKey::MerchantRefundQuota(merchant);
        if let Some(mut quota) = env
            .storage()
            .instance()
            .get::<_, MerchantRefundQuota>(&quota_key)
        {
            if reservation == Some(quota.period_start) {
                quota.used = quota.used.saturating_sub(refund.amount).max(0);
                env.storage().instance().set(&quota_key, &quota);
            }
        }
        env.storage()
            .instance()
            .remove(&DataKey::RmaQuotaPeriod(refund_id));
        Self::release_payment_refund_usage(&env, refund.payment_id, refund.amount);
        Self::remove_from_status_index(&env, RefundStatus::Approved, refund_id)?;
        refund.status = RefundStatus::PermanentlyDenied;
        refund.rejected_at = Some(now);
        env.storage()
            .instance()
            .set(&DataKey::Refund(refund_id), &refund);
        Self::add_to_status_index(&env, RefundStatus::PermanentlyDenied, refund_id);
        Ok(())
    }

    fn pending_rma(env: &Env, refund_id: u64) -> Result<(Refund, RmaRequirement), Error> {
        let refund = Self::get_refund(env, refund_id)?;
        let rma = Self::get_refund_rma(env.clone(), refund_id)
            .ok_or(Error::Core(CoreError::InvalidStatus))?;
        if refund.status != RefundStatus::Approved || rma.delivered {
            return Err(Error::Core(CoreError::InvalidStatus));
        }
        Ok((refund, rma))
    }

    pub(super) fn require_rma_delivery(env: &Env, refund_id: u64) -> Result<(), Error> {
        if Self::get_refund_rma(env.clone(), refund_id).is_some_and(|rma| !rma.delivered) {
            return Err(Error::Ext(ExtError::RmaDeliveryPending));
        }
        Ok(())
    }
}
