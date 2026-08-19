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
    model: 'claude-haiku-4-5-20251001',
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
  const args = { tier: 'full', jdFile: null, text: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tier') args.tier = argv[++i];
    else if (argv[i] === '--text') args.text = argv[++i];
    else if (!argv[i].startsWith('--')) args.jdFile = argv[i];
  }
  return args;
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
      temperature: 0.4,
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
      model: process.env.CAREER_OPS_MODEL || 'google/gemini-2.5-pro:free',
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

  const company = output.match(/^\s*COMPANY:\s*(.+)$/mi)?.[1]?.trim() || 'unknown';
  const date = new Date().toISOString().slice(0, 10);
  const reportsDir = join(ROOT, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, `${slugify(company)}-${date}.md`);

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
  console.error(`❌  ${error.message}`);
  process.exit(1);
});
