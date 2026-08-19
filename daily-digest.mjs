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

/**
 * @param {{date: string, entries: Array<Object>}} input
 * @returns {string} Markdown del digest.
 */
export function renderDigest({ date, entries }) {
  const header = [`# Career Intelligence — ${date}`, ''];

  if (!entries || entries.length === 0) {
    return [
      ...header,
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
  ].join('\n');
}

/** Estrae un campo dal blocco SCORE_SUMMARY prodotto dai modes. */
function summaryField(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
}

function collectEntries(date) {
  const reportsDir = join(ROOT, 'reports');
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const outDir = join(ROOT, 'reports', 'daily');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${date}.md`);
  writeFileSync(outPath, renderDigest({ date, entries: collectEntries(date) }), 'utf-8');
  console.log(`📄  Digest scritto: ${outPath}`);
}
