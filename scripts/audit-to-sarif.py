#!/usr/bin/env python3
"""Convert `cargo audit --json` output to a minimal SARIF 2.1.0 file.

Usage: audit-to-sarif.py audit.json out.sarif <lockfile-path-for-locations>
"""
import json, sys

data = json.load(open(sys.argv[1]))
lock = sys.argv[3]
rules, results = {}, []
for v in data.get("vulnerabilities", {}).get("list", []):
    adv, pkg = v["advisory"], v["package"]
    rules[adv["id"]] = {"id": adv["id"], "shortDescription": {"text": adv.get("title", adv["id"])}}
    results.append({
        "ruleId": adv["id"],
        "level": "error",
        "message": {"text": f"{pkg['name']} {pkg['version']}: {adv.get('title','')}"},
        "locations": [{"physicalLocation": {"artifactLocation": {"uri": lock}, "region": {"startLine": 1}}}],
    })
sarif = {
    "version": "2.1.0",
    "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
    "runs": [{"tool": {"driver": {"name": "cargo-audit", "rules": list(rules.values())}}, "results": results}],
}
json.dump(sarif, open(sys.argv[2], "w"), indent=2)
