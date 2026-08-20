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

## Estrazione JD reale (jd-extract.mjs)

`run-evaluations.mjs` non manda più la URL nuda all'LLM. Per ogni URL pendente in
`data/pipeline.md`, `jd-extract.mjs` apre la pagina con Playwright headless (stesso
motore già usato da `check-liveness.mjs`, nessuna dipendenza nuova), aspetta
l'hydration, ed estrae il testo reale dell'annuncio. Solo quel testo viene passato ad
`anthropic-eval.mjs` (via file temporaneo, non `--text`, per evitare limiti di
lunghezza della command line).

Riusa la stessa guardia SSRF e la stessa classificazione (`classifyLiveness`) già
validate da `check-liveness.mjs`: un annuncio scaduto, bloccato da anti-bot, o con
contenuto insufficiente non viene mai spedito all'LLM. Viene invece registrato in
`data/needs-manual-review.tsv` e segnalato nella sezione "Da verificare manualmente"
del digest giornaliero (`reports/daily/YYYY-MM-DD.md`) — così un annuncio che
l'automazione non riesce a leggere non sparisce in silenzio, va controllato a mano.
Un URL già segnalato non viene ritentato automaticamente nei run successivi (stessa
logica di `data/evaluated-urls.tsv`).

`CAREER_INTEL_ALLOW_URL_AS_TEXT=1` (env var, non un secret) resta una via di fuga
manuale: se impostata, quando l'estrazione fallisce lo script invia comunque la URL
nuda come testo invece di segnalare per revisione manuale. Non raccomandato — è per
chi vuole deliberatamente testare il vecchio comportamento.

## Dedup delle valutazioni

Ogni URL valutata con successo viene appesa a `data/evaluated-urls.tsv`
(`url\tdata ISO`). `run-evaluations.mjs` la consulta prima di ogni run e salta le URL
già presenti: senza questo, la stessa offerta verrebbe rivalutata (e rifatturata)
a ogni esecuzione, e la coda in `data/pipeline.md` non si svuoterebbe mai.
