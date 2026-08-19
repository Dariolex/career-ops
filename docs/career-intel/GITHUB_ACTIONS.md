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
