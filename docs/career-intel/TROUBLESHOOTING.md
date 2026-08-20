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

## `🔎 REVIEW <url>` in run-evaluations.mjs — "estrazione automatica non riuscita"

Comportamento atteso, non un errore bloccante. `jd-extract.mjs` (Playwright headless)
non è riuscito a leggere l'annuncio — motivi tipici: annuncio scaduto (`http_gone`),
blocco anti-bot (`bot_challenge`), o contenuto insufficiente (`insufficient_content`).
L'URL viene registrata in `data/needs-manual-review.tsv` e comparirà nella sezione
"Da verificare manualmente" del prossimo digest giornaliero — controllarla a mano.

**Non impostare `CAREER_INTEL_ALLOW_URL_AS_TEXT=1` per "risolvere" questo messaggio.**
È un override esplicito per chi vuole deliberatamente forzare l'invio della URL nuda
come testo quando l'estrazione fallisce, non un fix — produce valutazioni allucinate.
Vedi `docs/career-intel/GITHUB_ACTIONS.md`.

Un URL già presente in `data/needs-manual-review.tsv` non viene ritentato in
automatico nei run successivi. Per farlo ritentare, rimuovere la riga corrispondente
dal file.

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
