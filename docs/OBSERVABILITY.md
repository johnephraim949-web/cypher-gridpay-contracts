# Observability Stack

Configs live in `deploy/monitoring/` (Prometheus, alert rules, Alertmanager, Grafana provisioning, three dashboards, `docker-compose.monitoring.yml`). Runbooks: `docs/OBSERVABILITY_RUNBOOK.md`.

## Metrics that exist today
Only `services/crank-worker/src/metrics.ts` exposes Prometheus metrics (`/metrics` on `CRANK_METRICS_PORT`): `crank_due_queue_depth`, `crank_execution_latency_seconds`, `crank_gas_spent_stroops_total`, `crank_execution_total`, `crank_permanent_failures_total`, `crank_skipped_total{reason}` (includes `circuit_open`). `services/relayer/src/observability.ts` has only a JSON logger, a JSONL ledger and alert sinks; no Prometheus metrics. Indexer, webhook worker, watchtower and the contract exporter are not implemented.

## Planned (not yet emitted) metrics
Alerts in the `gridpay-planned-metrics` group reference metrics that do not exist and will not fire until implemented: `gridpay_contract_storage_ttl_ledgers_remaining`, `gridpay_contract_paused`, `gridpay_refund_circuit_breaker_tripped`, `gridpay_signer_xlm_balance`, `gridpay_indexer_ledger_lag`, `soroban_rpc_requests_total{code}`. Thresholds follow the issue (TTL 17,280/4,320 ledgers; balance 50/10 XLM; lag 12 ledgers; 5xx 1%).

## Not covered
Nothing was run: no promtool, no Grafana import, no compose up. `promtool check rules` and `promtool test rules` are not wired into CI (ci.yml is contended). The single unit test only covers `CrankWorkerDown`. Dashboards are minimal; panels on planned metrics will be empty. Runbook links point to a new file instead of docs/OPERATIONAL_RUNBOOK.md. Alertmanager secrets are mounted from files you must create; PagerDuty/Slack are not configured.
