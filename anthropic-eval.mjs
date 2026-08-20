#!/usr/bin/env node
/**
 * anthropic-eval.mjs — valutazione headless con Anthropic, fallback OpenRouter.
 *
 * Fratello di gemini-eval.mjs / openai-eval.mjs: legge la stessa logica da
 * modes/, produce lo stesso contratto di output, e in più il blocco
 * ---CAREER_SCORE--- definito in modes/_career-score.md.
 *
 * Nessuna dipendenza npm: package.json appartiene al system layer, quindi si
 * usa fetch nativo (Node >=18).
 *
 * Uso:
 *   node anthropic-eval.mjs <file-jd.txt>
 *   node anthropic-eval.mjs --text "job description..."
 *   node anthropic-eval.mjs <file-jd.txt> --tier triage
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluateCareerScore } from './career-score.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Caricamento .env, stesso approccio di openrouter-runner.mjs
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*?)\1$/, '$2');
    }
  }
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Tier di costo. Il triage gira sul modello economico con il profilo compatto;
// la valutazione completa sul modello capace con CV e profilo estesi.
const TIERS = {
  triage: {
    model: 'claude-haiku-4-5',
    maxTokens: 2048,
    modes: ['modes/_shared.md', 'modes/triage.md'],
    profile: 'modes/_brief.md',
    includeCv: false,
    careerScore: false,
  },
  full: {
    model: 'claude-sonnet-5',
    maxTokens: 8192,
    modes: ['modes/_shared.md', 'modes/oferta.md', 'modes/_career-score.md'],
    profile: 'modes/_profile.md',
    includeCv: true,
    careerScore: true,
  },
};

function readOptional(relative, label) {
  const path = join(ROOT, relative);
  if (!existsSync(path)) {
    console.warn(`⚠️   ${label} non trovato: ${relative}`);
    return `[${label} non disponibile]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

function parseArgs(argv) {
  const args = {
    tier: 'full', jdFile: null, text: null, url: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tier') args.tier = argv[++i];
    else if (argv[i] === '--text') args.text = argv[++i];
    else if (argv[i] === '--url') args.url = argv[++i];
    else if (!argv[i].startsWith('--')) args.jdFile = argv[i];
  }
  return args;
}

// Stesso schema ---SCORE_SUMMARY--- prodotto da gemini-eval.mjs, esteso con
// LOCATION/SALARY (che il modello determina già nei Blocchi A/D — non li
// deve indovinare due volte) e URL/SOURCE (che il modello non può conoscere
// dal solo testo della JD: vengono iniettati dallo script dopo la risposta,
// vedi injectUrlSource()).
const OPERATING_CONSTRAINTS = `
═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS CLI SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - For Block D (Comp research): provide salary estimates based on your training data, clearly noted as estimates.
   - For Block G (Legitimacy): analyze the JD text only; skip URL/page freshness checks.
   - Post-evaluation file saving is handled by the script, not by you.
2. Generate Blocks A through G in full.
3. At the very end, output a machine-readable summary block in this exact format:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
LOCATION: <location as already determined in Block A, or "Unknown">
SALARY: <compensation as already determined in Block D, or "Not stated">
---END_SUMMARY---
`;

/** Verifica minima di forma A-G + SCORE_SUMMARY, stessa logica/messaggi di
 * gemini-eval.mjs::validateEvaluationShape (~righe 172-211). */
