# Career Score 0–100

## Perché due sistemi di punteggio

`career-ops` valuta le offerte su una rubrica A–G con scala 1.0–5.0, cablata nel
tracker, nelle soglie di configurazione e in centinaia di test. Il Career Score non la
sostituisce: si aggiunge. La rubrica originale continua a funzionare, e chi aggiorna
dall'upstream non trova conflitti.

## Le dimensioni

| Dimensione | Peso |
| --- | --- |
| Professional fit | 25% |
| Career progression | 20% |
| Compensation | 15% |
| AI relevance | 15% |
| Geography e modello di lavoro | 10% |
| Employer quality | 10% |
| Strategic value | 5% |

## Chi decide cosa

L'LLM assegna i sette sotto-punteggi e le motivazioni, seguendo
`modes/_career-score.md`. `career-score.mjs` applica i pesi e calcola il totale.

La separazione è deliberata: un totale calcolato dal codice è riproducibile,
verificabile a mano e testabile. Un totale prodotto dal modello non lo sarebbe.

## Quando manca il salario

La maggior parte degli annunci non dichiara la retribuzione. In quel caso la dimensione
compensation viene **esclusa** e i pesi restanti rinormalizzati su 100.

L'alternativa — assegnare un valore neutro — sarebbe comunque una stima inventata. Con
la rinormalizzazione l'offerta non è né premiata né penalizzata, e il report dichiara
che il punteggio è calcolato su sei dimensioni anziché sette.

## Classificazione

| Classificazione | Soglia |
| --- | --- |
| APPLY | ≥ 75 |
| CONSIDER | 60–74 |
| LOW_PRIORITY | 45–59 |
| REJECT | < 45 |

Le soglie vivono in `config/profile.yml` sotto `career_score.thresholds` e vanno
calibrate sui dati reali dopo le prime settimane.
