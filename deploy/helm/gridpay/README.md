# gridpay Helm chart

Install: `helm install gridpay deploy/helm/gridpay -f deploy/helm/gridpay/values-staging.yaml`.

Only `crank-worker` is enabled by default; relayer, indexer, api, webhook-worker and web are disabled
placeholders because the repo has no runnable entrypoint/Dockerfile for them yet. `ttl-keeper` is a CronJob
under `ops/ttl-keeper/` (PR #499) and is intentionally not duplicated here. Probes are TCP because no HTTP
health endpoints exist. HPA is CPU-based only (queue-depth needs KEDA/custom metrics). The ExternalSecret
requires External Secrets Operator CRDs; secrets are referenced, never stored. Not linted or rendered by the author.
