#!/usr/bin/env python3
"""
T&C Monitor, data builder.

Reads the version history of each monitored document from Open Terms Archive
(a public git repository of dated Markdown versions), works out every change,
and writes the JSON files the dashboard reads into site/data/.

Run:  python scripts/build.py
Needs: git, Python 3.9+, PyYAML.
"""
import datetime as dt
import difflib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUT = ROOT / "site" / "data"
CONTEXT = 2  # unchanged lines shown around each change

DATE_RE = re.compile(
    r"^\s*(?:last\s+)?(?:updated|effective|revised)(?:\s+date)?\s*(?:on)?\s*:?\s*(.+?)\s*$",
    re.I,
)


def run(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True, encoding="utf-8").stdout


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def sync_repo(url):
    """Clone (first time) or update a bare copy of an OTA versions repository."""
    name = url.rstrip("/").split("/")[-1]
    path = CACHE / f"{name}.git"
    if path.exists():
        run("git", "fetch", "-q", "--prune", "origin", "+refs/heads/*:refs/heads/*", cwd=path)
    else:
        CACHE.mkdir(exist_ok=True)
        run("git", "clone", "-q", "--bare", url, str(path))
    return path


class Blobs:
    """Fast reader for file contents at given commits (git cat-file --batch)."""

    def __init__(self, repo):
        self.p = subprocess.Popen(
            ["git", "cat-file", "--batch"], cwd=repo,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        )

    def get(self, commit, path):
        self.p.stdin.write(f"{commit}:{path}\n".encode())
        self.p.stdin.flush()
        header = self.p.stdout.readline().decode().split()
        if len(header) < 3 or header[1] == "missing":
            return None
        size = int(header[2])
        data = self.p.stdout.read(size)
        self.p.stdout.read(1)
        return data.decode("utf-8", "replace")

    def close(self):
        self.p.stdin.close()
        self.p.wait()


def headings(lines):
    """Map line index -> current section heading (ATX '#' and setext '===/---')."""
    current, out = "", []
    for i, line in enumerate(lines):
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if line.startswith("#"):
            current = line.lstrip("#").strip()
        elif line.strip() and re.fullmatch(r"\s*(=+|-{3,})\s*", nxt) and not line.startswith(("*", "-")):
            current = line.strip()
        out.append(current)
    return out


def clean_heading(h):
    h = re.sub(r"\\", "", h)
    h = re.sub(r"[*_`]", "", h)
    return h[:120]


def declared_dates(text):
    found = []
    for line in text.splitlines()[:400]:
        m = DATE_RE.match(line)
        if m and len(m.group(1)) < 40 and re.search(r"\d{4}", m.group(1)):
            found.append(m.group(1).strip("*_ "))
    return found


# Words whose change can alter meaning even in a one-word edit (kept as "text change")
LEGAL_WORDS = set("""may must shall will should can cannot not no never only all any each every none
required require requires prohibited prohibit allowed allow permitted permit may not unless except
including excluding without within before after days months years minimum maximum free paid
consent opt object delete sell share train training""".split())
SMALL_EDIT_WORDS = 5   # at most this many words changed -> "small edit"
# Lines announcing upcoming changes or effective dates are never "small edits":
# moving an effective date (e.g. a postponed update) matters even if one word changes
ANNOUNCE_RE = re.compile(r"go(es)? into effect|take[s]? effect|effective|we('| a)re updating|we have updated|updated terms|will apply from", re.I)


def words_of(line):
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", normalize(line))
    t = re.sub(r"https?://\S+", " ", t)
    return re.findall(r"[^\W_]+", t.lower())


# Page elements that are not part of the legal text (menus, survey banners, help links, logos)
CHROME_RE = re.compile(
    r"have a moment|tell us how we|take (the )?survey|other ways to get help|copy link|related articles|"
    r"was this (page |article )?helpful|request user information|submit an emergency|preserve account records|"
    r"i have a different question|view printable version|^\s*!\[|logo for|^\s*_?notice_?\s*$|skip to (main )?content",
    re.I)
