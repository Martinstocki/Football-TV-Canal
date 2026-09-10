/**
 * Fuehrt die Abgleich-Skripte nach Zeitplan aus.
 *
 * WARUM KINDPROZESSE STATT IMPORT
 * -------------------------------
 * Alle drei Skripte beenden sich mit process.exit(). Wuerde man sie in den
 * Serverprozess importieren, riss der erste Aufruf den Webserver mit.
 * Als Kindprozess kann ausserdem kein Absturz und keine Endlosschleife im
 * Skript den Server treffen - schlimmstenfalls laeuft das Zeitlimit ab.
 *
 * REIHENFOLGE
 * -----------
 * Die Jobs laufen nacheinander, nicht parallel:
 *   1. sync      football-data -> Tabelle matches      (speist die Web-App)
 *   2. fixtures  football-data -> Tabelle fixtures
 *   3. tv        FotMob        -> Sender + AT1/EL/UECL
 *
 * "tv" muss zuletzt laufen, weil es die Sender den Spielen zuordnet, die
 * die beiden anderen gerade geholt haben. Ein Fehler in einem Job stoppt
 * die anderen nicht.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import cron from 'node-cron';
import { PROJECT_ROOT } from '../db/index.js';
import { log } from './logger.js';

export const JOBS = {
  sync: {
    script: 'scripts/import-matches.js',
    args: [],
    beschreibung: 'Spielplaene -> matches (Web-App)',
    // Zeile aus der Ausgabe, die als Kurzfassung ins Protokoll wandert
    summary: /^Fertig: .*/m,
  },
  fixtures: {
    script: 'scripts/fetch-fixtures.js',
    args: [],
    beschreibung: 'Spielplaene -> fixtures',
    summary: /^Gesamt: .*/m,
  },
  tv: {
    script: 'scripts/fetch-tv-guide.js',
    args: [],
    beschreibung: 'TV-Sender von FotMob',
    summary: /^\s*tv_channels:\s+.*/m,
  },
};

export const DEFAULT_JOBS = ['sync', 'fixtures', 'tv'];
export const DEFAULT_CRON = '0 8,18 * * *';

/** Verhindert, dass sich zwei Laeufe ueberholen. */
let laeuftGerade = false;

/** Woran man in der Ausgabe eine Fehlermeldung erkennt. */
const FEHLER_MUSTER =
  /FEHLER|Fehler|Error|abgelehnt|verweigert|fehlt\b|HTTP \d{3}|Limit|Zeitlimit|nicht freigeschaltet|ECONN|ENOTFOUND|Traceback/i;

/**
 * Sucht die Zeilen heraus, die den Fehler erklaeren.
 *
 * Einfach die letzten Zeilen zu nehmen reicht nicht: fetch-fixtures.js gibt
 * am Ende auch im Fehlerfall die komplette Spieltabelle aus, sodass die
 * eigentliche Meldung weit oben steht und aus dem Protokoll fiele.
 */
function fehlerZeilen(out, err, max = 12) {
  const saeubern = (s) => s.split('\n').map((z) => z.trimEnd()).filter(Boolean);

  const fehlerStrom = saeubern(err);
  if (fehlerStrom.length > 0) return fehlerStrom.slice(-max);

  const auffaellig = saeubern(out).filter((z) => FEHLER_MUSTER.test(z));
  if (auffaellig.length > 0) return auffaellig.slice(0, max);

  return saeubern(out).slice(-max);
}

/**
 * Startet ein Skript als Kindprozess und wartet auf sein Ende.
 * Wirft nie - Fehler kommen als Ergebnisobjekt zurueck.
 */
function fuehreAus(name, { timeoutMs }) {
  const job = JOBS[name];

  return new Promise((resolve) => {
    const start = Date.now();
    const skript = path.join(PROJECT_ROOT, job.script);

    let kind;
    try {
      kind = spawn(process.execPath, [skript, ...job.args], {
        cwd: PROJECT_ROOT,
        env: process.env,
        windowsHide: true,
      });
    } catch (err) {
      return resolve({
        name, ok: false, dauerMs: 0, code: null,
        fehler: `Prozess liess sich nicht starten: ${err.message}`, ausgabe: [],
      });
    }

    let out = '';
    let err = '';
    let abgebrochen = false;

    const uhr = setTimeout(() => {
      abgebrochen = true;
      kind.kill('SIGKILL');
    }, timeoutMs);

    kind.stdout.on('data', (d) => { out += d.toString(); });
    kind.stderr.on('data', (d) => { err += d.toString(); });

    kind.on('error', (e) => {
      clearTimeout(uhr);
      resolve({
        name, ok: false, dauerMs: Date.now() - start, code: null,
        fehler: e.message, ausgabe: [],
      });
    });

    kind.on('close', (code) => {
      clearTimeout(uhr);

      const zeilen = fehlerZeilen(out, err);
      const kurz = job.summary ? (out.match(job.summary)?.[0] ?? '').trim() : '';

      resolve({
        name,
        ok: !abgebrochen && code === 0,
        dauerMs: Date.now() - start,
        code,
        fehler: abgebrochen
          ? `Zeitlimit von ${Math.round(timeoutMs / 1000)} s ueberschritten, Prozess beendet`
          : code === 0
            ? null
            : `Beendet mit Code ${code}`,
        kurz,
        ausgabe: zeilen,
      });
    });
  });
}

