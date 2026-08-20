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

## Guard: nessuna estrazione JD reale, ancora (IMPORTANTE)

`run-evaluations.mjs` legge solo URL da `data/pipeline.md` — non esiste ancora una
pipeline che scarica e converte la posting in testo JD reale. Senza guard, lo script
manderebbe la nuda URL a `anthropic-eval.mjs --text <url>`, che la userebbe come se
fosse la job description: l'LLM produrrebbe una valutazione formattata con sicurezza
ma interamente allucinata, spendendo budget reale su output inventato.

Per questo `run-evaluations.mjs` rifiuta di default: se il "testo" da inviare è solo
l'URL nuda (nessun altro contenuto), la salta con un warning e passa alla successiva.
Solo impostando `CAREER_INTEL_ALLOW_URL_AS_TEXT=1` (env var, non un secret — non va
mai messo tra i secrets del repo) lo script torna al vecchio comportamento e invia
l'URL nuda comunque, con un warning aggiuntivo prima di farlo.

**Nessuna esecuzione live/non-dry-run va tentata finché una vera pipeline di
estrazione JD non sostituisce questo guard.** Questo non è un nice-to-have: eseguire
il workflow non in `dry_run` con `CAREER_INTEL_ALLOW_URL_AS_TEXT=1` prima che quella
pipeline esista significa pagare per valutazioni su testo che non è mai stato letto
dall'LLM — e i report prodotti (score, Career Score, tracker) sarebbero comunque
scritti nel repository come se fossero validi.

## Dedup delle valutazioni

Ogni URL valutata con successo viene appesa a `data/evaluated-urls.tsv`
(`url\tdata ISO`). `run-evaluations.mjs` la consulta prima di ogni run e salta le URL
già presenti: senza questo, la stessa offerta verrebbe rivalutata (e rifatturata)
a ogni esecuzione, e la coda in `data/pipeline.md` non si svuoterebbe mai.
