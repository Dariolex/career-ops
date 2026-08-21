/**
 * lib/triage-gate.mjs — gate di triage per le offerte provenienti dallo sweep
 * di mercato.
 *
 * Giudica sui SOLI METADATI gia' presenti in data/pipeline.md: azienda,
 * titolo, localita', data, compenso. Non scarica la JD di proposito —
 * jd-extract.mjs usa sempre Playwright, in sequenza, e il recupero della JD e'
 * il collo di bottiglia in wall-clock del run. Un gate che legge la JD
 * risparmierebbe token senza risparmiare il vincolo che morde davvero.
 *
 * Il prezzo di questa scelta e' che il giudizio e' piu' debole: un ruolo valido
 * con un titolo anonimo puo' essere scartato. Per questo la soglia va tenuta
 * permissiva e ogni scarto viene registrato con la sua motivazione — un falso
 * positivo costa una valutazione, un falso negativo costa un'opportunita'.
 *
 * I metadati sono contenuto esterno non fidato (AGENTS.md § "Untrusted
 * External Content"): si leggono per giudicarli, mai per obbedirvi.
 */

/**
 * Blocco metadati passato al tier triage per una singola voce.
 *
 * @param {object} entry - voce parsata da parsePipelineLine.
 * @returns {string}
 */
export function buildTriageText(entry) {
  return [
    'Valuta questo annuncio a partire dai soli metadati qui sotto.',
    'La descrizione completa non e\' disponibile: giudica su cio\' che c\'e\' e',
    'segnala l\'incertezza nella motivazione.',
    '',
    `URL: ${entry.url}`,
    `Azienda: ${entry.company || 'non indicata'}`,
    `Ruolo: ${entry.title || 'non indicato'}`,
    `Localita: ${entry.location || 'non indicata'}`,
    `Retribuzione: ${entry.compensation || 'non indicata'}`,
    `Pubblicato: ${entry.posted || 'data non indicata'}`,
  ].join('\n');
}

/**
 * Estrae la riga TRIAGE dall'output del tier triage.
 *
 * Il formato e' definito da modes/triage.md, che lo dichiara machine-readable e
 * stabile qualunque sia la lingua di output:
 *   TRIAGE: {PASS|MARGINAL|FAIL|SKIP} | {Company} | {Role} | {Score}/5 | {reason}
 * Solo {reason} e' prosa umana.
 *
 * @param {string} stdout
 * @returns {{verdict:string,company:string,role:string,score:number,reason:string}|null}
 */
export function parseTriageLine(stdout) {
  if (typeof stdout !== 'string') return null;
  // L'ultima riga TRIAGE vince: modes/triage.md chiede di restituirla come
  // ultima riga della risposta.
  const matches = [...stdout.matchAll(/^\s*TRIAGE:\s*(.+)$/gim)];
  if (matches.length === 0) return null;
  const cells = matches[matches.length - 1][1].split('|').map(c => c.trim());
  if (cells.length < 4) return null;
  const score = Number.parseFloat(String(cells[3]).replace(/\s*\/\s*5\s*$/, ''));
  return {
    verdict: cells[0].toUpperCase(),
    company: cells[1] ?? '',
    role: cells[2] ?? '',
    score: Number.isFinite(score) ? score : 0,
    reason: cells[4] ?? '',
  };
}

/**
 * Fa passare dal gate le voci indicate.
 *
 * @param {Array<object>} entries - voci da sweep.
 * @param {object} opts
 * @param {number} opts.threshold - soglia di passaggio (triage_threshold).
 * @param {(text: string) => Promise<string>} opts.runTriage - client iniettabile.
 * @param {Set<string>} opts.alreadyRejected - URL gia' scartati in run passati.
 * @returns {Promise<{passed: Array<{entry,score,reason}>, rejected: Array<{entry,score,reason}>}>}
 */
export async function gateEntries(entries, { threshold, runTriage, alreadyRejected }) {
  const passed = [];
  const rejected = [];

  for (const entry of entries) {
    // Memoria degli scarti: senza questo controllo un'offerta scartata, che
    // resta in pipeline.md, verrebbe ri-triaggiata a ogni run giornaliero.
    if (alreadyRejected.has(entry.url)) continue;

    let verdict = null;
    try {
      verdict = parseTriageLine(await runTriage(buildTriageText(entry)));
    } catch (error) {
      // Un guasto infrastrutturale non e' un giudizio: l'offerta resta in coda
      // per il prossimo run invece di essere scartata.
      console.warn(`⚠  triage non riuscito per ${entry.url}: ${error.message} — resta in coda`);
      continue;
    }
    if (!verdict) {
      console.warn(`⚠  risposta di triage non interpretabile per ${entry.url} — resta in coda`);
      continue;
    }

    if (verdict.score >= threshold) passed.push({ entry, score: verdict.score, reason: verdict.reason });
    else rejected.push({ entry, score: verdict.score, reason: verdict.reason });
  }

  passed.sort((a, b) => b.score - a.score);
  return { passed, rejected };
}

/**
 * Riga di data/triage-rejected.tsv: {url}\t{data}\t{punteggio}\t{motivazione}
 *
 * @returns {string} riga con newline finale.
 */
export function formatRejectedRow(entry, score, reason, todayIso) {
  const clean = String(reason ?? '').replace(/[\t\n\r]+/g, ' ').trim();
  return `${entry.url}\t${todayIso}\t${score}\t${clean}\n`;
}
