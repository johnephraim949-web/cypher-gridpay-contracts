# Contributing to Cypher GridPay Smart Contracts

Thank you for your interest in contributing to Cypher GridPay! We welcome contributions from the community to help build secure and reliable payment infrastructure on Stellar.

> 🧭 **New contributor? Start with the [Developer Onboarding & Local Debugging Handbook](docs/DEVELOPER_ONBOARDING.md).** It covers exact toolchain installation, the `core/` vs. `orchestrator/` dual-workspace layout, targeted test runs, Soroban diagnostic logs, auth debugging, snapshot updates, and a troubleshooting FAQ.

## 📜 Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have:
- Rust 1.74.0 or later
- Stellar CLI installed (`cargo install --locked stellar-cli --features opt`)
- Basic understanding of Soroban smart contracts
- Git for version control

> 📖 For the full, step-by-step setup (including `wasm32v1-none`, Node.js, Python, Docker, and `pre-commit`), see [docs/DEVELOPER_ONBOARDING.md](docs/DEVELOPER_ONBOARDING.md).

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/cypher-gridpay-contracts.git
   cd cypher-gridpay-contracts
   ```

2. **Add wasm target**
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

3. **Build the contracts**
   ```bash
   make build
   ```

4. **Run tests**
   ```bash
   cargo test --workspace
   ```

### Local Development with Docker

For a local Stellar test environment with standalone Soroban RPC, use the provided `docker-compose.yml`:

```bash
# Start the local Stellar Quickstart network
docker-compose up -d

# Check that the network is running
curl -s http://localhost:8000/

# Fund a test account using the friendbot/faucet
curl "http://localhost:8000/friendbot?addr=<YOUR_ADDRESS>"

# Deploy contracts using the deployment script
./scripts/deploy-testnet.sh
```

The `docker-compose.yml` service uses `stellar/quickstart:testing` with Soroban RPC enabled, providing:
- **Stellar Core** on port 8000 (standalone mode)
- **Soroban RPC** on port 8001 for smart contract interaction
- Automatic network passphrase: `Standalone Network ; February 2017`

To stop the environment:
```bash
docker-compose down
```

To reset all data:
```bash
docker-compose down -v
```

> 🛠️ Hitting port conflicts or linker errors? See the [Troubleshooting FAQ](docs/DEVELOPER_ONBOARDING.md#9-troubleshooting-faq).

### Makefile Targets

The root `Makefile` provides several helpful targets to streamline development. Run these using `make <target>`.

| Target | Description | When to Use |
|--------|-------------|-------------|
| `build` | Compiles the smart contracts using `stellar contract build` and checks the WASM sizes. | Use this whenever you want to compile your code and verify the output artifacts don't exceed size limits. |
| `test` | Runs the full `build` target, followed by `cargo test` to execute all tests. | Use this to verify that your contracts compile successfully and all tests pass. |
| `fmt` | Runs `cargo fmt --all` to format the workspace code. | Use this before committing to ensure your code adheres to standard Rust formatting guidelines. |
| `clean` | Runs `cargo clean` to remove the generated `target/` directory and build artifacts. | Use this to free up disk space or if you want to ensure a completely fresh build from scratch. |
| `check-size` | Checks the size of compiled `.wasm` artifacts against the `262144` bytes limit. | Runs automatically during `make build`. Use this manually if you just want to verify sizes without recompiling. |

### WASM Size Limit

Soroban networks enforce a maximum contract deployment size of **256 KB** (262,144 bytes). The `check-size` target enforces this limit to ensure contracts remain deployable on Stellar.

**Why this limit exists:** Soroban caps WASM blob size to keep ledger storage manageable and maintain network performance. A contract that exceeds it will be rejected at deployment by the Stellar network.

**If `make build` or `make check-size` fails with a size error:**

1. Check which contract exceeded the limit — the error message prints the file path and size.
2. **Build in release mode** — the default `stellar contract build` already compiles with optimizations.
3. **Strip debug symbols** — add `strip = true` to the release profile in `Cargo.toml`:
   ```toml
   [profile.release]
   strip = true
   ```
4. **Optimize for size** — add `opt-level = "z"` and `lto = true` in the release profile:
   ```toml
   [profile.release]
   opt-level = "z"
   lto = true
   ```
5. **Audit dependencies** — run `cargo bloat --crates` to identify large dependencies and consider lighter alternatives.
6. **Minimize contract exports** — only export the Soroban functions you need; avoid pulling in unused SDK features.
7. **Remove unused code** — use `cargo deadlinks` or review for dead code that the linker may still include.

After making changes, run `make build` to re-check the size.

> 📖 For a deeper walkthrough of CPU/memory gas optimization and WASM size reduction (twiggy/wasm-opt inspection, `env.budget().print()` profiling, bounded batch rules), see [docs/GAS_AND_WASM_OPTIMIZATION.md](docs/GAS_AND_WASM_OPTIMIZATION.md).

## 🔄 Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `test/` - Test additions or modifications

### 2. Make Your Changes

- Write clean, well-documented code
- Follow Rust best practices and idioms
- Add inline comments for complex logic
- Update or add tests for your changes

### 3. Write Tests

All contract changes **must** include tests:

```bash
# Test specific contract
cd contracts/payment
cargo test

# Test all contracts
cargo test --workspace
```

Test requirements:
- Unit tests for all public functions
- Integration tests for cross-contract interactions
- Edge case coverage
- Error handling verification

> 📖 For the full testing strategy — the five-layer verification pyramid (unit,
> auth/reentrancy, cross-contract E2E, property/fuzz, differential WASM),
> deterministic fixtures, time-travel helpers, and copyable templates — see
> [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md).

> ⚠️ **Never use `mock_all_auths()` in authorization-rejection tests.** Use explicit
> `MockAuth` so the test actually proves `require_auth` is enforced. See
> [Debugging auth failures](docs/DEVELOPER_ONBOARDING.md#5-debugging-auth-failures).

### 4. Format Your Code

```bash
make fmt
# or
cargo fmt --all
```

### 5. Run All Checks

Before committing, ensure:

To run the configured checks automatically before each commit, install
[`pre-commit`](https://pre-commit.com/) (for example, with `pipx install pre-commit`)
and enable the repository hook:

```bash
pre-commit install
```

The hook checks formatting, runs Clippy, and checks both the `core` and
`orchestrator` workspaces. To run it manually across all files:

```bash
pre-commit run --all-files
```

```bash
# Format check
cargo fmt --all -- --check

# Build all contracts
make build

# Run all tests
cargo test --workspace

# Check for warnings
cargo clippy --all-targets --all-features -- -D warnings
```

### 6. Commit Your Changes

Follow conventional commit format:

```bash
git commit -m "feat: add new payment validation"
git commit -m "fix: resolve escrow release issue"
git commit -m "test: add edge cases for refund processing"
git commit -m "docs: update payment contract documentation"
```

Commit message format:
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks

### 7. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub with:
- Clear description of changes
- Reference to related issues (if any)
- Screenshots/logs if applicable

## 📝 Code Style Guidelines

### Rust Conventions

- Follow the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- Use descriptive variable and function names
- Keep functions focused and small
- Prefer explicit error handling over panics

### Soroban-Specific Guidelines

```rust
// ✅ Good: Clear function documentation
/// Creates a new payment with escrow
/// 
/// # Arguments
/// * `env` - Contract environment
/// * `from` - Sender address
/// * `amount` - Payment amount
/// 
/// # Panics
/// Panics if amount is zero
pub fn create_payment(env: Env, from: Address, amount: i128) -> u64
```
