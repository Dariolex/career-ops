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
