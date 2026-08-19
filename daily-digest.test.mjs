import { renderDigest } from './daily-digest.mjs';

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
