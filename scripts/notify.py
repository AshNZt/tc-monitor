#!/usr/bin/env python3
"""
Compares the freshly built site/data/changes.json with the previous one
(passed as argument) and prints a Markdown summary of NEW text changes.
Prints nothing if there are none. Used by the workflow to open a GitHub Issue,
which emails everyone who watches the repository.

Usage: python scripts/notify.py previous_changes.json https://site-url/
"""
import json
import sys
from pathlib import Path

prev_path, site = sys.argv[1], sys.argv[2].rstrip("/")
new = json.loads(Path("site/data/changes.json").read_text(encoding="utf-8"))
try:
    old_ids = {c["id"] for c in json.loads(Path(prev_path).read_text(encoding="utf-8"))}
except (FileNotFoundError, json.JSONDecodeError):
    sys.exit(0)  # first run: no baseline, no alert

fresh = [c for c in new if c["id"] not in old_ids and c["type"] == "substantive"]
if not fresh:
    sys.exit(0)

lines = [f"{len(fresh)} new text change{'s' if len(fresh) > 1 else ''} detected.\n"]
for c in sorted(fresh, key=lambda c: c["date"]):
    secs = f" (sections: {', '.join(c['sections'][:4])})" if c["sections"] else ""
    lines.append(f"- **{c['platform_name']} · {c['document']}**, {c['date'][:10]}, "
                 f"+{c['added']} / −{c['removed']} lines{secs}  \n  {site}/#/change/{c['id']}")
print("\n".join(lines))
