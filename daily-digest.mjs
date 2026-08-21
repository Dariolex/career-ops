#!/usr/bin/env node
/**
 * daily-digest.mjs — digest giornaliero in reports/daily/YYYY-MM-DD.md.
 *
 * Distinto dai report per singola offerta (reports/NNN-azienda-data.md): questo
 * aggrega la giornata. Viene scritto anche quando non ci sono offerte, perché un
 * file assente è indistinguibile da un workflow rotto.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { evaluateCareerScore } from './career-score.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NEEDS_REVIEW_PATH = join(ROOT, 'data', 'needs-manual-review.tsv');
const TRIAGE_REJECTED_PATH = join(ROOT, 'data', 'triage-rejected.tsv');

const ORDER = { APPLY: 0, CONSIDER: 1, LOW_PRIORITY: 2, REJECT: 3 };

function renderEntry(entry) {
  const lines = [
    `### ${entry.total}/100 — ${entry.classification}`,
    '',
    `**${entry.title}** · ${entry.company}`,
    `${entry.location || 'Sede non indicata'}`,
    '',
    `Retribuzione: ${entry.salary || '_non dichiarato dall\'annuncio_'}`,
  ];

  if (entry.renormalized) {
    lines.push('', '> Punteggio calcolato senza la dimensione retributiva e rinormalizzato: l\'annuncio non dichiara il salario.');
  }

  if (entry.strengths?.length) {
    lines.push('', '**Punti di forza**', ...entry.strengths.map(s => `- ${s}`));
  }
  if (entry.weaknesses?.length) {
    lines.push('', '**Gap**', ...entry.weaknesses.map(w => `- ${w}`));
  }
  if (entry.redFlags?.length) {
    lines.push('', '**Rischi**', ...entry.redFlags.map(r => `- ${r}`));
  }
  if (entry.reasoning) {
    lines.push('', entry.reasoning);
  }
  if (entry.url) {
    lines.push('', `[Annuncio](${entry.url})`);
  }

  lines.push('', '---', '');
  return lines.join('\n');
}

function renderNeedsReviewSection(needsReview) {
  if (!needsReview || needsReview.length === 0) return [];
  const reasonLabel = {
    http_gone: 'annuncio scaduto',
    bot_challenge: 'bloccato da anti-bot',
    access_blocked: 'accesso bloccato',
    server_error: 'errore del server',
    expired_url: 'redirect verso URL scaduta',
    expired_body: 'pagina segnala scadenza',
    redirected_off_posting: 'redirect fuori dall\'annuncio',
    listing_page: 'redirect a pagina di elenco',
    insufficient_content: 'contenuto insufficiente',
    navigation_error: 'errore di navigazione',
    blocked_host: 'host bloccato dalla guardia di sicurezza',
    invalid_url: 'URL non valida',
    unsupported_protocol: 'protocollo non supportato',
  };
  const lines = [
    '## Da verificare manualmente',
    '',
    `${needsReview.length} annunci non sono stati estratti automaticamente e vanno controllati a mano:`,
    '',
  ];
  for (const item of needsReview) {
    const label = reasonLabel[item.code] || item.code || 'motivo sconosciuto';
    lines.push(`- [${item.url}](${item.url}) — ${label}${item.reason ? ` (${item.reason})` : ''}`);
  }
  lines.push('', '---', '');
  return lines;
}

/**
 * Offerte scartate oggi dal gate di triage (lib/triage-gate.mjs).
 *
 * Il gate giudica sui soli metadati ed e' quindi tarato permissivo: gli scarti
 * vanno mostrati, non nascosti — altrimenti il digest realizza la sparizione
 * silenziosa che il design del gate vuole evitare. Togliere la riga da
 * data/triage-rejected.tsv rimette l'offerta in gioco al run successivo.
 */
function renderTriageRejectedSection(triageRejected) {
  if (!triageRejected || triageRejected.length === 0) return [];
  const sorted = [...triageRejected].sort((a, b) => b.score - a.score);
  const lines = [
    `## Scartate dal triage (${sorted.length})`,
    '',
    'Giudicate sui soli metadati, sotto la soglia di passaggio. Per rimetterne',
    'una in gioco, togli la sua riga da `data/triage-rejected.tsv`.',
    '',
  ];
  for (const item of sorted) {
    lines.push(`- **${item.score}/5** — ${item.reason} — [annuncio](${item.url})`);
  }
  lines.push('', '---', '');
  return lines;
}

/**
 * @param {{date: string, entries: Array<Object>, needsReview?: Array<Object>, triageRejected?: Array<Object>}} input
 * @returns {string} Markdown del digest.
 */
