//! Soroban CPU / memory budget regression gate (issue #252, extended #378).
//!
//! Each benchmark resets the budget immediately before the entry point under
//! test, records `(cpu_instructions, memory_bytes)`, prints one markdown row
//! (`| entry point | cpu | mem | cpu ceiling | mem ceiling |`) for CI visibility, and
//! asserts the measurement is strictly below its ceiling.
//!
//! ## Structured JSON output (issue #378)
//!
//! When the `BUDGET_METRICS_OUT` environment variable is set to a file path,
//! each benchmark additionally appends one JSON Lines record to that file:
//!
//! ```jsonc
//! {"contract":"payment","entrypoint":"create_payment","cpu_insns":25123456,"mem_bytes":9876543,"wasm_bytes":23456,"cpu_ceiling":25000000,"mem_ceiling":10000000}
//! ```
//!
//! The CI converts these JSONL records into a `budget-metrics.json` array
//! artifact and compares it against the main-branch baseline
//! (`scripts/compare-budget-bench.py`). JSON is built by hand (no `serde`
//! dependency) and the env-var gate makes local runs non-invasive.
//!
//! `wasm_bytes` is read from the `WASM_BYTES_<CONTRACT>` env var (set by CI
//! after building each contract to `wasm32-unknown-unknown`), defaulting to 0
//! when not provided so the test still runs standalone.
//!
//! Run: `make budget-bench` (from `core/`), or
//! `cargo test -p payments budget_bench -- --nocapture --test-threads=1`.
//!
//! NOTE: the ceilings below are provisional upper bounds chosen well under the
//! network per-transaction limits (100M CPU instructions / 40 MiB memory). They
//! have not been calibrated against measured baselines; tighten them once real
//! numbers are available from the printed report. Ledger read/write counts are
//! not recorded here.
//! Not yet covered: refund `process_refund` and orchestrator admin entry points
//! (their benchmarks require multi-contract fixtures and are tracked for a
//! follow-up; the JSON schema's `contract` field already supports them).
#![cfg(test)]

use crate::{Currency, FeeConfig, PaymentContract, PaymentContractClient};
use escrow::{EscrowContract, EscrowContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};
use std::sync::Once;

const MAX_CREATE_PAYMENT_CPU: u64 = 25_000_000;
const MAX_CREATE_PAYMENT_MEM: u64 = 10_000_000;
const MAX_COMPLETE_PAYMENT_CPU: u64 = 40_000_000;
const MAX_COMPLETE_PAYMENT_MEM: u64 = 15_000_000;
const MAX_PAUSE_PAYMENT_CPU: u64 = 15_000_000;
const MAX_PAUSE_PAYMENT_MEM: u64 = 8_000_000;
const MAX_CREATE_ESCROW_CPU: u64 = 25_000_000;
const MAX_CREATE_ESCROW_MEM: u64 = 10_000_000;
const MAX_RELEASE_ESCROW_CPU: u64 = 40_000_000;
const MAX_RELEASE_ESCROW_MEM: u64 = 15_000_000;
const MAX_PAUSE_ESCROW_CPU: u64 = 15_000_000;
const MAX_PAUSE_ESCROW_MEM: u64 = 8_000_000;

/// Reset the budget, run `f`, and return `(cpu_instructions, memory_bytes)`.
fn measure<R>(env: &Env, f: impl FnOnce() -> R) -> (u64, u64) {
    env.cost_estimate().budget().reset_default();
    let _ = f();
    let b = env.cost_estimate().budget();
    (b.cpu_instruction_cost(), b.memory_bytes_cost())
}

