#!/usr/bin/env python3
"""
T&C Monitor, weekly email digest and RSS feed.

  python scripts/digest.py feed      -> writes site/feed.xml (latest text changes)
  python scripts/digest.py email     -> sends the weekly email (needs the env vars below)
  python scripts/digest.py preview   -> writes digest-preview.html, sends nothing

Email settings come from environment variables (GitHub secrets in the workflow):
  SMTP_USER       sender Gmail address, e.g. tcmonitor.alerts@gmail.com
  SMTP_PASSWORD   Gmail "app password" (16 letters), not the normal password
  MAIL_TO         recipients, separated by commas (sent as BCC, so they don't see each other)
"""
import datetime as dt
import html
import json
import os
import re
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formatdate, format_datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
CFG = yaml.safe_load((ROOT / "sources.yaml").read_text(encoding="utf-8"))
SETTINGS = CFG.get("settings", {})
SITE = SETTINGS.get("site_url", "").rstrip("/")
DAYS = int(SETTINGS.get("digest_days", 7))
SEND_EMPTY = bool(SETTINGS.get("digest_send_empty", True))
ANNOUNCE_RE = re.compile(r"go(es)? into effect|take[s]? effect|effective|we('| a)re updating|will apply from", re.I)
COLORS = {p["id"]: p.get("color", "#6d7388") for p in CFG["platforms"]}

esc = html.escape


def clean(s):
    s = re.sub(r"<br\s*/?>?", " / ", s, flags=re.I)
    s = re.sub(r"\\([^\w\s])", r"\1", s)
    s = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"[*_`#>|]", " ", s).replace("\u2060", "")
    return re.sub(r"\s+", " ", s).strip()


def load(days=None, limit=None):
    changes = [c for c in json.loads((DATA / "changes.json").read_text(encoding="utf-8")) if c["type"] == "substantive"]
    if days is not None:
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
        changes = [c for c in changes if dt.datetime.fromisoformat(c["date"]) >= since]
    changes = changes[:limit] if limit else changes
    for c in changes:
        full = json.loads((DATA / "changes" / f"{c['id']}.json").read_text(encoding="utf-8"))
        added = [clean(l) for h in full["hunks"] for t, l in h["lines"] if t == "+" and clean(l)]
        c["announce"] = next((a for a in added if ANNOUNCE_RE.search(a) and len(a) < 300), "")
        c["excerpt"] = "" if c["announce"] else next((a for a in added if len(a) > 40), added[0] if added else "")[:240]
        c["url"] = f"{SITE}/#/change/{c['id']}"
    return changes


def day(d, year=True):
    return f"{d.day} {d:%b %Y}" if year else f"{d.day} {d:%b}"


def fmt(iso):
    return day(dt.datetime.fromisoformat(iso))


# ---------------------------------------------------------------- email
def email_html(changes, since, until):
    by_platform = {}
    for c in sorted(changes, key=lambda c: c["date"], reverse=True):
        by_platform.setdefault(c["platform_name"], []).append(c)
    counts = ", ".join(f"{p} {len(v)}" for p, v in sorted(by_platform.items(), key=lambda x: -len(x[1])))
    period = f"{day(since, False)} to {day(until)}"

    if not changes:
        body = f"""<p style="margin:0 0 8px;font-size:15px;color:#20243a">No relevant text changes were detected this week ({period}).</p>
        <p style="margin:0;font-size:14px;color:#6d7388">Minor edits such as formatting, links or small wording fixes are not included.</p>"""
    else:
        blocks = []
        for platform, items in by_platform.items():
            color = COLORS.get(items[0]["platform"], "#6d7388")
            rows = []
            for c in items:
                secs = ", ".join(c["sections"][:3])
                rows.append(f"""
                <tr><td style="padding:14px 0;border-top:1px solid #edf0f4">
                  <div style="font-size:12px;color:#8b91a1">{fmt(c['date'])} &middot; about {c.get('words_changed', '?')} words changed</div>
                  <a href="{esc(c['url'])}" style="display:block;margin:3px 0 4px;font-size:15px;font-weight:700;color:#1b2556;text-decoration:none">{esc(c['document'])}</a>
                  {f'<div style="font-size:13px;color:#6d7388">Sections: {esc(secs)}</div>' if secs else ''}
                  {f'<div style="margin-top:6px;padding:7px 10px;font-size:13px;color:#7a5200;background:#fff4dc;border-radius:6px">&#9888; {esc(c["announce"])}</div>' if c['announce'] else ''}
                  {f'<div style="margin-top:6px;font-size:13.5px;line-height:1.5;color:#3c4258">&ldquo;{esc(c["excerpt"])}{"&hellip;" if len(c["excerpt"]) >= 240 else ""}&rdquo;</div>' if c['excerpt'] else ''}
                  <a href="{esc(c['url'])}" style="display:inline-block;margin-top:6px;font-size:13px;font-weight:600;color:#2f6f99">See the change &rarr;</a>
                </td></tr>""")
            blocks.append(f"""
            <tr><td style="padding:22px 0 4px">
              <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:{color};margin-right:6px"></span>
              <span style="font-size:17px;font-weight:700;color:#1b2556">{esc(platform)}</span>
              <span style="font-size:13px;color:#8b91a1"> &middot; {len(items)} change{'s' if len(items) > 1 else ''}</span>
            </td></tr>{''.join(rows)}""")
        body = f"""<p style="margin:0;font-size:15px;color:#20243a"><b>{len(changes)} text change{'s' if len(changes) > 1 else ''}</b> detected from {period}: {esc(counts)}.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">{''.join(blocks)}</table>"""

    return f"""<!doctype html><html><body style="margin:0;padding:0;background:#f6f7fb">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <tr><td style="padding:18px 24px;background:#1b2556;border-radius:10px 10px 0 0">
    <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94ceed;font-weight:700">Weekly digest</div>
    <div style="font-size:21px;font-weight:700;color:#ffffff;margin-top:2px">T&amp;C Monitor</div>
  </td></tr>
  <tr><td style="padding:22px 24px;background:#ffffff;border:1px solid #e5e8f0;border-top:0;border-radius:0 0 10px 10px">
    {body}
    <p style="margin:24px 0 0"><a href="{SITE}/#/changes" style="display:inline-block;padding:10px 16px;background:#1b2556;color:#ffffff;border-radius:7px;font-size:14px;font-weight:600;text-decoration:none">Open the change log</a></p>
  </td></tr>
  <tr><td style="padding:14px 6px;font-size:12px;line-height:1.5;color:#8b91a1">
    Changes detected by <a href="https://opentermsarchive.org" style="color:#8b91a1">Open Terms Archive</a>. Only text changes are listed; formatting, links and edits of up to 5 words are left out.
    Built by {esc(SETTINGS.get('author', ''))}. To stop receiving this email, reply to it.
  </td></tr>
</table></td></tr></table></body></html>"""


