// tests/pipeline-line.test.mjs — il parser deve leggere esattamente cio' che il
// formatter scrive. Non si asserisce l'uguaglianza byte a byte con l'INPUT:
// formatPipelineOffer sanifica (i pipe diventano '/', gli URL vengono
// percent-encoded) e converte i tipi (salary oggetto -> stringa, postedAt epoch
// -> 'YYYY-MM-DD'), quindi un round-trip esatto sull'input non e' ottenibile ne'
// desiderabile. L'invariante che conta e' che il parser recuperi i campi che il
// formatter ha effettivamente emesso, su OGNI forma di riga.
import { formatPipelineOffer, parsePipelineLine } from '../scan.mjs';
import { pass, fail } from './helpers.mjs';

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}

// --- forma minima: solo URL, azienda, titolo ---
const minimal = { url: 'https://example.com/j/1', company: 'Acme', title: 'Privacy Counsel' };
const minimalLine = formatPipelineOffer(minimal);
const minimalParsed = parsePipelineLine(minimalLine);
check('minima: url', minimalParsed.url, 'https://example.com/j/1');
check('minima: company', minimalParsed.company, 'Acme');
check('minima: title', minimalParsed.title, 'Privacy Counsel');
check('minima: scanLane vuoto', minimalParsed.scanLane, '');
check('minima: done false', minimalParsed.done, false);

// --- retrocompatibilita': senza scanLane l'output non cambia di un byte ---
check('scanLane assente: output invariato', formatPipelineOffer({ ...minimal }), minimalLine);
check('scanLane stringa vuota: output invariato', formatPipelineOffer({ ...minimal, scanLane: '' }), minimalLine);

// --- forma completa: tutti i segmenti posizionali ed etichettati ---
const full = {
  url: 'https://example.com/j/2',
  company: 'Globex',
  title: 'DPO',
  location: 'Milano',
  salary: { min: 110000, max: 130000, currency: 'EUR' },
  postedAt: Date.parse('2026-08-01T00:00:00Z'),
  scanLane: 'ats-sweep',
  note: 'da lista curata',
};
const fullLine = formatPipelineOffer(full);
const fullParsed = parsePipelineLine(fullLine);
check('completa: company', fullParsed.company, 'Globex');
check('completa: title', fullParsed.title, 'DPO');
check('completa: location', fullParsed.location, 'Milano');
check('completa: compensation', fullParsed.compensation, '110000-130000 EUR');
check('completa: posted', fullParsed.posted, '2026-08-01');
check('completa: scanLane', fullParsed.scanLane, 'ats-sweep');
check('completa: note', fullParsed.note, 'da lista curata');

// --- note: resta l'ULTIMO segmento anche con scan: presente ---
const scanIdx = fullLine.indexOf('| scan:');
const noteIdx = fullLine.indexOf('| note:');
if (scanIdx !== -1 && noteIdx !== -1 && scanIdx < noteIdx) pass('scan: precede note:');
else fail(`scan: deve precedere note: — scan@${scanIdx}, note@${noteIdx}`);

// --- compensation senza location: la cella location resta vuota ma presente ---
const compParsed = parsePipelineLine(formatPipelineOffer({
  url: 'https://example.com/j/3', company: 'Initech', title: 'Counsel',
  salary: { min: 90000, currency: 'EUR' },
}));
check('comp senza location: location vuota', compParsed.location, '');
check('comp senza location: compensation', compParsed.compensation, '90000 EUR');

// --- scanLane tracked ---
check('scanLane tracked',
  parsePipelineLine(formatPipelineOffer({ ...minimal, scanLane: 'tracked' })).scanLane, 'tracked');

// --- righe che NON sono voci di pipeline ---
check('intestazione ignorata', parsePipelineLine('## Pending'), null);
check('riga vuota ignorata', parsePipelineLine(''), null);
check('prosa ignorata', parsePipelineLine('Paste job URLs below'), null);
check('non stringa ignorata', parsePipelineLine(null), null);
check('checkbox senza url ignorata', parsePipelineLine('- [ ] non un url'), null);

// --- riga gia' spuntata ---
const done = parsePipelineLine('- [x] https://example.com/j/4 | Acme | DPO');
check('riga spuntata: done true', done.done, true);
check('riga spuntata: url', done.url, 'https://example.com/j/4');

// --- riferimento local: (JD archiviate, vedi AGENTS.md § "JD captures") ---
check('riferimento local accettato',
  parsePipelineLine('- [ ] local:jds/acme-dpo.md | Acme | DPO')?.url, 'local:jds/acme-dpo.md');