/**
 * Fuehrt alle gewuenschten Jobs nacheinander aus und protokolliert.
 * @returns {Promise<{ok: number, fehler: number, uebersprungen: boolean}>}
 */
export async function laufStarten({
  jobs = DEFAULT_JOBS,
  timeoutMs = Number(process.env.SCHEDULE_TIMEOUT_MS ?? 10 * 60 * 1000),
  anlass = 'Zeitplan',
} = {}) {
  if (laeuftGerade) {
    log('warnung', `Lauf uebersprungen (${anlass}) - der vorherige laeuft noch.`);
    return { ok: 0, fehler: 0, uebersprungen: true };
  }

  laeuftGerade = true;
  const start = Date.now();

  log('start', `Lauf gestartet (${anlass}): ${jobs.join(', ')}`);

  let ok = 0;
  let fehler = 0;

  try {
    for (const name of jobs) {
      if (!JOBS[name]) {
        log('warnung', `Unbekannter Job "${name}" - uebersprungen.`);
        continue;
      }

      const e = await fuehreAus(name, { timeoutMs });
      const s = (e.dauerMs / 1000).toFixed(1);

      if (e.ok) {
        ok++;
        log('ok', `${name.padEnd(8)} ${s.padStart(6)}s  ${e.kurz || JOBS[name].beschreibung}`);
      } else {
        fehler++;
        // Bei Fehlern die letzten Ausgabezeilen mitschreiben - ohne sie ist
        // im Nachhinein nicht zu erkennen, woran es lag.
        log(
          'fehler',
          `${name.padEnd(8)} ${s.padStart(6)}s  ${e.fehler}`,
          e.ausgabe.slice(-12)
        );
      }
    }
  } finally {
    laeuftGerade = false;
  }

  const s = ((Date.now() - start) / 1000).toFixed(1);
  log('ende', `${ok} ok, ${fehler} fehlgeschlagen, ${s}s gesamt`);

  return { ok, fehler, uebersprungen: false };
}

/**
 * Haengt den Zeitplan ein. Gibt die Cron-Aufgabe zurueck oder null,
 * wenn nichts eingerichtet wurde.
 */
export function planEinrichten({
  ausdruck = process.env.SCHEDULE_CRON || DEFAULT_CRON,
  jobs = jobsAusUmgebung(),
  zeitzone = process.env.TZ || 'Europe/Vienna',
} = {}) {
  if (!cron.validate(ausdruck)) {
    log('warnung', `"${ausdruck}" ist kein gueltiger Cron-Ausdruck - kein Zeitplan aktiv.`, [
      'Erwartet werden fuenf Felder: Minute Stunde Tag Monat Wochentag',
      'Beispiel taeglich 08:00 und 18:00:  0 8,18 * * *',
      'In PowerShell den Ausdruck in Anfuehrungszeichen setzen, sonst',
      'zerlegt die Shell ihn in einzelne Argumente.',
    ]);
    return null;
  }

  const aufgabe = cron.schedule(
    ausdruck,
    () => {
      // Absichtlich kein await: cron soll nicht auf uns warten.
      laufStarten({ jobs }).catch((e) => log('fehler', `Unerwartet: ${e.message}`));
    },
    { timezone: zeitzone }
  );

  log('info', `Zeitplan aktiv: "${ausdruck}" (${zeitzone}), Jobs: ${jobs.join(', ')}`);
  return aufgabe;
}

export function jobsAusUmgebung() {
  const roh = process.env.SCHEDULE_JOBS;
  if (!roh) return DEFAULT_JOBS;

  const gewaehlt = roh.split(',').map((s) => s.trim()).filter(Boolean);
  const gueltig = gewaehlt.filter((n) => JOBS[n]);

  if (gueltig.length === 0) {
    log('warnung', `SCHEDULE_JOBS="${roh}" enthaelt keinen bekannten Job - nehme Standard.`);
    return DEFAULT_JOBS;
  }
  return gueltig;
}
