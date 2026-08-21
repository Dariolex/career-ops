import { renderDigest, collectEntries, collectNeedsReview, collectTriageRejected } from './daily-digest.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

// --- Giornata senza risultati ---

const empty = renderDigest({ date: '2026-08-19', entries: [] });
ok('il digest vuoto riporta la data', empty.includes('2026-08-19'));
ok('il digest vuoto dichiara zero offerte', /nessuna offerta/i.test(empty));
ok('il digest vuoto non e una stringa vuota', empty.trim().length > 0);

// --- Giornata con risultati ---

const entries = [
  {
    total: 82, classification: 'APPLY',
    title: 'Data Protection Officer', company: 'Stripe',
    location: 'Dublin, Ireland', salary: null,
    url: 'https://example.com/dpo', renormalized: true,
    strengths: ['Esperienza GDPR diretta'], weaknesses: ['Nessuna gestione team'],
    redFlags: [], reasoning: 'Forte allineamento.',
  },
  {
    total: 64, classification: 'CONSIDER',
    title: 'Privacy Counsel', company: 'Adyen',
    location: 'Amsterdam, Netherlands', salary: '€90.000–110.000',
    url: 'https://example.com/pc', renormalized: false,
    strengths: ['Fintech regolamentata'], weaknesses: ['Meno componente AI'],
    redFlags: ['Richiesto olandese'], reasoning: 'Buon fit, minore rilevanza AI.',
  },
];

const digest = renderDigest({ date: '2026-08-19', entries });
ok('elenca il punteggio',             digest.includes('82/100'));
ok('elenca la classificazione',       digest.includes('APPLY'));
ok('elenca azienda e titolo',         digest.includes('Stripe') && digest.includes('Data Protection Officer'));
ok('elenca la sede',                  digest.includes('Dublin, Ireland'));
ok('elenca la URL',                   digest.includes('https://example.com/dpo'));
ok('segnala il salario mancante',     /non dichiarato/i.test(digest));
ok('mostra il salario quando c e',    digest.includes('€90.000–110.000'));
ok('elenca i punti di forza',         digest.includes('Esperienza GDPR diretta'));
ok('elenca i rischi',                 digest.includes('Richiesto olandese'));

// --- Ordinamento ---

const reversed = renderDigest({ date: '2026-08-19', entries: [entries[1], entries[0]] });
ok('ordina per punteggio decrescente',
  reversed.indexOf('Stripe') < reversed.indexOf('Adyen'));

// --- collectEntries(): estrazione da un vero file report, non da oggetti costruiti a mano ---
// Fixture nella forma esatta prodotta da anthropic-eval.mjs dopo il fix round finale:
// header + Blocchi A-G + ---SCORE_SUMMARY--- (con LOCATION/SALARY/URL/SOURCE) + ---CAREER_SCORE---.

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

const fixtureDir = mkdtempSync(join(tmpdir(), 'career-ops-daily-digest-'));
try {
  writeFileSync(join(fixtureDir, '001-stripe-dpo-2026-08-19.md'), FIXTURE_REPORT, 'utf-8');

  const collected = collectEntries('2026-08-19', fixtureDir);
  ok('collectEntries trova esattamente un report', collected.length === 1);
  const [entry] = collected;
  ok('collectEntries estrae il ruolo dal report reale',      entry?.title === 'Data Protection Officer');
  ok('collectEntries estrae azienda dal report reale',       entry?.company === 'Stripe');
  ok('collectEntries estrae la sede dal report reale',       entry?.location === 'Dublin, Ireland');
  ok('collectEntries estrae la URL dal report reale',        entry?.url === 'https://example.com/dpo');
  ok('collectEntries calcola il Career Score dal report reale', entry?.total > 0);
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

// --- needs-manual-review: collectNeedsReview + sezione nel digest ---

const needsReviewDir = mkdtempSync(join(tmpdir(), 'career-ops-needs-review-'));
try {
  const tsvPath = join(needsReviewDir, 'needs-manual-review.tsv');
  writeFileSync(tsvPath, [
    'https://example.com/job-a\t2026-08-19\tbot_challenge\tanti-bot challenge: just a moment',
    'https://example.com/job-b\t2026-08-18\thttp_gone\tHTTP 410',
    'https://example.com/job-c\t2026-08-19\tinsufficient_content\testratto troppo corto',
  ].join('\n') + '\n', 'utf-8');

  const todays = collectNeedsReview('2026-08-19', tsvPath);
  ok('collectNeedsReview filtra per data', todays.length === 2);
  ok('collectNeedsReview esclude righe di altre date', !todays.some(i => i.url === 'https://example.com/job-b'));
  ok('collectNeedsReview estrae il codice', todays.some(i => i.code === 'bot_challenge'));

  const emptyResult = collectNeedsReview('2026-08-19', join(needsReviewDir, 'assente.tsv'));
  ok('collectNeedsReview su file assente restituisce array vuoto', emptyResult.length === 0);

  const digestWithReview = renderDigest({ date: '2026-08-19', entries: [], needsReview: todays });
  ok('il digest include la sezione "Da verificare manualmente"', digestWithReview.includes('Da verificare manualmente'));
  ok('il digest elenca la URL da verificare', digestWithReview.includes('https://example.com/job-a'));

  const digestWithoutReview = renderDigest({ date: '2026-08-19', entries: [], needsReview: [] });
  ok('senza voci da verificare la sezione non appare', !digestWithoutReview.includes('Da verificare manualmente'));
} finally {
  rmSync(needsReviewDir, { recursive: true, force: true });
}

// --- triage-rejected: collectTriageRejected + sezione nel digest ---

const triageRejectedDir = mkdtempSync(join(tmpdir(), 'career-ops-triage-rejected-'));
try {
  const tsvPath = join(triageRejectedDir, 'triage-rejected.tsv');
  writeFileSync(tsvPath, [
    'https://example.com/job-basso\t2026-08-19\t2.1\tfuori archetipo',
    'https://example.com/job-vecchio\t2026-08-18\t1.5\tannuncio scaduto',
    'https://example.com/job-medio\t2026-08-19\t3.2\tadiacente ma non centrato',
  ].join('\n') + '\n', 'utf-8');

  const todaysRejected = collectTriageRejected('2026-08-19', tsvPath);
  ok('collectTriageRejected filtra per data', todaysRejected.length === 2);
  ok('collectTriageRejected esclude righe di altre date', !todaysRejected.some(i => i.url === 'https://example.com/job-vecchio'));
  ok('collectTriageRejected estrae il punteggio', todaysRejected.some(i => i.score === 3.2));

  const emptyRejected = collectTriageRejected('2026-08-19', join(triageRejectedDir, 'assente.tsv'));
  ok('collectTriageRejected su file assente restituisce array vuoto', emptyRejected.length === 0);

  const digestWithRejected = renderDigest({ date: '2026-08-19', entries: [], triageRejected: todaysRejected });
  ok('il digest include la sezione "Scartate dal triage"', digestWithRejected.includes('Scartate dal triage'));
  ok('il digest elenca la URL scartata', digestWithRejected.includes('https://example.com/job-basso'));
  ok('il digest ordina per punteggio decrescente', digestWithRejected.indexOf('3.2/5') < digestWithRejected.indexOf('2.1/5'));

  const digestWithoutRejected = renderDigest({ date: '2026-08-19', entries: [], triageRejected: [] });
  ok('senza scarti la sezione non appare', !digestWithoutRejected.includes('Scartate dal triage'));
} finally {
  rmSync(triageRejectedDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
