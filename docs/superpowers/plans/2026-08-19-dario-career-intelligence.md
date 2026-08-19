# Dario Career Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare il fork privato `Dariolex/career-ops` in un sistema di career intelligence che ogni mattina scopre, valuta e classifica offerte con un Career Score 0–100 spiegabile, girando su GitHub Actions senza intervento manuale.

**Architecture:** Layer additivo sopra `career-ops` v1.27.0. Nessun file di sistema viene modificato: le aggiunte sono file nuovi dichiarati in `config/local-paths.txt`, così `update-system.mjs` continua a portare i fix upstream ai provider ATS. La discovery e la valutazione riusano `scan.mjs`, `scan-ats-full.mjs`, `check-liveness.mjs` e i prompt `modes/triage.md` / `modes/oferta.md`; il Career Score si innesta come blocco aggiuntivo nel contratto di output già esistente.

**Tech Stack:** Node.js ≥18 (ESM `.mjs`), `js-yaml` e `playwright` già presenti, `fetch` nativo per le API LLM, GitHub Actions, Anthropic Messages API con fallback OpenRouter.

**Spec:** `docs/superpowers/specs/2026-08-19-dario-career-intelligence-design.md`

## Global Constraints

- **Nessun file di sistema modificato.** In particolare: `package.json`, `.gitignore`, `test-all.mjs`, `update-system.mjs`, `modes/_shared.md`, `modes/oferta.md`, `modes/triage.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `SECURITY.md`. Ogni file nuovo va dichiarato in `config/local-paths.txt`.
- **Nessuna nuova dipendenza npm.** `package.json` è un file di sistema. Usare `fetch` nativo (disponibile da Node 18) e le librerie già presenti: `js-yaml`, `playwright`, `@google/generative-ai`, `dotenv`.
- **Node ≥18** (`engines` in `package.json`). L'ambiente di sviluppo corrente è Node 24.
- **Moduli ESM `.mjs`** con import espliciti, coerenti con il resto del repository.
- **Convenzione di test del repo:** file `*.test.mjs` accanto al file testato, senza framework. Contatore `passed`/`failed`, helper `ok(label, condition)`, `process.exit(failed > 0 ? 1 : 0)` finale. Si eseguono con `node <file>.test.mjs`.
- **File utente gitignorati.** `cv.md`, `config/profile.yml`, `portals.yml`, `modes/_profile.md`, `modes/_brief.md`, `config/local-paths.txt`, `data/*` e `reports/*.md` sono in `.gitignore`. Poiché la decisione D4 prevede di committarli nel repository privato, il **primo** add di ciascuno richiede `git add -f`. Dopo di che il file è tracciato e `.gitignore` non si applica più.
- **Branch di lavoro:** `career-intel`. Il repository `Dariolex/career-ops` è privato.
- **Nessun secret nel codice.** Solo `ANTHROPIC_API_KEY` e `OPENROUTER_API_KEY`, letti da environment o `.env` (gitignorato).
- **Human-in-the-loop:** nessun codice che invii candidature, email o crei account.

---

## File Structure

| File | Responsabilità | Task |
| --- | --- | --- |
| `config/local-paths.txt` | Dichiara al sistema di update i file di proprietà del fork | 1 |
| `config/profile.yml` | Identità, ruoli target, geografie, soglie di classificazione | 1 |
| `modes/_profile.md` | Profilo narrativo per la valutazione completa | 1 |
| `modes/_brief.md` | Profilo compatto per il triage economico | 1 |
| `cv.md` | Il CV, fonte di verità per fit e documenti | 1 |
| `portals.yml` | Filtri titolo/location e lista aziende curata | 2 |
| `modes/_career-score.md` | Contratto di output del Career Score per l'LLM | 3 |
| `career-score.mjs` | Parsing, pesi, rinormalizzazione, classificazione | 4 |
| `career-score.test.mjs` | Test del calcolo | 4 |
| `anthropic-eval.mjs` | Motore di valutazione Anthropic con fallback OpenRouter | 5 |
| `run-evaluations.mjs` | Orchestratore: legge le offerte pendenti e applica il tetto di costo | 8 |
| `daily-digest.mjs` | Digest giornaliero `reports/daily/YYYY-MM-DD.md` | 6 |
| `daily-digest.test.mjs` | Test del digest | 6 |
| `obsidian-export.mjs` | Export Markdown per Obsidian | 7 |
| `obsidian-export.test.mjs` | Test dell'export | 7 |
| `.github/workflows/job-search.yml` | Cron giornaliero e avvio manuale | 8 |
| `docs/career-intel/*.md`, `CAREER-INTEL.md` | Documentazione | 9 |

---

### Task 1: Fondamenta e strato utente

Stabilisce la proprietà dei file rispetto all'updater e crea il profilo. Senza questo nulla può girare: ogni script a valle legge `config/profile.yml` e `cv.md`.

**Files:**
- Create: `config/local-paths.txt`
- Create: `config/profile.yml`
- Create: `modes/_profile.md`
- Create: `modes/_brief.md`
- Create: `cv.md`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: `config/profile.yml` con la chiave `career_score.thresholds` (`apply`, `consider`, `low_priority` — interi 0–100) letta dal Task 4; `career_score.max_full_evaluations` (intero) letto dal Task 8; `career_score.geography_priority` (lista ordinata di stringhe) usata dal Task 3.

- [ ] **Step 1: Creare `config/local-paths.txt`**

Il file dichiara all'updater i file di proprietà del fork. Deve elencare **tutte** le aggiunte del progetto, comprese quelle dei task successivi, così il guard di coverage non le segnala mai come orfane.

```text
# local-paths.txt — file di proprietà di questo fork (Dario Career Intelligence).
# Ogni percorso qui elencato è trattato come cv.md: `update-system.mjs apply`
# non lo tocca mai, e validate-system-paths-coverage.mjs non lo segnala.

career-score.mjs
career-score.test.mjs
anthropic-eval.mjs
run-evaluations.mjs
daily-digest.mjs
daily-digest.test.mjs
obsidian-export.mjs
obsidian-export.test.mjs
modes/_career-score.md
.github/workflows/job-search.yml
docs/career-intel/
docs/superpowers/
CAREER-INTEL.md
obsidian/
reports/daily/
```

- [ ] **Step 2: Verificare che l'updater accetti le dichiarazioni**

Run: `node validate-system-paths-coverage.mjs`
Expected: exit 0. Se un percorso viene rifiutato perché già presente nel system layer, rimuoverlo dall'elenco: significa che quel file è di upstream e non va toccato.

- [ ] **Step 3: Creare `config/profile.yml`**

Partire dal template e adattarlo. I campi marcati `DA COMPLETARE` richiedono i dati reali dell'utente; il file resta valido e il sistema gira anche prima che siano compilati, ma lo scoring sarà approssimativo.

```yaml
candidate:
  full_name: "DA COMPLETARE"
  email: "dariocav@hotmail.it"
  phone: "DA COMPLETARE"
  location: "Italy"
  linkedin: "DA COMPLETARE"
  photo: ""

target_roles:
  primary:
    - "AI Governance Counsel"
    - "AI Governance Manager"
    - "AI Regulatory Counsel"
    - "Senior Privacy Counsel"
    - "Data Protection Officer"
    - "Privacy Officer"
    - "AI Compliance Manager"
    - "Technology Counsel"
    - "Cybersecurity & Privacy Counsel"
  archetypes:
    - name: "AI Governance / Responsible AI"
      level: "Senior/Manager"
      fit: "primary"
    - name: "Privacy & Data Protection"
      level: "Senior/DPO"
      fit: "primary"
    - name: "Technology & Cyber Law Counsel"
      level: "Senior"
      fit: "secondary"
    - name: "Regulatory Affairs / Compliance"
      level: "Manager"
      fit: "adjacent"

narrative:
  headline: "DA COMPLETARE"
  exit_story: "DA COMPLETARE"
  superpowers:
    - "DA COMPLETARE"

compensation:
  target_range: "DA COMPLETARE"
  currency: "EUR"
  minimum: "DA COMPLETARE"

location:
  country: "Italy"
  city: "DA COMPLETARE"
  timezone: "CET"
  visa_status: "DA COMPLETARE"
  authorized_in: ["Italy", "European Union"]
  needs_sponsorship: false

language:
  output: it

spend_tier: standard

pipeline:
  triage_threshold: 3.5
  triage_min_urls: 5

# ── Career Score 0–100 (estensione di questo fork) ──────────────────────────
career_score:
  thresholds:
    apply: 75
    consider: 60
    low_priority: 45
  # Tetto di valutazioni complete per run: la valvola di controllo costi.
  max_full_evaluations: 15
  # Ordine di preferenza geografica. Alimenta la dimensione "geography".
  geography_priority:
    - "Italy"
    - "Ireland"
    - "Netherlands"
    - "Germany"
    - "Switzerland"
    - "European Union"
    - "United Kingdom"
    - "Remote Europe"
    - "International"
```

- [ ] **Step 4: Creare `modes/_profile.md`**

```markdown
# Profilo — Dario

## Chi sono

DA COMPLETARE: 2-4 frasi di sintesi (ruolo attuale, anni di esperienza, ambiti
principali, settori).

## Domini principali

Data Protection e GDPR, Privacy, AI Governance, EU AI Act, AI Compliance, Cyber Law,
Cybersecurity, Technology Law, Digital Regulation, Regulatory Compliance, Data
Governance, Risk Management, AI Risk, Responsible AI, Privacy Governance, DPO, Legal
Counsel, Regulatory Affairs.

## Domini secondari

AML e KYC, servizi finanziari, assicurazioni, contrattualistica internazionale,
trasformazione digitale, aspetti legali della cyberwarfare.

## Priorità geografica

1. Italia — 2. Irlanda (Dublino) — 3. Paesi Bassi (Amsterdam) — 4. Germania —
5. Svizzera — 6. Resto UE — 7. Regno Unito (richiede visto) — 8. Remote Europe —
9. Internazionale.

Dublino e Amsterdam sono prioritari perché concentrano gli headquarter EMEA con team
privacy e AI governance strutturati, e si lavora in inglese.

## Cosa cerco

DA COMPLETARE: seniority, settore, modello di lavoro, elementi non negoziabili.

## Note per lo scoring

DA COMPLETARE: preferenze su tipo di datore di lavoro (azienda tech, studio legale,
consulenza, istituzione), disponibilità a relocation, sensibilità ai settori
regolamentati.
```

- [ ] **Step 5: Creare `modes/_brief.md`**

Versione compatta usata dal triage economico. Deve restare breve: è il suo scopo.

```markdown
# Brief — Dario

Profilo legal e compliance senior su AI Governance, EU AI Act, Data Protection e GDPR,
privacy, cyber law e regulatory compliance.

Ruoli target: AI Governance Counsel/Manager, AI Regulatory Counsel, Senior Privacy
Counsel, Data Protection Officer, Privacy Officer, AI Compliance Manager, Technology
Counsel, Cybersecurity & Privacy Counsel.

Geografie in ordine: Italia, Irlanda (Dublino), Paesi Bassi (Amsterdam), Germania,
Svizzera, resto UE, Regno Unito, remote Europa.

Lingue di lavoro: italiano e inglese. Cittadinanza UE, nessuna sponsorship necessaria
nell'Unione Europea.

Scartare: ruoli puramente tecnici di ingegneria del software, ruoli entry level, ruoli
di vendita, ruoli che richiedono tedesco fluente come requisito eliminatorio.
```

- [ ] **Step 6: Creare `cv.md` segnaposto**

Il CV reale arriverà dall'utente. Il segnaposto permette agli script di girare senza fallire, e dichiara esplicitamente il proprio stato per non essere scambiato per un CV vero.

```markdown
# CV — DA COMPLETARE

> ATTENZIONE: questo è un segnaposto. Finché non viene sostituito con il CV reale,
> la dimensione "professional fit" del Career Score (25% del peso) non è attendibile.
> Il sistema non deve mai inventare esperienze, certificazioni o risultati.

## Esperienza professionale

DA COMPLETARE

## Formazione

DA COMPLETARE

## Certificazioni

DA COMPLETARE

## Lingue

Italiano (madrelingua). Inglese (DA COMPLETARE).

## Competenze

DA COMPLETARE
```

- [ ] **Step 7: Verificare che il repository resti coerente**

Run: `node doctor.mjs`
Expected: il comando gira e segnala eventuali file mancanti. Segnalazioni su `portals.yml` sono attese in questa fase — viene creato nel Task 2.

- [ ] **Step 8: Commit**

I file dello strato utente sono gitignorati: il primo add richiede `-f`.

```bash
git add -f config/local-paths.txt config/profile.yml modes/_profile.md modes/_brief.md cv.md
git commit -m "feat: strato utente e dichiarazione dei file del fork

config/local-paths.txt dichiara le aggiunte del progetto, cosi
update-system.mjs continua a portare i fix upstream senza toccarle."
```

---

### Task 2: Configurazione della discovery

Definisce cosa cercare e dove. È il task che verifica l'ipotesi più incerta del progetto — che le fonti disponibili producano offerte rilevanti per un profilo legal e compliance — e lo fa a costo zero, senza una sola chiamata LLM.

**Files:**
- Create: `portals.yml`

**Interfaces:**
- Consumes: `config/profile.yml` (Task 1) per coerenza tra geografie dichiarate e filtri
- Produces: `portals.yml` con `title_filter.positive`, `title_filter.negative`, `location_filter.allow`, `location_filter.block`, `tracked_companies[]`. Consumato da `scan.mjs` e `scan-ats-full.mjs`, invocati dal Task 8.

- [ ] **Step 1: Creare `portals.yml`**

Le keyword di titolo sono la leva più importante di tutto il sistema: un titolo che non corrisponde letteralmente a una voce di `positive` viene scartato in silenzio. Per questo l'elenco copre varianti di dicitura in inglese, italiano e tedesco.

La sintassi `"termine1 + termine2"` richiede la presenza di entrambi i termini in qualsiasi ordine, ed evita di dover enumerare tutte le combinazioni.

```yaml
# portals.yml — Dario Career Intelligence
# Letto da scan.mjs e scan-ats-full.mjs.

scan_history:
  recheck_after_days: 30

title_filter:
  positive:
    # -- AI governance e regolamentazione --
    - "AI Governance"
    - "AI Policy"
    - "AI Compliance"
    - "AI Regulatory"
    - "AI Risk"
    - "Responsible AI"
    - "AI Act"
    - "AI Ethics"
    - "Algorithmic Accountability"
    - "AI + Counsel"
    - "AI + Legal"
    - "AI + Governance"
    # -- Privacy e data protection --
    - "Data Protection Officer"
    - "Data Protection"
    - "Privacy Counsel"
    - "Privacy Officer"
    - "Privacy Manager"
    - "Privacy Lead"
    - "Privacy Program"
    - "Privacy Engineer"
    - "Data Privacy"
    - "GDPR"
    - "DPO"
    # -- Legal, technology e cyber --
    - "Technology Counsel"
    - "Technology Law"
    - "Digital Regulation"
    - "Regulatory Counsel"
    - "Regulatory Affairs"
    - "Legal Counsel"
    - "Senior Counsel"
    - "Compliance Manager"
    - "Compliance Officer"
    - "Cybersecurity + Counsel"
    - "Cyber + Legal"
    - "Data Governance"
    - "Risk + Compliance"
    # -- Italiano --
    - "Responsabile Protezione Dati"
    - "Responsabile Privacy"
    - "Consulente Privacy"
    - "Legale"
    - "Affari Regolamentari"
    - "Conformita"
    # -- Tedesco --
    - "Datenschutz"
    - "Datenschutzbeauftragter"
    - "Compliance Manager"
    - "Justiziar"
    - "Syndikusrechtsanwalt"
  negative:
    # Escludere i ruoli tecnici e commerciali che condividono keyword
    - "Software Engineer"
    - "Data Engineer"
    - "Data Scientist"
    - "Machine Learning Engineer"
    - "Sales"
    - "Account Executive"
    - "Recruiter"
    - "Intern"
    - "Internship"
    - "Working Student"
    - "Werkstudent"
    - "Praktikum"
    - "Tirocinio"
    - "Stage"
    - "Apprentice"
    - "Graduate Program"
  seniority_boost:
    - "Senior"
    - "Lead"
    - "Head of"
    - "Principal"
    - "Director"
    - "Manager"

location_filter:
  # always_allow ha precedenza su block: salva gli annunci multi-sede che
  # nominano una delle geografie target.
  always_allow:
    - "Italy"
    - "Italia"
    - "Milan"
    - "Milano"
    - "Rome"
    - "Roma"
    - "Ireland"
    - "Dublin"
    - "Netherlands"
    - "Amsterdam"
  allow:
    - "Remote"
    - "Hybrid"
    - "Italy"
    - "Italia"
    - "Ireland"
    - "Dublin"
    - "Netherlands"
    - "Amsterdam"
    - "Rotterdam"
    - "The Hague"
    - "Germany"
    - "Deutschland"
    - "Berlin"
    - "Munich"
    - "München"
    - "Frankfurt"
    - "Hamburg"
    - "Switzerland"
    - "Zurich"
    - "Zürich"
    - "Geneva"
    - "Basel"
    - "Europe"
    - "EMEA"
    - "Belgium"
    - "Brussels"
    - "Luxembourg"
    - "Spain"
    - "Madrid"
    - "Barcelona"
    - "France"
    - "Paris"
    - "Austria"
    - "Vienna"
    - "United Kingdom"
    - "London"
  block:
    - "India"
    - "Bengaluru"
    - "Hyderabad"
    - "United States"
    - "San Francisco"
    - "New York"
    - "Singapore"
    - "Japan"
    - "Tokyo"
    - "China"
    - "Brazil"
    - "Australia"

# Aziende con team privacy e AI governance strutturati nelle geografie target.
# La lista non pretende di essere esaustiva: scan-ats-full.mjs copre il resto
# spazzando l'intero dataset ATS pubblico con gli stessi filtri di titolo.
tracked_companies:

  # -- Dublino: headquarter EMEA con team privacy consolidati --
  - name: Stripe
    careers_url: https://stripe.com/jobs
    api: https://boards-api.greenhouse.io/v1/boards/stripe/jobs
    enabled: true
    notes: "Dublino: hub EMEA, team legal e privacy."
  - name: Workday
    careers_url: https://workday.wd5.myworkdayjobs.com/Workday
    enabled: true
    notes: "Dublino: sede EMEA."
  - name: HubSpot
    careers_url: https://www.hubspot.com/careers
    api: https://boards-api.greenhouse.io/v1/boards/hubspot/jobs
    enabled: true
    notes: "Dublino: headquarter EMEA."
  - name: Intercom
    careers_url: https://www.intercom.com/careers
    api: https://boards-api.greenhouse.io/v1/boards/intercom/jobs
    enabled: true

  # -- Amsterdam --
  - name: Booking.com
    careers_url: https://careers.booking.com
    enabled: true
    notes: "Amsterdam: grande team privacy e regulatory."
  - name: Adyen
    careers_url: https://careers.adyen.com
    api: https://boards-api.greenhouse.io/v1/boards/adyen/jobs
    enabled: true
    notes: "Amsterdam: fintech regolamentata."
  - name: Elastic
    careers_url: https://www.elastic.co/careers
    api: https://boards-api.greenhouse.io/v1/boards/elastic/jobs
    enabled: true
  - name: Miro
    careers_url: https://miro.com/careers
    api: https://boards-api.greenhouse.io/v1/boards/miro/jobs
    enabled: true

  # -- Laboratori AI: ruoli di AI governance e policy --
  - name: Anthropic
    careers_url: https://job-boards.greenhouse.io/anthropic
    api: https://boards-api.greenhouse.io/v1/boards/anthropic/jobs
    enabled: true
  - name: OpenAI
    careers_url: https://openai.com/careers
    api: https://boards-api.greenhouse.io/v1/boards/openai/jobs
    enabled: true
  - name: Mistral AI
    careers_url: https://jobs.lever.co/mistral
    enabled: true
    notes: "Parigi: AI Act come tema diretto."
  - name: Hugging Face
    careers_url: https://apply.workable.com/huggingface
    enabled: true

  # -- Italia e Sud Europa --
  - name: Bending Spoons
    careers_url: https://jobs.bendingspoons.com
    enabled: true
    notes: "Milano."
  - name: Satispay
    careers_url: https://www.satispay.com/careers
    enabled: true
    notes: "Milano: fintech regolamentata."
  - name: Scalapay
    careers_url: https://jobs.lever.co/scalapay
    enabled: true

  # -- DACH --
  - name: SAP
    careers_url: https://jobs.sap.com
    enabled: true
  - name: Siemens
    careers_url: https://jobs.siemens.com
    enabled: true
  - name: Zalando
    careers_url: https://jobs.zalando.com
    enabled: true
  - name: Personio
    careers_url: https://www.personio.com/about-personio/careers/
    enabled: true
  - name: N26
    careers_url: https://n26.com/en/careers
    api: https://boards-api.greenhouse.io/v1/boards/n26/jobs
    enabled: true
    notes: "Berlino: banca regolamentata."
```

- [ ] **Step 2: Validare la configurazione**

Run: `node validate-portals.mjs`
Expected: exit 0, nessun errore. Gli avvisi su aziende prive di `api` sono accettabili: quelle vengono raggiunte per altra via.

Se una voce `tracked_companies` segnala `unknown provider`, rimuovere la chiave `provider` da quella voce e affidarsi a `careers_url`.

- [ ] **Step 3: Eseguire una scansione reale a costo zero**

Questo è il momento della verità del progetto: nessun token speso, e si scopre se le fonti producono offerte rilevanti.

Run: `node scan.mjs`
Expected: il comando completa e scrive le offerte trovate in `data/pipeline.md`.

- [ ] **Step 4: Verificare la pertinenza dei risultati**

Run: `head -60 data/pipeline.md`
Expected: titoli coerenti con il profilo (privacy, data protection, AI governance, counsel). Zero risultati è un esito **possibile e informativo**, non un fallimento: significa che in quel momento non ci sono posizioni aperte corrispondenti.

Se compaiono molti falsi positivi tecnici, aggiungere le keyword responsabili a `title_filter.negative`. Se mancano ruoli attesi, aggiungere la variante letterale del titolo a `title_filter.positive`.

- [ ] **Step 5: Provare la scansione ampia sull'intero dataset ATS**

Run: `node scan-ats-full.mjs`
Expected: sweep dell'intero dataset pubblico Greenhouse/Lever/Ashby/Workday/iCIMS filtrato dagli stessi `title_filter` e `location_filter`. Richiede alcuni minuti e non consuma token. Serve a misurare quanta copertura aggiuntiva dia rispetto alla lista curata.

- [ ] **Step 6: Commit**

```bash
git add -f portals.yml
git commit -m "feat: configurazione discovery per ruoli AI governance e privacy

Filtri di titolo in inglese, italiano e tedesco; filtri di location sulle
geografie target con Dublino e Amsterdam in evidenza; lista curata di
aziende con team privacy strutturati."
```

---

### Task 3: Contratto di output del Career Score

Definisce il formato che l'LLM deve produrre. Va scritto prima del parser, perché il parser lo implementa.

**Files:**
- Create: `modes/_career-score.md`

**Interfaces:**
- Consumes: `config/profile.yml` → `career_score.geography_priority` (Task 1)
- Produces: il blocco delimitato `---CAREER_SCORE--- … ---END_CAREER_SCORE---`, con sette righe `NOME_DIMENSIONE: <0-100> | <motivazione>` (dove `COMPENSATION` accetta il valore letterale `unknown`), più le sezioni `STRENGTHS`, `WEAKNESSES`, `MISSING_REQUIREMENTS`, `RED_FLAGS` a elenco puntato e `REASONING` a testo libero. Consumato dal parser del Task 4 e prodotto dal motore del Task 5.

- [ ] **Step 1: Creare `modes/_career-score.md`**

```markdown
# Career Score 0–100

Estensione di questo fork. Si aggiunge alla valutazione A–G di `modes/oferta.md`
senza sostituirla: la rubrica 1–5 resta valida e invariata.

Valuta l'offerta su sette dimensioni indipendenti, assegnando a ciascuna un intero
da 0 a 100 e una motivazione di una frase. **Non calcolare il punteggio totale**:
i pesi vengono applicati da `career-score.mjs`. Il tuo compito è il giudizio sulle
singole dimensioni, non l'aritmetica.

## Le sette dimensioni

**PROFESSIONAL_FIT** — Quanto l'esperienza reale documentata in `cv.md` copre i
requisiti dell'annuncio. Valuta solo ciò che il CV dimostra. Non dedurre competenze
che non sono scritte.

**CAREER_PROGRESSION** — Quanto il ruolo rappresenta crescita: maggiore
responsabilità, seniority superiore, ingresso o consolidamento in AI Governance,
ruolo più strategico, maggiore esposizione internazionale. Un ruolo laterale o
inferiore riceve un punteggio basso anche se il fit è ottimo.

**COMPENSATION** — Valuta salario, bonus, equity, benefit e costo opportunità.
**Se l'annuncio non dichiara il salario, scrivi esattamente `unknown`.** Non stimare,
non dedurre dal settore, non usare medie di mercato. Un valore inventato è un errore
più grave di un dato mancante.

**AI_RELEVANCE** — Quanto il ruolo riguarda concretamente AI governance, EU AI Act,
AI compliance, responsible AI, AI risk, AI policy o regolamentazione dell'AI. Un
accenno generico all'intelligenza artificiale in un annuncio altrimenti tradizionale
non basta per un punteggio alto.

**GEOGRAPHY** — Confronta la sede con la priorità geografica dichiarata in
`config/profile.yml` sotto `career_score.geography_priority`: le prime posizioni
valgono di più. Considera remote e ibrido come fattori favorevoli. Una sede che
richiede visto di lavoro va penalizzata.

**EMPLOYER_QUALITY** — Reputazione, dimensione, settore, stabilità, qualità
tecnologica e rilevanza internazionale del datore di lavoro.

**STRATEGIC_VALUE** — Quanto il ruolo apre porte future: competenze acquisibili,
rete professionale, posizionamento sul mercato a tre-cinque anni.

## Formato di output obbligatorio

Emetti il blocco esattamente così, dopo la valutazione A–G:

---CAREER_SCORE---
PROFESSIONAL_FIT: 82 | Otto anni di esperienza GDPR coprono il requisito principale; manca l'esperienza diretta su AI Act.
CAREER_PROGRESSION: 75 | Passaggio da privacy operativa a governance strategica con responsabilità di team.
COMPENSATION: unknown
AI_RELEVANCE: 90 | Il ruolo ha l'implementazione dell'AI Act come responsabilità esplicita.
GEOGRAPHY: 85 | Dublino, seconda geografia prioritaria, con modello ibrido.
EMPLOYER_QUALITY: 80 | Multinazionale quotata con funzione privacy consolidata.
STRATEGIC_VALUE: 85 | Esperienza AI Act su scala europea, rara e molto richiesta.
STRENGTHS:
- Sovrapposizione diretta tra esperienza GDPR e requisiti dell'annuncio
- Componente AI Act sostanziale, non decorativa
WEAKNESSES:
- Nessuna esperienza documentata di gestione di un team
MISSING_REQUIREMENTS:
- Certificazione CIPP/E indicata come preferenziale
RED_FLAGS:
- Nessuno
REASONING: Ruolo fortemente allineato al profilo, con una componente AI Act che
rappresenta esattamente la direzione di crescita ricercata. Il gap sulla gestione
del team è colmabile e non eliminatorio.
---END_CAREER_SCORE---

## Regole

- Tutte e sette le dimensioni devono comparire, sempre, in questo ordine.
- I punteggi sono interi da 0 a 100. `COMPENSATION` accetta in alternativa
  `unknown`, che è l'unico valore non numerico ammesso.
- Ogni dimensione numerica ha una motivazione dopo la barra verticale.
- `STRENGTHS`, `WEAKNESSES`, `MISSING_REQUIREMENTS` e `RED_FLAGS` sono elenchi
  puntati. Se una sezione è vuota, scrivere `- Nessuno`.
- Non inventare mai esperienze, certificazioni, risultati o dati salariali.
```

- [ ] **Step 2: Commit**

```bash
git add modes/_career-score.md
git commit -m "feat: contratto di output del Career Score 0-100

Sette dimensioni valutate dall'LLM; l'aritmetica resta al codice.
Salario non dichiarato produce unknown, mai una stima inventata."
```

---

### Task 4: Calcolo del Career Score

Il cuore del sistema. Separa il giudizio (dell'LLM) dall'aritmetica (deterministica e testabile).

**Files:**
- Create: `career-score.mjs`
- Test: `career-score.test.mjs`

**Interfaces:**
- Consumes: il blocco `---CAREER_SCORE---` definito nel Task 3
- Produces:
  - `WEIGHTS` — oggetto `{professional_fit: 25, career_progression: 20, compensation: 15, ai_relevance: 15, geography: 10, employer_quality: 10, strategic_value: 5}`
  - `DEFAULT_THRESHOLDS` — `{apply: 75, consider: 60, low_priority: 45}`
  - `parseCareerScoreBlock(text)` → `{dimensions, salaryUnknown, strengths, weaknesses, missingRequirements, redFlags, reasoning}` dove `dimensions` è `{[nome]: {score: number|null, reasoning: string}}`. Lancia `Error` se il blocco manca o è malformato.
  - `computeCareerScore(dimensions)` → `{total: number, raw: number, renormalized: boolean, weightsUsed: number}`
  - `classify(total, thresholds)` → `'APPLY' | 'CONSIDER' | 'LOW_PRIORITY' | 'REJECT'`
  - `evaluateCareerScore(text, {thresholds})` → `{total, raw, renormalized, classification, dimensions, salaryUnknown, strengths, weaknesses, missingRequirements, redFlags, reasoning}`

  Usato dal Task 5 (motore) e dal Task 6 (digest).

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `career-score.test.mjs`. I casi coprono il calcolo pesato, la rinormalizzazione quando manca il salario, i confini esatti della classificazione e il rifiuto di input malformati.

```javascript
import {
  WEIGHTS, DEFAULT_THRESHOLDS, parseCareerScoreBlock,
  computeCareerScore, classify, evaluateCareerScore,
} from './career-score.mjs';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

// --- Pesi ---

ok('i pesi sommano a 100', Object.values(WEIGHTS).reduce((a, b) => a + b, 0) === 100);
ok('professional_fit pesa 25', WEIGHTS.professional_fit === 25);
ok('strategic_value pesa 5', WEIGHTS.strategic_value === 5);

// --- Calcolo con tutte le dimensioni ---
// 80*.25 + 70*.20 + 60*.15 + 90*.15 + 50*.10 + 80*.10 + 60*.05
// = 20 + 14 + 9 + 13.5 + 5 + 8 + 3 = 72.5

const complete = {
  professional_fit:   { score: 80, reasoning: 'x' },
  career_progression: { score: 70, reasoning: 'x' },
  compensation:       { score: 60, reasoning: 'x' },
  ai_relevance:       { score: 90, reasoning: 'x' },
  geography:          { score: 50, reasoning: 'x' },
  employer_quality:   { score: 80, reasoning: 'x' },
  strategic_value:    { score: 60, reasoning: 'x' },
};

const full = computeCareerScore(complete);
ok('il totale grezzo e 72.5', Math.abs(full.raw - 72.5) < 0.001);
ok('il totale arrotondato e 73', full.total === 73);
ok('senza dimensioni mancanti non rinormalizza', full.renormalized === false);
ok('usa tutti i 100 punti di peso', full.weightsUsed === 100);

// --- Rinormalizzazione quando manca il salario ---
// Somma pesata senza compensation = 63.5 su un peso totale di 85
// 63.5 / 85 * 100 = 74.7059

const noSalary = { ...complete, compensation: { score: null, reasoning: 'unknown' } };
const partial = computeCareerScore(noSalary);
ok('rinormalizza quando manca il salario', partial.renormalized === true);
ok('usa 85 punti di peso', partial.weightsUsed === 85);
ok('il totale grezzo e 74.71', Math.abs(partial.raw - 74.7059) < 0.001);
ok('il totale arrotondato e 75', partial.total === 75);
ok('la rinormalizzazione non penalizza il salario mancante', partial.total > full.total);

// --- Classificazione: confini esatti ---

ok('75 e APPLY',           classify(75, DEFAULT_THRESHOLDS) === 'APPLY');
ok('100 e APPLY',          classify(100, DEFAULT_THRESHOLDS) === 'APPLY');
ok('74 e CONSIDER',        classify(74, DEFAULT_THRESHOLDS) === 'CONSIDER');
ok('60 e CONSIDER',        classify(60, DEFAULT_THRESHOLDS) === 'CONSIDER');
ok('59 e LOW_PRIORITY',    classify(59, DEFAULT_THRESHOLDS) === 'LOW_PRIORITY');
ok('45 e LOW_PRIORITY',    classify(45, DEFAULT_THRESHOLDS) === 'LOW_PRIORITY');
ok('44 e REJECT',          classify(44, DEFAULT_THRESHOLDS) === 'REJECT');
ok('0 e REJECT',           classify(0, DEFAULT_THRESHOLDS) === 'REJECT');
ok('le soglie sono configurabili', classify(50, { apply: 40, consider: 30, low_priority: 20 }) === 'APPLY');

// --- Parsing ---

const validBlock = `
Testo che precede il blocco e va ignorato.

---CAREER_SCORE---
PROFESSIONAL_FIT: 82 | Esperienza GDPR solida.
CAREER_PROGRESSION: 75 | Passaggio a governance strategica.
COMPENSATION: unknown
AI_RELEVANCE: 90 | AI Act come responsabilita esplicita.
GEOGRAPHY: 85 | Dublino, ibrido.
EMPLOYER_QUALITY: 80 | Multinazionale quotata.
STRATEGIC_VALUE: 85 | Competenza rara e richiesta.
STRENGTHS:
- Sovrapposizione diretta con i requisiti
- Componente AI Act sostanziale
WEAKNESSES:
- Nessuna esperienza di gestione team
MISSING_REQUIREMENTS:
- Certificazione CIPP/E preferenziale
RED_FLAGS:
- Nessuno
REASONING: Ruolo fortemente allineato al profilo.
---END_CAREER_SCORE---
`;

const parsed = parseCareerScoreBlock(validBlock);
ok('legge un punteggio numerico',        parsed.dimensions.professional_fit.score === 82);
ok('legge la motivazione',               parsed.dimensions.professional_fit.reasoning === 'Esperienza GDPR solida.');
ok('unknown diventa null',               parsed.dimensions.compensation.score === null);
ok('segnala il salario mancante',        parsed.salaryUnknown === true);
ok('legge tutte le sette dimensioni',    Object.keys(parsed.dimensions).length === 7);
ok('legge i punti di forza',             parsed.strengths.length === 2);
ok('legge le debolezze',                 parsed.weaknesses.length === 1);
ok('legge i requisiti mancanti',         parsed.missingRequirements.length === 1);
ok('normalizza "Nessuno" a lista vuota', parsed.redFlags.length === 0);
ok('legge il ragionamento',              /fortemente allineato/.test(parsed.reasoning));

// --- Parsing: input non validi ---

function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

ok('rifiuta un testo senza blocco', throws(() => parseCareerScoreBlock('nessun blocco qui')));
ok('rifiuta un blocco incompleto', throws(() => parseCareerScoreBlock(
  '---CAREER_SCORE---\nPROFESSIONAL_FIT: 80 | x\n---END_CAREER_SCORE---')));
ok('rifiuta un punteggio fuori scala', throws(() => parseCareerScoreBlock(
  validBlock.replace('PROFESSIONAL_FIT: 82', 'PROFESSIONAL_FIT: 180'))));
ok('rifiuta un punteggio non numerico', throws(() => parseCareerScoreBlock(
  validBlock.replace('GEOGRAPHY: 85', 'GEOGRAPHY: alto'))));
ok('rifiuta unknown fuori da compensation', throws(() => parseCareerScoreBlock(
  validBlock.replace('GEOGRAPHY: 85 | Dublino, ibrido.', 'GEOGRAPHY: unknown'))));

// --- Integrazione ---

const evaluated = evaluateCareerScore(validBlock, { thresholds: DEFAULT_THRESHOLDS });
// 82*.25 + 75*.20 + 90*.15 + 85*.10 + 80*.10 + 85*.05
// = 20.5 + 15 + 13.5 + 8.5 + 8 + 4.25 = 69.75 su 85 -> 82.06
ok('valuta il blocco completo',   evaluated.total === 82);
ok('classifica come APPLY',       evaluated.classification === 'APPLY');
ok('riporta la rinormalizzazione', evaluated.renormalized === true);
ok('propaga il salario mancante',  evaluated.salaryUnknown === true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node career-score.test.mjs`
Expected: FAIL — `Cannot find module './career-score.mjs'`.

- [ ] **Step 3: Implementare `career-score.mjs`**

```javascript
#!/usr/bin/env node
/**
 * career-score.mjs — Career Score 0–100 di Dario Career Intelligence.
 *
 * L'LLM giudica le sette dimensioni; qui si fa solo aritmetica. La separazione
 * rende il punteggio riproducibile e verificabile a mano — proprietà che un
 * numero prodotto direttamente dal modello non avrebbe.
 *
 * Uso: node career-score.mjs <file-valutazione.md>
 */

