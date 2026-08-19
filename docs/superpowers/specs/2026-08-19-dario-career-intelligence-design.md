# Dario Career Intelligence — Design

**Data:** 2026-08-19
**Stato:** approvato in brainstorming, pronto per il piano di implementazione
**Repository:** `Dariolex/career-ops` (fork privato di `santifer/career-ops` v1.27.0)

## 1. Contesto e obiettivo

Trasformare il fork privato di `career-ops` in un sistema personale di career
intelligence che gira automaticamente su GitHub Actions, senza tenere un PC acceso.

Il sistema cerca offerte, le deduplica, verifica che siano ancora aperte, le valuta con
un LLM confrontandole con il profilo, assegna un punteggio 0–100 spiegabile, produce un
report giornaliero, mantiene lo storico e — su richiesta — genera CV su misura, cover
letter e preparazione al colloquio. Non invia mai candidature: la decisione finale
resta sempre dell'utente.

### Il vincolo che ha guidato ogni scelta

Il prompt originale è stato scritto senza conoscere il contenuto reale di `career-ops`.
Il repository è alla v1.27.0, con circa 70 script, 80+ provider ATS, oltre 500 test e un
sistema di auto-aggiornamento dall'upstream. Quasi tutte le funzionalità richieste
esistono già:

| Richiesta | Componente esistente |
| --- | --- |
| Job discovery multi-fonte | `scan.mjs` + `providers/` (80+ ATS e board) |
| Deduplicazione | `dedup-tracker.mjs`, `fingerprint-core.mjs`, `detect-reposts.mjs`, `url-key.mjs` |
| Verifica offerte attive | `check-liveness.mjs`, `liveness-*.mjs` |
| Scoring spiegabile | `modes/_shared.md` + `modes/oferta.md` (rubrica A–G, scala 1.0–5.0) |
| Profilo separato dal codice | `config/profile.yml`, `modes/_profile.md`, `cv.md` |
| Database e storico | `data/pipeline.md`, `data/applications.md`, `reports/NNN-*.md` |
| CV e cover letter su misura | `generate-pdf.mjs`, `build-cv-html.mjs`, `generate-cover-letter.mjs` |
| Preparazione colloquio | `modes/interview*.md`, `interview-prep/` |
| Controllo costi a livelli | `modes/triage.md`, `spend_tier` |
| Astrazione LLM | `openrouter-runner.mjs`, `gemini-eval.mjs`, `openai-eval.mjs`, `ollama-eval.mjs` |
| Pipeline candidature | `tracker.mjs`, `set-status.mjs`, `outcome.mjs` |

Manca soltanto l'esecuzione automatica schedulata: i 17 workflow presenti sono tutti di
manutenzione del repository, nessuno fa job search.

Ne discende il principio guida: **riusare, non ricostruire**. Ogni componente nuovo va
giustificato dall'assenza di un equivalente.

## 2. Decisioni architetturali

Sei decisioni prese esplicitamente durante il brainstorming.

**D1 — Esecuzione su GitHub Actions in autonomia.** Cron giornaliero che scansiona,
valuta e committa i risultati nel repository privato. Alternative scartate: modello
ibrido con valutazione locale, e modello interamente locale.

**D2 — Career Score come layer additivo.** La rubrica 1.0–5.0 esistente resta intatta;
il punteggio 0–100 a 7 dimensioni pesate si aggiunge sopra. Sostituire la rubrica
avrebbe richiesto di modificare `modes/_shared.md`, riadattare il tracker e rompere
centinaia di test, generando conflitti a ogni aggiornamento upstream.

**D3 — Motore Anthropic nativo con fallback OpenRouter.** Nuovo `anthropic-eval.mjs`
costruito sul pattern dei tre evaluator già presenti. Anthropic è il default richiesto e
non esiste ancora un motore nativo nel repository.

**D4 — Tutti i dati personali nel repository privato.** `cv.md`, `config/profile.yml`,
`data/` e `reports/` sono committati. È il modello che fa funzionare scoring accurato,
CV su misura, storico ed export Obsidian senza complicazioni di runtime.

