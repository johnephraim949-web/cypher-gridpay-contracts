# Frontend Bundle Budget and Lazy-Loading Plan (issue #362)

Status: **plan and budget config only.** `apps/web` has no `package.json`,
bundler config, router or entry point on main, so none of the code-splitting
work can be implemented or measured yet. Nothing here has been run.

## Budgets

`apps/web/.size-limit.json` declares the targets from the issue for
[`size-limit`](https://github.com/ai/size-limit):

- Embeddable Checkout Widget initial JS: under 120 KB gzipped.
- Main web app shell initial JS: under 250 KB gzipped.

The `path` globs (`dist/widget/*.js`, `dist/assets/index-*.js`) are
assumptions for a Vite build and must be adjusted to the real output layout.
To enforce it, the app's `package.json` needs `size-limit` and
`@size-limit/file` devDependencies, a `"size": "size-limit"` script, and a CI
step (preferably in a new workflow rather than `ci.yml`).

## Plan once the app exists

1. Route-level `React.lazy` for Admin, Analytics (charts), Sandbox; keep
   Checkout core in the entry chunk. Use Vite `manualChunks` to isolate
   `@stellar/stellar-sdk` and chart libraries.
2. Wallet adapters: `await import()` the adapter inside the click handler of
   the chosen option in `WalletSelectorModal`; never import all adapters at
   module top level.
3. Error boundary around lazy routes that catches chunk-load failures
   (`ChunkLoadError` / "Failed to fetch dynamically imported module") and shows
   a one-click reload prompt.
4. Prefetch next-route chunks on hover/focus of links.
5. Stale-while-revalidate cache for read-only queries (`get_allowed_tokens`,
   `get_protocol_parameters`).
6. Tree-shaking: `sdk/typescript/package.json` already sets
   `"sideEffects": false`; verify single-contract views import only the needed
   client from the SDK once the app is bundled.
7. Lighthouse mobile run (target >= 90) on the Checkout page in CI.
