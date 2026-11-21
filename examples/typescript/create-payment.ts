/**
 * Example: create a payment with the GridPay TypeScript SDK.
 *
 * Run with:
 *   npx tsx examples/typescript/create-payment.ts
 *
 * Requires the following environment variables:
 *   GRIDPAY_CONTRACT_ID   - deployed payments contract ID (C...)
 *   GRIDPAY_RPC_URL       - Soroban RPC endpoint (defaults to testnet)
 *   GRIDPAY_NETWORK_PASSPHRASE - network passphrase (defaults to testnet)
 *   GRIDPAY_SECRET_KEY    - signer secret key (SERVER-SIDE ONLY, never ship to browsers)
 *
 * See docs/TYPESCRIPT_SDK.md for the full cookbook.
 */
import {
  Keypair,
  Networks,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
import {
  PaymentsClient,
  decodeGridPayError,
} from "@cypher-gridpay/contracts-sdk";

async function main(): Promise<void> {
  const contractId = process.env.GRIDPAY_CONTRACT_ID;
  const secretKey = process.env.GRIDPAY_SECRET_KEY;
  if (!contractId || !secretKey) {
    throw new Error(
      "GRIDPAY_CONTRACT_ID and GRIDPAY_SECRET_KEY must be set (see file header).",
    );
  }

  const rpcUrl = process.env.GRIDPAY_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.GRIDPAY_NETWORK_PASSPHRASE ?? Networks.TESTNET;

  const signer = Keypair.fromSecret(secretKey);

  // Signing client: pass a signTransaction callback. In a browser, this is
  // where you would delegate to Freighter / a wallet instead of a Keypair.
  const client = new PaymentsClient({
    contractId,
    rpcUrl,
    networkPassphrase,
    publicKey: signer.publicKey(),
    signTransaction: async (xdr) => {
      const tx = (await import("@stellar/stellar-sdk")).TransactionBuilder.fromXDR(
        xdr,
        networkPassphrase,
      );
      tx.sign(signer);
      return tx.toXDR();
    },
  });

  const recipient = process.env.GRIDPAY_RECIPIENT ?? signer.publicKey();
  const amount = 10_000_000n; // 1 XLM in stroops (7 decimals)

  try {
    // The SDK simulates, pads resource fees, restores archived entries when
    // needed, submits, and polls until finality.
    const result = await client.createPayment({
      from: new Address(signer.publicKey()).toScVal(),
      to: new Address(recipient).toScVal(),
      amount: nativeToScVal(amount, { type: "i128" }),
      memo: nativeToScVal("hello-gridpay", { type: "string" }),
    });

    console.log("Payment submitted:");
    console.log("  hash:   ", result.hash);
    console.log("  status: ", result.status);
    console.log("  ledger: ", result.ledger);
  } catch (err) {
    const decoded = decodeGridPayError(err);
    if (decoded) {
      console.error(`GridPay error [${decoded.code}] ${decoded.name}: ${decoded.message}`);
      console.error(`  retryable: ${decoded.retryable}`);
    } else {
      console.error("Unexpected error:", err);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