MONTHS = set("jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july "
             "august september october november december".split())


def changed_words(hunks):
    """Words removed and added across the hunks (multiset difference, so moved text counts zero).
    Lines that are page elements (CHROME_RE) are ignored."""
    from collections import Counter
    rem, add = Counter(), Counter()
    for h in hunks:
        for t, l in h["lines"]:
            if CHROME_RE.search(l):
                continue
            if t == "-":
                rem.update(words_of(l))
            elif t == "+":
                add.update(words_of(l))
    gone, new = rem - add, add - rem
    return sum(gone.values()) + sum(new.values()), set(gone) | set(new)


def classify(subject, hunks):
    if subject.startswith("First record"):
        return "first"
    if subject.startswith("Apply technical"):
        return "technical"
    changed = [l for h in hunks for (t, l) in h["lines"] if t in "+-"]
    if changed and all(DATE_RE.match(l) for l in changed):
        return "date-only"
    return "substantive"


# Tokens that change on every page load without the text changing
# (tracking IDs inside links, cache-busting parameters).
NOISE = [
    (re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I), "<id>"),
    (re.compile(r"([?&])(utm_[a-z]+|_gl|_ga|ref|v|ts)=[^&)\s]*", re.I), r"\1"),
]


def normalize(text):
    for rx, rep in NOISE:
        text = rx.sub(rep, text)
    return text


def content_key(text):
    """Wording only: ignores link addresses, Markdown formatting and spacing."""
    t = normalize(text)
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"[\\*_`#>|=\u2060-]", "", t)
    return re.sub(r"\s+", " ", t).strip()


REVERT_WINDOW_DAYS = 60   # back to wording seen within this many days -> "reverted"
TEMPORARY_DAYS = 30       # wording that disappears again within this many days -> "temporary"
FLIP_MAX_WORDS = 50       # only flip-flops up to this size are hidden; larger ones stay visible, flagged


def days_between(a, b):
    return abs((dt.datetime.fromisoformat(b) - dt.datetime.fromisoformat(a)).days)


BULLET_RE = re.compile(r"^\s*([*+-]|\d+[.)])\s+")
RULE_RE = re.compile(r"^\s*([-=_*]\s*){3,}$")


def lead_in(lines, j):
    """Nearest paragraph above line j that is not a list item: the sentence that introduces a list."""
    for k in range(j - 1, max(-1, j - 120), -1):
        l = lines[k]
        if not l.strip() or RULE_RE.match(l) or BULLET_RE.match(l) or l.startswith("    "):
            continue
        if l.startswith("#") or (k + 1 < len(lines) and RULE_RE.match(lines[k + 1])):
            return ""          # reached a heading: no lead-in sentence
        return l.strip()[:400]
    return ""


