#!/usr/bin/env python3
"""Record per-file test results for the traceability matrix.

Usage: record-test-run.py <node-junit.xml> <playwright.json> [<tutor-playwright.json>]
Writes docs/evidence/test-run.json with the commit, time and pass/fail counts per test file.
Run it only on outputs from one run against one commit; the matrix trusts this file.
"""
import json, subprocess, sys, datetime, xml.etree.ElementTree as ET, collections

files = collections.defaultdict(lambda: {"passed": 0, "failed": 0})
for case in ET.parse(sys.argv[1]).getroot().iter("testcase"):
    name = case.get("file") or case.get("classname") or ""
    path = "tests/" + name.split("/tests/")[-1] if "/tests/" in name else name
    files[path]["failed" if case.find("failure") is not None or case.find("error") is not None else "passed"] += 1

def walk(suite, path):
    path = suite.get("file", path)
    for spec in suite.get("specs", []):
        ok = spec.get("ok") and all(r.get("status") in ("passed", "skipped") for t in spec.get("tests", []) for r in t.get("results", []))
        files["tests/" + path.split("tests/")[-1]]["passed" if ok else "failed"] += 1
    for child in suite.get("suites", []):
        walk(child, path)
for report in sys.argv[2:]:
    for suite in json.load(open(report)).get("suites", []):
        walk(suite, suite.get("file", ""))

commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
dirty = bool(subprocess.run(["git", "status", "--porcelain", "--", "app", "lib", "db", "tests", "scripts"], capture_output=True, text=True).stdout.strip())
out = {"commit": commit, "uncommitted_source_changes": dirty, "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
       "environment": "local fresh PostgreSQL, fictional data, headless Chromium", "files": dict(sorted(files.items()))}
json.dump(out, open("docs/evidence/test-run.json", "w"), indent=1)
print(commit[:7], "dirty" if dirty else "clean", sum(f["passed"] for f in files.values()), "passed", sum(f["failed"] for f in files.values()), "failed")
