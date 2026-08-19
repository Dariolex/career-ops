#!/usr/bin/env node
/**
 * career-score.mjs — Career Score 0–100 di Dario Career Intelligence.
 *
 * L'LLM giudica le sette dimensioni; qui si fa solo aritmetica. La separazione
 * rende il punteggio riproducibile e verificabile a mano — proprietà che un
 * numero prodotto direttamente dal modello non avrebbe.
 *
 * Uso: node career-score.mjs <file-valutazione.md>
 */

import { readFileSync } from 'fs';

export const WEIGHTS = {
  professional_fit:   25,
  career_progression: 20,
  compensation:       15,
  ai_relevance:       15,
  geography:          10,
  employer_quality:   10,
  strategic_value:     5,
};

export const DEFAULT_THRESHOLDS = { apply: 75, consider: 60, low_priority: 45 };

const DIMENSION_KEYS = Object.keys(WEIGHTS);
const BLOCK_RE = /---CAREER_SCORE---\s*([\s\S]*?)---END_CAREER_SCORE---/;

/** Le liste puntate usano "- Nessuno" per dichiarare l'assenza; qui diventa []. */
function parseList(body, label) {
  const section = body.match(
    // \Z non esiste in JavaScript (a differenza di PCRE/Python): senza questa
    // correzione matcha il carattere letterale "Z", che con il flag "i"
    // tronca la cattura alla prima "z" incontrata nel testo (es. dentro
    // "Sovrapposizione"). $(?![\s\S]) è l'idioma corretto per fine-stringa.
    new RegExp(`^${label}:\\s*$([\\s\\S]*?)(?=^[A-Z_]+:|$(?![\\s\\S]))`, 'mi'),
  );
  if (!section) return [];
  return section[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
    .filter(item => item && !/^(nessuno|none|n\/a)$/i.test(item));
}

/**
 * Estrae il blocco Career Score da un testo di valutazione.
 * @param {string} text - Output completo dell'LLM.
 * @returns {{dimensions: Object, salaryUnknown: boolean, strengths: string[],
 *   weaknesses: string[], missingRequirements: string[], redFlags: string[],
 *   reasoning: string}}
 * @throws {Error} Se il blocco manca o una dimensione è assente o malformata.
 */
export function parseCareerScoreBlock(text) {
  const block = String(text).match(BLOCK_RE);
  if (!block) throw new Error('blocco ---CAREER_SCORE--- non trovato');
  const body = block[1];

  const dimensions = {};
  let salaryUnknown = false;

  for (const key of DIMENSION_KEYS) {
    const line = body.match(new RegExp(`^\\s*${key.toUpperCase()}:\\s*(.+)$`, 'mi'));
    if (!line) throw new Error(`dimensione mancante: ${key}`);

    const raw = line[1].trim();
    const [valuePart, ...rest] = raw.split('|');
    const value = valuePart.trim();
    const reasoning = rest.join('|').trim();

    if (/^unknown$/i.test(value)) {
      if (key !== 'compensation') {
        throw new Error(`"unknown" è ammesso solo per compensation, non per ${key}`);
      }
      dimensions[key] = { score: null, reasoning: reasoning || 'unknown' };
      salaryUnknown = true;
      continue;
    }

    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`punteggio non valido per ${key}: "${value}"`);
    }
    dimensions[key] = { score, reasoning };
  }

  const reasoningMatch = body.match(/^REASONING:\s*([\s\S]*?)$/mi);

  return {
    dimensions,
    salaryUnknown,
    strengths:           parseList(body, 'STRENGTHS'),
    weaknesses:          parseList(body, 'WEAKNESSES'),
    missingRequirements: parseList(body, 'MISSING_REQUIREMENTS'),
    redFlags:            parseList(body, 'RED_FLAGS'),
    reasoning:           reasoningMatch ? reasoningMatch[1].trim() : '',
  };
}

/**
 * Applica i pesi. Una dimensione con score null viene esclusa e i pesi restanti
 * sono rinormalizzati su 100: assegnarle un valore neutro sarebbe comunque una
 * stima inventata, che il contratto vieta.
 * @param {Object} dimensions - Mappa da parseCareerScoreBlock.
 * @returns {{total: number, raw: number, renormalized: boolean, weightsUsed: number}}
 */
export function computeCareerScore(dimensions) {
  let weighted = 0;
  let weightsUsed = 0;

  for (const key of DIMENSION_KEYS) {
    const score = dimensions[key]?.score;
    if (score === null || score === undefined) continue;
    weighted += score * WEIGHTS[key];
    weightsUsed += WEIGHTS[key];
  }

  if (weightsUsed === 0) throw new Error('nessuna dimensione valutabile');

  const raw = weighted / weightsUsed;
  return {
    raw,
    total: Math.round(raw),
    renormalized: weightsUsed !== 100,
    weightsUsed,
  };
}

/**
 * @param {number} total - Punteggio 0–100.
 * @param {{apply: number, consider: number, low_priority: number}} thresholds
 * @returns {'APPLY'|'CONSIDER'|'LOW_PRIORITY'|'REJECT'}
 */
export function classify(total, thresholds = DEFAULT_THRESHOLDS) {
  if (total >= thresholds.apply) return 'APPLY';
  if (total >= thresholds.consider) return 'CONSIDER';
  if (total >= thresholds.low_priority) return 'LOW_PRIORITY';
  return 'REJECT';
}

/**
 * Pipeline completa: parsing, calcolo, classificazione.
 * @param {string} text - Output completo dell'LLM.
 * @param {{thresholds?: Object}} [options]
 */
export function evaluateCareerScore(text, { thresholds = DEFAULT_THRESHOLDS } = {}) {
  const parsed = parseCareerScoreBlock(text);
  const computed = computeCareerScore(parsed.dimensions);
  return {
    ...parsed,
    ...computed,
    classification: classify(computed.total, thresholds),
  };
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node career-score.mjs <file-valutazione.md>');
    process.exit(1);
  }
  try {
    const result = evaluateCareerScore(readFileSync(file, 'utf-8'));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Errore: ${error.message}`);
    process.exit(1);
  }
}