# ---- topics ------------------------------------------------------------------
# A change gets a topic when its changed text matches the topic's keywords.
# Order = display order. Keep the patterns simple so a colleague can edit them.
TOPICS = [
    ("ai", "AI", r"\b(ai|a\.i\.|artificial intelligence|machine learning|generative|llms?|chatbots?|meta ai|"
                 r"ai models?|train(s|ed|ing)? (our|ai|the) |model training|automated (systems?|decision\w*|processing)|algorithm\w*)\b"),
    ("minors", "Minors", r"\b(minors?|teens?|teenagers?|children|child|kids|youth|young people|parental|parents?|guardians?|"
                         r"under (the age of )?1[3-8]|aged? (of )?1[3-8]|age verification|age-appropriate)\b"),
    ("data", "Personal data", r"\b(personal (data|information)|privacy|gdpr|data protection|data transfers?|retention|retain|"
                              r"cookies?|trackers?|tracking|biometric\w*|location (data|information)|legal bas[ie]s|consent|"
                              r"data subject|delete your|your information)\b"),
    ("ads", "Advertising", r"\b(ads?|advertis\w*|advertisers?|sponsored|marketing|promotions?|targeting|branded content)\b"),
    ("moderation", "Content moderation", r"\b(remov(e|al|ing)|restrict\w*|suspen\w*|disabl\w*|violat\w*|community standards|harmful|"
                                         r"hate speech|misinformation|warning screens?|appeals?|enforce\w*|moderation|prohibited)\b"),
    ("disputes", "Disputes & liability", r"\b(arbitration|disputes?|governing law|jurisdiction|courts?|liabilit\w*|liable|"
                                         r"indemni\w*|class action|warrant(y|ies)|limitation of liability)\b"),
    ("payments", "Payments & pricing", r"\b(prices?|pricing|fees?|payments?|refunds?|subscriptions?|billing|credits?|purchases?|"
                                       r"taxe?s|invoices?|checkout)\b"),
    ("security", "Fraud & security", r"\b(fraud\w*|scams?|security|breach\w*|vulnerabilit\w*|impersonat\w*|"
                                     r"verify (your )?identity|identity verification|account integrity)\b"),
    ("ip", "IP & licences", r"\b(intellectual property|copyrights?|trademarks?|licen[cs]es?|ownership|outputs?|scrap\w*|crawl\w*)\b"),
    ("government", "Law enforcement", r"\b(law enforcement|government (agenc\w*|requests?)|subpoenas?|court orders?|"
                                      r"emergency requests?|legal requests?|authorities)\b"),
]
TOPIC_RX = [(k, label, re.compile(rx, re.I)) for k, label, rx in TOPICS]


def changed_text(hunks):
    parts = [plain(l) for h in hunks for t, l in h["lines"] if t != " " and l.strip() and not CHROME_RE.search(l)]
    return " ".join(p for p in parts if p)


def topics_for(text, sections):
    blob = text + " " + " ".join(sections)
    hits = [(len(rx.findall(blob)), k) for k, _, rx in TOPIC_RX]
    return [k for n, k in sorted(hits, key=lambda x: -x[0]) if n][:3]


# ---- announced (upcoming) updates -------------------------------------------
MONTH_NUM = {m: i for i, ms in enumerate([("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"),
             ("may",), ("jun", "june"), ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"),
             ("oct", "october"), ("nov", "november"), ("dec", "december")], 1) for m in ms}
DATE_PATTERNS = [
    re.compile(r"\b(?P<m>[A-Za-z]{3,9})\.? (?P<d>\d{1,2}),? (?P<y>20\d\d)\b"),      # November 20, 2026
    re.compile(r"\b(?P<d>\d{1,2}) (?P<m>[A-Za-z]{3,9})\.?,? (?P<y>20\d\d)\b"),      # 20 November 2026
    re.compile(r"\b(?P<y>20\d\d)-(?P<mm>\d\d)-(?P<d>\d\d)\b"),                     # 2026-11-20
]
UPCOMING_RE = re.compile(r"(will|shall) (go into|take|come into) effect|will (be|become) effective|will apply (from|on)|"
                         r"(goes|go|come|comes) into effect on|effective (from|on|as of)|we('| a)re updating|we are making changes|"
                         r"updated? .{0,40}(will|takes?) effect", re.I)


def find_dates(text):
    out = []
    for rx in DATE_PATTERNS:
        for m in rx.finditer(text):
            try:
                mon = int(m.group("mm")) if "mm" in m.groupdict() and m.group("mm") else MONTH_NUM.get(m.group("m").lower())
                if mon:
                    out.append(dt.date(int(m.group("y")), mon, int(m.group("d"))))
            except (ValueError, IndexError, AttributeError):
                pass
    return out


def plain(line):
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", normalize(line))
    return re.sub(r"\s+", " ", re.sub(r"[*_`#>|\\]", " ", t)).strip()


