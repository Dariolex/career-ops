#!/usr/bin/env node
/**
 * run-evaluations.mjs — orchestratore dei tier 2 e 3.
 *
 * Legge le offerte pendenti da data/pipeline.md, applica il tetto di costo e
 * invoca anthropic-eval.mjs su ciascuna. Il tetto è la valvola che impedisce a
 * una giornata anomala di consumare budget imprevisto.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';

const ROOT = dirname(fileURLToPath(import.meta.url));

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

const max = loadMaxEvaluations();
const urls = loadPendingUrls().slice(0, max);

if (urls.length === 0) {
  console.log('Nessuna offerta da valutare.');
  process.exit(0);
}

console.log(`Valutazione di ${urls.length} offerte (tetto: ${max}).`);

let evaluated = 0;
let skipped = 0;

for (const url of urls) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'anthropic-eval.mjs'), '--text', url], {
      stdio: 'inherit',
      env: process.env,
    });
    evaluated++;
  } catch {
    console.warn(`⚠️   Valutazione fallita: ${url}`);
    skipped++;
  }
}

console.log(`\nValutate ${evaluated}, saltate ${skipped}.`);
// Le valutazioni fallite non devono far fallire l'intero workflow: il digest
// deve comunque essere prodotto con ciò che è riuscito.
process.exit(0);