/// Read the compiled WASM size (bytes) for a contract from the
/// `WASM_BYTES_<CONTRACT_UPPER>` env var set by CI. Defaults to 0 when unset so
/// the test runs standalone without a WASM build.
fn wasm_bytes_for(contract: &str) -> u64 {
    let key = format!("WASM_BYTES_{}", contract.to_ascii_uppercase());
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

/// One-time file truncation guard so repeated `#[test]` functions writing to
/// the same `BUDGET_METRICS_OUT` path start from an empty file.
static METRICS_TRUNCATED: Once = Once::new();

/// Append a single JSON Lines record to `BUDGET_METRICS_OUT` when that env var
/// is set. No-op otherwise (local runs are unaffected). Built by hand so no
/// `serde` dev-dependency is required.
fn write_metric_jsonl(contract: &str, entrypoint: &str, cpu: u64, mem: u64, max_cpu: u64, max_mem: u64) {
    use std::io::Write;
    let Some(path) = std::env::var("BUDGET_METRICS_OUT").ok().filter(|p| !p.is_empty()) else {
        return;
    };
    METRICS_TRUNCATED.call_once(|| {
        // Truncate the file exactly once per process (first benchmark to run).
        let _ = std::fs::File::create(&path);
    });
    let wasm = wasm_bytes_for(contract);
    let line = format!(
        concat!(
            "{{\"contract\":\"{}\",\"entrypoint\":\"{}\",",
            "\"cpu_insns\":{},\"mem_bytes\":{},\"wasm_bytes\":{},",
            "\"cpu_ceiling\":{},\"mem_ceiling\":{}}}"
        ),
        contract, entrypoint, cpu, mem, wasm, max_cpu, max_mem
    );
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
}

fn report_and_assert(
    contract: &str,
    name: &str,
    (cpu, mem): (u64, u64),
    max_cpu: u64,
    max_mem: u64,
) {
    std::println!("| {} | {} | {} | {} | {} |", name, cpu, mem, max_cpu, max_mem);
    // Emit the structured JSON record for CI comparison.
    write_metric_jsonl(contract, name, cpu, mem, max_cpu, max_mem);
    assert!(cpu < max_cpu, "{name}: cpu {cpu} >= ceiling {max_cpu}");
    assert!(mem < max_mem, "{name}: mem {mem} >= ceiling {max_mem}");
}

struct Fixture {
    env: Env,
    admin: Address,
    customer: Address,
    merchant: Address,
    token: Address,
    payment: PaymentContractClient<'static>,
    escrow: EscrowContractClient<'static>,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let customer = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(&env, &token_id).mint(&customer, &1_000_000_000);

    let payment_addr = env.register_contract(None, PaymentContract);
    let escrow_addr = env.register_contract(None, EscrowContract);
    let payment = PaymentContractClient::new(&env, &payment_addr);
    let escrow = EscrowContractClient::new(&env, &escrow_addr);
    payment.initialize(&admin);
    escrow.initialize(&admin);
    payment.set_fee_config(
        &admin,
        &FeeConfig {
            fee_bps: 100,
            min_fee: 0,
            max_fee: 0,
            treasury: admin.clone(),
            fee_token: token_id.clone(),
            active: true,
        },
    );
    let tk = token::Client::new(&env, &token_id);
    tk.approve(&customer, &payment_addr, &1_000_000_000, &u32::MAX);
    tk.approve(&customer, &escrow_addr, &1_000_000_000, &u32::MAX);
    Fixture {
        env,
        admin,
        customer,
        merchant,
        token: token_id,
        payment,
        escrow,
    }
}

#[test]
fn budget_bench_payment() {
    let f = setup();
    std::println!("| entry point | cpu | mem | cpu ceiling | mem ceiling |");
    let meta = String::from_str(&f.env, "");

    let mut id = 0;
    let m = measure(&f.env, || {
        id = f.payment.create_payment(
            &f.customer,
            &f.merchant,
            &10_000,
            &f.token,
            &Currency::USDC,
            &0,
            &meta,
        );
    });
    report_and_assert("payment", "create_payment", m, MAX_CREATE_PAYMENT_CPU, MAX_CREATE_PAYMENT_MEM);
    report_and_assert(
        "create_payment",
        m,
        MAX_CREATE_PAYMENT_CPU,
        MAX_CREATE_PAYMENT_MEM,
    );

    let m = measure(&f.env, || f.payment.complete_payment(&f.admin, &id));
    report_and_assert(
        "payment",
        "complete_payment",
        m,
        MAX_COMPLETE_PAYMENT_CPU,
        MAX_COMPLETE_PAYMENT_MEM,
    );

    let reason = String::from_str(&f.env, "bench");
    let m = measure(&f.env, || f.payment.pause_contract(&f.admin, &reason));
    report_and_assert("payment", "pause_contract", m, MAX_PAUSE_PAYMENT_CPU, MAX_PAUSE_PAYMENT_MEM);
    report_and_assert(
        "payment.pause_contract",
        m,
        MAX_PAUSE_PAYMENT_CPU,
        MAX_PAUSE_PAYMENT_MEM,
    );
}

#[test]
fn budget_bench_escrow() {
    let f = setup();
    let now = f.env.ledger().timestamp();

    let mut id = 0;
    let m = measure(&f.env, || {
        id = f.escrow.create_escrow(
            &f.customer,
            &f.merchant,
            &10_000,
            &f.token,
            &now,
            &0,
            &(now + 10_000_000),
            &false,
        );
    });
    report_and_assert("escrow", "create_escrow", m, MAX_CREATE_ESCROW_CPU, MAX_CREATE_ESCROW_MEM);

    let m = measure(&f.env, || f.escrow.release_escrow(&f.admin, &id, &false));
    report_and_assert("escrow", "release_escrow", m, MAX_RELEASE_ESCROW_CPU, MAX_RELEASE_ESCROW_MEM);

    let reason = String::from_str(&f.env, "bench");
    let m = measure(&f.env, || f.escrow.pause_contract(&f.admin, &reason));
    report_and_assert("escrow", "pause_contract", m, MAX_PAUSE_ESCROW_CPU, MAX_PAUSE_ESCROW_MEM);
    report_and_assert(
        "create_escrow",
        m,
        MAX_CREATE_ESCROW_CPU,
        MAX_CREATE_ESCROW_MEM,
    );

    let m = measure(&f.env, || f.escrow.release_escrow(&f.admin, &id, &false));
    report_and_assert(
        "release_escrow",
        m,
        MAX_RELEASE_ESCROW_CPU,
        MAX_RELEASE_ESCROW_MEM,
    );

    let reason = String::from_str(&f.env, "bench");
    let m = measure(&f.env, || f.escrow.pause_contract(&f.admin, &reason));
    report_and_assert(
        "escrow.pause_contract",
        m,
        MAX_PAUSE_ESCROW_CPU,
        MAX_PAUSE_ESCROW_MEM,
    );
}