def email_text(changes, since, until):
    lines = [f"T&C Monitor, weekly digest ({day(since, False)} to {day(until)})", ""]
    if not changes:
        lines.append("No relevant text changes were detected this week.")
    for c in changes:
        lines += [f"- {c['platform_name']} · {c['document']} ({fmt(c['date'])}, about {c.get('words_changed', '?')} words)",
                  *( [f"  ! {c['announce']}"] if c["announce"] else [] ), f"  {c['url']}"]
    lines += ["", f"Change log: {SITE}/#/changes"]
    return "\n".join(lines)


def send_email():
    until = dt.datetime.now(dt.timezone.utc)
    since = until - dt.timedelta(days=DAYS)
    changes = load(days=DAYS)
    if not changes and not SEND_EMPTY:
        print("No changes this week, no email sent.")
        return
    user, pwd, to = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD"), os.environ.get("MAIL_TO", "")
    recipients = [a.strip() for a in to.replace(";", ",").split(",") if a.strip()]
    if not (user and pwd and recipients):
        print("Email secrets are not set (SMTP_USER, SMTP_PASSWORD, MAIL_TO): skipping the digest.")
        return
    msg = EmailMessage()
    n = len(changes)
    msg["Subject"] = f"T&C Monitor: {n} change{'s' if n != 1 else ''} this week" if n else "T&C Monitor: no relevant changes this week"
    msg["From"] = f"T&C Monitor <{user}>"
    msg["To"] = user                       # recipients go in BCC
    msg["Bcc"] = ", ".join(recipients)
    msg["Date"] = formatdate(localtime=False)
    msg.set_content(email_text(changes, since, until))
    msg.add_alternative(email_html(changes, since, until), subtype="html")
    with smtplib.SMTP_SSL(os.environ.get("SMTP_HOST", "smtp.gmail.com"), int(os.environ.get("SMTP_PORT", "465"))) as s:
        s.login(user, pwd)
        s.send_message(msg)
    print(f"Digest sent to {len(recipients)} recipient(s) with {n} change(s).")


# ---------------------------------------------------------------- RSS
def write_feed():
    changes = load(limit=50)
    items = []
    for c in changes:
        desc = (f"{c['announce']} " if c["announce"] else "") + (f"Sections: {', '.join(c['sections'][:4])}. " if c["sections"] else "") + (c["excerpt"] or "")
        items.append(f"""  <item>
    <title>{esc(c['platform_name'])} · {esc(c['document'])}</title>
    <link>{esc(c['url'])}</link>
    <guid isPermaLink="false">{esc(c['id'])}</guid>
    <pubDate>{format_datetime(dt.datetime.fromisoformat(c['date']))}</pubDate>
    <category>{esc(c['platform_name'])}</category>
    <description>{esc(desc)}</description>
  </item>""")
    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>T&amp;C Monitor</title>
  <link>{SITE}/</link>
  <description>Text changes to the terms and policies of major technology platforms.</description>
  <language>en</language>
  <lastBuildDate>{formatdate(localtime=False)}</lastBuildDate>
{chr(10).join(items)}
</channel>
</rss>
"""
    (ROOT / "site" / "feed.xml").write_text(feed, encoding="utf-8")
    print(f"Feed written with {len(items)} items.")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "preview"
    if mode == "feed":
        write_feed()
    elif mode == "email":
        send_email()
    else:
        until = dt.datetime.now(dt.timezone.utc)
        days = int(sys.argv[2]) if len(sys.argv) > 2 else DAYS
        out = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "digest-preview.html"
        out.write_text(email_html(load(days=days), until - dt.timedelta(days=days), until), encoding="utf-8")
        print(f"Preview written to {out}")