def announcements(text, changes, hunks_list, today):
    """Sentences in the current text that announce an update with a concrete date in the future
    (or that took effect in the last 30 days), with when they were first seen and any date moves."""
    found = []
    for raw in text.splitlines():
        if not UPCOMING_RE.search(raw):
            continue
        dates = find_dates(plain(raw))
        if not dates:
            continue
        eff = max(dates)
        if eff < today - dt.timedelta(days=30):
            continue
        sentence = plain(raw)
        link = re.search(r"\[([^\]]*)\]\((https?://[^)\s]+)\)", raw)
        prefix = re.sub(r"\s+", " ", re.split(r"\d", sentence)[0])[:45]
        first_seen, history = None, []
        for c, hunks in zip(changes, hunks_list):
            for h in hunks:
                for t, l in h["lines"]:
                    if t == "+" and prefix and prefix in plain(l):
                        first_seen = first_seen or c["date"]
                        d = find_dates(plain(l))
                        if d and (not history or history[-1]["date"] != max(d).isoformat()):
                            history.append({"date": max(d).isoformat(), "seen": c["date"], "change": c["id"]})
        found.append({
            "effective": eff.isoformat(), "sentence": sentence[:400],
            "link": link.group(2) if link else None, "link_text": link.group(1) if link else None,
            "first_seen": first_seen, "date_history": history,
            "status": "upcoming" if eff >= today else "in_force",
        })
    return found


def diff_hunks(old, new):
    a, b = normalize(old).splitlines(), normalize(new).splitlines()
    sec_b, sec_a = headings(b), headings(a)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    hunks, added, removed = [], 0, 0
    for group in sm.get_grouped_opcodes(CONTEXT):
        lines, section = [], ""
        for tag, i1, i2, j1, j2 in group:
            if tag == "equal":
                lines += [(" ", l) for l in a[i1:i2]]
                continue
            if not section:
                section = sec_b[j1] if j1 < len(sec_b) else (sec_a[i1] if i1 < len(sec_a) else "")
            for l in a[i1:i2]:
                if l.strip():
                    removed += 1
                lines.append(("-", l))
            for l in b[j1:j2]:
                if l.strip():
                    added += 1
                lines.append(("+", l))
        # drop pure blank-line changes
        if not any(t != " " and l.strip() for t, l in lines):
            continue
        hunks.append({
            "section": clean_heading(section),
            "old_start": group[0][1] + 1,
            "new_start": group[0][3] + 1,
            "lead": lead_in(b, group[0][3]),
            "lines": lines,
        })
    return hunks, added, removed


