#!/usr/bin/env python3
"""
Compares the freshly built site/data/changes.json with the previous one
(passed as argument) and prints a Markdown summary of NEW text changes.
Prints nothing if there are none. Used by the workflow to open a GitHub Issue,
which emails everyone who watches the repository.

Documents that were not in the previous data (a newly added platform or
document) are treated as a new baseline: their history is not alerted.
The list is capped so the Issue body stays under GitHub's 65,536-char limit.

Usage: python scripts/notify.py previous_changes.json https://site-url/
"""
import json
import sys
from pathlib import Path

MAX_ITEMS = 30          # changes listed individually
MAX_CHARS = 60000       # safety margin below GitHub's 65,536 limit

sys.stdout.reconfigure(encoding="utf-8")   # same output on Windows and Linux
prev_path, site = sys.argv[1], sys.argv[2].rstrip("/")
new = json.loads(Path("site/data/changes.json").read_text(encoding="utf-8"))
try:
    old = json.loads(Path(prev_path).read_text(encoding="utf-8"))
except (FileNotFoundError, json.JSONDecodeError):
    sys.exit(0)  # first run: no baseline, no alert

old_ids = {c["id"] for c in old}
known_docs = {c["doc_id"] for c in old}
fresh = [c for c in new
         if c["id"] not in old_ids
         and c["doc_id"] in known_docs
         and c["type"] == "substantive"]
if not fresh:
    sys.exit(0)

fresh.sort(key=lambda c: c["date"], reverse=True)   # newest first
lines = [f"{len(fresh)} new text change{'s' if len(fresh) > 1 else ''} detected.\n"]
shown = 0
for c in fresh[:MAX_ITEMS]:
    secs = f" (sections: {', '.join(c['sections'][:4])})" if c["sections"] else ""
    line = (f"- **{c['platform_name']} · {c['document']}**, {c['date'][:10]}, "
            f"+{c['added']} / −{c['removed']} lines{secs}  \n  {site}/#/change/{c['id']}")
    if sum(len(l) + 1 for l in lines) + len(line) > MAX_CHARS:
        break
    lines.append(line)
    shown += 1

if shown < len(fresh):
    lines.append(f"\n…and {len(fresh) - shown} more. See all changes on the site: {site}/")
print("\n".join(lines))
