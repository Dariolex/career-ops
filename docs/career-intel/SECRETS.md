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
