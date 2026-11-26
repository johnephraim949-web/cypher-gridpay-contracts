// Deterministic mock Soroban JSON-RPC server (issue #361).
// Replays canned responses for getHealth, getLedgerEntries, simulateTransaction,
// sendTransaction, getTransaction and getEvents. Fixtures below are PLACEHOLDER
// base64 strings, NOT real XDR: replace them with captured standalone-network
// responses before asserting on decoded values.
import http from 'node:http';

export const FIXTURES = {
  getHealth: { status: 'healthy', latestLedger: 1000, oldestLedger: 1, ledgerRetentionWindow: 17280 },
  getLedgerEntries: { entries: [], latestLedger: 1000 },
  simulateTransaction: { transactionData: 'AAAA', minResourceFee: '100', results: [{ xdr: 'AAAA', auth: [] }], latestLedger: 1000 },
  sendTransaction: { status: 'PENDING', hash: 'a'.repeat(64), latestLedger: 1000, latestLedgerCloseTime: '1700000000' },
  getTransaction: { status: 'SUCCESS', latestLedger: 1001, latestLedgerCloseTime: '1700000005', ledger: 1001 },
  getEvents: { events: [], latestLedger: 1001 },
};

export function startMockRpc(port = 8545, overrides = {}) {
  const calls = [];
  const fixtures = { ...FIXTURES, ...overrides };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
      let rpc;
      try { rpc = JSON.parse(body); } catch { res.statusCode = 400; return res.end('{}'); }
      calls.push(rpc);
      const result = fixtures[rpc.method];
      res.end(JSON.stringify(result === undefined
        ? { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `mock: no fixture for ${rpc.method}` } }
        : { jsonrpc: '2.0', id: rpc.id, result }));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () =>
    resolve({ url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(r)) })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startMockRpc(Number(process.env.MOCK_RPC_PORT ?? 8545));
  console.log(`mock soroban rpc listening on ${url}`);
}