def build():
    cfg = yaml.safe_load((ROOT / "sources.yaml").read_text(encoding="utf-8"))
    cfg.setdefault("settings", {})
    stale_days = cfg["settings"].get("stale_after_days", 21)
    now = dt.datetime.now(dt.timezone.utc)

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "changes").mkdir(parents=True)
    (OUT / "current").mkdir(parents=True)

    platforms, all_changes, status, upcoming = [], [], [], []
    search_index = {}

    repos = {}

    def repo_for(url):
        if url not in repos:
            path = sync_repo(url)
            last = run("git", "log", "-1", "--format=%cI", cwd=path).strip()
            repos[url] = (path, last)
        return repos[url]

    for p in cfg["platforms"]:
        # A platform has one or more services; each service is a folder in an
        # Open Terms Archive versions repository.
        services = []
        for s in p["services"]:
            s = {"name": s} if isinstance(s, str) else dict(s)
            s.setdefault("repo", p.get("repo"))
            services.append(s)
        multi = len(services) > 1

        docs, newest_source = [], None
        for svc in services:
            repo, last_source = repo_for(svc["repo"])
            newest_source = max(newest_source or last_source, last_source)
            web = svc["repo"].rstrip("/")
            service = svc["name"]
            files = [f for f in run("git", "ls-tree", "--name-only", "HEAD", f"{service}/", cwd=repo).splitlines()
                     if f.endswith(".md")]
            if not files:
                print(f"WARNING: no documents found for {p['name']} / {service}", file=sys.stderr)
            wanted = svc.get("documents")
            if wanted:
                files = [f for f in files if Path(f).stem in wanted]

            blobs = Blobs(repo)
            for path in sorted(files):
                name = Path(path).stem
                label = f"{service} {name}" if multi else name
                doc_id = f"{p['id']}--{slug(service)}--{slug(name)}" if multi else f"{p['id']}--{slug(name)}"
                log = run("git", "log", "--reverse", "--format=%H%x1f%cI%x1f%s", "--", path, cwd=repo)
                commits = [l.split("\x1f") for l in log.splitlines() if l]
                prev, changes, keys, pending = None, [], [], []
                for sha, date, subject in commits:
                    text = blobs.get(sha, path)
                    if text is None:
                        continue
                    if prev is None:
                        hunks, add, rem = [], text.count("\n") + 1, 0
                    else:
                        hunks, add, rem = diff_hunks(prev, text)
                        if not hunks:
                            prev = text
                            continue
                    kind = classify(subject, hunks)
                    key = content_key(text)
                    n_words, which = changed_words(hunks) if prev is not None else (0, set())
                    announces = any(t != " " and ANNOUNCE_RE.search(l) for h in hunks for t, l in h["lines"])
                    unstable = False
                    size_new, size_old = len(key.split()), len(content_key(prev).split()) if prev is not None else 0
                    after_error = bool(changes) and changes[-1]["type"] == "fetch-error"
                    if kind == "substantive" and prev is not None and size_old > 200 and size_new < 0.4 * size_old:
                        kind = "fetch-error"     # the source page was empty or an error page
                    elif kind == "substantive" and after_error and len(keys) >= 2 and keys[-2][1] == key:
                        kind = "fetch-error"     # back to the text from before the error page
                    elif kind == "substantive" and prev is not None:
                        if key == content_key(prev) or n_words == 0:
                            kind = "formatting"
                        elif which and all(w.isdigit() or w in MONTHS for w in which) and not announces:
                            kind = "date-only"
                        elif n_words <= SMALL_EDIT_WORDS and not (which & LEGAL_WORDS) and not announces:
                            kind = "small-edit"
                        else:
                            for j in range(len(keys) - 2, -1, -1):
                                k_date, k_key, k_idx = keys[j]
                                if days_between(k_date, date) > REVERT_WINDOW_DAYS:
                                    break
                                if k_key == key:
                                    # Small flip-flops are noise and get hidden. Large ones may be real
                                    # updates rolled back (or served alternately): keep them visible, flagged.
                                    if n_words <= FLIP_MAX_WORDS:
                                        kind = "reverted"
                                    else:
                                        unstable = True
                                    for c in changes[k_idx + 1:]:
                                        if c["type"] == "substantive" and days_between(c["date"], date) <= TEMPORARY_DAYS:
                                            if c.get("words_changed", 0) <= FLIP_MAX_WORDS:
                                                c["type"] = "temporary"
                                            else:
                                                c["unstable"] = True
                                    break
                    cid = f"{date[:10]}--{doc_id}--{sha[:7]}"
                    sections = sorted({h["section"] for h in hunks if h["section"]})
                    ctext = changed_text(hunks) if prev is not None else ""
                    if kind not in ("formatting", "fetch-error", "technical", "first"):
                        search_index[cid] = ctext[:600]
                    entry = {
                        "id": cid, "date": date, "platform": p["id"], "platform_name": p["name"],
                        "service": service, "doc_id": doc_id, "document": label, "type": kind,
                        "added": add, "removed": rem, "words_changed": n_words, "sections": sections,
                        "unstable": unstable,
                        "topics": topics_for(ctext, sections) if kind in ("substantive", "small-edit") else [],
                        "declared_dates": declared_dates(text),
                        "source_commit": f"{web}/commit/{sha}",
                    }
                    changes.append(entry)
                    pending.append(hunks)
                    keys.append((date, key, len(changes) - 1))
                    prev = text
                for entry, hunks in zip(changes, pending):
                    (OUT / "changes" / f"{entry['id']}.json").write_text(
                        json.dumps({**entry, "hunks": hunks}, ensure_ascii=False), encoding="utf-8")
                if prev is None:
                    continue
                (OUT / "current" / f"{doc_id}.md").write_text(prev, encoding="utf-8")
                for a in announcements(prev, changes, pending, now.date()):
                    upcoming.append({**a, "platform": p["id"], "platform_name": p["name"],
                                     "doc_id": doc_id, "document": label})
                subst = [c for c in changes if c["type"] == "substantive"]
                docs.append({
                    "id": doc_id, "name": label, "service": service,
                    "tracked_since": changes[0]["date"] if changes else None,
                    "last_change": changes[-1]["date"] if changes else None,
                    "last_substantive_change": subst[-1]["date"] if subst else None,
                    "versions": len(changes),
                    "substantive_changes": len(subst),
                    "declared_dates": declared_dates(prev),
                    "history_url": f"{web}/commits/main/{path.replace(' ', '%20')}",
                    "current_url": f"{web}/blob/main/{path.replace(' ', '%20')}",
                })
                all_changes += changes
            blobs.close()

        age = (now - dt.datetime.fromisoformat(newest_source)).days if newest_source else None
        status.append({"platform": p["id"], "name": p["name"], "last_source_commit": newest_source,
                       "age_days": age, "stale": age is None or age > stale_days})
        platforms.append({
            "id": p["id"], "name": p["name"], "color": p.get("color", "#6d7388"),
            "monogram": p.get("monogram", p["name"][:2].upper()),
            "services": [s["name"] for s in services],
            "sources": sorted({s["repo"].rstrip("/") for s in services}),
            "declarations": p.get("declarations"), "documents": docs,
        })

    all_changes.sort(key=lambda c: c["date"], reverse=True)
    (OUT / "index.json").write_text(json.dumps({
        "generated_at": now.isoformat(timespec="seconds"),
        "author": {"name": cfg["settings"].get("author", ""), "url": cfg["settings"].get("author_url", "")},
        "platforms": platforms, "status": status,
        "upcoming": sorted(upcoming, key=lambda a: a["effective"]),
        "topics": [{"id": k, "label": label} for k, label, _ in TOPICS],
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    # The site loads the main list on every page, so keep it small: text changes and first
    # records only, without fields the list never shows. Minor changes go in a second file
    # that is loaded only when someone ticks "Include minor changes".
    MINOR_TYPES = {"formatting", "fetch-error", "small-edit", "reverted", "temporary", "date-only", "technical"}
    slim = lambda c: {k: v for k, v in c.items() if k != "source_commit" and v not in ([], False, None)}
    (OUT / "changes.json").write_text(json.dumps(
        [slim(c) for c in all_changes if c["type"] not in MINOR_TYPES], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "changes-minor.json").write_text(json.dumps(
        [slim(c) for c in all_changes if c["type"] in MINOR_TYPES], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # changed text of each change, loaded by the site only when someone searches
    (OUT / "search.json").write_text(json.dumps(search_index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Summary for the workflow (new substantive changes since previous build)
    print(f"{len(all_changes)} versions, "
          f"{sum(c['type'] == 'substantive' for c in all_changes)} substantive changes, "
          f"{sum(len(p['documents']) for p in platforms)} documents")
    for s in status:
        if s["stale"]:
            print(f"WARNING: {s['platform']} source has not updated for {s['age_days']} days", file=sys.stderr)


if __name__ == "__main__":
    build()
