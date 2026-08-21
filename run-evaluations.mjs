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
import * as yaml from 'js-yaml';
import { chromium } from 'playwright';
import { extractJobDescription } from './jd-extract.mjs';
import { parsePipelineLine } from './scan.mjs';
import { gateEntries, formatRejectedRow } from './lib/triage-gate.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const EVALUATED_URLS_PATH = join(ROOT, 'data', 'evaluated-urls.tsv');
const NEEDS_REVIEW_PATH = join(ROOT, 'data', 'needs-manual-review.tsv');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const TRIAGE_REJECTED_PATH = join(ROOT, 'data', 'triage-rejected.tsv');

/** Profilo utente, letto una volta: serve al tetto per run e al budget settimanale. */
const profile = (() => {
  const profilePath = join(ROOT, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return {};
  try { return yaml.load(readFileSync(profilePath, 'utf-8')) || {}; }
  catch { return {}; }
})();

function loadMaxEvaluations() {
  const configured = profile.career_score?.max_full_evaluations;
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 15;
}

/**
 * Budget residuo nella finestra mobile di 7 giorni.
 *
 * evaluated-urls.tsv porta gia' la data di ogni valutazione, quindi la finestra
 * si calcola da li' senza introdurre stato nuovo. Serve perche'
 * max_full_evaluations e' un tetto PER RUN e il cron e' giornaliero: da solo
 * lascerebbe passare fino a 105 valutazioni a settimana.
 *
 * @param {string} tsvText - contenuto di data/evaluated-urls.tsv.
 * @param {number} weeklyCap - tetto settimanale.
 * @param {string} todayIso - data odierna 'YYYY-MM-DD'.
 * @returns {number} valutazioni ancora disponibili, mai negativo.
 */
export function remainingWeeklyBudget(tsvText, weeklyCap, todayIso) {
  if (typeof tsvText !== 'string' || tsvText.trim() === '') return Math.max(0, weeklyCap);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return Math.max(0, weeklyCap);
  // Finestra di 7 giorni con oggi incluso: il taglio e' 6 giorni indietro.
  const cutoffMs = todayMs - 6 * 86_400_000;

  let usedInWindow = 0;
  for (const line of tsvText.split('\n')) {
    const date = line.split('\t')[1]?.trim();
    if (!date) continue;
    const ms = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(ms) && ms >= cutoffMs && ms <= todayMs) usedInWindow++;
  }
  return Math.max(0, weeklyCap - usedInWindow);
}

/**
 * Voci pendenti di data/pipeline.md.
 *
 * Prima qui c'era un `text.match(/https?:\/\/\S+/g)` sull'intero file: pescava
 * gli URL anche dalla sezione ## Processed e funzionava solo perche'
 * evaluated-urls.tsv li riscartava a valle. Con il parser si legge la sezione
 * che il file dichiara di avere, e si recuperano i metadati che il gate usa.
 *
 * @param {string} text - contenuto di data/pipeline.md.
 * @returns {Array<object>} voci parsate della sola sezione ## Pending.
 */
export function loadPendingEntries(text) {
  if (typeof text !== 'string' || text === '') return [];
  const entries = [];
  let inPending = false;
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      inPending = /^pending$/i.test(heading[1]);
      continue;
    }
    if (!inPending) continue;
    const parsed = parsePipelineLine(line);
    if (parsed && !parsed.done) entries.push(parsed);
  }
  return entries;
}

/**
 * Divide la coda in base alla corsia di provenienza.
 *
 * Marcatore assente = tracked: bypassa il gate. Il default opposto sarebbe
 * silenzioso — un'offerta non marcata finirebbe sotto un modello economico e
 * potrebbe sparire senza motivo visibile.
 *
 * @param {Array<object>} entries
 * @returns {{tracked: Array<object>, sweep: Array<object>}}
 */
