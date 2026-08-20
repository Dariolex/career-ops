import {
  cleanExtractedText, isExtractionSufficient, buildExtractionResult,
} from './jd-extract.mjs';

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL: ${label}`); }
}

// --- cleanExtractedText ---

const messy = '  Riga 1  \n\n\n  Riga 2\r\n\r\n\r\nRiga 3  \n   \nRiga 4  ';
const cleaned = cleanExtractedText(messy);
ok('collassa righe vuote multiple', cleaned.text === 'Riga 1\nRiga 2\nRiga 3\nRiga 4');
ok('testo corto non e troncato', cleaned.truncated === false);

const long = 'x'.repeat(20000);
const longResult = cleanExtractedText(long);
ok('testo lungo viene troncato a 15000', longResult.text.length === 15000);
ok('flag truncated a true per testo lungo', longResult.truncated === true);

ok('testo vuoto/null non esplode', cleanExtractedText(null).text === '');

// --- isExtractionSufficient ---

ok('testo sotto 200 caratteri insufficiente', isExtractionSufficient('breve') === false);
ok('testo vuoto insufficiente', isExtractionSufficient('') === false);
ok('testo di 250 caratteri sufficiente', isExtractionSufficient('y'.repeat(250)) === true);

// --- buildExtractionResult: contenuto reale (nessun apply control passato,
// deve comunque essere trattato come estraibile — vedi commento nel modulo) ---

const realJobBody = `
Senior Privacy Counsel — Acme Corp

We are looking for an experienced Senior Privacy Counsel to lead our GDPR
and AI governance programme across the EU. You will own DPIAs, RoPA, and
manage relationships with supervisory authorities.

Requirements: 8+ years in data protection law, CIPP/E certification,
fluent English and Italian.

Apply now via our careers page.
`.repeat(3); // supera la soglia minima di 300 caratteri di classifyLiveness

const realJobResult = buildExtractionResult({
  status: 200,
  requestedUrl: 'https://acme.example.com/jobs/123',
  finalUrl: 'https://acme.example.com/jobs/123',
  bodyText: realJobBody,
});
ok('annuncio reale (200, contenuto sostanzioso): estrazione riuscita', realJobResult.success === true);
ok('testo estratto contiene il titolo del ruolo', realJobResult.text.includes('Senior Privacy Counsel'));

// --- buildExtractionResult: annuncio scaduto (HTTP 410) ---

const expiredResult = buildExtractionResult({
  status: 410,
  requestedUrl: 'https://acme.example.com/jobs/999',
  finalUrl: 'https://acme.example.com/jobs/999',
  bodyText: 'Gone',
});
ok('annuncio scaduto (410): estrazione fallita', expiredResult.success === false);
ok('annuncio scaduto: motivo riportato', expiredResult.code === 'http_gone');

// --- buildExtractionResult: blocco anti-bot ---

const challengeResult = buildExtractionResult({
  status: 200,
  requestedUrl: 'https://acme.example.com/jobs/1',
  finalUrl: 'https://acme.example.com/jobs/1',
  bodyText: 'Just a moment... Checking your browser before accessing acme.example.com.',
});
ok('sfida anti-bot: estrazione fallita', challengeResult.success === false);
ok('sfida anti-bot: codice bot_challenge', challengeResult.code === 'bot_challenge');

// --- buildExtractionResult: contenuto insufficiente (pagina quasi vuota) ---

const emptyPageResult = buildExtractionResult({
  status: 200,
  requestedUrl: 'https://acme.example.com/jobs/2',
  finalUrl: 'https://acme.example.com/jobs/2',
  bodyText: 'Home | Contatti',
});
ok('pagina quasi vuota: estrazione fallita', emptyPageResult.success === false);

if (failed > 0) {
  console.error(`\n${failed} test falliti, ${passed} riusciti.`);
  process.exit(1);
} else {
  console.log(`Tutti i ${passed} test sono passati.`);
  process.exit(0);
}
