#!/usr/bin/env bash
#
# scripts/canary-smoke-probes.sh
#
# Synthetic end-to-end smoke probes for the Testnet canary deployment.
#
# Probes executed:
#   1. create & complete payment
#   2. create & release escrow
#   3. request & process refund
#   4. query get_system_status
#
# Safety invariants:
#   - Refuses to run against Stellar Mainnet (network passphrase or RPC URL guard).
#   - Exits non-zero on any probe failure.
#   - Emits machine-readable JSON results for the Upgrade Readiness Report.
#
# Environment variables (required):
#   CANARY_RPC_URL            Soroban RPC endpoint for the Testnet canary.
#   CANARY_NETWORK_PASSPHRASE Network passphrase (must be Testnet).
#   CANARY_SECRET_KEY         Secret key of the canary signer.
#   CANARY_PAYMENT_CONTRACT   Contract ID of the Payment contract.
#   CANARY_ESCROW_CONTRACT    Contract ID of the Escrow contract.
#   CANARY_REFUND_CONTRACT    Contract ID of the Refund contract.
#   CANARY_ADMIN_CONTRACT     Contract ID of the Admin contract.
#
# Optional environment variables:
#   CANARY_RESULTS_FILE       Path to write JSON results (default: canary-smoke-results.json).
#   CANARY_TIMEOUT_SECONDS    Per-probe timeout in seconds (default: 120).
#   STELLAR_CLI               Stellar CLI binary (default: stellar).
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
STELLAR_CLI="${STELLAR_CLI:-stellar}"
CANARY_RESULTS_FILE="${CANARY_RESULTS_FILE:-canary-smoke-results.json}"
CANARY_TIMEOUT_SECONDS="${CANARY_TIMEOUT_SECONDS:-120}"

CANARY_RPC_URL="${CANARY_RPC_URL:-}"
CANARY_NETWORK_PASSPHRASE="${CANARY_NETWORK_PASSPHRASE:-}"
CANARY_SECRET_KEY="${CANARY_SECRET_KEY:-}"
CANARY_PAYMENT_CONTRACT="${CANARY_PAYMENT_CONTRACT:-}"
CANARY_ESCROW_CONTRACT="${CANARY_ESCROW_CONTRACT:-}"
CANARY_REFUND_CONTRACT="${CANARY_REFUND_CONTRACT:-}"
CANARY_ADMIN_CONTRACT="${CANARY_ADMIN_CONTRACT:-}"

