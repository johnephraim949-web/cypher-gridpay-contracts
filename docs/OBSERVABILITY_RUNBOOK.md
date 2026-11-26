# Observability Alert Runbook

Anchors match `runbook_url` in `deploy/monitoring/alerts/gridpay-contracts.yml`. For pausing contracts see `docs/OPERATIONAL_RUNBOOK.md`; for archived entries see `docs/STORAGE_RESTORATION.md`.

## CrankWorkerDown
Check the pod/process and `CRANK_METRICS_PORT`; restart and inspect logs.

## CrankPermanentFailures
Inspect the failing `action_type` in logs; a deterministic revert needs a contract or argument fix, not retries.

## CrankCircuitBreakerOpen
The worker's circuit breaker is skipping tasks. Check RPC health first, then wait for the breaker to half-open or fix the underlying error.

## CrankQueueBacklog
Check RPC latency and channel account pool capacity; scale or raise concurrency.

## CrankGasSpendHigh
Compare against expected task volume; look for retry loops. Threshold is a tunable guess.

## SorobanTTL
Run the TTL keeper (`ops/ttl-keeper`, if merged) or extend TTL manually; restore archived entries per `docs/STORAGE_RESTORATION.md`.

## ContractPaused
Confirm it is intentional via `get_system_status`; follow `docs/OPERATIONAL_RUNBOOK.md` to unpause.

## RefundCircuitBreaker
Investigate refund volume anomaly before resetting the breaker.

## SignerBalance
Top up the relayer/keeper account with XLM.

## IndexerLag
Check indexer logs and RPC reachability. Suppressed automatically when SorobanRpcDown fires.

## SorobanRpcErrors
Check the RPC node, upstream core sync, and the load balancer (`docs/SOROBAN_RPC_LOAD_BALANCER.md`).
