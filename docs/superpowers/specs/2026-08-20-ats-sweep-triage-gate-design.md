# Sweep ATS settimanale con gate di triage

**Data:** 2026-08-20
**Stato:** approvato, in attesa di piano di implementazione

## Problema

Lo scan giornaliero copre 14 aziende curate e negli ultimi sei run ha aggiunto
0-1 offerte nuove: dopo il primo passaggio non c'è più niente da vedere. Il
resto del mercato — 38.854 board ATS pubbliche — non viene mai guardato.

`scan-ats-full.mjs` esiste, funziona e sa spazzare quel mercato applicando gli
stessi filtri di `portals.yml`, ma nel workflow è dietro
`if: inputs.full_sweep == true`: solo dispatch manuale, mai il cron.

Accenderlo così com'è però peggiorerebbe la situazione, per una ragione trovata
durante l'analisi e non prevista quando la modifica è stata proposta:

**`run-evaluations.mjs` non ha uno stadio di triage.** Prende
`candidateUrls.slice(0, max)` (riga 97) — le prime 15 in ordine di file, non le
migliori — e le manda tutte a valutazione completa Sonnet con
`maxTokens: 24000`. Il tier `triage` (Haiku, `modes/_brief.md`) è definito in
`anthropic-eval.mjs:43` ma non viene mai invocato dal runner headless:
`triage_threshold` e `triage_min_urls` di `config/profile.yml` sono consumati
solo dalla modalità interattiva.

Uno sweep che riversa N match in `pipeline.md` verrebbe quindi drenato 15 al
giorno, in ordine arbitrario, tutti a prezzo pieno. Le offerte migliori
potrebbero stare in posizione 200 ed essere valutate due settimane dopo, quando
l'annuncio è morto.

## Decisioni

| Domanda | Scelta |
|---|---|
| Volume di offerte valutate a settimana | 15-30 (implica un gate) |
| Cadenza | Ibrida: tracked giornaliero, mercato settimanale |
| Ambito del gate | Solo le offerte provenienti dallo sweep |
| Base di giudizio del gate | Solo metadati, senza scaricare la JD |

## Vincoli misurati

Dataset ATS, misurato il 2026-08-20:

| Sorgente | Board | Concorrenza |
|---|---|---|
| Workday | 12.884 | 20 |
| iCIMS | 10.108 | 20 |
| Greenhouse | 8.333 | 6 (single-host) |
| Lever | 4.368 | 6 (single-host) |
| Ashby | 3.161 | 6 (single-host) |
| **Totale** | **38.854** | |

Altri vincoli rilevanti:

- Il job `job-search.yml` ha `timeout-minutes: 45`; i runner GitHub-hosted
  fermano un job a 6 ore.
- `scan-ats-full.mjs` fa checkpoint ogni 500 aziende in
  `data/cache/ats-full-checkpoint.json`, che non viene committato: un job
  ucciso dal timeout perde il checkpoint e `--resume` non ha cosa riprendere.
- `--resume` richiede flag identici a quelli del checkpoint e non è compatibile
  con `--shuffle`.
- Il dataset delle aziende è in cache 24h (`CACHE_TTL_HOURS`).
- **Throttling con perdita silenziosa:** il codice documenta che due sweep a
  un'ora di distanza hanno portato gli irraggiungibili di Lever da 2.436 a
  4.100 e quelli di Ashby da 683 a 1.675, con recupero a 2.525 / 684 dopo una
  pausa e nessun cambiamento nel dataset. Le board erano vive: sono state
  rifiutate, e i match su di esse persi senza errore.
- `jd-extract.mjs:110` `extractJobDescription` usa **sempre** Playwright, senza
  fast-path HTTP, e il runner tiene un solo browser riusato in sequenza, mai in
  parallelo. Il recupero della JD, non i token, è il collo di bottiglia in
  wall-clock.

## Design

### 1. Contratto dati: marcatore di corsia e parser

> **Correzione applicata in fase di piano.** Questa sezione diceva `source`.
> Il campo `offer.source` **esiste già ed è portante**: `scan.mjs:2702` lo mette
> a `sourceName`, `scan-ats-full.mjs:742` a `` `${sourceName}-full` ``, e
> `formatScanHistoryRow` (`scan.mjs:1794`) lo scrive nella colonna `portal` di
> `data/scan-history.tsv`, dove oggi si leggono valori come `greenhouse-api`.
> Riusarlo romperebbe quella colonna. Scartati per la stessa ragione anche
> `tracked` (esiste, `scan.mjs:2703`, con il significato di eleggibilità al
> rediscovery fallback), `lane` e `discovery` (il vocabolario del progetto li
> usa già per altro). Il campo è quindi **`scanLane`**, con etichetta markdown
> **`scan:`**.