# Known Mainnet identifiers that must never be targeted by a canary run.
MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"
MAINNET_RPC_HINTS=(
  "mainnet"
  "horizon.stellar.org"
  "soroban-rpc.mainnet"
  "rpc.stellar.org"
  "stellar.org:443"
)

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log()  { printf '[canary-smoke] %s\n' "$*" >&2; }
fail() { printf '[canary-smoke][ERROR] %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# Results tracking
# ---------------------------------------------------------------------------
PROBE_NAMES=()
PROBE_STATUSES=()
PROBE_DETAILS=()
PROBE_DURATIONS_MS=()

record_probe() {
  local name="$1" status="$2" detail="$3" duration_ms="$4"
  PROBE_NAMES+=("$name")
  PROBE_STATUSES+=("$status")
  PROBE_DETAILS+=("$detail")
  PROBE_DURATIONS_MS+=("$duration_ms")
}

json_escape() {
  # Escape a string for safe inclusion in JSON.
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

write_results() {
  local overall="$1"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  {
    printf '{\n'
    printf '  "generated_at": "%s",\n' "$(json_escape "$now")"
    printf '  "overall_status": "%s",\n' "$(json_escape "$overall")"
    printf '  "rpc_url": "%s",\n' "$(json_escape "$CANARY_RPC_URL")"
    printf '  "probes": [\n'
    local i
    for i in "${!PROBE_NAMES[@]}"; do
      printf '    {\n'
      printf '      "name": "%s",\n' "$(json_escape "${PROBE_NAMES[$i]}")"
      printf '      "status": "%s",\n' "$(json_escape "${PROBE_STATUSES[$i]}")"
      printf '      "duration_ms": %s,\n' "${PROBE_DURATIONS_MS[$i]:-0}"
      printf '      "detail": "%s"\n' "$(json_escape "${PROBE_DETAILS[$i]}")"
      if [[ "$i" -lt $(( ${#PROBE_NAMES[@]} - 1 )) ]]; then
        printf '    },\n'
      else
        printf '    }\n'
      fi
    done
    printf '  ]\n'
    printf '}\n'
  } > "$CANARY_RESULTS_FILE"

  log "Wrote results to $CANARY_RESULTS_FILE"
}

# ---------------------------------------------------------------------------
# Mainnet guard
# ---------------------------------------------------------------------------
guard_against_mainnet() {
  local violations=0

  if [[ -z "$CANARY_NETWORK_PASSPHRASE" ]]; then
    fail "CANARY_NETWORK_PASSPHRASE is not set."
    violations=$((violations + 1))
  elif [[ "$CANARY_NETWORK_PASSPHRASE" == "$MAINNET_PASSPHRASE" ]]; then
    fail "Refusing to run: network passphrase matches Stellar Mainnet."
    violations=$((violations + 1))
  elif [[ "${CANARY_NETWORK_PASSPHRASE,,}" == *"public global stellar network"* ]]; then
    fail "Refusing to run: network passphrase indicates Mainnet."
    violations=$((violations + 1))
  fi

  if [[ -z "$CANARY_RPC_URL" ]]; then
    fail "CANARY_RPC_URL is not set."
    violations=$((violations + 1))
  else
    local lower_url="${CANARY_RPC_URL,,}"
    local hint
    for hint in "${MAINNET_RPC_HINTS[@]}"; do
      if [[ "$lower_url" == *"$hint"* ]]; then
        fail "Refusing to run: RPC URL '$CANARY_RPC_URL' indicates Mainnet (matched '$hint')."
        violations=$((violations + 1))
      fi
    done
  fi

  if [[ "$violations" -gt 0 ]]; then
    record_probe "mainnet_guard" "failed" "Mainnet guard tripped; aborting canary probes." 0
    write_results "blocked"
    exit 2
  fi

  record_probe "mainnet_guard" "passed" "Network passphrase and RPC URL are non-Mainnet." 0
}

# ---------------------------------------------------------------------------
# Required env validation
# ---------------------------------------------------------------------------
require_env() {
  local missing=0
  local var
  for var in "$@"; do
    if [[ -z "${!var:-}" ]]; then
      fail "Required environment variable $var is not set."
      missing=$((missing + 1))
    fi
  done
  if [[ "$missing" -gt 0 ]]; then
    record_probe "env_validation" "failed" "Missing required environment variables." 0
    write_results "blocked"
    exit 2
  fi
}

# ---------------------------------------------------------------------------
# Probe runner
# ---------------------------------------------------------------------------
# run_probe <name> <command...>
# Captures stdout/stderr, times the invocation, records result, returns 0/1.
run_probe() {
  local name="$1"
  shift

  log "Running probe: $name"
  local start_ms end_ms duration_ms
  start_ms="$(date +%s%3N)"

  local output rc=0
  output="$(timeout "$CANARY_TIMEOUT_SECONDS" "$@" 2>&1)" || rc=$?

  end_ms="$(date +%s%3N)"
  duration_ms=$(( end_ms - start_ms ))

  if [[ "$rc" -eq 0 ]]; then
    log "Probe '$name' passed (${duration_ms}ms)."
    record_probe "$name" "passed" "${output:0:500}" "$duration_ms"
    return 0
  fi

  if [[ "$rc" -eq 124 ]]; then
    fail "Probe '$name' timed out after ${CANARY_TIMEOUT_SECONDS}s."
    record_probe "$name" "failed" "timeout after ${CANARY_TIMEOUT_SECONDS}s" "$duration_ms"
  else
    fail "Probe '$name' failed (exit $rc): ${output:0:500}"
    record_probe "$name" "failed" "exit ${rc}: ${output:0:500}" "$duration_ms"
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Individual probes
# ---------------------------------------------------------------------------
probe_payment_create_complete() {
  local payment_id
  payment_id="canary-pay-$(date +%s)-$RANDOM"

  run_probe "payment_create_complete" \
    "$STELLAR_CLI" contract invoke \
      --id "$CANARY_PAYMENT_CONTRACT" \
      --rpc-url "$CANARY_RPC_URL" \
      --network-passphrase "$CANARY_NETWORK_PASSPHRASE" \
      --source "$CANARY_SECRET_KEY" \
      -- create_and_complete_payment \
      --payment_id "$payment_id"
}

probe_escrow_create_release() {
  local escrow_id
  escrow_id="canary-esc-$(date +%s)-$RANDOM"

  run_probe "escrow_create_release" \
    "$STELLAR_CLI" contract invoke \
      --id "$CANARY_ESCROW_CONTRACT" \
      --rpc-url "$CANARY_RPC_URL" \
      --network-passphrase "$CANARY_NETWORK_PASSPHRASE" \
      --source "$CANARY_SECRET_KEY" \
      -- create_and_release_escrow \
      --escrow_id "$escrow_id"
}

probe_refund_request_process() {
  local refund_id
  refund_id="canary-ref-$(date +%s)-$RANDOM"

  run_probe "refund_request_process" \
    "$STELLAR_CLI" contract invoke \
      --id "$CANARY_REFUND_CONTRACT" \
      --rpc-url "$CANARY_RPC_URL" \
      --network-passphrase "$CANARY_NETWORK_PASSPHRASE" \
      --source "$CANARY_SECRET_KEY" \
      -- request_and_process_refund \
      --refund_id "$refund_id"
}

probe_get_system_status() {
  run_probe "get_system_status" \
    "$STELLAR_CLI" contract invoke \
      --id "$CANARY_ADMIN_CONTRACT" \
      --rpc-url "$CANARY_RPC_URL" \
      --network-passphrase "$CANARY_NETWORK_PASSPHRASE" \
      --source "$CANARY_SECRET_KEY" \
      -- get_system_status
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log "Starting canary smoke probes."

  guard_against_mainnet

  require_env \
    CANARY_SECRET_KEY \
    CANARY_PAYMENT_CONTRACT \
    CANARY_ESCROW_CONTRACT \
    CANARY_REFUND_CONTRACT \
    CANARY_ADMIN_CONTRACT

  if ! command -v "$STELLAR_CLI" >/dev/null 2>&1; then
    fail "Stellar CLI '$STELLAR_CLI' not found in PATH."
    record_probe "cli_availability" "failed" "stellar CLI not found" 0
    write_results "blocked"
    exit 2
  fi
  record_probe "cli_availability" "passed" "stellar CLI available" 0

  local failures=0

  probe_payment_create_complete || failures=$((failures + 1))
  probe_escrow_create_release   || failures=$((failures + 1))
  probe_refund_request_process  || failures=$((failures + 1))
  probe_get_system_status       || failures=$((failures + 1))

  if [[ "$failures" -gt 0 ]]; then
    fail "$failures probe(s) failed."
    write_results "failed"
    exit 1
  fi

  log "All canary smoke probes passed."
  write_results "passed"
  exit 0
}

main "$@"