import { renderJobNote } from './obsidian-export.mjs';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

const note = renderJobNote({
  job_id: 'stripe-dpo-2026-08-19',
  company: 'Stripe',
  title: 'Data Protection Officer',
  location: 'Dublin, Ireland',
  score: 82,
  classification: 'APPLY',
  source: 'greenhouse',
  url: 'https://example.com/dpo',
  discovered: '2026-08-19',
  whyItFits: 'Allineamento diretto con esperienza GDPR.',
  requirements: ['8+ anni di privacy', 'CIPP/E preferenziale'],
  gaps: ['Nessuna gestione team'],
  salary: null,
  notes: '',
});

ok('inizia con il frontmatter',      note.startsWith('---\n'));
ok('contiene il job_id',             note.includes('job_id: stripe-dpo-2026-08-19'));
ok('contiene azienda e titolo',      note.includes('company: Stripe') && note.includes('title: Data Protection Officer'));
ok('contiene il punteggio',          note.includes('score: 82'));
ok('contiene la classificazione',    note.includes('classification: APPLY'));
ok('contiene la fonte',              note.includes('source: greenhouse'));
ok('contiene la data di scoperta',   note.includes('discovered: 2026-08-19'));
ok('chiude il frontmatter',          note.split('---').length >= 3);

for (const section of ['## Score', '## Why it fits', '## Requirements', '## Gaps', '## Salary', '## Company', '## Notes', '## Application']) {
  ok(`contiene la sezione ${section}`, note.includes(section));
}

ok('elenca i requisiti',             note.includes('8+ anni di privacy'));
ok('elenca i gap',                   note.includes('Nessuna gestione team'));
ok('dichiara il salario mancante',   /non dichiarat/i.test(note));

// I valori con due punti romperebbero il frontmatter YAML se non quotati.
const risky = renderJobNote({
  job_id: 'x', company: 'Acme: Legal', title: 'Counsel: Privacy',
  location: 'Milan', score: 50, classification: 'CONSIDER',
  source: 'lever', url: 'https://example.com', discovered: '2026-08-19',
  whyItFits: '', requirements: [], gaps: [], salary: null, notes: '',
});
ok('quota i valori che contengono due punti', risky.includes('"Acme: Legal"'));
ok('quota anche il titolo',                   risky.includes('"Counsel: Privacy"'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
