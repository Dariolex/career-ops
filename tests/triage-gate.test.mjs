// tests/triage-gate.test.mjs — il gate: parsing della riga TRIAGE, soglia,
// ordinamento e memoria degli scarti. Nessuna rete: runTriage e' iniettato.
import {
  buildTriageText, parseTriageLine, gateEntries, formatRejectedRow,
} from '../lib/triage-gate.mjs';
import { pass, fail } from './helpers.mjs';

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}

// --- parseTriageLine: il contratto di modes/triage.md ---
const stdout = `
🤖  Valutazione prodotta da anthropic/claude-haiku-4-5

TRIAGE: PASS | Acme Corp | Senior Privacy Counsel | 4.3/5 | Archetipo centrato, Dublino, comp sopra soglia
`;
const parsed = parseTriageLine(stdout);
check('verdetto', parsed.verdict, 'PASS');
check('azienda', parsed.company, 'Acme Corp');
check('ruolo', parsed.role, 'Senior Privacy Counsel');
check('punteggio', parsed.score, 4.3);
check('motivazione', parsed.reason, 'Archetipo centrato, Dublino, comp sopra soglia');

check('FAIL parsato', parseTriageLine('TRIAGE: FAIL | X | Y | 2.0/5 | fuori archetipo').verdict, 'FAIL');
check('SKIP con punteggio 0', parseTriageLine('TRIAGE: SKIP | X | Y | 0/5 | annuncio scaduto').score, 0);
check('output senza riga TRIAGE', parseTriageLine('il modello ha divagato'), null);
check('output vuoto', parseTriageLine(''), null);
check('non stringa', parseTriageLine(null), null);

// --- buildTriageText: i metadati, e nient'altro ---
const entry = {
  url: 'https://e.com/a', company: 'Acme', title: 'DPO',
  location: 'Milano', posted: '2026-08-01', compensation: '110000 EUR',
  scanLane: 'ats-sweep', note: '', trust: '', done: false,
};
const text = buildTriageText(entry);
if (text.includes('Acme') && text.includes('DPO') && text.includes('Milano')) pass('i metadati finiscono nel testo');
else fail(`metadati mancanti nel testo: ${text}`);
if (text.includes('https://e.com/a')) pass('URL incluso');
else fail('URL mancante');

// --- gateEntries: soglia, ordinamento, memoria ---
const entries = [
  { ...entry, url: 'https://e.com/basso', company: 'Basso' },
  { ...entry, url: 'https://e.com/alto', company: 'Alto' },
  { ...entry, url: 'https://e.com/medio', company: 'Medio' },
  { ...entry, url: 'https://e.com/gia-scartato', company: 'Vecchio' },
];
const risposte = {
  'https://e.com/basso': 'TRIAGE: FAIL | Basso | DPO | 2.1/5 | fuori archetipo',
  'https://e.com/alto': 'TRIAGE: PASS | Alto | DPO | 4.8/5 | centrato',
  'https://e.com/medio': 'TRIAGE: PASS | Medio | DPO | 3.6/5 | adiacente',
};
let chiamate = 0;
const runTriage = async (t) => {
  chiamate++;
  return risposte[t.match(/https?:\/\/\S+/)[0]] ?? 'TRIAGE: FAIL | ? | ? | 0/5 | nessuna risposta';
};

const esito = await gateEntries(entries, {
  threshold: 3.5,
  runTriage,
  alreadyRejected: new Set(['https://e.com/gia-scartato']),
});

check('gia scartata: non ri-triaggiata', chiamate, 3);
check('sopravvissute', esito.passed.length, 2);
check('ordinamento per punteggio decrescente', esito.passed[0].entry.company, 'Alto');
check('seconda in classifica', esito.passed[1].entry.company, 'Medio');
check('scartate', esito.rejected.length, 1);
check('la scartata e quella sotto soglia', esito.rejected[0].entry.company, 'Basso');
check('lo scarto porta la motivazione', esito.rejected[0].reason, 'fuori archetipo');

// Soglia a 0: gate passante, come previsto dal Task 0 se il volume misurato e' basso.
const passante = await gateEntries(entries.slice(0, 3), { threshold: 0, runTriage, alreadyRejected: new Set() });
check('soglia 0: nessuno scarto', passante.rejected.length, 0);

// Un errore di rete non e' un giudizio: l'offerta resta in coda, non viene scartata.
const esploso = await gateEntries([entries[0]], {
  threshold: 3.5,
  runTriage: async () => { throw new Error('rete giu'); },
  alreadyRejected: new Set(),
});
check('errore di rete: nessuno scarto', esploso.rejected.length, 0);
check('errore di rete: nessun passaggio', esploso.passed.length, 0);

// --- formatRejectedRow ---
check('riga TSV',
  formatRejectedRow(entries[0], 2.1, 'fuori archetipo', '2026-08-20'),
  'https://e.com/basso\t2026-08-20\t2.1\tfuori archetipo\n');
check('tab e newline neutralizzati nella motivazione',
  formatRejectedRow(entries[0], 2.1, 'motivo\tcon\ttab\ne newline', '2026-08-20'),
  'https://e.com/basso\t2026-08-20\t2.1\tmotivo con tab e newline\n');