export function renderDigest({ date, entries, needsReview, triageRejected }) {
  const header = [`# Career Intelligence — ${date}`, ''];
  const needsReviewSection = renderNeedsReviewSection(needsReview);
  const triageRejectedSection = renderTriageRejectedSection(triageRejected);

  if (!entries || entries.length === 0) {
    return [
      ...header,
      ...needsReviewSection,
      ...triageRejectedSection,
      'Nessuna offerta rilevante trovata oggi.',
      '',
      'Per un profilo AI Governance e privacy senior è un esito normale: le posizioni',
      'target sono rare e i filtri sono volutamente stretti. Nessuna azione richiesta.',
      '',
    ].join('\n');
  }

  const sorted = [...entries].sort((a, b) => {
    const byClass = (ORDER[a.classification] ?? 9) - (ORDER[b.classification] ?? 9);
    return byClass !== 0 ? byClass : b.total - a.total;
  });

  const counts = sorted.reduce((acc, e) => {
    acc[e.classification] = (acc[e.classification] || 0) + 1;
    return acc;
  }, {});

  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ');

  return [
    ...header,
    `${sorted.length} offerte valutate — ${summary}`,
    '',
    '---',
    '',
    ...sorted.map(renderEntry),
    ...needsReviewSection,
    ...triageRejectedSection,
  ].join('\n');
}

/** Estrae un campo dal blocco SCORE_SUMMARY prodotto dai modes. */
function summaryField(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
}

/**
 * Legge reports/ e raccoglie le valutazioni del giorno dato, estraendo
 * Career Score + i campi SCORE_SUMMARY (ROLE, COMPANY, LOCATION, SALARY, URL).
 * Esportata perché è il punto in cui un report testuale reale diventa gli
 * oggetti che renderDigest() consuma — il test coverage gap segnalato dalla
 * review finale copriva solo renderDigest() con oggetti costruiti a mano, mai
 * questo passaggio.
 * @param {string} date - YYYY-MM-DD
 * @param {string} [reportsDirOverride] - directory reports/ da leggere (per i test)
 */
export function collectEntries(date, reportsDirOverride) {
  const reportsDir = reportsDirOverride || join(ROOT, 'reports', date);
  if (!existsSync(reportsDir)) return [];

  const entries = [];
  for (const file of readdirSync(reportsDir)) {
    if (!file.endsWith(`${date}.md`)) continue;
    const text = readFileSync(join(reportsDir, file), 'utf-8');
    try {
      const scored = evaluateCareerScore(text);
      entries.push({
        ...scored,
        title:    summaryField(text, 'ROLE') || 'Ruolo non indicato',
        company:  summaryField(text, 'COMPANY') || 'Azienda non indicata',
        location: summaryField(text, 'LOCATION'),
        salary:   summaryField(text, 'SALARY'),
        url:      summaryField(text, 'URL'),
      });
    } catch {
      // Un report senza blocco Career Score è una valutazione di altra origine:
      // si salta senza interrompere il digest.
    }
  }
  return entries;
}

/**
 * Legge data/needs-manual-review.tsv e restituisce le righe del giorno dato.
 * Formato riga: url\tdata ISO\tcode\treason (append-only, scritto da
 * run-evaluations.mjs quando jd-extract.mjs non riesce a estrarre un annuncio).
 * @param {string} date - YYYY-MM-DD
 * @param {string} [pathOverride] - percorso del file da leggere (per i test)
 */
export function collectNeedsReview(date, pathOverride) {
  const path = pathOverride || NEEDS_REVIEW_PATH;
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const items = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [url, rowDate, code, reason] = line.split('\t');
    if (rowDate?.trim() !== date) continue;
    items.push({ url: url?.trim(), date: rowDate?.trim(), code: code?.trim(), reason: reason?.trim() });
  }
  return items;
}

/**
 * Legge data/triage-rejected.tsv e restituisce le righe del giorno dato.
 * Formato riga: url\tdata ISO\tpunteggio\tmotivazione (append-only, scritto da
 * lib/triage-gate.mjs via run-evaluations.mjs quando un'offerta da sweep non
 * supera la soglia di triage).
 * @param {string} date - YYYY-MM-DD
 * @param {string} [pathOverride] - percorso del file da leggere (per i test)
 */
export function collectTriageRejected(date, pathOverride) {
  const path = pathOverride || TRIAGE_REJECTED_PATH;
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const items = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [url, rowDate, score, reason] = line.split('\t');
    if (rowDate?.trim() !== date) continue;
    items.push({ url: url?.trim(), date: rowDate?.trim(), score: Number.parseFloat(score), reason: reason?.trim() });
  }
  return items;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const outDir = join(ROOT, 'reports', 'daily');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}.md`);
  writeFileSync(outPath, renderDigest({
    date,
    entries: collectEntries(date),
    needsReview: collectNeedsReview(date),
    triageRejected: collectTriageRejected(date),
  }), 'utf-8');
  console.log(`📄  Digest scritto: ${outPath}`);
}
