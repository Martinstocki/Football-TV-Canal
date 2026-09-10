#!/usr/bin/env node
/**
 * Eigenstaendiger Zeitplaner - fuer den Fall, dass die Abgleiche laufen
 * sollen, ohne dass der Webserver laeuft. Bei laufendem Server ist der
 * Zeitplan dort schon eingebaut (siehe backend/server.js).
 *
 *   npm run scheduler            Zeitplan starten (08:00 und 18:00)
 *   npm run scheduler:once       einmal sofort durchlaufen, dann Ende
 *   npm run scheduler:test       jede Minute - zum Ausprobieren
 *
 *   node scripts/scheduler.js --cron "*\/2 * * * *"   eigener Rhythmus
 *   node scripts/scheduler.js --jobs tv               nur einzelne Jobs
 *   node scripts/scheduler.js --once --jobs tv        einmal, nur TV-Sender
 *
 * Beenden mit Strg+C.
 */
import 'dotenv/config';
import { initSchema } from '../backend/db/index.js';
import {
  laufStarten,
  planEinrichten,
  jobsAusUmgebung,
  JOBS,
  DEFAULT_CRON,
} from '../backend/services/scheduler.js';
import { log, logPath } from '../backend/services/logger.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

/**
 * Cron-Ausdruck einsammeln.
 *
 * PowerShell zerlegt ein unquotiertes "* * * * *" in fuenf einzelne
 * Argumente - dann kaeme bei --cron nur "*" an und der Zeitplan waere
 * still kaputt. Deshalb alles bis zum naechsten --schalter einsammeln
 * und wieder zusammensetzen.
 */
function cronArgument(fallback) {
  const i = process.argv.indexOf('--cron');
  if (i === -1) return fallback;

  const teile = [];
  for (let k = i + 1; k < process.argv.length; k++) {
    if (process.argv[k].startsWith('--')) break;
    teile.push(process.argv[k]);
  }

  return teile.length > 0 ? teile.join(' ') : fallback;
}

initSchema();

const gewaehlteJobs = arg('jobs')
  ? arg('jobs').split(',').map((s) => s.trim()).filter((n) => JOBS[n])
  : jobsAusUmgebung();

if (gewaehlteJobs.length === 0) {
  console.error(`Keine gueltigen Jobs. Erlaubt: ${Object.keys(JOBS).join(', ')}`);
  process.exit(1);
}

console.log(`Protokoll: ${logPath()}\n`);

// --- Einmalig durchlaufen --------------------------------------------------

if (flag('once')) {
  const { fehler } = await laufStarten({ jobs: gewaehlteJobs, anlass: 'manuell' });
  process.exit(fehler > 0 ? 1 : 0);
}

// --- Dauerbetrieb ----------------------------------------------------------

const ausdruck = cronArgument(process.env.SCHEDULE_CRON || DEFAULT_CRON);

const aufgabe = planEinrichten({ ausdruck, jobs: gewaehlteJobs });
if (!aufgabe) process.exit(1);

console.log('\nLaeuft. Beenden mit Strg+C.');

// Sauber aufhoeren, damit ein laufender Job noch zu Ende protokolliert wird.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('info', 'Zeitplaner beendet.');
    aufgabe.stop();
    process.exit(0);
  });
}
