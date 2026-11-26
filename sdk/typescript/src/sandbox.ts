/**
 * Developer Sandbox and Code Snippet Generator Utilities for Cypher GridPay.
 *
 * Provides BigInt-safe JSON serialization and auto-generated invocation snippets
 * for TypeScript SDK, Python SDK, and Stellar CLI.
 */

export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

export function safeStringify(value: unknown, space: number = 2): string {
  return JSON.stringify(value, bigIntReplacer, space);
}

export interface SnippetInput {
  contract: string;
  method: string;
  args: Record<string, unknown>;
  network: "testnet" | "standalone";
}

/**
 * Generates an idiomatic TypeScript SDK invocation snippet.
 */
export function generateTsSnippet(input: SnippetInput): string {
  const args = safeStringify(input.args, 2);
  return `import { ${input.contract}Client } from "@cypher-gridpay/contracts-sdk";

const client = new ${input.contract}Client({ network: "${input.network}" });
const result = await client.${input.method}(${args});
console.log(result);`;
}

/**
 * Generates an idiomatic Python SDK invocation snippet with Pythonic literals.
 */
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

/**
 * Generates a Stellar CLI invocation command.
 */
export function generateCliSnippet(input: SnippetInput): string {
  const entries = Object.entries(input.args);
  const argStr = entries.length > 0
    ? " " + entries.map(([k, v]) => `--${k} ${typeof v === "string" ? v : JSON.stringify(v, bigIntReplacer)}`).join(" ")
    : "";
  return `stellar contract invoke --id <CONTRACT_ID> --source <KEY> --network ${input.network} -- ${input.method}${argStr}`;
}
