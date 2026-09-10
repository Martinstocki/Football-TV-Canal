/**
 * Schreibt Protokollzeilen nach log.txt (Pfad ueber LOG_FILE aenderbar).
 *
 * Bewusst einfach gehalten: anhaengen, eine Zeile je Ereignis, Zeitstempel
 * in Ortszeit. Wenn die Datei zu gross wird, wird sie einmal umbenannt -
 * ohne das laeuft so ein Protokoll auf Dauer voll.
 *
 * Schreibfehler duerfen den Ablauf NIE stoppen: ein volles Laufwerk soll
 * den naechtlichen Abgleich nicht verhindern. Sie landen deshalb nur auf
 * der Konsole.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB, dann wird rotiert

export function logPath() {
  return path.resolve(PROJECT_ROOT, process.env.LOG_FILE || 'log.txt');
}

function zeitstempel(d = new Date()) {
  return d.toLocaleString('sv-SE', {
    timeZone: process.env.TZ || 'Europe/Vienna',
    hour12: false,
  }); // -> "2026-09-10 18:00:03"
}

/** Bei Ueberschreiten der Groesse einmal nach log.1.txt wegrollen. */
function rotiereWennNoetig(datei) {
  try {
    if (fs.statSync(datei).size < MAX_BYTES) return;

    const alt = datei.replace(/(\.[^.]+)?$/, '.1$1');
    fs.rmSync(alt, { force: true });
    fs.renameSync(datei, alt);
  } catch {
    // Datei existiert noch nicht oder ist gerade gesperrt - beides egal.
  }
}

/**
 * @param {'start'|'ok'|'fehler'|'ende'|'info'|'warnung'} art
 * @param {string} text
 * @param {string[]} [details]  eingerueckte Folgezeilen, z. B. Fehlerausgabe
 */
export function log(art, text, details = []) {
  const zeile =
    `${zeitstempel()}  [${art.padEnd(8)}] ${text}\n` +
    details.map((d) => `${' '.repeat(21)}  | ${d}\n`).join('');

  process.stdout.write(zeile);

  const datei = logPath();
  try {
    rotiereWennNoetig(datei);
    fs.appendFileSync(datei, zeile, 'utf8');
  } catch (err) {
    process.stdout.write(`  (Protokoll nicht schreibbar: ${err.message})\n`);
  }
}

/** Letzte n Zeilen aus dem Protokoll, fuer "npm run log". */
export function tail(n = 40) {
  try {
    return fs.readFileSync(logPath(), 'utf8').split('\n').filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}