**D5 — Il fork resta aggiornabile dall'upstream.** Nessun file di sistema viene
modificato. Il repository è attivo e i fix ai provider ATS — che si rompono con
regolarità — arrivano gratis solo mantenendo la compatibilità.

**D6 — Discovery su lista curata di aziende via ATS.** Nessun provider italiano custom:
sarebbero parser fragili, sconosciuti all'upstream e a carico dell'utente.

### Il meccanismo che rende D5 possibile

`update-system.mjs` aggiorna solo i percorsi elencati in `SYSTEM_PATHS` e non tocca mai
`USER_PATHS`. Per i file che un fork aggiunge di suo esiste un terzo canale ufficiale:
`config/local-paths.txt`, letto a runtime, dove il fork dichiara ciò che è proprio.

Nell'upstream quel file è gitignorato. Nel nostro fork lo **committiamo**, rimuovendolo
da `.gitignore`: così anche `validate-system-paths-coverage.mjs` in CI riconosce le
nostre aggiunte come legittime invece di segnalarle come file orfani.

## 3. Architettura

### Strato utente — mai toccato dall'updater

Già coperto da `USER_PATHS`:

- `cv.md` — il CV, fonte di verità per ogni valutazione e documento generato
- `config/profile.yml` — identità, ruoli target, compensation, location, soglie, `spend_tier`
- `modes/_profile.md` — profilo in forma narrativa, letto dai prompt di valutazione
- `portals.yml` — lista curata di aziende e ATS da scansionare
- `data/`, `reports/`, `output/`, `interview-prep/` — offerte, storico, report, documenti

Il prompt originale chiedeva `user/profile.yml`. Usiamo `config/profile.yml` perché è il
percorso che ogni script del repository già legge; un percorso parallelo avrebbe imposto
di riscrivere tutti i consumatori.

### Codice nuovo — dichiarato in `config/local-paths.txt`

| File | Ruolo |
| --- | --- |
| `anthropic-eval.mjs` | Motore di valutazione Anthropic, fallback OpenRouter |
| `career-score.mjs` | Calcolo deterministico del Career Score 0–100 |
| `career-score.test.mjs` | Test di pesi, rinormalizzazione, soglie |
| `modes/_career-score.md` | Istruzioni di scoring per l'LLM |
| `obsidian-export.mjs` | Export Markdown per Obsidian |
| `obsidian-export.test.mjs` | Test dell'export |
| `.github/workflows/job-search.yml` | Cron giornaliero e avvio manuale |
| `docs/career-intel/` | Documentazione del sistema |
| `CAREER-INTEL.md` | Punto d'ingresso in radice |
| `obsidian/` | Output Obsidian (derivato, rigenerabile) |

### Componenti riusati senza modifiche

`scan.mjs` e i provider ATS; `check-liveness.mjs` e i moduli liveness; la deduplicazione
(`dedup-tracker.mjs`, `fingerprint-core.mjs`, `detect-reposts.mjs`, `url-key.mjs`);
`modes/triage.md` e `modes/oferta.md`; `tracker.mjs`, `set-status.mjs`, `outcome.mjs`;
`generate-pdf.mjs`, `build-cv-html.mjs`, `generate-cover-letter.mjs`;
`modes/interview*.md`; `reserve-report-num.mjs`; `pipeline-lock.mjs`.

## 4. Profilo professionale

`config/profile.yml` contiene identità, ruoli target, geografie, compensation e soglie.
`modes/_profile.md` contiene la versione narrativa. Entrambi modificabili senza toccare
il motore.

**Domini principali:** Data Protection e GDPR, Privacy, AI Governance, EU AI Act, AI
Compliance, Cyber Law, Cybersecurity, Technology Law, Digital Regulation, Regulatory
Compliance, Data Governance, Risk Management, AI Risk, Responsible AI, Privacy
Governance, DPO, Legal Counsel, Regulatory Affairs.

