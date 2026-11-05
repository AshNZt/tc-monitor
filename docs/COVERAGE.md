# Coverage

What TermRadar tracks, what is missing, and how to add it.
Census done on 5 November 2026 against the Open Terms Archive collections
`GenAI`, `pga` (Platform Governance Archive) and `contrib`.

## Tracked today (52 documents)

| Platform | Service (source collection) | Documents |
|---|---|---|
| OpenAI | ChatGPT (GenAI) | Terms of Service (Europe Terms of Use + Service Terms), Privacy Policy, Acceptable Use Policy (Usage Policies), Commercial Terms, Business Privacy Policy, Data Processor Agreement, Developer Terms, In-App Purchases Policy, Platform to Business Notice, Trackers Policy, Vulnerability Disclosure Policy |
| Anthropic | Claude.ai (GenAI) | Terms of Service, Privacy Policy, Acceptable Use Policy, Commercial Terms, Data Processor Agreement, Law Enforcement Guidelines, Trackers Policy, Vulnerability Disclosure Policy |
| Google | Generative AI Services (GenAI) | Generative AI Additional Terms of Service, Generative AI Prohibited Use Policy |
| Google | Google (contrib) | Google Terms of Service, Google Privacy Policy (both also govern Gemini) |
| Meta | Facebook, Instagram, Threads, WhatsApp (pga) | Terms of Service, Privacy Policy, Community Guidelines, Commercial Terms, Advertising policies, Developer Terms, Trackers Policy, Law Enforcement Guidelines and others: 24 documents |
| Apple | Apple, App Store, iCloud (contrib) | Privacy Policy, Human Rights Policy, App Store Review Guidelines, App Store Developer Terms, iCloud Terms of Service |

## Missing, by importance

Not tracked by Open Terms Archive in any collection on the census date.

| Platform | Document | Why it matters |
|---|---|---|
| Meta | **Meta AI Terms of Service** | Governs Meta AI across Facebook, Instagram, WhatsApp and Messenger. The Meta Terms of Service refer to it for AI products. |
| Meta | **Preview pages of announced updates** (e.g. `facebook.com/legal/commercial_terms_preview`) | The text of an announced change is only there until it takes effect. Example: the AI scraping clause of the Commercial Terms (Oct 2026). |
| Google | **Gemini Apps Privacy Notice** | The main privacy document for the Gemini app (human review, retention, training). |
| Apple | **Apple Media Services Terms** | Terms for App Store, Apple Music, Apple TV purchases. |
| Apple | **Apple Intelligence / ChatGPT integration terms** | AI features in iOS; to be checked whether a standalone document exists. |
| Meta | Messenger | Not a separate service in the archive. |

Other services exist in the archive but are not added on purpose: DALL·E (same OpenAI documents as ChatGPT), Facebook Payments and Facebook Ads (low relevance, Facebook Ads not updated since 2022), YouTube and dozens of Google products (out of scope).

## How to add a missing document

Open Terms Archive accepts contributions. For each document above:

1. Find the exact URL of the document as seen from the EU.
2. Open an issue (or a pull request) in the declarations repository of the right collection:
   - AI services: <https://github.com/OpenTermsArchive/GenAI-declarations>
   - Meta platforms: <https://github.com/OpenTermsArchive/pga-declarations>
   - Anything else: <https://github.com/OpenTermsArchive/contrib-declarations>
3. Once it is accepted and the first version is recorded, nothing else is needed for already tracked services: TermRadar picks up every document of the service automatically. For a new service, add it to `sources.yaml`.

Suggested issue text (adapt per document):

> **Request to track: Meta AI Terms of Service**
> URL: (exact URL, EU version)
> Service: Meta AI, governing the AI features of Facebook, Instagram, WhatsApp and Messenger. The Meta Terms of Service refer to it for AI products.
> Reason: we monitor changes to platform terms for EU policy analysis; this document is currently not archived in any collection.

## Known source quirks

- **OpenAI Terms of Service** combine two texts (Europe Terms of Use and Service Terms), so two "Updated" dates appear.
- **Facebook Privacy Policy** repeats some sections on the source page, so some changes appear twice.
- **Meta pages** often show survey banners and help menus, and sometimes error pages: these are filtered out (see About page on the site).