import { readFileSync } from 'fs';

export const WEIGHTS = {
  professional_fit:   25,
  career_progression: 20,
  compensation:       15,
  ai_relevance:       15,
  geography:          10,
  employer_quality:   10,
  strategic_value:     5,
};

export const DEFAULT_THRESHOLDS = { apply: 75, consider: 60, low_priority: 45 };

const DIMENSION_KEYS = Object.keys(WEIGHTS);
const BLOCK_RE = /---CAREER_SCORE---\s*([\s\S]*?)---END_CAREER_SCORE---/;

/** Le liste puntate usano "- Nessuno" per dichiarare l'assenza; qui diventa []. */
function parseList(body, label) {
  const section = body.match(
    // \Z non esiste in JavaScript (a differenza di PCRE/Python): senza questa
    // correzione matcha il carattere letterale "Z", che con il flag "i"
    // tronca la cattura alla prima "z" incontrata nel testo (es. dentro
    // "Sovrapposizione"). $(?![\s\S]) è l'idioma corretto per fine-stringa.
    new RegExp(`^${label}:\\s*$([\\s\\S]*?)(?=^[A-Z_]+:|$(?![\\s\\S]))`, 'mi'),
  );
  if (!section) return [];
  return section[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(item => item && !/^(nessuno|none|n\/a)$/i.test(item));
}

/**
 * Estrae il blocco Career Score da un testo di valutazione.
 * @param {string} text - Output completo dell'LLM.
 * @returns {{dimensions: Object, salaryUnknown: boolean, strengths: string[],
 *   weaknesses: string[], missingRequirements: string[], redFlags: string[],
 *   reasoning: string}}
 * @throws {Error} Se il blocco manca o una dimensione è assente o malformata.
 */
export function parseCareerScoreBlock(text) {
  const block = String(text).match(BLOCK_RE);
  if (!block) throw new Error('blocco ---CAREER_SCORE--- non trovato');
  const body = block[1];

  const dimensions = {};
  let salaryUnknown = false;

  for (const key of DIMENSION_KEYS) {
    const line = body.match(new RegExp(`^\\s*${key.toUpperCase()}:\\s*(.+)$`, 'mi'));
    if (!line) throw new Error(`dimensione mancante: ${key}`);

    const raw = line[1].trim();
    const [valuePart, ...rest] = raw.split('|');
    const value = valuePart.trim();
    const reasoning = rest.join('|').trim();

    if (/^unknown$/i.test(value)) {
      if (key !== 'compensation') {
        throw new Error(`"unknown" è ammesso solo per compensation, non per ${key}`);
      }
      dimensions[key] = { score: null, reasoning: reasoning || 'unknown' };
      salaryUnknown = true;
      continue;
    }

    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`punteggio non valido per ${key}: "${value}"`);
    }
    dimensions[key] = { score, reasoning };
  }

  const reasoningMatch = body.match(/^REASONING:\s*([\s\S]*?)$/mi);

  return {
    dimensions,
    salaryUnknown,
    strengths:           parseList(body, 'STRENGTHS'),
    weaknesses:          parseList(body, 'WEAKNESSES'),
    missingRequirements: parseList(body, 'MISSING_REQUIREMENTS'),
    redFlags:            parseList(body, 'RED_FLAGS'),
    reasoning:           reasoningMatch ? reasoningMatch[1].trim() : '',
  };
}