`scanLane` è un campo dell'oggetto offerta, come `note`: una stringa, nessun
branch specifico dentro il formatter, coerente con il commento esistente su
`note` (*"it stays generic: nothing here is source-specific"*).

`formatPipelineOffer` (`scan.mjs:1750`) emette `| scan: {valore}` **dopo
`trust:` e prima di `note:`**, così `note:` resta l'ultimo segmento: è testo
libero e deve poter contenere qualsiasi cosa senza ambiguità di parsing.
Un'offerta senza `scanLane` produce output byte-identico a oggi.

- `scan.mjs` scrive `scan: tracked`
- `scan-ats-full.mjs` scrive `scan: ats-sweep` (importa già `appendToPipeline`
  da `scan.mjs`, riga 46: il writer è condiviso)

**Regola di default:** marcatore assente = trattata come `tracked`, quindi
bypassa il gate. Vale per le righe già presenti in `pipeline.md` e per quelle
scritte a mano. Il default opposto sarebbe silenzioso: un'offerta non marcata
finirebbe sotto il gate e potrebbe sparire senza motivo visibile. Assente
significa "non so", e di fronte a "non so" il sistema spende di più, non di
meno.

**Parser.** `extractPipelineCompanyRole` (`scan.mjs:1229`) è interno ed estrae
solo company/ruolo. Si aggiunge accanto a `formatPipelineOffer` un
`parsePipelineLine(line)` esportato, suo inverso, che restituisce
`{url, company, title, location, compensation, posted, trust, source, note}`.
Adiacenti perché formato e parsing non possano divergere.

`run-evaluations.mjs` smette di usare `text.match(/https?:\/\/\S+/g)` (righe
54-60) e usa il parser. Effetto collaterale corretto qui: quel regex raccoglie
oggi gli URL da tutto il file, inclusa la sezione `## Processed`, e funziona
solo perché `evaluated-urls.tsv` li riscarta a valle. Con il parser si legge
solo `## Pending`.

### 2. Workflow di sweep: una sorgente ATS al giorno

Workflow nuovo e separato: `.github/workflows/ats-sweep.yml`.

Una sorgente per giorno feriale — lunedì Greenhouse, martedì Lever, mercoledì
Ashby, giovedì Workday, venerdì iCIMS — calcolata da `date -u +%u`. Weekend
fermo.

Ogni board resta spazzata una volta a settimana, quindi la copertura è quella
di uno sweep settimanale completo, ma ogni run è breve e autonomo. Questo
elimina il rischio di timeout, la necessità di `--resume` e il problema della
persistenza del checkpoint fra run. Il giorno più pesante è Greenhouse, 8.333
board a concorrenza 6.

Riduce anche il throttling documentato sopra: Greenhouse, Lever e Ashby stanno
ciascuno dietro un unico host, e dando a ognuno il suo giorno nessuno viene
colpito due volte ravvicinate.

Parametri:

- `--since 8`: il ciclo è di 7 giorni, l'ottavo è margine.
- `concurrency: group: job-search`, condiviso con il workflow giornaliero, così
  non si scrive mai su `data/` in parallelo.
- Cron alle 07:00 UTC, dopo che il job delle 05:00 ha finito.
- Input `dry_run` come nel workflow giornaliero.
- Commit con la stessa lista esplicita di path già in uso.

**Visibilità del degrado:** il conteggio delle board irraggiungibili va nel job
summary. Uno sweep strozzato perde match in silenzio, quindi deve sembrare
degradato e non vuoto.

### 3. Gate e budget

**Stadio 1 — gate e ranking sui soli metadati.** `pipeline.md` porta già URL,
azienda, titolo, località e data. Le offerte `ats-sweep` in coda vengono
giudicate dal tier `triage` (Haiku, `modes/_brief.md`) sui soli metadati:
nessun fetch, nessun Playwright.

> **Correzione applicata in fase di piano.** Questa sezione prevedeva **una
> sola chiamata** con i metadati di tutte le offerte. `modes/triage.md`
> definisce però già un contratto machine-readable **per singolo annuncio** —
> `TRIAGE: {PASS|MARGINAL|FAIL|SKIP} | {Company} | {Role} | {Score}/5 | {reason}`,
> con scritto *"the caller parses them"* — e `anthropic-eval.mjs` espone già
> `--tier triage`. Il piano usa quindi **una chiamata per offerta** riusando
> quel contratto: nessun secondo formato di triage da mantenere in parallelo al
> primo, e una risposta malformata perde un'offerta invece di tutte. Costo: con
> `_brief.md` a ~700 token, 100 offerte fanno circa 70k token di input su un
> modello economico, in sequenza 2-3 minuti.

