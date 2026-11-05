# TermRadar

A free public website that tracks changes to the terms of service and policies of OpenAI, Anthropic, Google, Meta and Apple. For each change it shows when it was detected, what was added or removed, which sections and topics it concerns, and which updates have been announced but are not in force yet.

**Site:** https://ashnzt.github.io/tc-monitor/ · **RSS:** https://ashnzt.github.io/tc-monitor/feed.xml

*Versione italiana in fondo.*

## How it works

```
Open Terms Archive ──► scripts/build.py ──► scripts/check.py ──► site/ on GitHub Pages
(archives documents     (weekly: compare      (stops publishing      (static site,
 several times a day)    versions, classify)    if data is broken)     no server)
```

1. [Open Terms Archive](https://opentermsarchive.org) downloads each document several times a day and keeps every version in public git repositories.
2. Every Monday at 06:17 UTC the GitHub Action `.github/workflows/update.yml` runs `scripts/build.py`, which reads those versions, compares each with the previous one and writes the data the site reads into `site/data/`.
3. `scripts/check.py` verifies the data. If it fails, nothing is published and the site stays as it was.
4. The site is published on GitHub Pages. New text changes open a GitHub Issue (email to anyone watching the repository).

No server, no database, no cost.

## How changes are classified

Only **text changes** are counted and shown by default. These are hidden as *minor* but remain available with "Include minor changes":

| Type | Meaning |
|---|---|
| Links, formatting or page elements | No words changed, or only menus, survey banners, help links, logos |
| Source page error | The source showed an empty or error page (and the return to normal) |
| Small edit | 5 words or fewer, unless they include words like may, must, not, consent, or announce an effective date |
| Date only | Only dates or numbers changed |
| Reverted / Short-lived | Edits up to 50 words that flip back within weeks. Larger flip-flops stay visible with a warning |
| Technical | Changes caused by the archive's own extraction rules |

Topics (AI, Minors, Personal data, etc.) are assigned from keywords in `scripts/build.py` (`TOPICS`). Upcoming changes come from notices like "These updates will go into effect on …" in the current text.

## Files

| File | Purpose |
|---|---|
| `sources.yaml` | Platforms and documents monitored, author, site URL, email settings |
| `scripts/build.py` | Builds all data for the site (about 3 to 5 minutes) |
| `scripts/check.py` | Safety check before publishing |
| `scripts/digest.py` | RSS feed, and the weekly email (inactive until secrets are set) |
| `scripts/notify.py` | Text of the GitHub Issue for new changes |
| `.github/workflows/update.yml` | Schedule, checks, publishing |
| `site/` | The website: `index.html`, `app.js`, `style.css`. Plain HTML/JS, no build step |
| `site/data/` | Generated data. Never edit by hand |
| `docs/COVERAGE.md` | What is tracked, what is missing, how to add documents |

## Common tasks

**Add a platform or a service:** add it to `sources.yaml` (see the comments there and `docs/COVERAGE.md`), commit and push. The next run fetches its whole history.

**Run a rebuild now:** repository › Actions › Update T&C data › Run workflow.

**Run locally:**
```bash
pip install pyyaml
python scripts/build.py && python scripts/check.py
cd site && python -m http.server 8000      # open http://localhost:8000
```
Do not commit the local `site/data`: run `git restore site/data` before committing, the workflow rebuilds it.

**Turn on the weekly email:** create a dedicated Gmail account, enable 2-step verification, create an *app password*, then set the repository secrets `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_TO` (comma-separated recipients). Test with Run workflow and "send_digest" ticked.

## When something breaks

| Symptom | What to do |
|---|---|
| Red X on the workflow, step "Check the data…" | Read the message: usually a service folder was renamed at Open Terms Archive. Fix the name in `sources.yaml`. The site online is unaffected. |
| Banner "source has not recorded anything for N days" | Open Terms Archive may have stopped tracking a document. Check the declarations repository. |
| Scheduled runs stopped | GitHub disables schedules after 60 days without activity. The workflow commits on every run to prevent this; if it happens, re-enable it in the Actions tab. |
| A change is wrongly hidden or shown | Adjust the rules at the top of `scripts/build.py` (`SMALL_EDIT_WORDS`, `LEGAL_WORDS`, `CHROME_RE`, `FLIP_MAX_WORDS`). |

## Handover

The repository belongs to Alessandro Morigi's GitHub account. To hand it over, add a colleague as collaborator (Settings › Collaborators) or transfer the repository (Settings › Transfer): history and authorship are kept and the old link redirects.

---

## Versione italiana (in breve)

Sito pubblico e gratuito che registra le modifiche ai termini di OpenAI, Anthropic, Google, Meta e Apple. I dati vengono da Open Terms Archive; ogni lunedì una GitHub Action li confronta, li verifica e ripubblica il sito. Per aggiungere una piattaforma basta modificare `sources.yaml`. Se qualcosa si rompe, il sito online resta com'era: leggere l'errore nel tab Actions e consultare la tabella *When something breaks*. Per passare il progetto a un collega: Settings › Collaborators oppure Settings › Transfer.

---

## Licence

Code and site: [PolyForm Noncommercial License 1.0.0](LICENSE.md). Use, copying and modification are allowed **for non-commercial purposes only**. The archived documents belong to the respective platforms and come from Open Terms Archive; they are not covered by this licence.