export function partitionByLane(entries) {
  const tracked = [];
  const sweep = [];
  for (const entry of entries) {
    if (entry.scanLane === 'ats-sweep') sweep.push(entry);
    else tracked.push(entry);
  }
  return { tracked, sweep };
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

/** Client reale del tier triage: cattura lo stdout di anthropic-eval.mjs. */
async function runTriageReal(text) {
  return execFileSync(process.execPath, [
    join(ROOT, 'anthropic-eval.mjs'), '--tier', 'triage', '--text', text,
  ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
}

/**
 * Esegue il ciclo di valutazione completo.
 * Esportata per testabilità; chiamata automaticamente sotto se il file è main.
 */
export async function runEvaluations() {
  const weeklyCap = profile.career_score?.weekly_full_evaluations ?? 25;
  const evaluatedTsvForBudget = existsSync(EVALUATED_URLS_PATH) ? readFileSync(EVALUATED_URLS_PATH, 'utf-8') : '';
  const weeklyLeft = remainingWeeklyBudget(evaluatedTsvForBudget, weeklyCap, new Date().toISOString().slice(0, 10));
  const max = Math.min(loadMaxEvaluations(), weeklyLeft);
  const pipelineText = existsSync(PIPELINE_PATH) ? readFileSync(PIPELINE_PATH, 'utf-8') : '';
  const allEntries = loadPendingEntries(pipelineText);
  const allUrls = allEntries.map(e => e.url);
  const evaluatedUrls = loadUrlSetFromTsv(EVALUATED_URLS_PATH);
  const needsReviewUrls = loadUrlSetFromTsv(NEEDS_REVIEW_PATH);

  const alreadyEvaluatedSkipped = allUrls.filter(url => evaluatedUrls.has(url)).length;
  const alreadyNeedsReviewSkipped = allUrls.filter(url => !evaluatedUrls.has(url) && needsReviewUrls.has(url)).length;
  const candidateEntries = allEntries.filter(e =>
    !evaluatedUrls.has(e.url) && !needsReviewUrls.has(e.url));

  if (allUrls.length === 0) {
    console.log('Nessuna offerta da valutare.');
    return;
  }

  if (weeklyLeft === 0) {
    console.log(`Budget settimanale esaurito (${weeklyCap} valutazioni negli ultimi 7 giorni). Nessuna valutazione in questo run.`);
    return;
  }

  if (alreadyEvaluatedSkipped > 0) {
    console.log(`⏭  ${alreadyEvaluatedSkipped} URL già valutate in precedenza (data/evaluated-urls.tsv), saltate.`);
  }
  if (alreadyNeedsReviewSkipped > 0) {
    console.log(`🔎 ${alreadyNeedsReviewSkipped} URL già segnalate per verifica manuale (data/needs-manual-review.tsv), saltate — vedi il digest giornaliero.`);
  }

  // Le offerte da sweep passano dal gate di triage prima di meritare una
  // valutazione Sonnet piena; le tracked lo bypassano e restano in testa.
  const { tracked, sweep } = partitionByLane(candidateEntries);
  const alreadyRejected = loadUrlSetFromTsv(TRIAGE_REJECTED_PATH);
  const threshold = profile.pipeline?.triage_threshold ?? 3.5;

  const { passed, rejected } = await gateEntries(sweep, {
    threshold, runTriage: runTriageReal, alreadyRejected,
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  for (const r of rejected) {
    appendFileSync(TRIAGE_REJECTED_PATH, formatRejectedRow(r.entry, r.score, r.reason, todayIso), 'utf-8');
  }
  if (rejected.length > 0) {
    console.log(`🚪 ${rejected.length} offerte da sweep sotto la soglia ${threshold} — in data/triage-rejected.tsv, riassunte nel digest.`);
  }

  // Le tracked non passano dal gate e stanno in testa; le sopravvissute
  // seguono in ordine di punteggio. La coda smette di essere servita in
  // ordine di file.
  const urls = [...tracked, ...passed.map(p => p.entry)].map(e => e.url).slice(0, max);

  if (urls.length === 0) {
    console.log('Nessuna offerta nuova da valutare (tutte già presenti in data/evaluated-urls.tsv, data/needs-manual-review.tsv, o tetto esaurito).');
    return;
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
    if (browser) await browser.close();
  }

  if (evaluated > 0) {
    console.log(`\n${evaluated} offerte valutate.`);
    if (needsReview > 0) console.log(`${needsReview} offerte segnalate per verifica manuale (vedi data/needs-manual-review.tsv).`);
    if (failed > 0) console.log(`${failed} valutazioni fallite.`);
  } else if (needsReview > 0) {
    console.log(`\n${needsReview} offerte segnalate per verifica manuale (vedi data/needs-manual-review.tsv). Nessuna valutazione completata.`);
  }
}

// Esegui automaticamente se il file è l'entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runEvaluations().catch(err => {
    console.error('Errore fatale:', err);
    process.exit(1);
  });
}