**Domini secondari:** AML e KYC, servizi finanziari, assicurazioni, contrattualistica
internazionale, trasformazione digitale, aspetti legali della cyberwarfare.

**Ruoli prioritari:** AI Governance Counsel, AI Governance Manager, AI Regulatory
Counsel, Senior Privacy Counsel, Data Protection Officer, Privacy Officer, AI Compliance
Manager, Technology Counsel, Cybersecurity & Privacy Counsel, Responsible AI, AI Risk,
Digital Regulation.

**Ruoli secondari:** Legal Counsel, Regulatory Affairs, Compliance Manager, Technology
Risk, Data Governance.

### Priorità geografica

1. Italia
2. Irlanda (Dublino)
3. Paesi Bassi (Amsterdam)
4. Germania
5. Svizzera
6. Resto UE
7. Regno Unito
8. Remote Europe
9. Internazionale

Dublino e Amsterdam occupano il secondo e terzo posto per ragioni sostanziali. Dublino
ospita la Data Protection Commission — autorità capofila per gran parte delle big tech
europee — e gli headquarter EMEA di Meta, Google, LinkedIn, TikTok, Apple, Microsoft e
Stripe, tutti con team privacy e AI governance strutturati. Amsterdam ha densità
analoga: Booking, Adyen, Uber EMEA, ING, Philips, Elastic. In entrambi i mercati si
lavora in inglese, quindi non si applica il requisito linguistico che in Germania e
Svizzera è spesso vincolante. Sul piano tecnico quelle sedi reclutano su Greenhouse,
Workday, SuccessFactors e Ashby: gli ATS con la copertura migliore.

Il Regno Unito è collocato dopo l'UE perché, post-Brexit, richiede visto di lavoro.

## 5. Career Score 0–100

### Separazione tra giudizio e aritmetica

L'LLM valuta ogni dimensione e produce un sotto-punteggio 0–100 con motivazione,
seguendo `modes/_career-score.md`. `career-score.mjs` applica i pesi e calcola il totale
in modo deterministico.

Questa separazione rende il punteggio riproducibile, verificabile a mano e testabile —
proprietà che un numero prodotto direttamente dal modello non avrebbe.

### Dimensioni e pesi

| Dimensione | Peso | Cosa misura |
| --- | --- | --- |
| Professional fit | 25% | Compatibilità tra esperienza reale e requisiti |
| Career progression | 20% | Crescita, responsabilità, seniority, ingresso in AI Governance, esposizione internazionale |
| Compensation | 15% | Salario, bonus, equity, benefit, costo opportunità |
| AI relevance | 15% | Quanto il ruolo riguarda AI governance, AI Act, AI compliance, responsible AI, AI risk |
| Geography e modello di lavoro | 10% | Rispetto alla priorità geografica; remote, ibrido, relocation |
| Employer quality | 10% | Reputazione, dimensione, settore, stabilità, rilevanza internazionale |
| Strategic value | 5% | Valore del ruolo per la carriera futura |

### Salario non dichiarato

Quando l'offerta non riporta il salario — la maggioranza dei casi — il sistema marca
`salary_unknown: true`, **esclude la dimensione compensation e rinormalizza i pesi
restanti su 100**.

Assegnare un valore neutro sarebbe comunque una stima inventata, e il prompt lo vieta
esplicitamente. Con la rinormalizzazione l'offerta non è né premiata né penalizzata, e
il report dichiara che il punteggio è calcolato su sei dimensioni.

### Classificazione

| Classificazione | Soglia |
| --- | --- |
| APPLY | ≥ 75 |
| CONSIDER | 60–74 |
| LOW_PRIORITY | 45–59 |
| REJECT | < 45 |

Le soglie vivono in `config/profile.yml` e vanno calibrate dopo il primo run reale.

### Output per ogni offerta

Punteggio totale; classificazione; i sette sotto-punteggi con motivazione;
`salary_unknown`; `strengths`; `weaknesses`; `missing_requirements`; `red_flags`;
`reasoning` complessivo.

