#!/usr/bin/env python3
"""
scripts/compare-budget-bench.py

Compare current budget-bench metrics against the main-branch baseline and emit
a Markdown comparison table. Used by .github/workflows/ci.yml as the
regression gate (issue #378).

Usage:
    python3 scripts/compare-budget-bench.py \
        --current budget-metrics.json \
        --baseline baseline-metrics.json \
        --output budget-comparison.md \
        --warn-pct 5 --fail-pct 15 --enforce

Exit codes:
    0  No failures (pass, or warnings-only, or missing baseline recorded gracefully)
    1  One or more entrypoints exceeded the configured regression threshold or
       a Soroban ledger cap (--enforce gates this; without --enforce it only warns)

Metric records (JSON array, or JSON Lines — auto-detected):
    {"contract": "payment", "entrypoint": "create_payment",
     "cpu_insns": 25123456, "mem_bytes": 9876543, "wasm_bytes": 23456,
     "cpu_ceiling": 25000000, "mem_ceiling": 10000000}

Each entrypoint is matched against the baseline by (contract, entrypoint) and
deltas are computed for cpu_insns, mem_bytes, and wasm_bytes:
    delta_pct = (current - baseline) / baseline * 100   (only when baseline > 0)

Classification per metric:
    FAIL  — current exceeds the Soroban ledger cap (cpu/mem), OR
            delta_pct > --fail-pct (regression)
    WARN  — delta_pct > --warn-pct (and not already FAIL)
    OK    — otherwise
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# Soroban network per-transaction limits (defaults; overridable via CLI).
# ---------------------------------------------------------------------------
DEFAULT_CPU_CAP = 100_000_000          # 100M CPU instructions / tx
DEFAULT_MEM_CAP = 40 * 1024 * 1024     # 40 MiB / tx
DEFAULT_WASM_CAP = 64 * 1024            # 64 KiB optimized contract budget

WARN_PCT = 5
FAIL_PCT = 15

STATUS_OK = "OK"
STATUS_WARN = "WARN"
STATUS_FAIL = "FAIL"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class MetricRecord:
    contract: str
    entrypoint: str
    cpu_insns: int = 0
    mem_bytes: int = 0
    wasm_bytes: int = 0
    cpu_ceiling: int = 0
    mem_ceiling: int = 0


@dataclass
class Comparison:
    contract: str
    entrypoint: str
    cpu_now: int
    cpu_base: Optional[int]
    cpu_delta_pct: Optional[float]
    mem_now: int
    mem_base: Optional[int]
    mem_delta_pct: Optional[float]
    wasm_now: int
    wasm_base: Optional[int]
    wasm_delta_pct: Optional[float]
    # Per-metric statuses
    cpu_status: str = STATUS_OK
    mem_status: str = STATUS_OK
    wasm_status: str = STATUS_OK
    overall: str = STATUS_OK
    notes: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def read_metrics(path: str) -> list[MetricRecord]:
    """Read a metrics file as a JSON array or JSON Lines (auto-detected)."""
    if not path or not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip()
    if not raw:
        return []
    records: list[MetricRecord] = []

    def to_record(obj: dict) -> MetricRecord:
        return MetricRecord(
            contract=str(obj.get("contract", "")),
            entrypoint=str(obj.get("entrypoint", "")),
            cpu_insns=int(obj.get("cpu_insns", 0) or 0),
            mem_bytes=int(obj.get("mem_bytes", 0) or 0),
            wasm_bytes=int(obj.get("wasm_bytes", 0) or 0),
            cpu_ceiling=int(obj.get("cpu_ceiling", 0) or 0),
            mem_ceiling=int(obj.get("mem_ceiling", 0) or 0),
        )

    # Auto-detect: JSON array starts with '[', JSONL starts with '{'.
    first = raw[0]
    if first == "[":
        data = json.loads(raw)
        for obj in data:
            if isinstance(obj, dict):
                records.append(to_record(obj))
    elif first == "{":
        # JSON Lines: one object per line.
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if isinstance(obj, dict):
                records.append(to_record(obj))
    else:
        raise ValueError(f"Unrecognized metrics format in {path!r} (first char {first!r})")
    return records


def pct_delta(current: int, baseline: Optional[int]) -> Optional[float]:
    """Percentage delta of current vs baseline. None if baseline missing/zero."""
    if baseline is None or baseline == 0:
        return None
    return (current - baseline) / baseline * 100.0


def classify(delta_pct: Optional[float], warn_pct: float, fail_pct: float,
             current: int, cap: int, has_cap: bool = True) -> str:
    """Classify a single metric. Cap-breach is always FAIL regardless of delta."""
    if has_cap and cap > 0 and current > cap:
        return STATUS_FAIL
    if delta_pct is None:
        # No baseline for this metric (e.g. wasm_bytes == 0 in both). Not a regression.
        return STATUS_OK
    if delta_pct > fail_pct:
        return STATUS_FAIL
    if delta_pct > warn_pct:
        return STATUS_WARN
    return STATUS_OK


# ---------------------------------------------------------------------------
# Core comparison
# ---------------------------------------------------------------------------

def build_index(records: list[MetricRecord]) -> dict[tuple[str, str], MetricRecord]:
    return {(r.contract, r.entrypoint): r for r in records}


def compare(current: list[MetricRecord], baseline: list[MetricRecord],
            warn_pct: float, fail_pct: float,
            cpu_cap: int, mem_cap: int, wasm_cap: int) -> list[Comparison]:
    base_idx = build_index(baseline)
    results: list[Comparison] = []
    for cur in current:
        key = (cur.contract, cur.entrypoint)
        base = base_idx.get(key)
        cpu_d = pct_delta(cur.cpu_insns, base.cpu_insns if base else None)
        mem_d = pct_delta(cur.mem_bytes, base.mem_bytes if base else None)
        wasm_d = pct_delta(cur.wasm_bytes, base.wasm_bytes if base else None)

        cpu_s = classify(cpu_d, warn_pct, fail_pct, cur.cpu_insns, cpu_cap)
        mem_s = classify(mem_d, warn_pct, fail_pct, cur.mem_bytes, mem_cap)
        # WASM cap is a soft budget (64 KiB target) — treat as warn, not hard cap.
        wasm_s = classify(wasm_d, warn_pct, fail_pct, cur.wasm_bytes, wasm_cap, has_cap=False)

        notes: list[str] = []
        if base is None:
            notes.append("new entrypoint (no baseline)")
        if cur.cpu_ceiling and cur.cpu_insns >= cur.cpu_ceiling:
            notes.append(f"cpu {cur.cpu_insns} >= ceiling {cur.cpu_ceiling}")
            cpu_s = STATUS_FAIL
        if cur.mem_ceiling and cur.mem_bytes >= cur.mem_ceiling:
            notes.append(f"mem {cur.mem_bytes} >= ceiling {cur.mem_ceiling}")
            mem_s = STATUS_FAIL

        overall = STATUS_OK
        if cpu_s == STATUS_FAIL or mem_s == STATUS_FAIL or wasm_s == STATUS_FAIL:
            overall = STATUS_FAIL
        elif cpu_s == STATUS_WARN or mem_s == STATUS_WARN or wasm_s == STATUS_WARN:
            overall = STATUS_WARN

        results.append(Comparison(
            contract=cur.contract, entrypoint=cur.entrypoint,
            cpu_now=cur.cpu_insns, cpu_base=base.cpu_insns if base else None, cpu_delta_pct=cpu_d,
            mem_now=cur.mem_bytes, mem_base=base.mem_bytes if base else None, mem_delta_pct=mem_d,
            wasm_now=cur.wasm_bytes, wasm_base=base.wasm_bytes if base else None, wasm_delta_pct=wasm_d,
            cpu_status=cpu_s, mem_status=mem_s, wasm_status=wasm_s,
            overall=overall, notes=notes,
        ))
    return results


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------

ICON = {STATUS_OK: "white_check_mark", STATUS_WARN: "warning", STATUS_FAIL: "x"}
EMOJI = {STATUS_OK: "✅", STATUS_WARN: "⚠️", STATUS_FAIL: "❌"}


def fmt_int(n: int) -> str:
    return f"{n:,}"


def fmt_delta(d: Optional[float]) -> str:
    if d is None:
        return "—"
    sign = "+" if d >= 0 else ""
    return f"{sign}{d:.1f}%"


def render_markdown(results: list[Comparison], had_baseline: bool,
                    baseline_missing_reason: Optional[str],
                    warn_pct: float, fail_pct: float,
                    cpu_cap: int, mem_cap: int) -> str:
    n_fail = sum(1 for r in results if r.overall == STATUS_FAIL)
    n_warn = sum(1 for r in results if r.overall == STATUS_WARN)
    n_ok = sum(1 for r in results if r.overall == STATUS_OK)

    lines: list[str] = []
    lines.append("## 📊 Soroban Budget Benchmark Report")
    lines.append("")
    lines.append(f"Thresholds: **warn > {warn_pct:.0f}%** · **fail > {fail_pct:.0f}%** "
                 f"(or Soroban cap: CPU ≤ {fmt_int(cpu_cap)}, MEM ≤ {fmt_int(mem_cap)})")
    lines.append("")

    if not had_baseline:
        reason = baseline_missing_reason or "no main baseline available yet"
        lines.append(f"> ℹ️ **No baseline comparison** — {reason}. "
                     "Current metrics recorded as the new baseline; the PR is **not** failed.")
        lines.append("")

    summary_icon = EMOJI[STATUS_FAIL] if n_fail else (EMOJI[STATUS_WARN] if n_warn else EMOJI[STATUS_OK])
    lines.append(f"**Summary:** {summary_icon} {n_ok} ok · {n_warn} warning · {n_fail} fail")
    lines.append("")

    if not results:
        lines.append("_No benchmark metrics were recorded._")
        return "\n".join(lines)

    # Per-entrypoint table
    lines.append("| Contract | Entrypoint | CPU insns | CPU Δ | Mem bytes | Mem Δ | WASM bytes | WASM Δ | Status |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|:---:|")
    for r in results:
        lines.append(
            "| {c} | {e} | {cpu} | {cpud} | {mem} | {memd} | {wasm} | {wasmd} | {st} |".format(
                c=r.contract, e=r.entrypoint,
                cpu=fmt_int(r.cpu_now), cpud=fmt_delta(r.cpu_delta_pct),
                mem=fmt_int(r.mem_now), memd=fmt_delta(r.mem_delta_pct),
                wasm=fmt_int(r.wasm_now), wasmd=fmt_delta(r.wasm_delta_pct),
                st=f"{EMOJI[r.overall]} {r.overall}",
            )
        )
    lines.append("")

    # Diagnostic detail for any non-OK rows
    flagged = [r for r in results if r.overall != STATUS_OK]
    if flagged:
        lines.append("### Regression details")
        lines.append("")
        for r in flagged:
            lines.append(f"**{r.contract}.{r.entrypoint}** — {EMOJI[r.overall]} {r.overall}")
            if r.cpu_status != STATUS_OK:
                base = fmt_int(r.cpu_base) if r.cpu_base is not None else "N/A"
                lines.append(f"- CPU: {fmt_int(r.cpu_now)} (base {base}, {fmt_delta(r.cpu_delta_pct)}) "
                              f"[{r.cpu_status}]")
            if r.mem_status != STATUS_OK:
                base = fmt_int(r.mem_base) if r.mem_base is not None else "N/A"
                lines.append(f"- Mem: {fmt_int(r.mem_now)} (base {base}, {fmt_delta(r.mem_delta_pct)}) "
                              f"[{r.mem_status}]")
            if r.wasm_status != STATUS_OK:
                base = fmt_int(r.wasm_base) if r.wasm_base is not None else "N/A"
                lines.append(f"- WASM: {fmt_int(r.wasm_now)} (base {base}, {fmt_delta(r.wasm_delta_pct)}) "
                              f"[{r.wasm_status}]")
            for note in r.notes:
                lines.append(f"- {note}")
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Compare budget-bench metrics vs baseline.")
    p.add_argument("--current", required=True, help="Path to current budget-metrics.json (array or JSONL).")
    p.add_argument("--baseline", default="", help="Path to main baseline budget-metrics.json. Optional.")
    p.add_argument("--output", default="", help="Path to write the Markdown comparison (also printed to stdout).")
    p.add_argument("--warn-pct", type=float, default=WARN_PCT, help=f"Warning threshold %% (default {WARN_PCT}).")
    p.add_argument("--fail-pct", type=float, default=FAIL_PCT, help=f"Failure threshold %% (default {FAIL_PCT}).")
    p.add_argument("--cpu-cap", type=int, default=DEFAULT_CPU_CAP, help="Soroban CPU instruction cap/tx.")
    p.add_argument("--mem-cap", type=int, default=DEFAULT_MEM_CAP, help="Soroban memory cap/tx (bytes).")
    p.add_argument("--wasm-cap", type=int, default=DEFAULT_WASM_CAP, help="WASM size soft budget (bytes).")
    p.add_argument("--enforce", action="store_true",
                   help="Exit non-zero when any regression exceeds the fail threshold or cap.")
    args = p.parse_args(argv)

    current = read_metrics(args.current)
    if not current:
        msg = (f"ERROR: no metrics parsed from --current {args.current!r}. "
               "Did budget-bench run with BUDGET_METRICS_OUT set?")
        print(msg, file=sys.stderr)
        # Write an empty-ish report so the PR comment still posts.
        md = "## 📊 Soroban Budget Benchmark Report\n\n⚠️ No budget metrics were recorded for this run.\n"
        if args.output:
            with open(args.output, "w", encoding="utf-8") as fh:
                fh.write(md)
        print(md)
        # A missing current metrics file is a hard error for the gate (something is wrong with bench).
        return 2 if args.enforce else 1

    had_baseline = True
    baseline_missing_reason: Optional[str] = None
    baseline: list[MetricRecord] = []
    if not args.baseline or not os.path.exists(args.baseline):
        had_baseline = False
        baseline_missing_reason = ("baseline file not provided" if not args.baseline
                                    else f"baseline file {args.baseline!r} not found")
    else:
        try:
            baseline = read_metrics(args.baseline)
            if not baseline:
                had_baseline = False
                baseline_missing_reason = "baseline file was empty"
        except Exception as exc:  # noqa: BLE001
            had_baseline = False
            baseline_missing_reason = f"baseline file could not be parsed ({exc})"

    results = compare(current, baseline, args.warn_pct, args.fail_pct,
                      args.cpu_cap, args.mem_cap, args.wasm_cap)

    md = render_markdown(results, had_baseline, baseline_missing_reason,
                         args.warn_pct, args.fail_pct, args.cpu_cap, args.mem_cap)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(md)
    print(md)

    n_fail = sum(1 for r in results if r.overall == STATUS_FAIL)

    # Graceful first-run: if there was no baseline, never fail the gate.
    if not had_baseline:
        print("\nℹ️ No baseline — current metrics recorded as the new baseline; gate not enforced.",
              file=sys.stderr)
        return 0

    if n_fail == 0:
        return 0

    print(f"\n❌ {n_fail} entrypoint(s) exceeded the regression threshold or Soroban cap.",
          file=sys.stderr)
    # Without --enforce we only warn (useful for dry-runs).
    return 1 if args.enforce else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
