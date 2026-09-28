#!/usr/bin/env bash
# ==============================================================================
# scripts/pre-commit.sh
# Git pre-commit hook script for Cypher GridPay Smart Contracts
#
# Can be executed directly or linked into .git/hooks/pre-commit:
#   ln -sf ../../scripts/pre-commit.sh .git/hooks/pre-commit
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo " Running Git Pre-Commit Checks"
echo "=========================================================="

# 1. Format check in core
echo "Checking code format in core workspace..."
(cd core && cargo fmt --all -- --check) || {
    echo "ERROR: core code formatting check failed! Run 'make fmt' to auto-format." >&2
    exit 1
}

# 2. Format check in orchestrator
echo "Checking code format in orchestrator workspace..."
(cd orchestrator && cargo fmt --all -- --check) || {
    echo "ERROR: orchestrator code formatting check failed! Run 'make fmt' to auto-format." >&2
    exit 1
}

# 3. Compile check in core
echo "Running cargo check in core workspace..."
(cd core && cargo check) || {
    echo "ERROR: core cargo check failed!" >&2
    exit 1
}

# 4. Compile check in orchestrator
echo "Running cargo check in orchestrator workspace..."
(cd orchestrator && cargo check) || {
    echo "ERROR: orchestrator cargo check failed!" >&2
    exit 1
}

echo "All pre-commit checks passed successfully!"