Il sistema deve spiegare perché, non limitarsi a dichiarare un numero.

## 6. Pipeline a tre livelli

**Tier 1 — deterministico, zero token.** `scan.mjs` legge `portals.yml` e interroga gli
ATS delle aziende curate. Segue la deduplicazione, che assegna un `job_id` stabile
combinando URL canonico, azienda, titolo normalizzato, location e identificativo
d'origine. `check-liveness.mjs` scarta le posizioni già chiuse. Infine filtri secchi su
geografia, seniority e keyword di esclusione. Nessuna chiamata LLM, nessun costo.

**Tier 2 — LLM economico.** `modes/triage.md` eseguito da `anthropic-eval.mjs` con
Claude Haiku 4.5, alimentato dal profilo compatto `modes/_brief.md` anziché dal CV
completo. Scarta le offerte palesemente fuori target.

**Tier 3 — LLM avanzato.** Solo sui sopravvissuti: valutazione completa `modes/oferta.md`
(blocchi A–G) più il Career Score, con Claude Sonnet 5. Un tetto massimo di offerte per
run, configurabile, impedisce che una giornata anomala consumi budget imprevisto.

Il provider è selezionabile da configurazione: default Anthropic, fallback OpenRouter.

## 7. Workflow GitHub Actions

`.github/workflows/job-search.yml`, con due modalità di avvio: cron giornaliero
`0 5 * * *` e `workflow_dispatch` manuale.

GitHub Actions interpreta il cron **solo in UTC**, senza gestire l'ora legale: le 05:00
UTC corrispondono alle 06:00 italiane in inverno e alle 07:00 in estate. Lo slittamento
è irrilevante per un job batch notturno e non giustifica soluzioni più complesse.

Parametri manuali: `dry_run` (esegue senza committare né spendere token), tetto sulle
offerte da valutare, sottoinsieme di portali da scansionare.

Sequenza: checkout; setup Node 18+; installazione dipendenze; lettura dei secrets;
discovery; deduplicazione; verifica liveness; triage; valutazione completa; Career Score;
generazione report; aggiornamento tracker; export Obsidian; commit dei dati; upload
artifact; riepilogo nella Step Summary.

**Commit diretti sul branch, senza pull request.** Questo evita il guard
`no-user-data.yml`, che scatta solo su eventi `pull_request`, ed elimina la necessità di
approvare una PR ogni mattina. Un `concurrency group` più `pipeline-lock.mjs` prevengono
la sovrapposizione di due run sugli stessi file.

Notifiche: artifact scaricabile più riepilogo nella GitHub Step Summary, visibile nella
pagina del run senza configurare nulla. Email e Telegram restano predisposti come
estensioni opzionali, non richiesti per il funzionamento.

## 8. Modello dei dati

Il prompt proponeva `data/jobs/`, `data/history/`, `data/reports/`, `data/applications/`.
Il repository ha già una struttura equivalente su cui poggiano tracker, dashboard, plugin
e decine di script; crearne una parallela produrrebbe due fonti di verità.

- `data/pipeline.md` — offerte scoperte, in attesa di valutazione
- `data/applications.md` — tabella canonica, una riga per offerta
- `reports/NNN-{azienda}-{data}.md` — valutazione completa, numerata atomicamente

Ogni offerta conserva `job_id`, titolo, azienda, location, URL, fonte, `discovered_at`,
`last_verified_at`, status, punteggio, classificazione, salario, descrizione, requisiti,
analisi LLM e stato della candidatura.

**Lo storico è il git log.** Ogni run committa, quindi la storia di quando un'offerta è
apparsa, come è stata valutata e come è cambiato il suo status è già completa e
navigabile, senza database aggiuntivi.

### Pipeline candidature

`DISCOVERED → EVALUATED → SHORTLISTED → APPLY → APPLIED → INTERVIEW → OFFER → REJECTED`,
mappata su `set-status.mjs` e `tracker.mjs`. Gli stati restano modificabili a mano.