/**
 * Applica i pesi. Una dimensione con score null viene esclusa e i pesi restanti
 * sono rinormalizzati su 100: assegnarle un valore neutro sarebbe comunque una
 * stima inventata, che il contratto vieta.
 * @param {Object} dimensions - Mappa da parseCareerScoreBlock.
 * @returns {{total: number, raw: number, renormalized: boolean, weightsUsed: number}}
 */
export function computeCareerScore(dimensions) {
  let weighted = 0;
  let weightsUsed = 0;

  for (const key of DIMENSION_KEYS) {
    const score = dimensions[key]?.score;
    if (score === null || score === undefined) continue;
    weighted += score * WEIGHTS[key];
    weightsUsed += WEIGHTS[key];
  }

  if (weightsUsed === 0) throw new Error('nessuna dimensione valutabile');

  const raw = weighted / weightsUsed;
  return {
    raw,
    total: Math.round(raw),
    renormalized: weightsUsed !== 100,
    weightsUsed,
  };
}

/**
 * @param {number} total - Punteggio 0–100.
 * @param {{apply: number, consider: number, low_priority: number}} thresholds
 * @returns {'APPLY'|'CONSIDER'|'LOW_PRIORITY'|'REJECT'}
 */
export function classify(total, thresholds = DEFAULT_THRESHOLDS) {
  if (total >= thresholds.apply) return 'APPLY';
  if (total >= thresholds.consider) return 'CONSIDER';
  if (total >= thresholds.low_priority) return 'LOW_PRIORITY';
  return 'REJECT';
}

