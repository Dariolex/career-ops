import { renderJobNote, collectJobNotes } from './obsidian-export.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

for (const section of ['## Score', '## Why it fits', '## Missing requirements', '## Gaps', '## Salary', '## Company', '## Notes', '## Application']) {
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

// yamlValue() deve fare l'escape dei backslash prima di quotare (es. path stile Windows).
const backslashy = renderJobNote({
  job_id: 'y', company: 'C:\\Users\\dario: Corp', title: 'Role', location: 'Milan',
  score: 50, classification: 'CONSIDER', source: 'lever', url: 'https://example.com',
  discovered: '2026-08-19', whyItFits: '', requirements: [], gaps: [], salary: null, notes: '',
});
ok('fa l\'escape dei backslash in un valore quotato',
  backslashy.includes('"C:\\\\Users\\\\dario: Corp"'));

// --- collectJobNotes(): estrazione da un vero file report, non da oggetti costruiti a mano ---
// Stessa fixture di daily-digest.test.mjs: header + Blocchi A-G + ---SCORE_SUMMARY---
// (con LOCATION/SALARY/URL/SOURCE) + ---CAREER_SCORE---, la forma reale prodotta da
// anthropic-eval.mjs dopo il fix round finale.

const FIXTURE_REPORT = `# Evaluation: Stripe — Data Protection Officer

**Date:** 2026-08-19
**URL:** https://example.com/dpo

## Block A — Role Summary

TL;DR: forte fit GDPR.

## Block B — Match with CV

Requisiti mappati.

## Block C — Level and Strategy

Livello senior confermato.

## Block D — Comp and Demand

Stima basata su training data.

## Block E — Customization Plan

Piano di personalizzazione.

## Block F — Interview Plan

Piano colloqui.

## Block G — Posting Legitimacy

Nessuna anomalia.

---SCORE_SUMMARY---
COMPANY: Stripe
ROLE: Data Protection Officer
SCORE: 4.1
ARCHETYPE: Governance
LEGITIMACY: High Confidence
LOCATION: Dublin, Ireland
SALARY: Not stated
URL: https://example.com/dpo
SOURCE: example.com
---END_SUMMARY---

---CAREER_SCORE---
PROFESSIONAL_FIT: 85 | Esperienza GDPR diretta.
CAREER_PROGRESSION: 70 | Passaggio naturale.
COMPENSATION: unknown
AI_RELEVANCE: 60 | Componente AI Act presente.
GEOGRAPHY: 90 | Dublino, remoto.
EMPLOYER_QUALITY: 85 | Multinazionale quotata.
STRATEGIC_VALUE: 70 | Competenza richiesta.
STRENGTHS:
- Esperienza GDPR diretta
WEAKNESSES:
- Nessuna gestione team
MISSING_REQUIREMENTS:
- Certificazione CIPP/E
RED_FLAGS:
- Nessuno
REASONING: Forte allineamento con il profilo.
---END_CAREER_SCORE---
`;

const fixtureDir = mkdtempSync(join(tmpdir(), 'career-ops-obsidian-export-'));
try {
  writeFileSync(join(fixtureDir, '001-stripe-dpo-2026-08-19.md'), FIXTURE_REPORT, 'utf-8');

  const jobs = collectJobNotes(fixtureDir);
  ok('collectJobNotes trova esattamente un report', jobs.length === 1);
  const [job] = jobs;
  ok('collectJobNotes deriva il job_id da azienda e ruolo',
    job?.job_id === 'stripe-data-protection-officer');
  ok('collectJobNotes estrae azienda dal report reale',   job?.note.includes('company: Stripe'));
  ok('collectJobNotes estrae il ruolo dal report reale',  job?.note.includes('title: Data Protection Officer'));
  ok('collectJobNotes estrae la sede dal report reale',   job?.note.includes('location: Dublin, Ireland'));
  ok('collectJobNotes estrae la URL dal report reale',    job?.note.includes('https://example.com/dpo'));
  ok('collectJobNotes estrae la fonte dal report reale',  job?.note.includes('source: example.com'));
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
