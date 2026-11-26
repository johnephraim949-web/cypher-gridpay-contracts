#!/usr/bin/env python3
"""Fail if any optimized WASM exceeds its budget; write a Markdown table.

Usage: check-wasm-size.py <budget.json> <wasm-dir-or-file>... [--baseline sizes.json] [--out sizes.json]
Exit code 1 on any breach. Appends the table to $GITHUB_STEP_SUMMARY when set.
"""
import json, os, sys, pathlib

args = sys.argv[1:]
baseline_path = out_path = None
for flag in ("--baseline", "--out"):
    if flag in args:
        i = args.index(flag)
        val = args[i + 1]
        del args[i:i + 2]
        if flag == "--baseline":
            baseline_path = val
        else:
            out_path = val
budget = json.load(open(args[0]))
default = budget["default_bytes"]
overrides = budget.get("overrides", {})
baseline = json.load(open(baseline_path)) if baseline_path and os.path.exists(baseline_path) else {}

wasms = []
for p in args[1:]:
    p = pathlib.Path(p)
    wasms += sorted(p.glob("*.wasm")) if p.is_dir() else [p]
if not wasms:
    print("::error::no .wasm files found to check")
    sys.exit(1)

rows, sizes, failed = [], {}, False
for w in wasms:
    size = w.stat().st_size
    limit = overrides.get(w.name, default)
    sizes[w.name] = size
    delta = f"{size - baseline[w.name]:+d}" if w.name in baseline else "n/a"
    ok = size <= limit
    failed |= not ok
    rows.append(f"| {w.name} | {size} | {limit} | {delta} | {'OK' if ok else 'OVER BUDGET'} |")

table = "| Contract | Size (bytes) | Budget (bytes) | Delta vs base | Status |\n|---|---|---|---|---|\n" + "\n".join(rows)
print(table)
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
        f.write("### WASM size budget\n\n" + table + "\n")
if out_path:
    json.dump(sizes, open(out_path, "w"), indent=2)
sys.exit(1 if failed else 0)
