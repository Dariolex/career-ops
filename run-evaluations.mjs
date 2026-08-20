#!/usr/bin/env node
/**
 * run-evaluations.mjs — orchestratore dei tier 2 e 3.
 *
 * Legge le offerte pendenti da data/pipeline.md, applica il tetto di costo e
 * invoca anthropic-eval.mjs su ciascuna. Il tetto è la valvola che impedisce a
 * una giornata anomala di consumare budget imprevisto.
 *
 * Due guardie aggiunte dal fix round di final review:
 *  - Fix 1: senza una vera pipeline di fetch/estrazione JD, l'unico testo
 *    disponibile per ogni URL è l'URL stesso. Inviarlo così com'è all'LLM come
 *    se fosse la job description produce valutazioni allucinate e formattate
 *    con sicurezza — spende budget reale per output inventato. Il default è
 *    rifiutarsi e saltare; CAREER_INTEL_ALLOW_URL_AS_TEXT=1 forza il vecchio
 *    comportamento per chi vuole testarlo deliberatamente.
 *  - Fix 2: senza memoria di cosa è già stato valutato, ogni run ri-valuta e
 *    ri-fattura le stesse URL all'infinito e la coda non si svuota mai.
 *    data/evaluated-urls.tsv (url\tdata ISO, uno per riga) è il log
 *    processed-URL: append-only, controllato prima di ogni dispatch.
 */

import {
  readFileSync, existsSync, appendFileSync, mkdirSync,
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));
const EVALUATED_URLS_PATH = join(ROOT, 'data', 'evaluated-urls.tsv');

function loadMaxEvaluations() {
  const fromEnv = Number(process.env.MAX_EVALUATIONS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  const profilePath = join(ROOT, 'config', 'profile.yml');
  if (existsSync(profilePath)) {
    const profile = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    const configured = profile.career_score?.max_full_evaluations;
    if (Number.isFinite(configured) && configured > 0) return configured;
  }
  return 15;
}

function loadPendingUrls() {
  const pipelinePath = join(ROOT, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) return [];
  const text = readFileSync(pipelinePath, 'utf-8');
  const urls = text.match(/https?:\/\/\S+/g) || [];
  return [...new Set(urls.map(url => url.replace(/[)\]|,.]+$/, '')))];
}

/** URL già valutate in run precedenti: {url}\t{data ISO} per riga. */
function loadEvaluatedUrls() {
  if (!existsSync(EVALUATED_URLS_PATH)) return new Set();
  const text = readFileSync(EVALUATED_URLS_PATH, 'utf-8');
  const set = new Set();
  for (const line of text.split('\n')) {
    const url = line.split('\t')[0]?.trim();
    if (url) set.add(url);
  }
  return set;
}

function appendEvaluatedUrl(url) {
  mkdirSync(dirname(EVALUATED_URLS_PATH), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  appendFileSync(EVALUATED_URLS_PATH, `${url}\t${today}\n`, 'utf-8');
}

/** Vero solo se il "testo" è letteralmente l'URL e nient'altro — cioè non
 * abbiamo mai estratto una vera job description per questa offerta. */
function isBareUrl(text) {
  return /^https?:\/\/\S+$/.test(String(text).trim());
}

const max = loadMaxEvaluations();
const allUrls = loadPendingUrls();
const evaluatedUrls = loadEvaluatedUrls();

const candidateUrls = allUrls.filter(url => !evaluatedUrls.has(url));
const alreadyEvaluatedSkipped = allUrls.length - candidateUrls.length;
const urls = candidateUrls.slice(0, max);

if (allUrls.length === 0) {
  console.log('Nessuna offerta da valutare.');
  process.exit(0);
}

if (alreadyEvaluatedSkipped > 0) {
  console.log(`⏭  ${alreadyEvaluatedSkipped} URL già valutate in precedenza (data/evaluated-urls.tsv), saltate.`);
}

if (urls.length === 0) {
  console.log('Nessuna offerta nuova da valutare (tutte già presenti in data/evaluated-urls.tsv o tetto esaurito).');
  process.exit(0);
}

console.log(`Valutazione di ${urls.length} offerte (tetto: ${max}).`);

const allowUrlAsText = process.env.CAREER_INTEL_ALLOW_URL_AS_TEXT === '1';

let evaluated = 0;
let guardSkipped = 0;
let failed = 0;

for (const url of urls) {
  // Fix 1: non esiste ancora una pipeline di fetch/estrazione JD — l'unico
  // "testo" disponibile per ogni URL è l'URL stesso. Inviarlo come se fosse
  // la job description produce valutazioni allucinate ma formattate con
  // sicurezza, sprecando budget reale. Rifiuta di default; solo un override
  // esplicito (per chi vuole testarlo deliberatamente) lo lascia passare.
  const text = url;
  if (isBareUrl(text)) {
    if (!allowUrlAsText) {
      console.warn(`⚠ SKIP ${url} — no job-description text available, only a bare URL (no fetch/extraction pipeline wired yet). Set CAREER_INTEL_ALLOW_URL_AS_TEXT=1 to override and send the raw URL to the LLM anyway (NOT recommended, wastes API spend on hallucinated output).`);
      guardSkipped++;
      continue;
    }
    console.warn(`⚠ CAREER_INTEL_ALLOW_URL_AS_TEXT=1 set — sending the raw URL as job-description text to the LLM anyway: ${url} (NOT recommended, wastes API spend on hallucinated output).`);
  }

  try {
    execFileSync(process.execPath, [
      join(ROOT, 'anthropic-eval.mjs'), '--text', text, '--url', url,
    ], {
      stdio: 'inherit',
      env: process.env,
    });
    evaluated++;
    appendEvaluatedUrl(url);
  } catch {
    console.warn(`⚠️   Valutazione fallita: ${url}`);
    failed++;
  }
}

console.log(`\nValutate ${evaluated}, saltate per guard URL ${guardSkipped}, fallite ${failed}, già valutate in precedenza ${alreadyEvaluatedSkipped}.`);
// Le valutazioni fallite non devono far fallire l'intero workflow: il digest
// deve comunque essere prodotto con ciò che è riuscito.
process.exit(0);
