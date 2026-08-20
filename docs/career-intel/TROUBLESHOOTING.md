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

## `⚠ SKIP <url>` in run-evaluations.mjs — "no job-description text available"

Comportamento atteso, non un errore. Non esiste ancora una pipeline che scarica e
converte una posting URL in testo JD reale: senza guard, lo script manderebbe la nuda
URL all'LLM come se fosse la job description, producendo una valutazione allucinata
ma formattata con sicurezza, a spese di budget reale. `run-evaluations.mjs` si rifiuta
di farlo di default e salta l'URL con questo warning.

**Non impostare `CAREER_INTEL_ALLOW_URL_AS_TEXT=1` per "risolvere" questo messaggio.**
È un override esplicito per chi vuole testare deliberatamente il vecchio
comportamento (invio della URL nuda), non un fix. **Nessuna esecuzione live/non-dry-run
va tentata finché una vera pipeline di estrazione JD non sostituisce questo guard** —
è un prerequisito, non un nice-to-have. Vedi `docs/career-intel/GITHUB_ACTIONS.md`.

## Un'offerta non viene mai valutata, nemmeno con il guard disattivato

Controllare `data/evaluated-urls.tsv`: se l'URL è già presente, `run-evaluations.mjs`
la salta come già valutata (dedup, vedi `docs/career-intel/GITHUB_ACTIONS.md`). Per
forzare una rivalutazione, rimuovere manualmente la riga corrispondente da quel file.

## `unknown provider` in validate-portals

La voce `provider` di quell'azienda non corrisponde a nessun modulo in `providers/`.
Rimuovere la chiave `provider` e affidarsi a `careers_url`.

## L'aggiornamento upstream segnala conflitti

Non dovrebbe accadere: nessun file di sistema è modificato. Se accade, verificare che
il file in conflitto sia elencato in `config/local-paths.txt`, e che quel file non
appartenga già al system layer — in quel caso è stato modificato per errore e va
ripristinato.
