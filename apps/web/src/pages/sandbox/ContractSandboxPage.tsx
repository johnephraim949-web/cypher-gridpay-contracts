import React, { useState } from "react";
import SnippetGenerator, { safeStringify } from "../../components/sandbox/SnippetGenerator";
import TestnetFaucetBar from "../../components/sandbox/TestnetFaucetBar";

const NETWORK = (import.meta as any)?.env?.VITE_STELLAR_NETWORK ?? "testnet";

interface MethodConfig {
  name: string;
  type: "read" | "write";
  sampleArgs: Record<string, unknown>;
  description: string;
}

const CONTRACT_DEFINITIONS: Record<string, { description: string; methods: MethodConfig[] }> = {
  Payment: {
    description: "SEP-41 payment routing, split payouts, and automated escrow forwarding",
    methods: [
      {
        name: "get_balance",
        type: "read",
        sampleArgs: {
          account: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
          token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        },
        description: "Query token balance and available payment allowance",
      },
      {
        name: "initiate_payment",
        type: "write",
        sampleArgs: {
          payer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
          payee: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          amount: 10000000n,
          memo: "INV-2026-001",
        },
        description: "Initiate single or split payment execution",
      },
      {
        name: "authorize_hold",
        type: "write",
        sampleArgs: {
          preauth_id: "AUTH-882",
          customer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
          amount: 25000000n,
          ttl_ledgers: 17280,
        },
        description: "Pre-authorize hold and partial capture escrow allocation",
      },
    ],
  },
  Escrow: {
    description: "Multi-party conditional milestone, tender deposit, and retainer escrows",
    methods: [
      {
        name: "get_escrow",
        type: "read",
        sampleArgs: { escrow_id: "ESCROW-9001" },
        description: "Retrieve current state, beneficiaries, and milestones of an escrow",
      },
      {
        name: "create_escrow",
        type: "write",
        sampleArgs: {
          escrow_id: "ESCROW-9001",
          buyer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
          seller: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          amount: 50000000n,
          timelock: 1735689600,
        },
        description: "Instantiate a multi-signature time-locked escrow contract",
      },
      {
        name: "dispute_escrow",
        type: "write",
        sampleArgs: { escrow_id: "ESCROW-9001", reason: "Defective delivery and failed inspection" },
        description: "Open dispute and trigger arbitration cooldown",
      },
    ],
  },
  Refund: {
    description: "Goodwill vouchers, automated buyer protection, and arbitration dispute pools",
    methods: [
      {
        name: "get_refund_status",
        type: "read",
        sampleArgs: { refund_id: "REF-404" },
        description: "Check refund eligibility, settlement status, and payout hash",
      },
      {
        name: "issue_goodwill_voucher",
        type: "write",
        sampleArgs: {
          customer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
          credit_amount: 15000000n,
          expiry_epoch: 1767225600,
        },
        description: "Issue merchant-funded non-expiring goodwill store credit",
      },
      {
        name: "process_rma_refund",
        type: "write",
        sampleArgs: {
          rma_number: "RMA-9921",
          carrier_tracking: "1Z9999999999999999",
          delivery_confirmed: true,
        },
        description: "Process carrier delivery attestation automated refund",
      },
    ],
  },
  Admin: {
    description: "Orchestrator control center, timelocked governance queue, and contract rotation",
    methods: [
      {
        name: "get_system_status",
        type: "read",
        sampleArgs: {},
        description: "Inspect global paused state, active contract addresses, and protocol version",
      },
      {
        name: "set_system_pause",
        type: "write",
        sampleArgs: { paused: false, reason: "Normal operations resumed" },
        description: "Emergency circuit-breaker halt/resume protocol orchestrator",
      },
      {
        name: "rotate_contract",
        type: "write",
        sampleArgs: {
          contract_name: "payment",
          new_contract_id: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        },
        description: "Update orchestrator registry to target upgraded contract instance",
      },
    ],
  },
};