## 9. Report giornaliero

Vanno distinti due artefatti diversi, entrambi sotto `reports/`:

- `reports/NNN-{azienda}-{data}.md` — la **valutazione di una singola offerta**, con
  numerazione progressiva atomica. È il formato già in uso nel repository.
- `reports/daily/YYYY-MM-DD.md` — il **digest giornaliero** prodotto da ogni run, che
  aggrega le migliori opportunità della giornata. È un file nuovo, introdotto da questo
  progetto, collocato in una sottocartella per non collidere con la numerazione
  progressiva esistente.

Il digest elenca, per ciascuna opportunità: punteggio e classificazione, titolo, azienda,
location, salario, URL, perché è interessante, punti di forza, gap principali, rischi e
raccomandazione. Quando un run non produce risultati, il digest viene comunque scritto e
lo dichiara esplicitamente — l'assenza di offerte è informazione, non un errore.

## 10. Obsidian

`obsidian-export.mjs` genera `obsidian/jobs/`, `companies/`, `applications/`, `reports/`
in Markdown con frontmatter (`job_id`, `company`, `title`, `location`, `score`,
`classification`, `source`, `url`, `discovered`) e sezioni Score, Why it fits,
Requirements, Gaps, Salary, Company, Notes, Application.

È un export derivato e rigenerabile: la verità resta in `data/` e `reports/`. Gira come
ultimo step del workflow ed è disattivabile da configurazione. Nessuna sincronizzazione
con servizi cloud: il sistema resta filesystem-based.

## 11. CV, cover letter, preparazione colloquio

Riusano i motori esistenti. Per un'offerta classificata `APPLY` è possibile generare in
`output/{job-id}/` il CV, la cover letter e l'analisi, e in `interview-prep/{job-id}.md`
la preparazione al colloquio: domande probabili, tecniche e legali, comportamentali,
specifiche sull'azienda, su AI Act, GDPR e cybersecurity, con risposte suggerite basate
esclusivamente sui dati reali del profilo.

Vincolo assoluto: non inventare esperienze, certificazioni o risultati, e non alterare i
fatti del CV. Si adatta solo la presentazione di esperienze reali.

## 12. Sicurezza

**Secrets:** `ANTHROPIC_API_KEY` e, opzionale, `OPENROUTER_API_KEY`. Nessuna credenziale
di job board, nessun cookie, nessuna sessione autenticata persistente — conseguenza
diretta dell'aver escluso le fonti che richiedono login.

Nessuna API key nel codice. Il `.gitignore` esistente copre `.env` e i file sensibili;
va esteso per le aggiunte. I log del workflow riportano titolo, azienda e punteggio, mai
il contenuto del CV.

**Human-in-the-loop strutturale.** Il sistema non contiene codice per inviare
candidature, scrivere a recruiter, accettare condizioni contrattuali o creare account.
Prepara, analizza, classifica, genera documenti e suggerisce. Il click resta all'utente.

## 13. Testing

Convenzione del repository: `*.test.mjs` accanto al file testato.

Copertura: calcolo dei pesi; rinormalizzazione quando manca il salario; soglie di
classificazione; parsing e validazione della risposta LLM; export Obsidian; validità
statica del workflow.

Fixture realistiche: offerta senza salario; senza location; duplicata su più fonti;
scaduta; in italiano; in inglese; in tedesco; con requisiti mancanti; con descrizione
molto lunga.

I test girano con uno script npm dedicato e nel workflow del progetto. Non vengono
innestati in `test-all.mjs`, file di sistema da 855 KB la cui modifica garantirebbe
conflitti a ogni aggiornamento upstream.

## 14. Documentazione

`docs/ARCHITECTURE.md`, `docs/SETUP.md` e `SECURITY.md` **esistono già** nell'upstream.
Sovrascriverli romperebbe l'aggiornabilità decisa in D5.

