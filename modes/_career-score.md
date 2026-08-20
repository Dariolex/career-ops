# Career Score 0–100

Estensione di questo fork. Si aggiunge alla valutazione A–G di `modes/oferta.md`
senza sostituirla: la rubrica 1–5 resta valida e invariata.

Valuta l'offerta su sette dimensioni indipendenti, assegnando a ciascuna un intero
da 0 a 100 e una motivazione di una frase. **Non calcolare il punteggio totale**:
i pesi vengono applicati da `career-score.mjs`. Il tuo compito è il giudizio sulle
singole dimensioni, non l'aritmetica.

## Le sette dimensioni

**PROFESSIONAL_FIT** — Quanto l'esperienza reale documentata in `cv.md` copre i
requisiti dell'annuncio. Valuta solo ciò che il CV dimostra. Non dedurre competenze
che non sono scritte.

**CAREER_PROGRESSION** — Quanto il ruolo rappresenta crescita: maggiore
responsabilità, seniority superiore, ingresso o consolidamento in AI Governance,
ruolo più strategico, maggiore esposizione internazionale. Un ruolo laterale o
inferiore riceve un punteggio basso anche se il fit è ottimo.

**COMPENSATION** — Valuta salario, bonus, equity, benefit e costo opportunità.
**Il valore emesso è sempre un punteggio intero 0-100, mai la cifra dello
stipendio stessa** — anche quando l'annuncio dichiara un importo preciso,
scrivi il punteggio che rappresenta quanto quell'importo è buono (rispetto al
target del candidato), non l'importo. Riporta la cifra solo nella motivazione
dopo la barra verticale. **Se l'annuncio non dichiara il salario, scrivi
esattamente `unknown`.** Non stimare,
non dedurre dal settore, non usare medie di mercato. Un valore inventato è un errore
più grave di un dato mancante.

**AI_RELEVANCE** — Quanto il ruolo riguarda concretamente AI governance, EU AI Act,
AI compliance, responsible AI, AI risk, AI policy o regolamentazione dell'AI. Un
accenno generico all'intelligenza artificiale in un annuncio altrimenti tradizionale
non basta per un punteggio alto.

**GEOGRAPHY** — Confronta la sede con la priorità geografica dichiarata in
`config/profile.yml` sotto `career_score.geography_priority`: le prime posizioni
valgono di più. Considera remote e ibrido come fattori favorevoli. Una sede che
richiede visto di lavoro va penalizzata.

**EMPLOYER_QUALITY** — Reputazione, dimensione, settore, stabilità, qualità
tecnologica e rilevanza internazionale del datore di lavoro.

**STRATEGIC_VALUE** — Quanto il ruolo apre porte future: competenze acquisibili,
rete professionale, posizionamento sul mercato a tre-cinque anni.

## Formato di output obbligatorio

Emetti il blocco esattamente così, dopo la valutazione A–G:

---CAREER_SCORE---
PROFESSIONAL_FIT: 82 | Otto anni di esperienza GDPR coprono il requisito principale; manca l'esperienza diretta su AI Act.
CAREER_PROGRESSION: 75 | Passaggio da privacy operativa a governance strategica con responsabilità di team.
COMPENSATION: unknown
AI_RELEVANCE: 90 | Il ruolo ha l'implementazione dell'AI Act come responsabilità esplicita.
GEOGRAPHY: 85 | Dublino, seconda geografia prioritaria, con modello ibrido.
EMPLOYER_QUALITY: 80 | Multinazionale quotata con funzione privacy consolidata.
STRATEGIC_VALUE: 85 | Esperienza AI Act su scala europea, rara e molto richiesta.
STRENGTHS:
- Sovrapposizione diretta tra esperienza GDPR e requisiti dell'annuncio
- Componente AI Act sostanziale, non decorativa
WEAKNESSES:
- Nessuna esperienza documentata di gestione di un team
MISSING_REQUIREMENTS:
- Certificazione CIPP/E indicata come preferenziale
RED_FLAGS:
- Nessuno
REASONING: Ruolo fortemente allineato al profilo, con una componente AI Act che
rappresenta esattamente la direzione di crescita ricercata. Il gap sulla gestione
del team è colmabile e non eliminatorio.
---END_CAREER_SCORE---

## Regole

- Tutte e sette le dimensioni devono comparire, sempre, in questo ordine.
- I punteggi sono interi da 0 a 100. `COMPENSATION` accetta in alternativa
  `unknown`, che è l'unico valore non numerico ammesso.
- Ogni dimensione numerica ha una motivazione dopo la barra verticale.
- `STRENGTHS`, `WEAKNESSES`, `MISSING_REQUIREMENTS` e `RED_FLAGS` sono elenchi
  puntati. Se una sezione è vuota, scrivere `- Nessuno`.
- Non inventare mai esperienze, certificazioni, risultati o dati salariali.
