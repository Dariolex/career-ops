#!/usr/bin/env node
/**
 * run-evaluations.mjs — orchestratore dei tier 2 e 3.
 *
 * Legge le offerte pendenti da data/pipeline.md, applica il tetto di costo e
 * invoca anthropic-eval.mjs su ciascuna. Il tetto è la valvola che impedisce a
 * una giornata anomala di consumare budget imprevisto.
 *
 * Tre guardie:
 *  - Fix 2 (final review): senza memoria di cosa è già stato valutato, ogni
 *    run ri-valuta e ri-fattura le stesse URL all'infinito e la coda non si
 *    svuota mai. data/evaluated-urls.tsv (url\tdata ISO, uno per riga) è il
 *    log processed-URL: append-only, controllato prima di ogni dispatch.
 *  - Estrazione JD reale (jd-extract.mjs, Playwright headless): ogni URL
 *    viene navigata e il testo dell'annuncio estratto davvero, invece di
 *    spedire la URL nuda all'LLM come se fosse la job description.
 *  - Annunci non estraibili (scaduti, bloccati da anti-bot, contenuto
 *    insufficiente) non vengono scartati in silenzio: finiscono in
 *    data/needs-manual-review.tsv e il digest giornaliero li segnala,
 *    così l'utente sa quali annunci verificare a mano. CAREER_INTEL_ALLOW_URL_AS_TEXT=1
 *    resta una via di fuga manuale per chi vuole comunque forzare l'invio
 *    della URL nuda come testo (NON raccomandato).
 */

import {
  readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync, unlinkSync,
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { extractJobDescription } from './jd-extract.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const EVALUATED_URLS_PATH = join(ROOT, 'data', 'evaluated-urls.tsv');
const NEEDS_REVIEW_PATH = join(ROOT, 'data', 'needs-manual-review.tsv');

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
function loadUrlSetFromTsv(path) {
  if (!existsSync(path)) return new Set();
  const text = readFileSync(path, 'utf-8');
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

/** Annuncio non estraibile: registrato per verifica manuale (mai riprovato
 * in automatico — coerente con evaluated-urls.tsv, un solo file per URL). */
function appendNeedsReview(url, code, reason) {
  mkdirSync(dirname(NEEDS_REVIEW_PATH), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const safeReason = String(reason ?? '').replace(/[\t\n]/g, ' ');
  appendFileSync(NEEDS_REVIEW_PATH, `${url}\t${today}\t${code}\t${safeReason}\n`, 'utf-8');
}

const max = loadMaxEvaluations();
const allUrls = loadPendingUrls();
const evaluatedUrls = loadUrlSetFromTsv(EVALUATED_URLS_PATH);
const needsReviewUrls = loadUrlSetFromTsv(NEEDS_REVIEW_PATH);

const alreadyEvaluatedSkipped = allUrls.filter(url => evaluatedUrls.has(url)).length;
const alreadyNeedsReviewSkipped = allUrls.filter(url => !evaluatedUrls.has(url) && needsReviewUrls.has(url)).length;
const candidateUrls = allUrls.filter(url => !evaluatedUrls.has(url) && !needsReviewUrls.has(url));
const urls = candidateUrls.slice(0, max);

if (allUrls.length === 0) {
  console.log('Nessuna offerta da valutare.');
  process.exit(0);
}

if (alreadyEvaluatedSkipped > 0) {
  console.log(`⏭  ${alreadyEvaluatedSkipped} URL già valutate in precedenza (data/evaluated-urls.tsv), saltate.`);
}
if (alreadyNeedsReviewSkipped > 0) {
  console.log(`🔎 ${alreadyNeedsReviewSkipped} URL già segnalate per verifica manuale (data/needs-manual-review.tsv), saltate — vedi il digest giornaliero.`);
}

if (urls.length === 0) {
  console.log('Nessuna offerta nuova da valutare (tutte già presenti in data/evaluated-urls.tsv, data/needs-manual-review.tsv, o tetto esaurito).');
  process.exit(0);
}

console.log(`Valutazione di ${urls.length} offerte (tetto: ${max}).`);

const allowUrlAsText = process.env.CAREER_INTEL_ALLOW_URL_AS_TEXT === '1';

let evaluated = 0;
let needsReview = 0;
let failed = 0;

// Un solo browser per l'intero run, riusato in sequenza — mai Playwright in
// parallelo (stessa regola di check-liveness.mjs).
let browser = null;
async function ensureBrowser() {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

try {
  for (const url of urls) {
    const extraction = await extractJobDescription(url, { browser: await ensureBrowser() });

    let jdText;
    if (extraction.success) {
      jdText = extraction.text;
    } else if (allowUrlAsText) {
      console.warn(`⚠ CAREER_INTEL_ALLOW_URL_AS_TEXT=1 set — estrazione fallita (${extraction.code}: ${extraction.reason}), invio comunque la URL nuda come testo: ${url} (NON raccomandato, spreca budget su output allucinato).`);
      jdText = url;
    } else {
      console.warn(`🔎 REVIEW ${url} — estrazione automatica non riuscita (${extraction.code}: ${extraction.reason}). Segnalato in data/needs-manual-review.tsv, verrà mostrato nel digest giornaliero. Imposta CAREER_INTEL_ALLOW_URL_AS_TEXT=1 per forzare l'invio della URL nuda (NON raccomandato).`);
      appendNeedsReview(url, extraction.code, extraction.reason);
      needsReview++;
      continue;
    }

    const jdFilePath = join(tmpdir(), `career-intel-jd-${randomUUID()}.txt`);
    writeFileSync(jdFilePath, jdText, 'utf-8');
    try {
      execFileSync(process.execPath, [
        join(ROOT, 'anthropic-eval.mjs'), jdFilePath, '--url', url,
      ], {
        stdio: 'inherit',
        env: process.env,
      });
      evaluated++;
      appendEvaluatedUrl(url);
    } catch {
      console.warn(`⚠️   Valutazione fallita: ${url}`);
      failed++;
    } finally {
      try { unlinkSync(jdFilePath); } catch { /* best-effort cleanup */ }
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
}

console.log(`\nValutate ${evaluated}, da verificare manualmente ${needsReview}, fallite ${failed}, già valutate/segnalate in precedenza ${alreadyEvaluatedSkipped + alreadyNeedsReviewSkipped}.`);
// Le valutazioni fallite non devono far fallire l'intero workflow: il digest
// deve comunque essere prodotto con ciò che è riuscito.
process.exit(0);