export default function ContractSandboxPage() {
  const isMainnet = NETWORK === "mainnet";
  const network = (NETWORK === "standalone" ? "standalone" : "testnet") as "testnet" | "standalone";

  const [selectedContract, setSelectedContract] = useState<string>("Payment");
  const [selectedMethodName, setSelectedMethodName] = useState<string>("get_balance");
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [argsJson, setArgsJson] = useState<string>(
    safeStringify(CONTRACT_DEFINITIONS.Payment.methods[0].sampleArgs, 2)
  );
  const [parsedArgs, setParsedArgs] = useState<Record<string, unknown>>(
    CONTRACT_DEFINITIONS.Payment.methods[0].sampleArgs
  );
  const [executionResult, setExecutionResult] = useState<unknown>(null);
  const [executing, setExecuting] = useState<boolean>(false);

  // Hard security guard for Mainnet execution
  if (isMainnet) {
    return (
      <div className="max-w-4xl mx-auto p-8 my-6 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">⚠️</span>
          <h1 className="text-xl font-bold">Contract Sandbox Disabled on Stellar Mainnet</h1>
        </div>
        <p className="text-sm mt-2 text-amber-800">
          The interactive Soroban contract sandbox executes transactions and simulated calls against live test accounts.
          To protect mainnet funds and avoid unintended on-chain state modifications, the sandbox route is strictly
          read-only and disabled in production mainnet environments.
        </p>
        <p className="text-xs text-amber-700 mt-4">
          Switch to <strong>Testnet</strong> or <strong>Standalone</strong> mode in your deployment configuration to enable the interactive developer sandbox.
        </p>
      </div>
    );
  }

  const currentContractConfig = CONTRACT_DEFINITIONS[selectedContract];
  const currentMethodConfig =
    currentContractConfig?.methods.find((m) => m.name === selectedMethodName) ||
    currentContractConfig?.methods[0];

  const handleContractChange = (newContract: string) => {
    setSelectedContract(newContract);
    const firstMethod = CONTRACT_DEFINITIONS[newContract]?.methods[0];
    if (firstMethod) {
      setSelectedMethodName(firstMethod.name);
      setArgsJson(safeStringify(firstMethod.sampleArgs, 2));
      setParsedArgs(firstMethod.sampleArgs);
    }
  };

  const handleMethodChange = (newMethodName: string) => {
    setSelectedMethodName(newMethodName);
    const methodObj = currentContractConfig?.methods.find((m) => m.name === newMethodName);
    if (methodObj) {
      setArgsJson(safeStringify(methodObj.sampleArgs, 2));
      setParsedArgs(methodObj.sampleArgs);
    }
  };

  const handleArgsTextChange = (text: string) => {
    setArgsJson(text);
    try {
      const parsed = JSON.parse(text);
      setParsedArgs(parsed);
    } catch {
      // Allow live editing while JSON is temporarily incomplete
    }
  };

  const executeSimulation = async () => {
    setExecuting(true);
    setExecutionResult(null);

    // Simulated sandbox invocation response demonstrating BigInt serialization
    setTimeout(() => {
      setExecutionResult({
        status: "SUCCESS",
        network,
        contract: selectedContract,
        method: selectedMethodName,
        ledgerSequence: 1249821,
        simulatedCpuInstructions: 842109n,
        simulatedMemoryBytes: 154820n,
        authRequired: currentMethodConfig?.type === "write",
        returnValue: {
          success: true,
          txHash: "9a738bfd24b6f120e2e92c6b3e811bc51d8b9487b3e150db65a2d04a62e08cf4",
          effectiveBalance: 9850000000n,
          feeCharged: 100n,
        },
      });
      setExecuting(false);
    }, 400);
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Developer Contract Sandbox</h1>
            <span className="px-2 py-0.5 text-xs font-semibold uppercase rounded bg-indigo-100 text-indigo-700">
              {network}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Experiment with Soroban smart contract invocations and inspect live client SDK code.
          </p>
        </div>
      </div>

      <TestnetFaucetBar
        walletAddress={walletAddress}
        network={network}
        onAddressChange={setWalletAddress}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Call Form */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-4 bg-white border rounded shadow-sm space-y-4">
            <h2 className="text-base font-bold text-gray-800">Method Invocation</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Contract Target</label>
                <select
                  value={selectedContract}
                  onChange={(e) => handleContractChange(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {Object.keys(CONTRACT_DEFINITIONS).map((c) => (
                    <option key={c} value={c}>
                      {c} Contract
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">{currentContractConfig?.description}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Method</label>
                <select
                  value={selectedMethodName}
                  onChange={(e) => handleMethodChange(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {currentContractConfig?.methods.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} ({m.type})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">{currentMethodConfig?.description}</p>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-semibold text-gray-600">Invocation Parameters (JSON)</label>
                <button
                  onClick={() => {
                    if (currentMethodConfig) {
                      setArgsJson(safeStringify(currentMethodConfig.sampleArgs, 2));
                      setParsedArgs(currentMethodConfig.sampleArgs);
                    }
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  Reset Sample Args
                </button>
              </div>
              <textarea
                value={argsJson}
                onChange={(e) => handleArgsTextChange(e.target.value)}
                rows={7}
                className="w-full text-xs font-mono border border-gray-300 rounded p-2.5 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              onClick={executeSimulation}
              disabled={executing}
              className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm rounded shadow-sm transition"
            >
              {executing ? "Simulating On-Chain Call..." : `Simulate ${selectedContract}.${selectedMethodName} (${network})`}
            </button>
          </div>

          {/* Invocation Result Display */}
          <div className="p-4 bg-white border rounded shadow-sm space-y-2">
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Simulated Execution Response</h3>
            <pre className="p-3 bg-slate-900 text-emerald-400 text-xs font-mono rounded overflow-auto min-h-[140px] max-h-72">
              <code>
                {executionResult
                  ? safeStringify(executionResult, 2)
                  : "// Execute method to inspect simulated RPC and footprint results"}
              </code>
            </pre>
          </div>
        </div>

        {/* Right Column: Dynamic Snippet Side Panel */}
        <div className="lg:col-span-5">
          <SnippetGenerator
            contract={selectedContract}
            method={selectedMethodName}
            args={parsedArgs}
            network={network}
          />
        </div>
      </div>
    </div>
  );
}
