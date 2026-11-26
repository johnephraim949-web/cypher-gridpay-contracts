import { test, expect } from '@playwright/test';
// @ts-ignore - plain ESM module
import { startMockRpc } from '../mocks/sorobanRpcMock.mjs';

// Runs without a web app: verifies the mock harness itself is deterministic.
test('mock soroban rpc replays canned getHealth', async ({ request }) => {
  const rpc = await startMockRpc(0 + 18545);
  try {
    const r = await request.post(rpc.url, { data: { jsonrpc: '2.0', id: 1, method: 'getHealth' } });
    expect((await r.json()).result.status).toBe('healthy');
    const bad = await request.post(rpc.url, { data: { jsonrpc: '2.0', id: 2, method: 'nope' } });
    expect((await bad.json()).error.code).toBe(-32601);
    expect(rpc.calls).toHaveLength(2);
  } finally {
    await rpc.close();
  }
});
