#!/usr/bin/env node
/**
 * obsidian-export.mjs — export Markdown compatibile con Obsidian.
 *
 * Vista derivata e rigenerabile: la verità resta in data/ e reports/.
 * Cancellare obsidian/ e rieseguire è sempre sicuro.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { evaluateCareerScore } from './career-score.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Un valore YAML che contiene due punti, virgolette o # va quotato. */
function yamlValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value);
  if (/[:#"'\n]/.test(text)) {
    // Il backslash va escaped PRIMA delle virgolette: altrimenti un valore
    // come "C:\Users\..." (path Windows) produce YAML non valido — le
    // virgolette doppie escaped a valle raddoppierebbero anche i backslash
    // appena inseriti da questo stesso escaping.
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return text;
}

function bulletList(items, emptyLabel) {
  if (!items || items.length === 0) return `_${emptyLabel}_`;
  return items.map(item => `- ${item}`).join('\n');
}

/**
 * @param {Object} job
 * @returns {string} Nota Markdown con frontmatter.
 */
export function renderJobNote(job) {
  return [
    '---',
    `job_id: ${yamlValue(job.job_id)}`,
    `company: ${yamlValue(job.company)}`,
    `title: ${yamlValue(job.title)}`,
    `location: ${yamlValue(job.location)}`,
    `score: ${job.score ?? ''}`,
    `classification: ${yamlValue(job.classification)}`,
    `source: ${yamlValue(job.source)}`,
    `url: ${yamlValue(job.url)}`,
    `discovered: ${yamlValue(job.discovered)}`,
    '---',
    '',
    `# ${job.title || 'Ruolo non indicato'}`,
    '',
    '## Score',
    '',
    `**${job.score ?? '—'}/100 — ${job.classification || 'non classificato'}**`,
    '',
    '## Why it fits',
    '',
    job.whyItFits || '_Non disponibile_',
    '',
    '## Missing requirements',
    '',
    bulletList(job.requirements, 'Nessun requisito estratto'),
    '',
    '## Gaps',
    '',
    bulletList(job.gaps, 'Nessun gap rilevato'),
    '',
    '## Salary',
    '',
    job.salary || '_Non dichiarato dall\'annuncio_',
    '',
    '## Company',
    '',
    job.company || '_Non indicata_',
    '',
    '## Notes',
    '',
    job.notes || '',
    '',
    '## Application',
    '',
    '- [ ] Candidatura inviata',
    '',
  ].join('\n');
}

function summaryField(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim() || null;
}

function slugify(value) {
  return String(value || 'job')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'job';
}

/**
 * Legge reportsDir e converte ogni report con Career Score in un job note
 * Obsidian ({job_id, note}), estraendo i campi SCORE_SUMMARY (COMPANY, ROLE,
 * LOCATION, SALARY, URL, SOURCE). Esportata perché è il passaggio da report
 * testuale reale a note renderizzata — il test coverage gap segnalato dalla
 * review finale copriva solo renderJobNote() con oggetti costruiti a mano,
 * mai questo ciclo di lettura.
 * @param {string} reportsDir
 * @returns {Array<{job_id: string, note: string}>}
 */
export function collectJobNotes(reportsDir) {
  const jobs = [];
  if (!existsSync(reportsDir)) return jobs;

  for (const file of readdirSync(reportsDir)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(reportsDir, file), 'utf-8');
    let scored;
    try {
      scored = evaluateCareerScore(text);
    } catch {
      continue; // report senza Career Score: non è materiale di questo export
    }

    const company = summaryField(text, 'COMPANY') || 'unknown';
    const title = summaryField(text, 'ROLE') || 'unknown';
    const jobId = `${slugify(company)}-${slugify(title)}`;

    const note = renderJobNote({
      job_id: jobId,
      company,
      title,
      location: summaryField(text, 'LOCATION'),
      score: scored.total,
      classification: scored.classification,
      source: summaryField(text, 'SOURCE') || 'career-ops',
      url: summaryField(text, 'URL'),
      discovered: file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '',
      whyItFits: scored.reasoning,
      requirements: scored.missingRequirements,
      gaps: scored.weaknesses,
      salary: scored.salaryUnknown ? null : summaryField(text, 'SALARY'),
      notes: '',
    });

    jobs.push({ job_id: jobId, note });
  }
  return jobs;
}

// pathToFileURL evita il confronto letterale file://+argv[1], che su Windows
// fallisce sempre (backslash non convertiti, spazi non percent-encoded).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportsDir = join(ROOT, 'reports');
  const outDir = join(ROOT, 'obsidian', 'jobs');
  mkdirSync(outDir, { recursive: true });

  const jobs = collectJobNotes(reportsDir);
  for (const job of jobs) {
    writeFileSync(join(outDir, `${job.job_id}.md`), job.note, 'utf-8');
  }

  console.log(`📓  Export Obsidian: ${jobs.length} note in ${outDir}`);
}
