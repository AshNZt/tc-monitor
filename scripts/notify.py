#!/usr/bin/env python3
"""
Prints a Markdown summary of the text changes detected in the last N days
(nothing if there are none). The workflow uses it once a week, on Monday
morning, to open a GitHub Issue: GitHub emails everyone who watches the repository.

Usage: python scripts/notify.py 7 https://site-url
"""
import datetime as dt
import json
import sys
from pathlib import Path

days, site = int(sys.argv[1]), sys.argv[2].rstrip("/")
since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
changes = json.loads(Path("site/data/changes.json").read_text(encoding="utf-8"))
fresh = [c for c in changes if c["type"] == "substantive" and dt.datetime.fromisoformat(c["date"]) >= since]
if not fresh:
    sys.exit(0)

lines = [f"{len(fresh)} text change{'s' if len(fresh) > 1 else ''} detected in the last {days} days.\n"]
for c in sorted(fresh, key=lambda c: c["date"]):
    secs = f" (sections: {', '.join(c.get('sections', [])[:4])})" if c.get("sections") else ""
    lines.append(f"- **{c['platform_name']} · {c['document']}**, {c['date'][:10]}, "
                 f"about {c.get('words_changed', '?')} words{secs}  \n  {site}/#/change/{c['id']}")
print("\n".join(lines))
