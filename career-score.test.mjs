import {
  WEIGHTS, DEFAULT_THRESHOLDS, parseCareerScoreBlock,
  computeCareerScore, classify, evaluateCareerScore,
} from './career-score.mjs';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

// --- Pesi ---

ok('i pesi sommano a 100', Object.values(WEIGHTS).reduce((a, b) => a + b, 0) === 100);
ok('professional_fit pesa 25', WEIGHTS.professional_fit === 25);
ok('strategic_value pesa 5', WEIGHTS.strategic_value === 5);

// --- Calcolo con tutte le dimensioni ---
// 80*.25 + 70*.20 + 60*.15 + 90*.15 + 50*.10 + 80*.10 + 60*.05
// = 20 + 14 + 9 + 13.5 + 5 + 8 + 3 = 72.5

const complete = {
  professional_fit:   { score: 80, reasoning: 'x' },
  career_progression: { score: 70, reasoning: 'x' },
  compensation:       { score: 60, reasoning: 'x' },
  ai_relevance:       { score: 90, reasoning: 'x' },
  geography:          { score: 50, reasoning: 'x' },
  employer_quality:   { score: 80, reasoning: 'x' },
  strategic_value:    { score: 60, reasoning: 'x' },
};

const full = computeCareerScore(complete);
ok('il totale grezzo e 72.5', Math.abs(full.raw - 72.5) < 0.001);
ok('il totale arrotondato e 73', full.total === 73);
ok('senza dimensioni mancanti non rinormalizza', full.renormalized === false);
ok('usa tutti i 100 punti di peso', full.weightsUsed === 100);

// --- Rinormalizzazione quando manca il salario ---
// Somma pesata senza compensation = 63.5 su un peso totale di 85
// 63.5 / 85 * 100 = 74.7059

const noSalary = { ...complete, compensation: { score: null, reasoning: 'unknown' } };
const partial = computeCareerScore(noSalary);
ok('rinormalizza quando manca il salario', partial.renormalized === true);
ok('usa 85 punti di peso', partial.weightsUsed === 85);
ok('il totale grezzo e 74.71', Math.abs(partial.raw - 74.7059) < 0.001);
ok('il totale arrotondato e 75', partial.total === 75);
ok('la rinormalizzazione non penalizza il salario mancante', partial.total > full.total);

// --- Classificazione: confini esatti ---

ok('75 e APPLY',           classify(75, DEFAULT_THRESHOLDS) === 'APPLY');
ok('100 e APPLY',          classify(100, DEFAULT_THRESHOLDS) === 'APPLY');
ok('74 e CONSIDER',        classify(74, DEFAULT_THRESHOLDS) === 'CONSIDER');
ok('60 e CONSIDER',        classify(60, DEFAULT_THRESHOLDS) === 'CONSIDER');
ok('59 e LOW_PRIORITY',    classify(59, DEFAULT_THRESHOLDS) === 'LOW_PRIORITY');
ok('45 e LOW_PRIORITY',    classify(45, DEFAULT_THRESHOLDS) === 'LOW_PRIORITY');
ok('44 e REJECT',          classify(44, DEFAULT_THRESHOLDS) === 'REJECT');
ok('0 e REJECT',           classify(0, DEFAULT_THRESHOLDS) === 'REJECT');
ok('le soglie sono configurabili', classify(50, { apply: 40, consider: 30, low_priority: 20 }) === 'APPLY');

// --- Parsing ---

const validBlock = `
Testo che precede il blocco e va ignorato.

---CAREER_SCORE---
PROFESSIONAL_FIT: 82 | Esperienza GDPR solida.
CAREER_PROGRESSION: 75 | Passaggio a governance strategica.
COMPENSATION: unknown
AI_RELEVANCE: 90 | AI Act come responsabilita esplicita.
GEOGRAPHY: 85 | Dublino, ibrido.
EMPLOYER_QUALITY: 80 | Multinazionale quotata.
STRATEGIC_VALUE: 85 | Competenza rara e richiesta.
STRENGTHS:
- Sovrapposizione diretta con i requisiti
- Componente AI Act sostanziale
WEAKNESSES:
- Nessuna esperienza di gestione team
MISSING_REQUIREMENTS:
- Certificazione CIPP/E preferenziale
RED_FLAGS:
- Nessuno
REASONING: Ruolo fortemente allineato al profilo.
---END_CAREER_SCORE---
`;

const parsed = parseCareerScoreBlock(validBlock);
ok('legge un punteggio numerico',        parsed.dimensions.professional_fit.score === 82);
ok('legge la motivazione',               parsed.dimensions.professional_fit.reasoning === 'Esperienza GDPR solida.');
ok('unknown diventa null',               parsed.dimensions.compensation.score === null);
ok('segnala il salario mancante',        parsed.salaryUnknown === true);
ok('legge tutte le sette dimensioni',    Object.keys(parsed.dimensions).length === 7);
ok('legge i punti di forza',             parsed.strengths.length === 2);
ok('legge le debolezze',                 parsed.weaknesses.length === 1);
ok('legge i requisiti mancanti',         parsed.missingRequirements.length === 1);
ok('normalizza "Nessuno" a lista vuota', parsed.redFlags.length === 0);
ok('legge il ragionamento',              /fortemente allineato/.test(parsed.reasoning));

// --- Parsing: input non validi ---

function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

ok('rifiuta un testo senza blocco', throws(() => parseCareerScoreBlock('nessun blocco qui')));
ok('rifiuta un blocco incompleto', throws(() => parseCareerScoreBlock(
  '---CAREER_SCORE---\nPROFESSIONAL_FIT: 80 | x\n---END_CAREER_SCORE---')));
ok('rifiuta un punteggio fuori scala', throws(() => parseCareerScoreBlock(
  validBlock.replace('PROFESSIONAL_FIT: 82', 'PROFESSIONAL_FIT: 180'))));
ok('rifiuta un punteggio non numerico', throws(() => parseCareerScoreBlock(
  validBlock.replace('GEOGRAPHY: 85', 'GEOGRAPHY: alto'))));
ok('rifiuta unknown fuori da compensation', throws(() => parseCareerScoreBlock(
  validBlock.replace('GEOGRAPHY: 85 | Dublino, ibrido.', 'GEOGRAPHY: unknown'))));

// --- Integrazione ---

const evaluated = evaluateCareerScore(validBlock, { thresholds: DEFAULT_THRESHOLDS });
// 82*.25 + 75*.20 + 90*.15 + 85*.10 + 80*.10 + 85*.05
// = 20.5 + 15 + 13.5 + 8.5 + 8 + 4.25 = 69.75 su 85 -> 82.06
ok('valuta il blocco completo',   evaluated.total === 82);
ok('classifica come APPLY',       evaluated.classification === 'APPLY');
ok('riporta la rinormalizzazione', evaluated.renormalized === true);
ok('propaga il salario mancante',  evaluated.salaryUnknown === true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
