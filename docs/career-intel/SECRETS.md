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

Chiavi API, password, cookie, token di sessione, credenziali OAuth. Il file `cv.md`
grezzo non viene mai stampato nei log. Lo step "Job summary" del workflow riporta però
il digest completo — titolo, azienda, punteggio e anche i testi di `reasoning` /
`strengths` / `weaknesses` prodotti dalla valutazione, che possono citare fatti tratti
dal CV (es. "10 anni di esperienza GDPR" se il CV lo dichiara). Il repository è privato,
quindi il rischio è basso, ma non è corretto dire che il contenuto del CV "non finisce
mai" nei log: alcuni fatti derivati ci finiscono, il testo integrale del file no.
