import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { CrankMetrics } from "./metrics.js";
import { SimulateFirstPipeline } from "./pipeline.js";
import { createStellarStack } from "./rpc/stellar.js";
import { CrankWorker } from "./scheduler.js";
import { PostgresScheduleStore } from "./store/postgres.js";
import { initTelemetry, shutdownTelemetry } from "./telemetry.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const telemetry = initTelemetry({
    serviceName: "crank-worker",
    network: config.network,
    otlpEndpoint: config.otelEndpoint,
  });
  const logger = telemetry.logger;

  const pgPool = new Pool({ connectionString: config.databaseUrl });
  const store = new PostgresScheduleStore(pgPool);
  await store.initialize();

  const stack = createStellarStack(config);
  const metrics = new CrankMetrics();
  const metricsServer = config.metricsPort === undefined ? undefined : await metrics.startServer(config.metricsPort);

  const pipeline = new SimulateFirstPipeline({
    rpc: stack.rpcGateway,
    txFactory: stack.txFactory,
    signer: stack.signer,
    pool: stack.pool,
    config,
  });
  const worker = new CrankWorker({
    store,
    pipeline,
    metrics,
    owner: `${process.env.CRANK_WORKER_ID ?? ""}:${process.pid}`.replace(/^:/, ""),
    lookaheadMs: config.lookaheadMs,
    batchSize: config.batchSize,
    lockTtlMs: config.lockTtlMs,
    pollIntervalMs: config.pollIntervalMs,
    circuit: {
      failureThreshold: config.failureThreshold,
      baseBackoffMs: config.baseBackoffMs,
      maxBackoffMs: config.maxBackoffMs,
    },
    logger: (message) => logger.info(message, { component: "crank-scheduler" }),
  });

  const controller = new AbortController();
  const shutdown = (signal: string): void => {
    logger.info("shutdown signal received", { signal });
    controller.abort();
    // Flush telemetry without blocking the worker loop; bounded by the SDK timeout.
    void shutdownTelemetry(telemetry).catch((error: unknown) => {
      console.error("telemetry shutdown failed", error);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  await worker.runForever(controller.signal);

  metricsServer?.close();
  await stack.pool.close();
  await pgPool.end();
  await shutdownTelemetry(telemetry);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
