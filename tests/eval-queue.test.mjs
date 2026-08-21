// tests/eval-queue.test.mjs — la coda di valutazione: quali righe di
// pipeline.md entrano, e da che parte del gate finiscono.
import { loadPendingEntries, partitionByLane, remainingWeeklyBudget } from '../run-evaluations.mjs';
import { pass, fail } from './helpers.mjs';

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}

const FILE = `# Pipeline — Pending URLs

Paste job URLs below as \`- [ ] {url}\` then run \`/career-ops pipeline\`.

## Pending

- [ ] https://example.com/a | Acme | DPO | Milano | posted: 2026-08-01 | scan: tracked
- [ ] https://example.com/b | Globex | Privacy Counsel | Dublino | scan: ats-sweep
- [ ] https://example.com/c | Initech | Legal Counsel

## Processed

- [x] https://example.com/vecchia | Umbrella | DPO | scan: ats-sweep
`;

const entries = loadPendingEntries(FILE);
check('legge solo ## Pending', entries.length, 3);
check('non pesca da ## Processed', entries.some(e => e.url.includes('vecchia')), false);

const { tracked, sweep } = partitionByLane(entries);
check('una sola offerta da sweep', sweep.length, 1);
check('la sweep e quella giusta', sweep[0].url, 'https://example.com/b');
check('due offerte tracked', tracked.length, 2);

// La regola di default della spec: marcatore assente = tracked, quindi bypassa
// il gate. Assente significa "non so", e di fronte a "non so" il sistema spende
// di piu', non di meno: un'offerta non marcata — una riga incollata a mano, una
// riga scritta prima di questa modifica — non deve poter sparire sotto un
// modello economico senza motivo visibile.
if (tracked.some(e => e.url === 'https://example.com/c')) pass('marcatore assente trattato come tracked');
else fail('marcatore assente: deve finire tra le tracked, non tra le sweep');

check('file senza ## Pending', loadPendingEntries('# Vuoto\n').length, 0);
check('stringa vuota', loadPendingEntries('').length, 0);

// --- budget a finestra mobile di 7 giorni ---
const OGGI = '2026-08-20';
const TSV = [
  'https://e.com/1\t2026-08-20',
  'https://e.com/2\t2026-08-19',
  'https://e.com/3\t2026-08-14', // 6 giorni fa: dentro la finestra
  'https://e.com/4\t2026-08-13', // 7 giorni fa: fuori
  'https://e.com/5\t2026-07-01', // molto vecchia: fuori
].join('\n');

check('conta solo gli ultimi 7 giorni', remainingWeeklyBudget(TSV, 25, OGGI), 22);
check('budget esaurito non va sotto zero', remainingWeeklyBudget(TSV, 2, OGGI), 0);
check('tsv vuoto: budget pieno', remainingWeeklyBudget('', 25, OGGI), 25);
check('righe malformate ignorate', remainingWeeklyBudget('spazzatura\n\n', 25, OGGI), 25);