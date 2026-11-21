use super::*;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetainerEscrow {
    pub id: u64,
    pub client: Address,
    pub vendor: Address,
    pub token: Address,
    pub total_deposited: i128,
    pub total_drawn: i128,
    pub period_seconds: u64,
    pub max_draw_per_period: i128,
    pub rollover_unused: bool,
    pub started_at: u64,
    pub terminated_at: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
struct RetainerState {
    escrow: RetainerEscrow,
    last_period: u64,
    drawn_this_period: i128,
    reclaimed: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetainerDrawn {
    #[topic]
    pub retainer_id: u64,
    pub amount: i128,
    pub fee: i128,
    pub work_digest: BytesN<32>,
}

#[contractimpl]
impl EscrowContract {
    #[allow(clippy::too_many_arguments)]
    pub fn create_retainer_escrow(
        env: Env,
        client: Address,
        vendor: Address,
        token: Address,
        total_deposited: i128,
        period_seconds: u64,
        max_draw_per_period: i128,
        rollover_unused: bool,
    ) -> Result<u64, Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Basic(BasicError::ReentrantCallDetected))?;
        client.require_auth();
        Self::require_not_paused(&env, "create_retainer_escrow")?;
        if total_deposited <= 0 || max_draw_per_period <= 0 || period_seconds == 0 {
            return Err(Error::Escrow(EscrowError::InvalidRetainerTerms));
        }
        storage::extend_instance(&env);
        let last: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RetainerCounter)
            .unwrap_or(0);
        let id = last
            .checked_add(1)
            .ok_or(Error::Escrow(EscrowError::InvalidRetainerTerms))?;
        env.storage().instance().set(&DataKey::RetainerCounter, &id);
        let state = RetainerState {
            escrow: RetainerEscrow {
                id,
                client: client.clone(),
                vendor,
                token: token.clone(),
                total_deposited,
                total_drawn: 0,
                period_seconds,
                max_draw_per_period,
                rollover_unused,
                started_at: env.ledger().timestamp(),
                terminated_at: None,
            },
            last_period: 0,
            drawn_this_period: 0,
            reclaimed: false,
        };
        storage::set_persistent(&env, &DataKey::Retainer(id), &state);
        token::Client::new(&env, &token).transfer(
            &client,
            &env.current_contract_address(),
            &total_deposited,
        );
        Ok(id)
    }

    pub fn get_retainer_escrow(env: Env, retainer_id: u64) -> Result<RetainerEscrow, Error> {
        Ok(Self::load_retainer(&env, retainer_id)?.escrow)
    }

    pub fn draw_retainer_funds(
        env: Env,
        vendor: Address,
        retainer_id: u64,
        amount: i128,
        work_digest: BytesN<32>,
    ) -> Result<(), Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Basic(BasicError::ReentrantCallDetected))?;
        vendor.require_auth();
        Self::require_not_paused(&env, "draw_retainer_funds")?;
        let mut state = Self::load_retainer(&env, retainer_id)?;
        let escrow = &mut state.escrow;
        if vendor != escrow.vendor {
            return Err(Error::Basic(BasicError::Unauthorized));
        }
        let now = env.ledger().timestamp();
        if escrow.terminated_at.is_some_and(|end| now >= end) {
            return Err(Error::Escrow(EscrowError::InvalidStatus));
        }
        if amount <= 0 {
            return Err(Error::Escrow(EscrowError::InvalidRetainerTerms));
        }
        if amount > escrow.total_deposited - escrow.total_drawn {
            return Err(Error::Escrow(EscrowError::RetainerBalanceExceeded));
        }
        let period = now.saturating_sub(escrow.started_at) / escrow.period_seconds;
        if period != state.last_period {
            state.last_period = period;
            state.drawn_this_period = 0;
        }
        let available = if escrow.rollover_unused {
            (i128::from(period) + 1)
                .checked_mul(escrow.max_draw_per_period)
                .unwrap_or(escrow.total_deposited)
                .min(escrow.total_deposited)
                - escrow.total_drawn
        } else {
            escrow.max_draw_per_period - state.drawn_this_period
        };
        if amount > available {
            return Err(Error::Escrow(EscrowError::RetainerPeriodCapExceeded));
        }
        escrow.total_drawn += amount;
        state.drawn_this_period += amount;
        let token = escrow.token.clone();
        storage::set_persistent(&env, &DataKey::Retainer(retainer_id), &state);

        let config = Self::get_escrow_fee_config(env.clone());
        let fee = if config.enabled {
            fixed_math::mul_div_ceil_or_panic(&env, amount, config.fee_bps, 10_000)
        } else {
            0
        };
        let contract = env.current_contract_address();
        let asset = token::Client::new(&env, &token);
        if fee > 0 {
            if config.fee_recipient == contract {
                let key = DataKey::Participant(ParticipantKey::AccumulatedFees(token));
                let accumulated: i128 = env.storage().instance().get(&key).unwrap_or(0);
                let updated = accumulated
                    .checked_add(fee)
                    .ok_or(Error::Escrow(EscrowError::InvalidRetainerTerms))?;
                env.storage().instance().set(&key, &updated);
            } else {
                asset.transfer(&contract, &config.fee_recipient, &fee);
            }
        }
        if amount > fee {
            asset.transfer(&contract, &vendor, &(amount - fee));
        }
        RetainerDrawn {
            retainer_id,
            amount,
            fee,
            work_digest,
        }
        .publish(&env);
        Ok(())
    }

    /// Schedules the cutoff once. A zero notice allows immediate withdrawal.
    pub fn terminate_retainer_escrow(
        env: Env,
        client: Address,
        retainer_id: u64,
        notice_period_secs: u64,
    ) -> Result<(), Error> {
        client.require_auth();
        let mut state = Self::load_retainer(&env, retainer_id)?;
        if client != state.escrow.client {
            return Err(Error::Basic(BasicError::Unauthorized));
        }
        if state.escrow.terminated_at.is_some() {
            return Err(Error::Escrow(EscrowError::InvalidStatus));
        }
        state.escrow.terminated_at = Some(
            env.ledger()
                .timestamp()
                .checked_add(notice_period_secs)
                .ok_or(Error::Escrow(EscrowError::InvalidRetainerTerms))?,
        );
        storage::set_persistent(&env, &DataKey::Retainer(retainer_id), &state);
        Ok(())
    }

    pub fn withdraw_retainer_balance(
        env: Env,
        client: Address,
        retainer_id: u64,
    ) -> Result<i128, Error> {
        let _entry = reentrancy::ExternalEntry::acquire(&env)
            .map_err(|_| Error::Basic(BasicError::ReentrantCallDetected))?;
        client.require_auth();
        let mut state = Self::load_retainer(&env, retainer_id)?;
        if client != state.escrow.client {
            return Err(Error::Basic(BasicError::Unauthorized));
        }
        if state.reclaimed {
            return Err(Error::Escrow(EscrowError::AlreadyProcessed));
        }
        if state
            .escrow
            .terminated_at
            .is_none_or(|end| env.ledger().timestamp() < end)
        {
            return Err(Error::Escrow(EscrowError::ReleaseNotYetAvailable));
        }
        let remaining = state.escrow.total_deposited - state.escrow.total_drawn;
        state.reclaimed = true;
        storage::set_persistent(&env, &DataKey::Retainer(retainer_id), &state);
        if remaining > 0 {
            token::Client::new(&env, &state.escrow.token).transfer(
                &env.current_contract_address(),
                &client,
                &remaining,
            );
        }
        Ok(remaining)
    }

    fn load_retainer(env: &Env, id: u64) -> Result<RetainerState, Error> {
        storage::extend_instance(env);
        storage::get_persistent(env, &DataKey::Retainer(id))
            .ok_or(Error::Escrow(EscrowError::NotFound))
    }
}