/**
 * Pipeline completa: parsing, calcolo, classificazione.
 * @param {string} text - Output completo dell'LLM.
 * @param {{thresholds?: Object}} [options]
 */
export function evaluateCareerScore(text, { thresholds = DEFAULT_THRESHOLDS } = {}) {
  const parsed = parseCareerScoreBlock(text);
  const computed = computeCareerScore(parsed.dimensions);
  return {
    ...parsed,
    ...computed,
    classification: classify(computed.total, thresholds),
  };
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node career-score.mjs <file-valutazione.md>');
    process.exit(1);
  }
  try {
    const result = evaluateCareerScore(readFileSync(file, 'utf-8'));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Errore: ${error.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `node career-score.test.mjs`
Expected: PASS — `0 failed`, exit 0.

Se il conteggio pesato non torna, controllare che `computeCareerScore` divida per `weightsUsed` e non per 100 fisso: è l'errore che rompe la rinormalizzazione.

- [ ] **Step 5: Commit**

```bash
git add career-score.mjs career-score.test.mjs
git commit -m "feat: calcolo del Career Score 0-100

L'LLM giudica le dimensioni, il codice fa l'aritmetica. Quando manca il
salario la dimensione viene esclusa e i pesi rinormalizzati, invece di
assegnare un valore neutro che sarebbe comunque una stima inventata."
```

---

### Task 5: Motore di valutazione Anthropic

Rende la valutazione eseguibile senza CLI interattiva. Modellato su `gemini-eval.mjs`, di cui replica il contratto di output, aggiungendo il blocco Career Score.

**Files:**
- Create: `anthropic-eval.mjs`

**Interfaces:**
- Consumes: `modes/_shared.md`, `modes/oferta.md`, `modes/_career-score.md` (Task 3), `cv.md`, `modes/_profile.md` (Task 1); `evaluateCareerScore` da `career-score.mjs` (Task 4)
- Produces: eseguibile `node anthropic-eval.mjs <file-jd|--text "...">` che stampa la valutazione, scrive `reports/NNN-{azienda}-{data}.md` e restituisce exit 0 in caso di successo. Invocato dal Task 8.

- [ ] **Step 1: Implementare `anthropic-eval.mjs`**

Nessuna dipendenza npm: `package.json` è un file di sistema, quindi si usa `fetch` nativo contro la Messages API.

```javascript
#!/usr/bin/env node
/**
 * anthropic-eval.mjs — valutazione headless con Anthropic, fallback OpenRouter.
 *
 * Fratello di gemini-eval.mjs / openai-eval.mjs: legge la stessa logica da
 * modes/, produce lo stesso contratto di output, e in più il blocco
 * ---CAREER_SCORE--- definito in modes/_career-score.md.
 *
 * Nessuna dipendenza npm: package.json appartiene al system layer, quindi si
 * usa fetch nativo (Node >=18).
 *
 * Uso:
 *   node anthropic-eval.mjs <file-jd.txt>
 *   node anthropic-eval.mjs --text "job description..."
 *   node anthropic-eval.mjs <file-jd.txt> --tier triage
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluateCareerScore } from './career-score.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Caricamento .env, stesso approccio di openrouter-runner.mjs
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*?)\1$/, '$2');
    }
  }
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Tier di costo. Il triage gira sul modello economico con il profilo compatto;
// la valutazione completa sul modello capace con CV e profilo estesi.
const TIERS = {
  triage: {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
    modes: ['modes/_shared.md', 'modes/triage.md'],
    profile: 'modes/_brief.md',
    includeCv: false,
    careerScore: false,
  },
  full: {
    model: 'claude-sonnet-5',
    maxTokens: 8192,
    modes: ['modes/_shared.md', 'modes/oferta.md', 'modes/_career-score.md'],
    profile: 'modes/_profile.md',
    includeCv: true,
    careerScore: true,
  },
};

function readOptional(relative, label) {
  const path = join(ROOT, relative);
  if (!existsSync(path)) {
    console.warn(`⚠️   ${label} non trovato: ${relative}`);
    return `[${label} non disponibile]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

function parseArgs(argv) {
  const args = { tier: 'full', jdFile: null, text: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tier') args.tier = argv[++i];
    else if (argv[i] === '--text') args.text = argv[++i];
    else if (!argv[i].startsWith('--')) args.jdFile = argv[i];
  }
  return args;
}

/** Redige la chiave dai messaggi di errore prima di stamparli. */
function redact(message, ...secrets) {
  let out = String(message || '');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

async function callAnthropic({ apiKey, model, maxTokens, system, userText }) {
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.4,
      // Il prefisso statico (shared + oferta + cv) è marcato per il caching:
      // si ripete identico a ogni offerta della stessa giornata.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `JOB DESCRIPTION DA VALUTARE:\n\n${userText}` }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  return data.content.map(part => part.text ?? '').join('').trim();
}

async function callOpenRouter({ apiKey, system, userText, maxTokens }) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.CAREER_OPS_MODEL || 'google/gemini-2.5-pro:free',
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `JOB DESCRIPTION DA VALUTARE:\n\n${userText}` },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

function slugify(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tier = TIERS[args.tier];
  if (!tier) {
    console.error(`Tier sconosciuto: ${args.tier}. Valori ammessi: triage, full.`);
    process.exit(1);
  }

  let jdText = args.text;
  if (!jdText && args.jdFile) {
    if (!existsSync(args.jdFile)) {
      console.error(`File non trovato: ${args.jdFile}`);
      process.exit(1);
    }
    jdText = readFileSync(args.jdFile, 'utf-8').trim();
  }
  if (!jdText) {
    console.error('Uso: node anthropic-eval.mjs <file-jd.txt> [--tier triage|full]');
    process.exit(1);
  }

  const parts = tier.modes.map(m => readOptional(m, m));
  parts.push(readOptional(tier.profile, tier.profile));
  if (tier.includeCv) parts.push(`# CV\n\n${readOptional('cv.md', 'cv.md')}`);
  const system = parts.join('\n\n---\n\n');

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  let output = null;
  let usedProvider = null;

  if (anthropicKey) {
    try {
      output = await callAnthropic({
        apiKey: anthropicKey, model: tier.model,
        maxTokens: tier.maxTokens, system, userText: jdText,
      });
      usedProvider = `anthropic/${tier.model}`;
    } catch (error) {
      console.warn(`⚠️   Anthropic non disponibile: ${redact(error.message, anthropicKey)}`);
    }
  }

  if (!output && openrouterKey) {
    try {
      output = await callOpenRouter({
        apiKey: openrouterKey, system, userText: jdText, maxTokens: tier.maxTokens,
      });
      usedProvider = 'openrouter (fallback)';
    } catch (error) {
      console.error(`❌  OpenRouter non disponibile: ${redact(error.message, openrouterKey)}`);
    }
  }

  if (!output) {
    console.error('❌  Nessun provider LLM disponibile. Configurare ANTHROPIC_API_KEY.');
    process.exit(1);
  }

  console.log(`\n🤖  Valutazione prodotta da ${usedProvider}\n`);
  console.log(output);

  if (!tier.careerScore) process.exit(0);

  let scored;
  try {
    scored = evaluateCareerScore(output);
  } catch (error) {
    console.error(`❌  Career Score non estraibile: ${error.message}`);
    console.error('    Nessun report salvato. Riprovare.');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  CAREER SCORE: ${scored.total}/100 — ${scored.classification}`);
  if (scored.renormalized) {
    console.log(`  (salario non dichiarato: calcolato su ${scored.weightsUsed} punti di peso)`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  const company = output.match(/^\s*COMPANY:\s*(.+)$/mi)?.[1]?.trim() || 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  const reportsDir = join(ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${slugify(company)}-${date}.md`);

  writeFileSync(reportPath, [
    output,
    '',
    '---',
    '',
    '## Career Score',
    '',
    `**${scored.total}/100 — ${scored.classification}**`,
    scored.renormalized
      ? `\n> Salario non dichiarato: punteggio calcolato su ${scored.weightsUsed} punti di peso invece di 100.`
      : '',
    '',
    '```json',
    JSON.stringify(scored, null, 2),
    '```',
    '',
  ].join('\n'), 'utf-8');

  console.log(`📄  Report salvato: ${reportPath}`);
}

main().catch(error => {
  console.error(`❌  ${error.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Verificare che lo script si carichi senza errori di sintassi**

Run: `node --check anthropic-eval.mjs`
Expected: nessun output, exit 0.

- [ ] **Step 3: Verificare la gestione dell'assenza di chiavi**

Run: `ANTHROPIC_API_KEY= OPENROUTER_API_KEY= node anthropic-eval.mjs --text "Data Protection Officer, Dublin"`
Expected: FAIL controllato con `Nessun provider LLM disponibile`, exit 1. Nessuno stack trace.

- [ ] **Step 4: Verificare una valutazione reale**

Richiede `ANTHROPIC_API_KEY` configurata in `.env`.

Run: `node anthropic-eval.mjs --text "Data Protection Officer, Dublin, Ireland. Hybrid. Lead GDPR compliance and EU AI Act readiness for EMEA. 8+ years privacy experience required. CIPP/E preferred."`
Expected: valutazione A–G, blocco Career Score, riga `CAREER SCORE: NN/100 — CLASSIFICAZIONE`, report scritto in `reports/`. Poiché l'annuncio non dichiara un salario, deve comparire l'avviso sulla rinormalizzazione.

- [ ] **Step 5: Commit**

```bash
git add anthropic-eval.mjs
git commit -m "feat: motore di valutazione Anthropic con fallback OpenRouter

Usa fetch nativo per non aggiungere dipendenze a package.json, che
appartiene al system layer. Tier triage economico e full con Career Score."
```

---

### Task 6: Digest giornaliero

Trasforma le valutazioni della giornata in un documento leggibile. È il prodotto che l'utente consulta ogni mattina.

**Files:**
- Create: `daily-digest.mjs`
- Test: `daily-digest.test.mjs`

**Interfaces:**
- Consumes: `evaluateCareerScore` da `career-score.mjs` (Task 4); i report prodotti dal Task 5
- Produces:
  - `renderDigest({date, entries})` → stringa Markdown. `entries` è un array di `{total, classification, title, company, location, salary, url, renormalized, strengths, weaknesses, redFlags, reasoning}`.
  - eseguibile `node daily-digest.mjs` che scrive `reports/daily/YYYY-MM-DD.md`. Invocato dal Task 8.

- [ ] **Step 1: Scrivere i test che falliscono**

Il caso più importante è quello a zero offerte: un digest che non viene scritto è indistinguibile da un workflow rotto.

```javascript
import { renderDigest } from './daily-digest.mjs';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

// --- Giornata senza risultati ---

const empty = renderDigest({ date: '2026-08-19', entries: [] });
ok('il digest vuoto riporta la data', empty.includes('2026-08-19'));
ok('il digest vuoto dichiara zero offerte', /nessuna offerta/i.test(empty));
ok('il digest vuoto non e una stringa vuota', empty.trim().length > 0);

// --- Giornata con risultati ---

const entries = [
  {
    total: 82, classification: 'APPLY',
    title: 'Data Protection Officer', company: 'Stripe',
    location: 'Dublin, Ireland', salary: null,
    url: 'https://example.com/dpo', renormalized: true,
    strengths: ['Esperienza GDPR diretta'], weaknesses: ['Nessuna gestione team'],
    redFlags: [], reasoning: 'Forte allineamento.',
  },
  {
    total: 64, classification: 'CONSIDER',
    title: 'Privacy Counsel', company: 'Adyen',
    location: 'Amsterdam, Netherlands', salary: '€90.000–110.000',
    url: 'https://example.com/pc', renormalized: false,
    strengths: ['Fintech regolamentata'], weaknesses: ['Meno componente AI'],
    redFlags: ['Richiesto olandese'], reasoning: 'Buon fit, minore rilevanza AI.',
  },
];

const digest = renderDigest({ date: '2026-08-19', entries });
ok('elenca il punteggio',             digest.includes('82/100'));
ok('elenca la classificazione',       digest.includes('APPLY'));
ok('elenca azienda e titolo',         digest.includes('Stripe') && digest.includes('Data Protection Officer'));
ok('elenca la sede',                  digest.includes('Dublin, Ireland'));
ok('elenca la URL',                   digest.includes('https://example.com/dpo'));
ok('segnala il salario mancante',     /non dichiarato/i.test(digest));
ok('mostra il salario quando c e',    digest.includes('€90.000–110.000'));
ok('elenca i punti di forza',         digest.includes('Esperienza GDPR diretta'));
ok('elenca i rischi',                 digest.includes('Richiesto olandese'));

// --- Ordinamento ---

const reversed = renderDigest({ date: '2026-08-19', entries: [entries[1], entries[0]] });
ok('ordina per punteggio decrescente',
  reversed.indexOf('Stripe') < reversed.indexOf('Adyen'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node daily-digest.test.mjs`
Expected: FAIL — `Cannot find module './daily-digest.mjs'`.

- [ ] **Step 3: Implementare `daily-digest.mjs`**

```javascript
#!/usr/bin/env node
/**
 * daily-digest.mjs — digest giornaliero in reports/daily/YYYY-MM-DD.md.
 *
 * Distinto dai report per singola offerta (reports/NNN-azienda-data.md): questo
 * aggrega la giornata. Viene scritto anche quando non ci sono offerte, perché un
 * file assente è indistinguibile da un workflow rotto.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluateCareerScore } from './career-score.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

const ORDER = { APPLY: 0, CONSIDER: 1, LOW_PRIORITY: 2, REJECT: 3 };

function renderEntry(entry) {
  const lines = [
    `### ${entry.total}/100 — ${entry.classification}`,
    '',
    `**${entry.title}** · ${entry.company}`,
    `${entry.location || 'Sede non indicata'}`,
    '',
    `Retribuzione: ${entry.salary || '_non dichiarato dall\'annuncio_'}`,
  ];

  if (entry.renormalized) {
    lines.push('', '> Punteggio calcolato senza la dimensione retributiva e rinormalizzato: l\'annuncio non dichiara il salario.');
  }

  if (entry.strengths?.length) {
    lines.push('', '**Punti di forza**', ...entry.strengths.map(s => `- ${s}`));
  }
  if (entry.weaknesses?.length) {
    lines.push('', '**Gap**', ...entry.weaknesses.map(w => `- ${w}`));
  }
  if (entry.redFlags?.length) {
    lines.push('', '**Rischi**', ...entry.redFlags.map(r => `- ${r}`));
  }
  if (entry.reasoning) {
    lines.push('', entry.reasoning);
  }
  if (entry.url) {
    lines.push('', `[Annuncio](${entry.url})`);
  }

  lines.push('', '---', '');
  return lines.join('\n');
}

/**
 * @param {{date: string, entries: Array<Object>}} input
 * @returns {string} Markdown del digest.
 */
export function renderDigest({ date, entries }) {
  const header = [`# Career Intelligence — ${date}`, ''];

  if (!entries || entries.length === 0) {
    return [
      ...header,
      'Nessuna offerta rilevante trovata oggi.',
      '',
      'Per un profilo AI Governance e privacy senior è un esito normale: le posizioni',
      'target sono rare e i filtri sono volutamente stretti. Nessuna azione richiesta.',
      '',
    ].join('\n');
  }

  const sorted = [...entries].sort((a, b) => {
    const byClass = (ORDER[a.classification] ?? 9) - (ORDER[b.classification] ?? 9);
    return byClass !== 0 ? byClass : b.total - a.total;
  });

  const counts = sorted.reduce((acc, e) => {
    acc[e.classification] = (acc[e.classification] || 0) + 1;
    return acc;
  }, {});

  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ');

  return [
    ...header,
    `${sorted.length} offerte valutate — ${summary}`,
    '',
    '---',
    '',
    ...sorted.map(renderEntry),
  ].join('\n');
}

/** Estrae un campo dal blocco SCORE_SUMMARY prodotto dai modes. */
function summaryField(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
}

function collectEntries(date) {
  const reportsDir = join(ROOT, 'reports');
  if (!existsSync(reportsDir)) return [];

  const entries = [];
  for (const file of readdirSync(reportsDir)) {
    if (!file.endsWith(`${date}.md`)) continue;
    const text = readFileSync(join(reportsDir, file), 'utf-8');
    try {
      const scored = evaluateCareerScore(text);
      entries.push({
        ...scored,
        title:    summaryField(text, 'ROLE') || 'Ruolo non indicato',
        company:  summaryField(text, 'COMPANY') || 'Azienda non indicata',
        location: summaryField(text, 'LOCATION'),
        salary:   summaryField(text, 'SALARY'),
        url:      summaryField(text, 'URL'),
      });
    } catch {
      // Un report senza blocco Career Score è una valutazione di altra origine:
      // si salta senza interrompere il digest.
    }
  }
  return entries;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const outDir = join(ROOT, 'reports', 'daily');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}.md`);
  writeFileSync(outPath, renderDigest({ date, entries: collectEntries(date) }), 'utf-8');
  console.log(`📄  Digest scritto: ${outPath}`);
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `node daily-digest.test.mjs`
Expected: PASS — `0 failed`, exit 0.

- [ ] **Step 5: Generare un digest reale**

Run: `node daily-digest.mjs`
Expected: scrive `reports/daily/<oggi>.md`. Senza valutazioni della giornata, contiene il messaggio di assenza offerte — che è il comportamento corretto.

- [ ] **Step 6: Commit**

```bash
git add daily-digest.mjs daily-digest.test.mjs
git commit -m "feat: digest giornaliero delle offerte valutate

Scritto anche nelle giornate senza risultati: un file assente sarebbe
indistinguibile da un workflow rotto."
```

---

### Task 7: Export Obsidian

Produce una vista navigabile delle offerte. È un export derivato: la verità resta in `data/` e `reports/`.

**Files:**
- Create: `obsidian-export.mjs`
- Test: `obsidian-export.test.mjs`

**Interfaces:**
- Consumes: `evaluateCareerScore` da `career-score.mjs` (Task 4); i report del Task 5
- Produces:
  - `renderJobNote(job)` → stringa Markdown con frontmatter YAML. `job` è `{job_id, company, title, location, score, classification, source, url, discovered, whyItFits, requirements, gaps, salary, notes}`.
  - eseguibile `node obsidian-export.mjs` che scrive `obsidian/jobs/*.md`. Invocato dal Task 8.

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
import { renderJobNote } from './obsidian-export.mjs';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

const note = renderJobNote({
  job_id: 'stripe-dpo-2026-08-19',
  company: 'Stripe',
  title: 'Data Protection Officer',
  location: 'Dublin, Ireland',
  score: 82,
  classification: 'APPLY',
  source: 'greenhouse',
  url: 'https://example.com/dpo',
  discovered: '2026-08-19',
  whyItFits: 'Allineamento diretto con esperienza GDPR.',
  requirements: ['8+ anni di privacy', 'CIPP/E preferenziale'],
  gaps: ['Nessuna gestione team'],
  salary: null,
  notes: '',
});

ok('inizia con il frontmatter',      note.startsWith('---\n'));
ok('contiene il job_id',             note.includes('job_id: stripe-dpo-2026-08-19'));
ok('contiene azienda e titolo',      note.includes('company: Stripe') && note.includes('title: Data Protection Officer'));
ok('contiene il punteggio',          note.includes('score: 82'));
ok('contiene la classificazione',    note.includes('classification: APPLY'));
ok('contiene la fonte',              note.includes('source: greenhouse'));
ok('contiene la data di scoperta',   note.includes('discovered: 2026-08-19'));
ok('chiude il frontmatter',          note.split('---').length >= 3);

for (const section of ['## Score', '## Why it fits', '## Requirements', '## Gaps', '## Salary', '## Company', '## Notes', '## Application']) {
  ok(`contiene la sezione ${section}`, note.includes(section));
}

ok('elenca i requisiti',             note.includes('8+ anni di privacy'));
ok('elenca i gap',                   note.includes('Nessuna gestione team'));
ok('dichiara il salario mancante',   /non dichiarat/i.test(note));

// I valori con due punti romperebbero il frontmatter YAML se non quotati.
const risky = renderJobNote({
  job_id: 'x', company: 'Acme: Legal', title: 'Counsel: Privacy',
  location: 'Milan', score: 50, classification: 'CONSIDER',
  source: 'lever', url: 'https://example.com', discovered: '2026-08-19',
  whyItFits: '', requirements: [], gaps: [], salary: null, notes: '',
});
ok('quota i valori che contengono due punti', risky.includes('"Acme: Legal"'));
ok('quota anche il titolo',                   risky.includes('"Counsel: Privacy"'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node obsidian-export.test.mjs`
Expected: FAIL — `Cannot find module './obsidian-export.mjs'`.

- [ ] **Step 3: Implementare `obsidian-export.mjs`**

```javascript
#!/usr/bin/env node
/**
 * obsidian-export.mjs — export Markdown compatibile con Obsidian.
 *
 * Vista derivata e rigenerabile: la verità resta in data/ e reports/.
 * Cancellare obsidian/ e rieseguire è sempre sicuro.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluateCareerScore } from './career-score.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Un valore YAML che contiene due punti, virgolette o # va quotato. */
function yamlValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  if (/[:#"'\n]/.test(text)) return `"${text.replace(/"/g, '\\"')}"`;
  return text;
}

function bulletList(items, emptyLabel) {
  if (!items || items.length === 0) return `_${emptyLabel}_`;
  return items.map(item => `- ${item}`).join('\n');
}

/**
 * @param {Object} job
 * @returns {string} Nota Markdown con frontmatter.
 */
export function renderJobNote(job) {
  return [
    '---',
    `job_id: ${yamlValue(job.job_id)}`,
    `company: ${yamlValue(job.company)}`,
    `title: ${yamlValue(job.title)}`,
    `location: ${yamlValue(job.location)}`,
    `score: ${job.score ?? ''}`,
    `classification: ${yamlValue(job.classification)}`,
    `source: ${yamlValue(job.source)}`,
    `url: ${yamlValue(job.url)}`,
    `discovered: ${yamlValue(job.discovered)}`,
    '---',
    '',
    `# ${job.title || 'Ruolo non indicato'}`,
    '',
    '## Score',
    '',
    `**${job.score ?? '—'}/100 — ${job.classification || 'non classificato'}**`,
    '',
    '## Why it fits',
    '',
    job.whyItFits || '_Non disponibile_',
    '',
    '## Requirements',
    '',
    bulletList(job.requirements, 'Nessun requisito estratto'),
    '',
    '## Gaps',
    '',
    bulletList(job.gaps, 'Nessun gap rilevato'),
    '',
    '## Salary',
    '',
    job.salary || '_Non dichiarato dall\'annuncio_',
    '',
    '## Company',
    '',
    job.company || '_Non indicata_',
    '',
    '## Notes',
    '',
    job.notes || '',
    '',
    '## Application',
    '',
    '- [ ] Candidatura inviata',
    '',
  ].join('\n');
}

function summaryField(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
}

function slugify(value) {
  return String(value || 'job')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'job';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportsDir = join(ROOT, 'reports');
  const outDir = join(ROOT, 'obsidian', 'jobs');
  mkdirSync(outDir, { recursive: true });

  let written = 0;
  if (existsSync(reportsDir)) {
    for (const file of readdirSync(reportsDir)) {
      if (!file.endsWith('.md')) continue;
      const text = readFileSync(join(reportsDir, file), 'utf-8');
      let scored;
      try {
        scored = evaluateCareerScore(text);
      } catch {
        continue; // report senza Career Score: non è materiale di questo export
      }

      const company = summaryField(text, 'COMPANY') || 'unknown';
      const title = summaryField(text, 'ROLE') || 'unknown';
      const jobId = `${slugify(company)}-${slugify(title)}`;

      writeFileSync(join(outDir, `${jobId}.md`), renderJobNote({
        job_id: jobId,
        company,
        title,
        location: summaryField(text, 'LOCATION'),
        score: scored.total,
        classification: scored.classification,
        source: summaryField(text, 'SOURCE') || 'career-ops',
        url: summaryField(text, 'URL'),
        discovered: file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '',
        whyItFits: scored.reasoning,
        requirements: scored.missingRequirements,
        gaps: scored.weaknesses,
        salary: scored.salaryUnknown ? null : summaryField(text, 'SALARY'),
        notes: '',
      }), 'utf-8');
      written++;
    }
  }

  console.log(`📓  Export Obsidian: ${written} note in ${outDir}`);
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

Run: `node obsidian-export.test.mjs`
Expected: PASS — `0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add obsidian-export.mjs obsidian-export.test.mjs
git commit -m "feat: export Obsidian delle offerte valutate

Vista derivata e rigenerabile; i valori con due punti sono quotati per
non rompere il frontmatter YAML."
```

---

### Task 8: Workflow GitHub Actions

Rende il sistema autonomo. Fino a qui tutto gira solo se lanciato a mano.

**Files:**
- Create: `.github/workflows/job-search.yml`

**Interfaces:**
- Consumes: `portals.yml` (Task 2), `anthropic-eval.mjs` (Task 5), `daily-digest.mjs` (Task 6), `obsidian-export.mjs` (Task 7), `career_score.max_full_evaluations` da `config/profile.yml` (Task 1)
- Produces: esecuzione automatica giornaliera con commit dei risultati e artifact scaricabile

- [ ] **Step 1: Creare `.github/workflows/job-search.yml`**

```yaml
name: Job Search

# Cron interpretato in UTC: le 05:00 UTC sono le 06:00 italiane d'inverno e le
# 07:00 d'estate. Lo slittamento è irrilevante per un batch notturno.
on:
  schedule:
    - cron: '0 5 * * *'
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Esegue senza committare e senza chiamare gli LLM'
        type: boolean
        default: false
      max_evaluations:
        description: 'Tetto di valutazioni complete per questo run'
        type: string
        default: ''
      full_sweep:
        description: 'Include la scansione ampia dell intero dataset ATS'
        type: boolean
        default: false

# Due run non devono mai scrivere insieme su data/ e reports/.
concurrency:
  group: job-search
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  search:
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install --no-audit --no-fund

      - name: Run project tests
        run: |
          node career-score.test.mjs
          node daily-digest.test.mjs
          node obsidian-export.test.mjs

      - name: Validate portals configuration
        run: node validate-portals.mjs

      - name: Discovery (tier 1, zero token)
        run: node scan.mjs

      - name: Full ATS sweep (opzionale)
        if: ${{ inputs.full_sweep == true }}
        run: node scan-ats-full.mjs

      - name: Liveness check
        run: node check-liveness.mjs || echo "Liveness check completato con avvisi"

      - name: Evaluate offers
        if: ${{ inputs.dry_run != true }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          MAX_EVALUATIONS: ${{ inputs.max_evaluations }}
        run: node run-evaluations.mjs

      - name: Generate daily digest
        run: node daily-digest.mjs

      - name: Export to Obsidian
        run: node obsidian-export.mjs

      - name: Job summary
        run: |
          DIGEST="reports/daily/$(date -u +%F).md"
          if [ -f "$DIGEST" ]; then
            cat "$DIGEST" >> "$GITHUB_STEP_SUMMARY"
          else
            echo "Nessun digest prodotto." >> "$GITHUB_STEP_SUMMARY"
          fi

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: career-intelligence-${{ github.run_number }}
          path: |
            reports/
            obsidian/
          retention-days: 30
          if-no-files-found: warn

      - name: Commit results
        if: ${{ inputs.dry_run != true }}
        run: |
          git config user.name "career-intel-bot"
          git config user.email "noreply@github.com"
          # -f perché data/, reports/ e i file di profilo sono gitignorati
          # nel system layer: la decisione D4 li vuole tracciati in questo fork.
          git add -f data/ reports/ obsidian/ || true
          if git diff --staged --quiet; then
            echo "Nessuna modifica da committare."
          else
            git commit -m "chore: risultati job search $(date -u +%F) [skip ci]"
            git push
          fi
```

- [ ] **Step 2: Creare `run-evaluations.mjs`, l'orchestratore richiamato dal workflow**

Il workflow ha bisogno di un passo che legga le offerte pendenti, applichi il tetto di costo e invochi il motore su ciascuna.

```javascript
#!/usr/bin/env node
/**
 * run-evaluations.mjs — orchestratore dei tier 2 e 3.
 *
 * Legge le offerte pendenti da data/pipeline.md, applica il tetto di costo e
 * invoca anthropic-eval.mjs su ciascuna. Il tetto è la valvola che impedisce a
 * una giornata anomala di consumare budget imprevisto.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));

function loadMaxEvaluations() {
  const fromEnv = Number(process.env.MAX_EVALUATIONS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  const profilePath = join(ROOT, 'config', 'profile.yml');
  if (existsSync(profilePath)) {
    const profile = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    const configured = profile.career_score?.max_full_evaluations;
    if (Number.isFinite(configured) && configured > 0) return configured;
  }
  return 15;
}

function loadPendingUrls() {
  const pipelinePath = join(ROOT, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) return [];
  const text = readFileSync(pipelinePath, 'utf-8');
  const urls = text.match(/https?:\/\/\S+/g) || [];
  return [...new Set(urls.map(url => url.replace(/[)\]|,.]+$/, '')))];
}

const max = loadMaxEvaluations();
const urls = loadPendingUrls().slice(0, max);

if (urls.length === 0) {
  console.log('Nessuna offerta da valutare.');
  process.exit(0);
}

console.log(`Valutazione di ${urls.length} offerte (tetto: ${max}).`);

let evaluated = 0;
let skipped = 0;

for (const url of urls) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'anthropic-eval.mjs'), '--text', url], {
      stdio: 'inherit',
      env: process.env,
    });
    evaluated++;
  } catch {
    console.warn(`⚠️   Valutazione fallita: ${url}`);
    skipped++;
  }
}

console.log(`\nValutate ${evaluated}, saltate ${skipped}.`);
// Le valutazioni fallite non devono far fallire l'intero workflow: il digest
// deve comunque essere prodotto con ciò che è riuscito.
process.exit(0);
```

Aggiungere `run-evaluations.mjs` a `config/local-paths.txt`.

- [ ] **Step 3: Validare la sintassi YAML del workflow**

Run: `node -e "const y=require('js-yaml');const fs=require('fs');y.load(fs.readFileSync('.github/workflows/job-search.yml','utf8'));console.log('YAML valido')"`
Expected: `YAML valido`.

- [ ] **Step 4: Verificare la sintassi degli script**

Run: `node --check run-evaluations.mjs`
Expected: nessun output, exit 0.

- [ ] **Step 5: Commit e push del branch**

```bash
git add .github/workflows/job-search.yml run-evaluations.mjs
git add -f config/local-paths.txt
git commit -m "feat: workflow giornaliero di job search

Cron 05:00 UTC e avvio manuale con dry_run. Commit diretti sul branch:
il guard no-user-data scatta solo sulle pull request."
git push -u origin career-intel
```

- [ ] **Step 6: Configurare i secrets sul repository**

```bash
gh secret set ANTHROPIC_API_KEY --repo Dariolex/career-ops
gh secret set OPENROUTER_API_KEY --repo Dariolex/career-ops
```

- [ ] **Step 7: Eseguire un dry-run reale**

```bash
gh workflow run job-search.yml --repo Dariolex/career-ops --ref career-intel -f dry_run=true
gh run watch --repo Dariolex/career-ops
```

Expected: il workflow completa in verde. Con `dry_run=true` non chiama gli LLM e non committa: verifica discovery, test e generazione del digest a costo zero.

- [ ] **Step 8: Eseguire un run completo**

```bash
gh workflow run job-search.yml --repo Dariolex/career-ops --ref career-intel -f max_evaluations=3
```

Expected: valuta al massimo tre offerte, produce il digest, committa i risultati. Il tetto basso limita il costo della prima verifica reale.

---

### Task 9: Documentazione

**Files:**
- Create: `CAREER-INTEL.md`
- Create: `docs/career-intel/SETUP.md`
- Create: `docs/career-intel/SCORING.md`
- Create: `docs/career-intel/GITHUB_ACTIONS.md`
- Create: `docs/career-intel/SECRETS.md`
- Create: `docs/career-intel/TROUBLESHOOTING.md`

**Interfaces:**
- Consumes: tutto ciò che precede
- Produces: nessuna interfaccia di codice

I nomi `docs/ARCHITECTURE.md`, `docs/SETUP.md` e `SECURITY.md` appartengono all'upstream: sovrascriverli romperebbe l'aggiornabilità. Per questo la documentazione del progetto vive sotto `docs/career-intel/`.

- [ ] **Step 1: Creare `CAREER-INTEL.md`**

```markdown
# Dario Career Intelligence

Estensione privata di [career-ops](https://github.com/santifer/career-ops) che ogni
mattina scopre, valuta e classifica offerte per un profilo AI Governance, privacy e
data protection.

## Cosa fa

Ogni giorno alle 05:00 UTC un workflow GitHub Actions scansiona gli ATS delle aziende
configurate, scarta duplicati e posizioni chiuse, valuta le offerte superstiti con un
LLM e assegna un **Career Score 0–100** con classificazione APPLY, CONSIDER,
LOW_PRIORITY o REJECT. Il risultato è un digest in `reports/daily/`.

Il sistema non invia mai candidature. Prepara, analizza e suggerisce; la decisione
resta all'utente.

## Documentazione

- [Setup](docs/career-intel/SETUP.md) — configurazione iniziale
- [Scoring](docs/career-intel/SCORING.md) — come funziona il Career Score
- [GitHub Actions](docs/career-intel/GITHUB_ACTIONS.md) — automazione
- [Secrets](docs/career-intel/SECRETS.md) — chiavi API
- [Troubleshooting](docs/career-intel/TROUBLESHOOTING.md) — problemi comuni

## Comandi

| Comando | Effetto |
| --- | --- |
| `node scan.mjs` | Discovery sulle aziende configurate (zero token) |
| `node scan-ats-full.mjs` | Sweep dell'intero dataset ATS pubblico (zero token) |
| `node anthropic-eval.mjs <file>` | Valuta una singola offerta |
| `node daily-digest.mjs` | Genera il digest della giornata |
| `node obsidian-export.mjs` | Esporta le note per Obsidian |
| `node career-score.test.mjs` | Esegue i test dello scoring |

## Rapporto con l'upstream

Nessun file di sistema è modificato. Le aggiunte sono dichiarate in
`config/local-paths.txt`, quindi `node update-system.mjs apply` continua a portare i
fix upstream — in particolare quelli ai provider ATS, che si rompono con regolarità —
senza toccare questo layer.
```

- [ ] **Step 2: Creare `docs/career-intel/SCORING.md`**

```markdown
# Career Score 0–100

## Perché due sistemi di punteggio

`career-ops` valuta le offerte su una rubrica A–G con scala 1.0–5.0, cablata nel
tracker, nelle soglie di configurazione e in centinaia di test. Il Career Score non la
sostituisce: si aggiunge. La rubrica originale continua a funzionare, e chi aggiorna
dall'upstream non trova conflitti.

## Le dimensioni

| Dimensione | Peso |
| --- | --- |
| Professional fit | 25% |
| Career progression | 20% |
| Compensation | 15% |
| AI relevance | 15% |
| Geography e modello di lavoro | 10% |
| Employer quality | 10% |
| Strategic value | 5% |

## Chi decide cosa

L'LLM assegna i sette sotto-punteggi e le motivazioni, seguendo
`modes/_career-score.md`. `career-score.mjs` applica i pesi e calcola il totale.

La separazione è deliberata: un totale calcolato dal codice è riproducibile,
verificabile a mano e testabile. Un totale prodotto dal modello non lo sarebbe.

## Quando manca il salario

La maggior parte degli annunci non dichiara la retribuzione. In quel caso la dimensione
compensation viene **esclusa** e i pesi restanti rinormalizzati su 100.

L'alternativa — assegnare un valore neutro — sarebbe comunque una stima inventata. Con
la rinormalizzazione l'offerta non è né premiata né penalizzata, e il report dichiara
che il punteggio è calcolato su sei dimensioni anziché sette.

## Classificazione

| Classificazione | Soglia |
| --- | --- |
| APPLY | ≥ 75 |
| CONSIDER | 60–74 |
| LOW_PRIORITY | 45–59 |
| REJECT | < 45 |

Le soglie vivono in `config/profile.yml` sotto `career_score.thresholds` e vanno
calibrate sui dati reali dopo le prime settimane.
```

- [ ] **Step 3: Creare `docs/career-intel/SECRETS.md`**

```markdown
# Secrets

## Quali servono

| Secret | Necessario | Uso |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Sì | Motore di valutazione principale |
| `OPENROUTER_API_KEY` | No | Fallback quando Anthropic non risponde |

Nessun altro. Non servono credenziali di job board, cookie o sessioni: il sistema usa
solo fonti pubbliche senza autenticazione.

## Configurazione su GitHub

```bash
gh secret set ANTHROPIC_API_KEY --repo Dariolex/career-ops
gh secret set OPENROUTER_API_KEY --repo Dariolex/career-ops
```

Oppure da interfaccia web: Settings → Secrets and variables → Actions → New repository
secret.

## Configurazione in locale

Copiare `.env.example` in `.env` e inserire le chiavi. `.env` è gitignorato e non va
mai committato.

## Cosa non finisce mai nel repository

Chiavi API, password, cookie, token di sessione, credenziali OAuth. I log del workflow
riportano titolo, azienda e punteggio, mai il contenuto del CV.
```

- [ ] **Step 4: Creare `docs/career-intel/SETUP.md`**

```markdown
# Setup

## Prerequisiti

- Node.js ≥ 18
- Un fork **privato** di `career-ops`
- Una chiave API Anthropic

## Passi

1. **Clonare il fork**

   ```bash
   gh repo clone Dariolex/career-ops
   cd career-ops
   npm install
   ```

2. **Compilare il profilo**

   Modificare `config/profile.yml` e `modes/_profile.md` sostituendo ogni voce
   `DA COMPLETARE` con i dati reali.

3. **Inserire il CV**

   Sostituire il contenuto di `cv.md` con il CV reale, in Markdown. Finché resta il
   segnaposto, la dimensione professional fit — il 25% del punteggio — non è
   attendibile.

4. **Configurare le chiavi**

   ```bash
   cp .env.example .env
   # inserire ANTHROPIC_API_KEY
   ```

5. **Verificare**

   ```bash
   node validate-portals.mjs
   node career-score.test.mjs
   node scan.mjs
   ```

6. **Configurare i secrets su GitHub** — vedi [SECRETS.md](SECRETS.md).

## Personalizzare la ricerca

`portals.yml` contiene i filtri. `title_filter.positive` è la leva più importante: un
titolo che non corrisponde letteralmente a una voce dell'elenco viene scartato in
silenzio. Aggiungere le varianti di dicitura che interessano, incluse quelle in
italiano e tedesco.
```

- [ ] **Step 5: Creare `docs/career-intel/GITHUB_ACTIONS.md`**

```markdown
# GitHub Actions

## Quando gira

Ogni giorno alle `05:00` UTC. GitHub interpreta il cron solo in UTC e non gestisce
l'ora legale: sono le 06:00 italiane d'inverno e le 07:00 d'estate.

## Avvio manuale

```bash
gh workflow run job-search.yml --repo Dariolex/career-ops --ref career-intel
```

Parametri disponibili:

| Parametro | Effetto |
| --- | --- |
| `dry_run` | Esegue discovery e test senza chiamare gli LLM né committare |
| `max_evaluations` | Tetto di valutazioni complete per questo run |
| `full_sweep` | Include la scansione dell'intero dataset ATS pubblico |

## Cosa fa il workflow

Test del progetto, validazione di `portals.yml`, discovery a costo zero, verifica delle
posizioni ancora aperte, valutazione con tetto di costo, digest giornaliero, export
Obsidian, commit e artifact.

## Perché committa direttamente

Il repository ha un guard, `no-user-data.yml`, che blocca le pull request contenenti
file dello strato utente. Scatta solo su eventi `pull_request`: committando
direttamente sul branch il guard non interviene, e non serve approvare una pull request
ogni mattina.

I file dello strato utente sono gitignorati nel system layer, quindi il workflow usa
`git add -f`. È una conseguenza voluta della scelta di tenere i dati personali nel
repository privato.

## Controllo dei costi

Tre livelli. Il primo — discovery, deduplicazione e liveness — non consuma token. Il
secondo filtra con un modello economico. Il terzo, il più costoso, gira solo sui
sopravvissuti e solo fino al tetto configurato in
`config/profile.yml` → `career_score.max_full_evaluations`.
```

- [ ] **Step 6: Creare `docs/career-intel/TROUBLESHOOTING.md`**

```markdown
# Troubleshooting

## La scansione non trova nulla

Per un profilo AI Governance e privacy senior è un esito normale: le posizioni target
sono rare. Prima di cambiare configurazione, verificare che non sia semplicemente una
giornata senza offerte.

Se il vuoto persiste per più giorni:

- Controllare che `title_filter.positive` contenga le varianti letterali dei titoli
  cercati. Un titolo che non corrisponde a nessuna voce viene scartato senza avviso.
- Controllare che `location_filter.block` non stia escludendo geografie desiderate.
- Provare `node scan-ats-full.mjs`, che spazza l'intero dataset ATS invece delle sole
  aziende configurate.

## Troppi falsi positivi

Aggiungere le keyword responsabili a `title_filter.negative`. I ruoli tecnici che
contengono "AI" sono la causa più frequente.

## `Career Score non estraibile`

Il modello non ha prodotto il blocco `---CAREER_SCORE---` nel formato atteso. Di norma
si risolve rieseguendo. Se ricorre, verificare che `modes/_career-score.md` sia incluso
tra i file caricati dal tier `full` in `anthropic-eval.mjs`.

## Il workflow fallisce sul commit

Verificare che il workflow abbia `permissions: contents: write`. Se il messaggio
riguarda file ignorati, controllare che il comando usi `git add -f`.

## `unknown provider` in validate-portals

La voce `provider` di quell'azienda non corrisponde a nessun modulo in `providers/`.
Rimuovere la chiave `provider` e affidarsi a `careers_url`.

## L'aggiornamento upstream segnala conflitti

Non dovrebbe accadere: nessun file di sistema è modificato. Se accade, verificare che
il file in conflitto sia elencato in `config/local-paths.txt`, e che quel file non
appartenga già al system layer — in quel caso è stato modificato per errore e va
ripristinato.
```

- [ ] **Step 7: Verificare che i test passino tutti**

Run: `node career-score.test.mjs && node daily-digest.test.mjs && node obsidian-export.test.mjs`
Expected: tutti PASS, exit 0.

- [ ] **Step 8: Verificare la coerenza con l'updater**

Run: `node validate-system-paths-coverage.mjs`
Expected: exit 0, nessun file orfano.

- [ ] **Step 9: Commit**

```bash
git add CAREER-INTEL.md docs/career-intel/
git commit -m "docs: documentazione di Dario Career Intelligence

Sotto docs/career-intel/ per non collidere con docs/ARCHITECTURE.md,
docs/SETUP.md e SECURITY.md, che appartengono all'upstream."
git push
```

---

## Verifica finale

Prima di considerare il progetto completo:

- [ ] `node career-score.test.mjs && node daily-digest.test.mjs && node obsidian-export.test.mjs` — tutti verdi
- [ ] `node validate-portals.mjs` — exit 0
- [ ] `node validate-system-paths-coverage.mjs` — exit 0
- [ ] `node scan.mjs` produce offerte pertinenti in `data/pipeline.md`
- [ ] `node anthropic-eval.mjs --text "..."` produce un Career Score valido
- [ ] Il workflow completa in verde con `dry_run=true`
- [ ] Il workflow completa in verde con `max_evaluations=3` e committa i risultati
- [ ] `reports/daily/YYYY-MM-DD.md` esiste ed è leggibile
- [ ] `git log --oneline` mostra la storia delle offerte scoperte
- [ ] Nessun secret compare in `git log -p`
- [ ] `cv.md` contiene il CV reale, non il segnaposto

## Debito noto alla consegna

- **Dipendenza dal CV.** Finché `cv.md` resta il segnaposto, la dimensione professional
  fit non è attendibile e il punteggio complessivo va letto con cautela.
- **Soglie da calibrare.** `apply: 75` è un'ipotesi. Vanno riviste dopo due o tre
  settimane di dati reali.
- **`run-evaluations.mjs` passa la URL come testo.** Il motore riceve la URL, non il
  contenuto dell'annuncio. Va integrato con `browser-extract.mjs` o `jd-capture.mjs`
  per estrarre il testo prima della valutazione — miglioramento naturale dopo il primo
  run reale, quando si vedrà quali fonti restituiscono contenuto utilizzabile.
- **PDF in CI non verificato.** La generazione di CV e cover letter usa Playwright.
  Resta un'operazione locale finché non viene provata nel workflow.
- **Il tracker non viene aggiornato dal motore.** `anthropic-eval.mjs` scrive il report
  ma non aggiunge la riga in `data/applications.md`, come invece fa `gemini-eval.mjs`.
  Il digest legge direttamente i report, quindi il sistema funziona; ma la tabella
  canonica del tracker resta da collegare, ed è il passo naturale prima di usare
  `set-status.mjs` per la pipeline candidature.

## Requisiti della spec che non richiedono codice nuovo

La sezione 11 della spec — CV su misura, cover letter e preparazione al colloquio —
non ha un task dedicato perché i motori esistono già e funzionano senza modifiche:
`generate-pdf.mjs`, `build-cv-html.mjs`, `generate-cover-letter.mjs` e i prompt
`modes/interview*.md`. Diventano utilizzabili non appena `cv.md` contiene il CV reale.
Il principio guida del progetto è riusare, non ricostruire: aggiungere un task qui
significherebbe duplicare codice funzionante.