**Scala del punteggio:** 0-5 con un decimale, la stessa già usata dalla
modalità interattiva, e la soglia riusa la chiave esistente
`pipeline.triage_threshold` di `config/profile.yml` (oggi `3.5`) invece di
introdurne una nuova. Nessuna scala nuova, nessuna chiave nuova.

Il punteggio prodotto è anche il criterio di ordinamento: `slice(0, max)` smette
di prendere le prime in ordine di file e prende le migliori.

**Stadio 2 — valutazione.** Fetch Playwright e valutazione Sonnet solo sui
sopravvissuti, nell'ordine dato dal punteggio. Le offerte `tracked` saltano lo
stadio 1 e si inseriscono in testa allo stadio 2.

**Taratura della soglia:** permissiva. Un falso positivo costa una valutazione,
un falso negativo costa un'opportunità. Giudicare dai metadati è più debole che
leggere la JD e un ruolo valido con un titolo anonimo può essere scartato: la
soglia deve sbagliare per eccesso.

**Log degli scarti:** ogni offerta scartata dal gate finisce in
`data/triage-rejected.tsv` (`{url}\t{data}\t{punteggio}\t{motivazione}`) con un
riassunto nel digest giornaliero. Senza questo il sistema realizzerebbe la
sparizione silenziosa che il design vuole evitare.

Il file ha una seconda funzione, necessaria: **è la memoria degli scarti**.
Un'offerta scartata resta in `pipeline.md`, quindi senza questo controllo
verrebbe ri-triaggiata a ogni run giornaliero, all'infinito. Il runner salta gli
URL già presenti nel file, esattamente come già fa con `evaluated-urls.tsv` e
`needs-manual-review.tsv`. Ne segue anche il modo di annullare una decisione:
togliere la riga dal TSV rimette l'offerta in gioco al run successivo.

**Budget.** `max_full_evaluations: 15` è per run e il cron è giornaliero: fino a
105 a settimana contro le 15-30 richieste. `evaluated-urls.tsv` contiene già la
data di ogni valutazione (`{url}\t{date}`), quindi il budget diventa una
finestra mobile di 7 giorni letta da lì: `weekly_full_evaluations: 25` in
`config/profile.yml`, con il tetto per-run come seconda sicurezza. Nessuno stato
nuovo da mantenere.

## Verifica

**Passo zero, prima di scrivere il gate:** misurare il volume reale con
`scan-ats-full.mjs --dry-run --since 8 --ats greenhouse --limit 1500` e
l'equivalente su Lever. Non scrive nulla e dice quanti match produce davvero il
`title_filter` su un campione noto, da cui estrapolare il volume settimanale. Se
il volume è basso la soglia va messa a zero; se è alto la taratura è il punto.
La soglia non va scelta prima di conoscere quel numero.

**Test**, secondo la disciplina esistente (21 file di test, `test-all.mjs`,
scritti prima dell'implementazione):

- **Round-trip**, il test che regge tutto il resto:
  `parsePipelineLine(formatPipelineOffer(x))` restituisce `x` su ogni forma di
  riga — URL nudo, 3, 4 e 5 colonne, con e senza `posted:`, `trust:`, `source:`,
  `note:`. È l'invariante che impedisce a formato e parser di divergere.
- Output byte-identico quando `source` è assente.
- `source` mancante trattata come `tracked`.
- Lettura della sola sezione `## Pending`.
- Finestra mobile di 7 giorni sulle date di `evaluated-urls.tsv`.
- Partizionamento tracked/sweep, soglia e ordinamento.
- Memoria degli scarti: un URL già in `data/triage-rejected.tsv` non viene
  ri-triaggiato al run successivo, e torna in gioco se la riga viene rimossa.

La chiamata di triage riceve il client come dipendenza iniettabile: i test
girano senza rete.

**Vincolo di runtime:** in locale gira Node v24.19.0, ma `job-search.yml:43`
fissa `node-version: '20'`. Il codice nuovo deve essere valido su Node 20, che è
la versione di produzione.

Il workflow di sweep non è testabile in CI: va lanciato a mano con
`workflow_dispatch`, una sorgente alla volta, prima di abilitare il cron.

## Ordine di realizzazione

Questa sequenza non va invertita.

1. **Marcatore e parser**, senza cambio di comportamento: i due scanner scrivono
   `source:`, il runner lo ignora ancora.
2. **Runner al parser**: partizionamento e budget settimanale, ancora senza
   gate.
3. **Gate, ranking e log degli scarti.**
4. **Workflow di sweep**, prima a mano con `workflow_dispatch` una sorgente alla
   volta, poi con il cron.

Accendere lo sweep prima che il gate esista ricreerebbe il problema di partenza:
la coda si riempie e si drena a 15 al giorno in ordine arbitrario.

**Rollback:** ogni passo è un commit separato. L'unico effetto verso l'esterno è
il workflow nuovo, che si disattiva togliendo il `cron`.