La documentazione del progetto vive quindi in `docs/career-intel/`: architettura, setup,
GitHub Actions, secrets, scoring, sicurezza, Obsidian, troubleshooting. `CAREER-INTEL.md`
in radice fa da punto d'ingresso. Il `README.md` upstream non viene toccato.

## 15. Fuori scope

LinkedIn e Indeed: richiedono autenticazione e il loro scraping viola i termini di
servizio; l'upstream li esclude dal core di proposito. Nessun invio automatico di
candidature o email. Nessun secondo database. Nessuna sincronizzazione con Google Drive.
Nessuna nuova dashboard web: ne esiste già una sotto `dashboard/`.

## 16. Rischi

1. **Copertura italiana limitata.** Le fonti curate su ATS intercettano le
   multinazionali, non il mercato legale italiano tradizionale — studi e aziende medie —
   che vive su LinkedIn e passaparola. Il sistema è un complemento alla ricerca manuale,
   non un sostituto. L'aggiunta di Dublino e Amsterdam mitiga il rischio in modo
   sostanziale, perché in quei mercati la copertura ATS è ottima.
2. **Volume atteso basso.** I ruoli AI Governance e DPO senior sono rari: sono attese
   poche offerte al giorno, talvolta nessuna. È il segno che i filtri funzionano.
3. **Qualità dipendente dal CV.** Finché `cv.md` non è completo e accurato, la dimensione
   più pesante dello scoring resta approssimativa.
4. **Costo da misurare.** La stima ragionevole è di pochi euro al mese grazie ai tier, ma
   va verificata sul primo run reale.
5. **Playwright in CI.** La generazione PDF richiede un browser headless; va verificata
   nel workflow o confinata all'esecuzione locale.

## 17. Input ancora mancanti

- **Il CV** — l'utente lo fornirà; va convertito in `cv.md`.
- **Identità professionale** — seniority, ruolo attuale, anni di esperienza, formazione,
  certificazioni, livello di inglese, autorizzazione al lavoro. Nella bozza sono ancora
  segnaposto.
- **Aspettativa salariale** — opzionale, ma migliora la dimensione compensation.
- **Lista aziende** — da costruire per `portals.yml` sui mercati target.

## 18. Ordine di implementazione suggerito

Il lavoro si presta a essere consegnato in incrementi verificabili, ciascuno dei quali
lascia il sistema funzionante:

1. **Fondamenta** — `config/local-paths.txt`, `.gitignore`, strato utente (`cv.md`,
   `config/profile.yml`, `modes/_profile.md`, `modes/_brief.md`).
2. **Discovery** — `portals.yml` con la lista curata di aziende; verifica che la
   scansione produca offerte reali. Interamente a costo zero.
3. **Scoring** — `modes/_career-score.md`, `career-score.mjs` e i relativi test.
4. **Motore LLM** — `anthropic-eval.mjs` con fallback OpenRouter.
5. **Automazione** — `.github/workflows/job-search.yml`, prima in `dry_run`, poi reale.
6. **Output** — digest giornaliero ed export Obsidian.
7. **Documentazione** — `docs/career-intel/` e `CAREER-INTEL.md`.

I passi 1 e 2 sono i più informativi rispetto al costo: verificano sul campo l'ipotesi
più incerta del progetto, cioè che le fonti disponibili producano davvero offerte
rilevanti per un profilo legal e compliance.

## 19. Definition of Done

Il progetto è completo quando: il sistema gira in locale; il workflow parte manualmente e
da cron; le offerte vengono scoperte, deduplicate e verificate; il Career Score 0–100
viene calcolato con classificazione APPLY / CONSIDER / LOW_PRIORITY / REJECT; il report
Markdown viene prodotto; lo storico è conservato; il profilo è separato dal codice;
nessun secret è nel repository; CV, cover letter e interview prep sono generabili;
l'export Obsidian funziona; nessuna candidatura parte automaticamente; i test passano; il
workflow è validato almeno staticamente e con un dry-run non distruttivo; la
documentazione è completa.
