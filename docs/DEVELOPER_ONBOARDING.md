# Developer Onboarding & Local Debugging Handbook

This handbook walks a first-time contributor from a clean machine to a green
`make test` and a running localnet. It is the canonical setup guide; if you get
stuck, check the [Troubleshooting FAQ](#troubleshooting-faq) before opening an
issue.

> **TL;DR** — install the toolchain, run `make build`, `make test`, then
> `make fmt clippy check-size differential` before opening a PR.

---

## 1. Toolchain installation

Install everything below. Versions are the minimums we test against in CI.

### Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup target add wasm32-unknown-unknown
# Soroban contracts are built for the v1 WASM target on newer SDKs:
rustup target add wasm32v1-none
```

Confirm with `rustc --version` and `cargo --version`. The workspace pins its
edition and MSRV in `core/Cargo.toml` / `orchestrator/Cargo.toml`; if `cargo`
complains about the toolchain, run `rustup update stable`.

### Stellar CLI

```bash
cargo install --locked stellar-cli --features opt
stellar --version
```

`stellar-cli` provides `stellar contract build`, `stellar contract invoke`, and
`stellar network` helpers used by the localnet workflow.

### Node.js, Python, Docker, pre-commit

- **Node.js** 20+ (LTS) with `npm` — used by `services/relayer`,
  `services/crank-worker`, and `sdk/typescript`.
- **Python** 3.11+ with `pip` — used by `sdk/python` and `examples/python`.
- **Docker** + Docker Compose — required for the localnet quickstart.
- **pre-commit** — installs the git hooks that run `fmt`/`clippy` checks:

```bash
pip install --user pre-commit
pre-commit install
```

---

## 2. Workspace layout tour

This repo is a **dual workspace** — `core/` and `orchestrator/` are separate
Cargo workspaces with their own `Cargo.lock` files. Always run cargo commands
from the correct directory (or via the root `Makefile`, which does it for you).

```
core/
  contracts/*          # Soroban smart contracts (payment, escrow, ...)
  test_utils/          # shared test helpers, MockAuth, snapshot utilities
orchestrator/
  contracts/admin      # admin/orchestration contract
  ...                  # orchestrator-side crates
sdk/
  typescript/          # @.../sdk TypeScript client
  python/              # Python client
services/
  relayer/             # Node.js relayer service
  crank-worker/        # Node.js crank worker
  tests/e2e/           # end-to-end + differential WASM tests
examples/
  typescript/ python/  # runnable integration examples
```

Key entry points:

- `core/contracts/*` — the on-chain logic. Each contract has a `src/lib.rs`
  with `#[contractimpl]` and a `src/test.rs` (or `tests/`) suite.
- `core/test_utils` — shared fixtures. `mock_all_auths()` and explicit
  `MockAuth` helpers live here.
- `orchestrator/contracts/admin` — admin contract that coordinates the core
  contracts.
- `tests/e2e` — cross-contract and differential (native vs WASM) tests.
- `sdk/*` — client libraries consumed by `services/` and `examples/`.

---

## 3. Building and testing

From the repo root:

```bash
make build      # builds core + orchestrator (incl. WASM artifacts)
make test       # core tests + budget bench + orchestrator tests
```

### Running a single targeted test

Don't run the whole suite while iterating. Target the crate and test name:

```bash
# A single test in a core contract
cd core && cargo test -p <contract-crate> <test_name> -- --nocapture

# A single e2e test
cd tests/e2e && cargo test --test differential_wasm <test_name> -- --nocapture
```

`-- --nocapture` surfaces `println!`/`env.logs()` output that is otherwise
swallowed by the test harness.

### Inspecting Soroban diagnostic event logs

Soroban captures contract events and diagnostics in the test `Env`. Use
`env.logs()` to dump them:

```rust
let env = Env::default();
// ... invoke the contract ...
for log in env.logs().all() {
    println!("{log:?}");
}
```

Run with `-- --nocapture` to see the output. This is the fastest way to confirm
which events a contract emitted and in what order.

### Debugging auth failures

Two patterns, and they are **not** interchangeable:

- `env.mock_all_auths()` — auto-satisfies every `require_auth()` call. Great for
  happy-path tests where auth is not the subject under test.
- Explicit `MockAuth` — asserts that a *specific* address authorized a
  *specific* invocation. Use this when you are testing authorization logic.

```rust
use soroban_sdk::testutils::MockAuth;
use soroban_sdk::testutils::MockAuthInvoke;

env.mock_auths(&[MockAuth {
    address: &admin,
    invoke: &MockAuthInvoke {
        contract: &contract_id,
        fn_name: "transfer",
        args: (from.clone(), to.clone(), amount).into_val(&env),
        sub_invokes: &[],
    },
}]);
```

> **Security invariant:** never call `mock_all_auths()` in
> `test_auth_rejection.rs` (or any authorization-rejection test). It masks the
> exact failure you are trying to prove. To test a rejection, either omit the
> mock entirely (the call should panic with an auth error) or install a
> `MockAuth` for the *wrong* address and assert the call fails.

### Updating test snapshots

Soroban test snapshots capture ledger state and must be refreshed after an SDK
upgrade or intentional state change:

```bash
make update-snapshots   # UPDATE_SNAPSHOTS=1 make -C core test
```

Review the diff before committing — snapshot churn is a common source of noisy
PRs. Only commit snapshots that changed because of your change.

---

## 4. Pre-PR checklist

Run all of these from the repo root before opening a PR:

```bash
make fmt          # rustfmt across both workspaces
make clippy       # clippy with -D warnings
make test         # full test suite
make check-size   # WASM binary size budget
make differential # native vs compiled-WASM differential tests
```

`make differential` requires the WASM artifacts from `make build`; it fails
loudly if they are missing.

### Keeping WASM binaries small

`make check-size` enforces a budget. To stay under it:

- Avoid `format!` and string formatting in on-chain code — it pulls in the
  formatting machinery and bloats the binary.
- Avoid long panic strings; prefer short `panic!("msg")` or typed errors.
- Don't add dependencies you don't need; every crate adds code.
- Prefer `#[contracterror]` enums over stringly-typed errors.

---

## 5. Localnet quickstart

```bash
docker compose up -d          # starts localnet + services
stellar network local         # point the CLI at localnet
make build                    # build WASM artifacts
```

If a port is already in use, see the FAQ below.

---

## Troubleshooting FAQ

1. **`error: linker 'cc' not found` (Linux/Codespaces).** Install build
   essentials: `sudo apt-get install -y build-essential pkg-config libssl-dev`.
2. **`wasm32-unknown-unknown` target missing.** Run
   `rustup target add wasm32-unknown-unknown wasm32v1-none`.
3. **`stellar: command not found`.** `cargo install --locked stellar-cli` puts
   the binary in `~/.cargo/bin`; ensure that is on your `PATH`.
4. **Docker Quickstart port conflict (`bind: address already in use`).** Another
   localnet or service is holding the port. Stop it with
   `docker compose down` (or `docker ps` to find the offender), then retry.
5. **Stale `Cargo.lock` / dependency resolution errors.** Because `core/` and
   `orchestrator/` are separate workspaces, a stale lock in one can break the
   other. Run `cargo update` inside the affected workspace, or delete that
   workspace's `Cargo.lock` and rebuild.
6. **macOS: `ld: symbol(s) not found` when linking tests.** Ensure Xcode command
   line tools are installed (`xcode-select --install`) and that you are not
   mixing an ARM toolchain with an x86_64 target.
7. **`make differential` fails with missing WASM.** Run `make build` first — the
   differential tests require compiled artifacts.
8. **Snapshot tests fail after an SDK bump.** Run `make update-snapshots`, review
   the diff, and commit only the snapshots affected by your change.
9. **pre-commit hook fails on `fmt`.** Run `make fmt` and re-stage; the hook
   runs the same formatter as CI.
10. **Codespaces runs out of disk.** Prune Docker with
    `docker system prune -af` and remove stale `target/` dirs.

---

## Getting help

- Open an issue with the `question` label and include your OS, `rustc --version`,
  and the failing command output.
- See `CONTRIBUTING.md` for PR conventions and the review process.
