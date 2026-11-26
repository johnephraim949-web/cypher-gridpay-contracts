import React, { useState } from "react";

export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function safeStringify(value: unknown, space = 2): string {
  return JSON.stringify(value, bigIntReplacer, space);
}

export interface SnippetInput {
  contract: string;
  method: string;
  args: Record<string, unknown>;
  network: "testnet" | "standalone";
}

export function generateTsSnippet(input: SnippetInput): string {
  const args = safeStringify(input.args, 2);
  return `import { ${input.contract}Client } from "@cypher-gridpay/contracts-sdk";

const client = new ${input.contract}Client({ network: "${input.network}" });
const result = await client.${input.method}(${args});
console.log(result);`;
}

export function generatePySnippet(input: SnippetInput): string {
  const args = JSON.stringify(input.args, bigIntReplacer, 2)
    .replace(/:\s*true\b/g, ": True")
    .replace(/:\s*false\b/g, ": False")
    .replace(/:\s*null\b/g, ": None");
  return `from cypher_gridpay_sdk import ${input.contract}Client

client = ${input.contract}Client(network="${input.network}")
result = client.${input.method}(**${args})
print(result)`;
}

export function generateCliSnippet(input: SnippetInput): string {
  const entries = Object.entries(input.args);
  const argStr = entries.length > 0
    ? " " + entries.map(([k, v]) => `--${k} ${typeof v === "string" ? v : JSON.stringify(v, bigIntReplacer)}`).join(" ")
    : "";
  return `stellar contract invoke --id <CONTRACT_ID> --source <KEY> --network ${input.network} -- ${input.method}${argStr}`;
}

export default function SnippetGenerator({
  contract,
  method,
  args,
  network,
}: {
  contract: string;
  method: string;
  args: Record<string, unknown>;
  network: "testnet" | "standalone";
}) {
  const input: SnippetInput = { contract, method, args, network };
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // clipboard write fallback
    }
  };

  const tsCode = generateTsSnippet(input);
  const pyCode = generatePySnippet(input);
  const cliCode = generateCliSnippet(input);

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-sm text-gray-900 border-b pb-2">Live Code Snippets</h3>

      <div className="border rounded bg-white shadow-sm overflow-hidden">
        <div className="flex justify-between items-center bg-gray-50 px-3 py-1.5 border-b">
          <span className="text-xs font-semibold text-gray-700">TypeScript SDK</span>
          <button
            onClick={() => copy(tsCode, "ts")}
            className="text-xs px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 transition text-gray-700"
          >
            {copiedKey === "ts" ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <pre className="p-3 bg-slate-900 text-slate-100 text-xs overflow-auto font-mono max-h-48">
          <code>{tsCode}</code>
        </pre>
      </div>

      <div className="border rounded bg-white shadow-sm overflow-hidden">
        <div className="flex justify-between items-center bg-gray-50 px-3 py-1.5 border-b">
          <span className="text-xs font-semibold text-gray-700">Python SDK</span>
          <button
            onClick={() => copy(pyCode, "py")}
            className="text-xs px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 transition text-gray-700"
          >
            {copiedKey === "py" ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <pre className="p-3 bg-slate-900 text-slate-100 text-xs overflow-auto font-mono max-h-48">
          <code>{pyCode}</code>
        </pre>
      </div>

      <div className="border rounded bg-white shadow-sm overflow-hidden">
        <div className="flex justify-between items-center bg-gray-50 px-3 py-1.5 border-b">
          <span className="text-xs font-semibold text-gray-700">Stellar CLI</span>
          <button
            onClick={() => copy(cliCode, "cli")}
            className="text-xs px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 transition text-gray-700"
          >
            {copiedKey === "cli" ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <pre className="p-3 bg-slate-900 text-slate-100 text-xs overflow-auto font-mono max-h-48">
          <code>{cliCode}</code>
        </pre>
      </div>
    </div>
  );
}
