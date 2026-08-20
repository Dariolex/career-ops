#!/usr/bin/env node
/**
 * jd-extract.mjs — estrazione del testo reale di un annuncio via Playwright headless.
 *
 * Sostituisce la guardia "rifiuta URL nuda" di run-evaluations.mjs con
 * un'estrazione vera. Riusa la stessa logica di sicurezza e classificazione
 * già validata da check-liveness.mjs (liveness-browser.mjs / liveness-core.mjs)
 * invece di reinventarla: guardia SSRF, gestione hydration SPA, e
 * classifyLiveness() per distinguere un annuncio vivo da uno scaduto,
 * bloccato da anti-bot, o con contenuto insufficiente. Un annuncio che
 * classifyLiveness giudica non estraibile non deve mai essere spedito
 * all'LLM come se fosse una job description reale.
 *
 * Uso:
 *   node jd-extract.mjs <url>
 */

import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import {
  newLivenessPage,
  rejectPrivateOrInvalid,
  validateUrlSecurity,
} from './liveness-browser.mjs';
import { classifyLiveness } from './liveness-core.mjs';

const NAVIGATE_TIMEOUT_MS = 15_000;
const HYDRATION_WAIT_MS = 2_000;
const MAX_CHARS = 15_000;
const MIN_CHARS = 200;

/** Ripulisce il testo grezzo (righe vuote, whitespace) e lo tronca al tetto
 * di caratteri — evita di gonfiare inutilmente il costo del prompt LLM. */
export function cleanExtractedText(rawText) {
  const collapsed = String(rawText ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = collapsed.length > MAX_CHARS;
  return {
    text: truncated ? collapsed.slice(0, MAX_CHARS) : collapsed,
    truncated,
  };
}

export function isExtractionSufficient(text) {
  return String(text ?? '').trim().length >= MIN_CHARS;
}

/** Parte pura (nessuna rete/browser): decide se {status, bodyText, ...} già
 * osservati costituiscono un'estrazione utilizzabile. Separata da
 * extractFromPage così i test esercitano la logica di decisione con input
 * statici, senza dover mockare la navigazione Playwright. */
export function buildExtractionResult({ status, requestedUrl, finalUrl, bodyText }) {
  // Non passiamo gli apply-control (costerebbe una querySelectorAll in più
  // senza servire al testo), quindi classifyLiveness non potrà mai
  // restituire result:'active' via apply_control_visible per questa chiamata
  // — resterà 'uncertain'/no_apply_control anche per annunci vivi con
  // contenuto sostanzioso. È il caso atteso e va trattato come estraibile:
  // solo un vero segnale negativo (scaduto, bloccato, contenuto insufficiente)
  // deve far fallire l'estrazione.
  const verdict = classifyLiveness({ status, requestedUrl, finalUrl, bodyText, applyControls: [] });
  const isUsableContent = verdict.result === 'active' || verdict.code === 'no_apply_control';
  if (!isUsableContent) {
    return { success: false, code: verdict.code, reason: verdict.reason };
  }

  const { text, truncated } = cleanExtractedText(bodyText);
  if (!isExtractionSufficient(text)) {
    return { success: false, code: 'insufficient_content', reason: 'estratto troppo corto per essere una job description reale' };
  }

  return { success: true, text, truncated, finalUrl };
}

/** Naviga una pagina già aperta e prova a estrarne il testo dell'annuncio. */
export async function extractFromPage(page, url) {
  const guardError = rejectPrivateOrInvalid(url);
  if (guardError) {
    return { success: false, code: guardError.code, reason: guardError.reason };
  }
  try {
    await validateUrlSecurity(url);
  } catch (err) {
    return { success: false, code: 'blocked_host', reason: err.message };
  }

  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS });
  } catch (err) {
    return { success: false, code: 'navigation_error', reason: `navigation error: ${err.message.split('\n')[0]}` };
  }

  await page.waitForTimeout(HYDRATION_WAIT_MS);

  const status = response?.status() ?? 0;
  const finalUrl = page.url();
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '');

  return buildExtractionResult({ status, requestedUrl: url, finalUrl, bodyText });
}

/** Apre un browser (o riusa quello passato — mai lanciarne uno per URL in un
 * ciclo), estrae, e chiude solo ciò che ha aperto lui. */
export async function extractJobDescription(url, { browser } = {}) {
  let ownBrowser = null;
  let page;
  try {
    const activeBrowser = browser ?? (ownBrowser = await chromium.launch({ headless: true }));
    page = await newLivenessPage(activeBrowser);
    return await extractFromPage(page, url);
  } finally {
    if (page) await page.close().catch(() => {});
    if (ownBrowser) await ownBrowser.close().catch(() => {});
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Uso: node jd-extract.mjs <url>');
    process.exit(1);
  }
  const result = await extractJobDescription(url);
  if (!result.success) {
    console.error(`Estrazione fallita (${result.code}): ${result.reason}`);
    process.exit(1);
  }
  console.log(result.text);
  if (result.truncated) console.error('\n[testo troncato a 15000 caratteri]');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
