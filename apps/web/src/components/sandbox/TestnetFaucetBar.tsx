import React, { useState } from "react";

interface Props {
  walletAddress?: string;
  network: "testnet" | "standalone";
  onAddressChange?: (addr: string) => void;
}

export default function TestnetFaucetBar({ walletAddress, network, onAddressChange }: Props) {
  const [customAddress, setCustomAddress] = useState(walletAddress || "");
  const [loading, setLoading] = useState<boolean>(false);
  const [last, setLast] = useState<number>(0);
  const [msg, setMsg] = useState<string>("");
  const cooldownMs = 10000;

  const currentAddress = walletAddress || customAddress;

  const fund = async () => {
    const now = Date.now();
    if (now - last < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - (now - last)) / 1000);
      setMsg(`Rate limited. Try again in ${waitSec}s.`);
      return;
    }
    if (!currentAddress || !currentAddress.startsWith("G") || currentAddress.length < 50) {
      setMsg("Please provide a valid Stellar public key (starts with G).");
      return;
    }

    setLoading(true);
    setMsg("Requesting funds from Friendbot...");
    setLast(now);

    try {
      if (network === "testnet") {
        const res = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(currentAddress)}`);
        if (res.ok) {
          setMsg("Funded successfully via Stellar Friendbot (+10,000 XLM).");
        } else {
          const errData = await res.json().catch(() => null);
          setMsg(`Friendbot response: ${errData?.detail || res.statusText}`);
        }
      } else {
        setMsg("Standalone network: please use local quickstart friendbot (http://localhost:8000/friendbot).");
      }
    } catch (err: any) {
      setMsg(`Faucet request failed: ${err?.message || "network error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-md">
      <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Testnet Faucet:</span>
      <input
        type="text"
        placeholder="Enter Stellar address (G...)"
        value={currentAddress}
        onChange={(e) => {
          setCustomAddress(e.target.value);
          onAddressChange?.(e.target.value);
        }}
        className="px-2 py-1 text-xs border border-gray-300 rounded font-mono w-72 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <button
        onClick={fund}
        disabled={loading}
        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium rounded transition"
      >
        {loading ? "Funding..." : "Fund Account (Friendbot)"}
      </button>
      {msg && <span className="text-xs text-slate-600 ml-1">{msg}</span>}
    </div>
  );
}
