#!/usr/bin/env python3
"""
Safety check run by the workflow after the build and before publishing.
If anything here fails, the workflow stops: nothing is committed and the
site online stays as it was.

Run:  python scripts/check.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
errors = []


def check(ok, msg):
    if not ok:
        errors.append(msg)


def load(name):
    try:
        return json.loads((DATA / name).read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        errors.append(f"{name}: cannot be read ({e})")
        return None


index, main, minor, search = load("index.json"), load("changes.json"), load("changes-minor.json"), load("search.json")

if index:
    check(len(index.get("platforms", [])) > 0, "index.json: no platforms")
    for p in index.get("platforms", []):
        check(len(p["documents"]) > 0, f"platform {p['id']}: no documents found (renamed folder at the source?)")
        for d in p["documents"]:
            check((DATA / "current" / f"{d['id']}.md").exists(), f"missing current text for {d['id']}")
    for s in index.get("status", []):
        if s.get("stale"):
            print(f"WARNING: source for {s['platform']} has not updated for {s.get('age_days')} days")

if main is not None:
    check(len(main) > 50, f"changes.json: only {len(main)} changes, expected many more")
    ids = set()
    for c in main + (minor or []):
        for key in ("id", "date", "platform", "doc_id", "document", "type"):
            check(key in c, f"change without '{key}': {c.get('id')}")
        check(c.get("id") not in ids, f"duplicate change id {c.get('id')}")
        ids.add(c.get("id"))
    # every change in the main list must have its detail file
    missing = [c["id"] for c in main if not (DATA / "changes" / f"{c['id']}.json").exists()]
    check(not missing, f"{len(missing)} change files missing, e.g. {missing[:3]}")
    dates = [c["date"] for c in main]
    check(dates == sorted(dates, reverse=True), "changes.json is not sorted newest first")

# the site code must at least be present
for f in ("index.html", "app.js", "style.css"):
    check((ROOT / "site" / f).exists() and (ROOT / "site" / f).stat().st_size > 500, f"site/{f} missing or empty")

if errors:
    print("CHECK FAILED:")
    for e in errors[:30]:
        print(" -", e)
    sys.exit(1)
print(f"Check passed: {len(main or [])} main changes, {len(minor or [])} minor, "
      f"{sum(len(p['documents']) for p in (index or {}).get('platforms', []))} documents.")
