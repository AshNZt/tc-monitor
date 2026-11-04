# T&C Monitor

A free public website that tracks changes to the terms of service and policies of major digital platforms. For each change it shows the date it was detected, which sections were affected and the exact wording added or removed.

Built by Alessandro Morigi.

*Versione italiana più sotto.*

## How it works

```
Open Terms Archive  ──►  scripts/build.py  ──►  site/data/*.json  ──►  dashboard (site/)
(archives documents       (weekly, GitHub        (changes, diffs,        (GitHub Pages)
 several times a day)      Actions)               current texts)
```

1. [Open Terms Archive](https://opentermsarchive.org) downloads each document several times a day and stores every version in public git repositories.
2. Every Monday a GitHub Action runs `scripts/build.py`. It reads the version history, compares each version with the previous one, filters noise (rotating IDs in links) and labels each change: *text change*, *date only*, *technical* or *first record*.
3. The results are committed to `site/data/` and the site is republished on GitHub Pages.
4. If there are new text changes, the Action opens a GitHub Issue. Everyone who watches the repository gets an email.

No server, no database, no cost.

## Setup (once)

1. Create a **public** repository on GitHub, for example `tc-monitor`, and upload these files.
2. In the repository: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
3. In `sources.yaml`, set `author_url` to your GitHub profile.
4. Go to **Actions › Update T&C data › Run workflow**. After about a minute the site is live at `https://<username>.github.io/tc-monitor/`.
5. To receive emails: click **Watch › Custom › Issues** on the repository page. Colleagues can do the same.

## Adding a platform

Uncomment or add a block in `sources.yaml`. The service name must match a folder in the Open Terms Archive versions repository:

| Platform | Repository | Service folder |
|---|---|---|
| Anthropic | `GenAI-versions` | `Claude.ai` |
| Google Gemini | `GenAI-versions` | `Google Generative AI Services` |
| Meta / Facebook | `pga-versions` | `Facebook` (also `Instagram`, `WhatsApp`) |
| Apple | not tracked by Open Terms Archive yet | |

To check what Open Terms Archive tracks for a service, see the `declarations` repositories at <https://github.com/OpenTermsArchive>. A missing document or platform (such as Apple) can be proposed to them, or tracked with your own Open Terms Archive collection.

## Running locally

```bash
pip install pyyaml
python scripts/build.py
cd site && python -m http.server 8000   # open http://localhost:8000
```

## Maintenance

- **A banner on the site says the source has not updated for N days.** Open Terms Archive may have stopped tracking or renamed a document. Check its repository and update `sources.yaml`.
- **The Action fails.** Open the failed run in the Actions tab and read the error. The usual cause is a renamed folder in the source.
- **Scheduled runs stop.** GitHub disables schedules in repositories with no activity for 60 days. This project commits a timestamp on every run to avoid that. If it happens anyway, re-enable the workflow in the Actions tab.

## Files

| File | Purpose |
|---|---|
| `sources.yaml` | What is monitored, author name, settings |
| `scripts/build.py` | Builds all data for the site |
| `scripts/notify.py` | Writes the text of the email alert |
| `.github/workflows/update.yml` | Weekly schedule, publishing, alerts |
| `site/` | The dashboard (HTML, CSS, JavaScript, no build step) |
| `site/data/` | Generated data, do not edit by hand |

---

## Versione italiana

**Cos'è.** Un sito pubblico e gratuito che registra le modifiche ai termini di servizio e alle policy delle principali piattaforme digitali. Per ogni modifica mostra la data, le sezioni coinvolte e il testo aggiunto o rimosso.

**Come funziona.** Open Terms Archive scarica i documenti più volte al giorno. Ogni lunedì una GitHub Action legge lo storico, calcola le differenze tra le versioni, aggiorna i dati e ripubblica il sito su GitHub Pages. Se ci sono modifiche nuove apre una Issue, che arriva per email a chi segue il repository.

**Configurazione iniziale.**
1. Crea un repository **pubblico** su GitHub e carica questi file.
2. **Settings › Pages › Source: GitHub Actions**.
3. In `sources.yaml` inserisci il tuo profilo GitHub in `author_url`.
4. **Actions › Update T&C data › Run workflow**. Dopo circa un minuto il sito è online.
5. Per gli avvisi email: **Watch › Custom › Issues**.

**Aggiungere una piattaforma.** Aggiungi un blocco in `sources.yaml`, vedi la tabella sopra.

**Se qualcosa si rompe.** Guarda la sezione *Maintenance*: nella maggior parte dei casi basta correggere il nome di un documento in `sources.yaml`.
