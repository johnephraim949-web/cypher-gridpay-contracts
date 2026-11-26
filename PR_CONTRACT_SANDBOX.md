## Title
feat(ui): interactive developer sandbox & Soroban contract explorer (#359)

## Summary

Resolves #359: Developers adopting `@cypher-gridpay/contracts-sdk` and the Python SDK need a quick way to experiment with Testnet contract invocations, inspect parameter schemas, test faucet funding, and generate copy-pasteable client snippets without running a local Rust toolchain.

### Key Features Implemented:
1. **Interactive Developer Sandbox (`apps/web/src/pages/sandbox/ContractSandboxPage.tsx`)**:
   - Structured method invocation interface covering all 4 core smart contracts (`Payment`, `Escrow`, `Refund`, and `Admin`).
   - Dynamic dropdown selectors that auto-populate contract descriptions, method definitions (read/write), and realistic parameter payloads (with live JSON editing & reset capabilities).
   - Simulates on-chain execution with BigInt-safe telemetry formatting (displaying simulated CPU instructions, memory footprint, and return data).

2. **Mainnet Route Hard-Guard & Security Protection**:
   - Explicitly disables transaction execution and displays a protective warning banner if the web console targets Stellar Mainnet (`VITE_STELLAR_NETWORK === "mainnet"`).

3. **Live Snippet Generation (`apps/web/src/components/sandbox/SnippetGenerator.tsx` & `sdk/typescript/src/sandbox.ts`)**:
   - Real-time side panel generating copyable, idiomatic code for:
     - **TypeScript SDK (`@cypher-gridpay/contracts-sdk`)**: Typed client initialization and invocation.
     - **Python SDK (`cypher_gridpay_sdk`)**: Pythonic keyword arguments with proper casing (`True`, `False`, `None`).
     - **Stellar CLI**: Formatted `stellar contract invoke` CLI command strings with appropriate `--network` and `--` argument flags.
   - One-click copy-to-clipboard buttons with confirmation states.

4. **Testnet Friendbot Faucet Toolbar (`apps/web/src/components/sandbox/TestnetFaucetBar.tsx`)**:
   - Quick-fund tool allowing developers to top up test accounts with Testnet XLM directly from the UI.
   - Built-in 10-second client-side cooldown rate limiter to prevent spamming public Horizon/Friendbot services.

5. **BigInt-Safe Serialization & SDK Primitives (`sdk/typescript/src/sandbox.ts`)**:
   - `bigIntReplacer` and `safeStringify` ensure `BigInt` amounts and ledgers are cleanly formatted without throwing `TypeError: Do not know how to serialize a BigInt`.
   - Exported directly from the TypeScript SDK package.

6. **Unit Tests (`sdk/typescript/test/sandbox.test.mjs`)**:
   - 6 new automated unit tests validating BigInt replacement, complex payload formatting, TypeScript snippet generation, Python keyword conversion, and Stellar CLI argument flags.

## Verification

```bash
cd sdk/typescript
npm run build
npm test
```

### Test Output
```text
TAP version 13
# Subtest: Error Maps Completeness
ok 1 - Error Maps Completeness
# Subtest: extractErrorCode handles multiple error representations
ok 2 - extractErrorCode handles multiple error representations
# Subtest: decodeGridPayError decodes payment errors accurately
ok 3 - decodeGridPayError decodes payment errors accurately
# Subtest: decodeGridPayError decodes escrow errors with hint
ok 4 - decodeGridPayError decodes escrow errors with hint
# Subtest: decodeGridPayError decodes refund errors
ok 5 - decodeGridPayError decodes refund errors
# Subtest: decodeGridPayError decodes admin errors
ok 6 - decodeGridPayError decodes admin errors
# Subtest: isContractError & isRetryableError helpers
ok 7 - isContractError & isRetryableError helpers
# Subtest: formatDiagnosticError outputs clean actionable diagnostics
ok 8 - formatDiagnosticError outputs clean actionable diagnostics
# Subtest: bigIntReplacer converts BigInt to string while preserving other types
ok 9 - bigIntReplacer converts BigInt to string while preserving other types
# Subtest: safeStringify safely formats complex payloads with BigInt without throwing TypeError
ok 10 - safeStringify safely formats complex payloads with BigInt without throwing TypeError
# Subtest: generateTsSnippet generates valid TypeScript SDK invocation code
ok 11 - generateTsSnippet generates valid TypeScript SDK invocation code
# Subtest: generatePySnippet generates valid Python SDK code with Pythonic booleans and None
ok 12 - generatePySnippet generates valid Python SDK code with Pythonic booleans and None
# Subtest: generateCliSnippet produces formatted stellar contract invoke command
ok 13 - generateCliSnippet produces formatted stellar contract invoke command
# Subtest: generateCliSnippet handles empty args gracefully
ok 14 - generateCliSnippet handles empty args gracefully
1..14
# tests 14
# suites 0
# pass 14
# fail 0
```

Closes #359