function validateEvaluationShape(text) {
  const issues = [];
  const requiredBlocks = [
    ['A', /(?:^|\n)#{1,3}\s*(?:A[).:-]?|Block A\b)/im],
    ['B', /(?:^|\n)#{1,3}\s*(?:B[).:-]?|Block B\b)/im],
    ['C', /(?:^|\n)#{1,3}\s*(?:C[).:-]?|Block C\b)/im],
    ['D', /(?:^|\n)#{1,3}\s*(?:D[).:-]?|Block D\b)/im],
    ['E', /(?:^|\n)#{1,3}\s*(?:E[).:-]?|Block E\b)/im],
    ['F', /(?:^|\n)#{1,3}\s*(?:F[).:-]?|Block F\b)/im],
    ['G', /(?:^|\n)#{1,3}\s*(?:G[).:-]?|Block G\b)/im],
  ];

  for (const [label, pattern] of requiredBlocks) {
    if (!pattern.test(text)) issues.push(`missing Block ${label}`);
  }

  const summary = text.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  if (!summary) {
    issues.push('missing SCORE_SUMMARY block');
  } else {
    const summaryBlock = summary[1];
    for (const key of ['COMPANY', 'ROLE', 'ARCHETYPE', 'LEGITIMACY']) {
      const field = summaryBlock.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'));
      const value = field?.[1]?.trim() ?? '';
      if (!value || (key !== 'COMPANY' && value.toLowerCase() === 'unknown')) {
        issues.push(`SCORE_SUMMARY ${key} is required`);
      }
    }

    const score = summaryBlock.match(/^\s*SCORE:\s*([0-9]+(?:\.[0-9]+)?)/mi);
    const scoreValue = score ? Number(score[1]) : NaN;
    if (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 5) {
      issues.push('SCORE_SUMMARY score must be a number between 0 and 5');
    }
  }

  if (issues.length > 0) {
    throw new Error(`Anthropic returned an invalid career-ops report: ${issues.join('; ')}`);
  }
}

/** Estrae un campo dal blocco SCORE_SUMMARY (o da qualunque riga "KEY: valore"). */
function summaryField(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
}

/** Inietta URL/SOURCE — che il modello non può conoscere dal solo testo JD —
 * dentro il blocco ---SCORE_SUMMARY--- già validato, subito prima del marcatore
 * di chiusura. */
function injectUrlSource(text, { url, source }) {
  const marker = '---END_SUMMARY---';
  const idx = text.indexOf(marker);
  if (idx === -1) return text;
  const insertion = `URL: ${url || 'unknown'}\nSOURCE: ${source || 'unknown'}\n`;
  return text.slice(0, idx) + insertion + text.slice(idx);
}

/** Deriva il nome del portale dall'host dell'URL, se disponibile. */
function sourceFromUrl(url) {
  if (!url) return 'unknown';
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Redige la chiave dai messaggi di errore prima di stamparli. */
function redact(message, ...secrets) {
  let out = String(message || '');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

async function callAnthropic({ apiKey, model, maxTokens, system, userText }) {
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // temperature non passato: rifiutato con 400 ("temperature is
      // deprecated for this model") dai modelli Claude correnti — usa il
      // default del server.
      // Il prefisso statico (shared + oferta + cv) è marcato per il caching:
      // si ripete identico a ogni offerta della stessa giornata.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `JOB DESCRIPTION DA VALUTARE:\n\n${userText}` }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  return data.content.map(part => part.text ?? '').join('').trim();
}

async function callOpenRouter({ apiKey, system, userText, maxTokens }) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.CAREER_OPS_MODEL || 'google/gemma-4-31b-it:free',
      max_tokens: maxTokens,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `JOB DESCRIPTION DA VALUTARE:\n\n${userText}` },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 400)}`);
  }

  const data = await response.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

function slugify(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tier = TIERS[args.tier];
  if (!tier) {
    console.error(`Tier sconosciuto: ${args.tier}. Valori ammessi: triage, full.`);
    process.exit(1);
  }

  let jdText = args.text;
  if (!jdText && args.jdFile) {
    if (!existsSync(args.jdFile)) {
      console.error(`File non trovato: ${args.jdFile}`);
      process.exit(1);
    }
    jdText = readFileSync(args.jdFile, 'utf-8').trim();
  }
  if (!jdText) {
    console.error('Uso: node anthropic-eval.mjs <file-jd.txt> [--tier triage|full]');
    process.exit(1);
  }

  const parts = tier.modes.map(m => readOptional(m, m));
  parts.push(readOptional(tier.profile, tier.profile));
  if (tier.includeCv) parts.push(`# CV\n\n${readOptional('cv.md', 'cv.md')}`);
  // Solo il tier "full" (Blocchi A-G) porta le regole operative + il
  // contratto SCORE_SUMMARY: il triage ha una shape diversa e più leggera.
  if (tier.careerScore) parts.push(OPERATING_CONSTRAINTS);
  const system = parts.join('\n\n---\n\n');

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  let output = null;
  let usedProvider = null;

  if (anthropicKey) {
    try {
      output = await callAnthropic({
        apiKey: anthropicKey, model: tier.model,
        maxTokens: tier.maxTokens, system, userText: jdText,
      });
      usedProvider = `anthropic/${tier.model}`;
    } catch (error) {
      console.warn(`⚠️   Anthropic non disponibile: ${redact(error.message, anthropicKey)}`);
    }
  }

  if (!output && openrouterKey) {
    try {
      output = await callOpenRouter({
        apiKey: openrouterKey, system, userText: jdText, maxTokens: tier.maxTokens,
      });
      usedProvider = 'openrouter (fallback)';
    } catch (error) {
      console.error(`❌  OpenRouter non disponibile: ${redact(error.message, openrouterKey)}`);
    }
  }

  if (!output) {
    console.error('❌  Nessun provider LLM disponibile. Configurare ANTHROPIC_API_KEY.');
    process.exit(1);
  }

  console.log(`\n🤖  Valutazione prodotta da ${usedProvider}\n`);
  console.log(output);

  if (!tier.careerScore) process.exit(0);

  try {
    validateEvaluationShape(output);
  } catch (error) {
    console.error(`❌  ${error.message}`);
    console.error('    No report was saved. Retry, lower temperature, or use the OpenRouter fallback for this JD.');
    process.exit(1);
  }

  // Il modello non può conoscere l'URL della posting dal solo testo della JD:
  // iniettato qui, prima di estrarre company/role/report, così finisce sia nel
  // report salvato sia nella query summaryField() usata da daily-digest.mjs e
  // obsidian-export.mjs.
  output = injectUrlSource(output, { url: args.url, source: sourceFromUrl(args.url) });

  let scored;
  try {
    scored = evaluateCareerScore(output);
  } catch (error) {
    console.error(`❌  Career Score non estraibile: ${error.message}`);
    console.error('    Nessun report salvato. Riprovare.');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  CAREER SCORE: ${scored.total}/100 — ${scored.classification}`);
  if (scored.renormalized) {
    console.log(`  (salario non dichiarato: calcolato su ${scored.weightsUsed} punti di peso)`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  const company = summaryField(output, 'COMPANY') || 'unknown';
  const role = summaryField(output, 'ROLE') || 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  const reportsDir = join(ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  // Include lo slug del ruolo (#Fix4): senza, due ruoli diversi nella stessa
  // azienda nello stesso giorno si sovrascrivono a vicenda in silenzio.
  const reportPath = join(reportsDir, `${slugify(company)}-${slugify(role)}-${date}.md`);

  writeFileSync(reportPath, [
    output,
    '',
    '---',
    '',
    '## Career Score',
    '',
    `**${scored.total}/100 — ${scored.classification}**`,
    scored.renormalized
      ? `\n> Salario non dichiarato: punteggio calcolato su ${scored.weightsUsed} punti di peso invece di 100.`
      : '',
    '',
    '```json',
    JSON.stringify(scored, null, 2),
    '```',
    '',
  ].join('\n'), 'utf-8');

  console.log(`📄  Report salvato: ${reportPath}`);
}

main().catch(error => {
  // Stessa disciplina redact() di ogni altro percorso di errore in questo
  // file (in difesa: una chiave potrebbe finire nel messaggio anche qui).
  console.error(`❌  ${redact(error.message, process.env.ANTHROPIC_API_KEY, process.env.OPENROUTER_API_KEY)}`);
  process.exit(1);
});
