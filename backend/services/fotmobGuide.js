/**
 * Liest das TV-Programm von fotmob.com/de/tv-guide/<land>.
 *
 * WARUM WEDER PUPPETEER NOCH CHEERIO
 * ----------------------------------
 * FotMob ist eine Next.js-Seite und liefert den kompletten Datensatz bereits
 * im ausgelieferten HTML mit, im Script-Tag "__NEXT_DATA__":
 *
 *   props.pageProps.fallback["tvguide-groups:at"]["20260912"][]
 *     -> { leagueId, leagueName, leagueCcode, matches: [
 *            { id, utcTime, home:{id,name}, away:{id,name}, channels:[{name}] } ] }
 *
 * Damit ist das Ergebnis bereits strukturiertes JSON:
 *   - Puppeteer wuerde einen kompletten Chromium (~300 MB) starten, um
 *     JavaScript auszufuehren, dessen Ergebnis schon im HTML steht.
 *   - Cheerio wuerde HTML-Elemente abklappern - bruechiger als das JSON,
 *     und die Liga-Zuordnung steckt dort nur in der Ueberschrift daneben.
 *
 * Ein einziger fetch() genuegt und liefert sieben Tage auf einmal.
 * Sollte FotMob irgendwann auf reines Client-Rendering umstellen, faellt das
 * hier sofort mit einer klaren Meldung auf - dann waere Puppeteer der Plan B.
 *
 * RUECKSICHT AUF DIE QUELLE
 * -------------------------
 *   - genau eine Anfrage pro Lauf, sieben Tage auf einmal
 *   - Mindestabstand zwischen zwei echten Abrufen (Standard 6 Stunden),
 *     dazwischen wird die zwischengespeicherte Antwort verwendet
 *   - echter User-Agent, ueber SCRAPER_USER_AGENT anpassbar
 *   - Zeitlimit und maximal zwei Wiederholungen mit wachsender Pause
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../db/index.js';

const PAGES = {
  AT: 'https://www.fotmob.com/de/tv-guide/at',
  DE: 'https://www.fotmob.com/de/tv-guide/de',
};

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Sender, die eher App oder Website als Fernsehkanal sind. Nur fuer die Anzeige. */
const STREAM_PATTERN =
  /(sky x|sky go|dazn|onefootball|youtube|app\b|stream|player|\bnow\b|rtl\+|magentasport|\+$|ppv|\.de\b|\.com\b|prime video|apple tv|fanatiz|sportdigital)/i;

export function classifyChannel(name) {
  return STREAM_PATTERN.test(name) ? 'stream' : 'tv';
}

/**
 * FotMob traegt fuer noch offene Uebertragungen einen Pseudo-Sender ein
 * ("Noch zu bestaetigen" / "To be confirmed"). Das ist kein Kanal, sondern
 * dieselbe Aussage wie unser eigener Platzhalter - also aussortieren, damit
 * nicht zwei verschiedene Platzhaltertexte nebeneinander stehen.
 */
const PSEUDO_CHANNEL = /^(noch zu best[äa]tigen|to be confirmed|tba|tbc|tbd|unknown|unbekannt)$/i;

export function isRealChannel(name) {
  return !PSEUDO_CHANNEL.test(String(name).trim());
}

const cacheDir = () => path.join(PROJECT_ROOT, 'data', 'cache');
const cacheFile = (country) => path.join(cacheDir(), `fotmob-tvguide-${country.toLowerCase()}.html`);

function cacheAge(country) {
  try {
    return (Date.now() - fs.statSync(cacheFile(country)).mtimeMs) / 1000;
  } catch {
    return Infinity;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Holt die Seite - oder den Zwischenspeicher, wenn der noch frisch genug ist.
 *
 * @param {string} country            AT | DE
 * @param {object} opts
 * @param {number} opts.minIntervalSec  Mindestabstand zwischen echten Abrufen
 * @param {boolean} opts.force          Zwischenspeicher ignorieren
 * @returns {Promise<{html: string, fromCache: boolean, ageSec: number, url: string}>}
 */
export async function fetchGuide(country = 'AT', { minIntervalSec = 6 * 3600, force = false } = {}) {
  const url = PAGES[country];
  if (!url) throw new Error(`Fuer "${country}" ist keine FotMob-Seite hinterlegt.`);

  const age = cacheAge(country);

  if (!force && age < minIntervalSec) {
    return {
      html: fs.readFileSync(cacheFile(country), 'utf8'),
      fromCache: true,
      ageSec: Math.round(age),
      url,
    };
  }

  const userAgent = process.env.SCRAPER_USER_AGENT || DEFAULT_USER_AGENT;
  let letzterFehler;

  for (const versuch of [0, 1, 2]) {
    if (versuch > 0) await sleep(versuch * 3000); // 3 s, dann 6 s

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': 'de-AT,de;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(25000),
      });

      if (res.status === 429 || res.status === 503) {
        throw new Error(`FotMob drosselt gerade (HTTP ${res.status}) - spaeter erneut versuchen.`);
      }
      if (!res.ok) throw new Error(`FotMob antwortete mit HTTP ${res.status}`);

      const html = await res.text();

      fs.mkdirSync(cacheDir(), { recursive: true });
      fs.writeFileSync(cacheFile(country), html, 'utf8');

      return { html, fromCache: false, ageSec: 0, url };
    } catch (err) {
      letzterFehler = err;
    }
  }

  // Lieber veraltete Daten als gar keine - aber sichtbar als solche.
  if (age !== Infinity) {
    return {
      html: fs.readFileSync(cacheFile(country), 'utf8'),
      fromCache: true,
      ageSec: Math.round(age),
      url,
      stale: true,
      error: letzterFehler.message,
    };
  }

  throw letzterFehler;
}

/**
 * Zieht die Spiele samt Sendern aus dem HTML.
 *
 * @returns {Array<{sourceMatchId, leagueId, leagueName, leagueCcode,
 *                  home, away, homeId, awayId, kickoffUtc,
 *                  channels: Array<{name, type, position}>}>}
 */
export function parseGuide(html) {
  const tag = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);

  if (!tag) {
    throw new Error(
      'Kein __NEXT_DATA__ in der Seite. FotMob hat vermutlich den Aufbau geaendert - ' +
        'siehe Kommentar am Kopf von backend/services/fotmobGuide.js.'
    );
  }

  let data;
  try {
    data = JSON.parse(tag[1]);
  } catch (err) {
    throw new Error(`__NEXT_DATA__ ist kein gueltiges JSON: ${err.message}`);
  }

  const fallback = data?.props?.pageProps?.fallback ?? {};
  const key = Object.keys(fallback).find((k) => k.startsWith('tvguide-groups'));

  if (!key) {
    throw new Error(
      `Kein Schluessel "tvguide-groups*" in den Seitendaten. Vorhanden: ${
        Object.keys(fallback).slice(0, 8).join(', ') || '(nichts)'
      }`
    );
  }

  const spiele = [];

  for (const gruppen of Object.values(fallback[key] ?? {})) {
    for (const gruppe of gruppen ?? []) {
      for (const m of gruppe.matches ?? []) {
        if (!m?.home?.name || !m?.away?.name || !m?.utcTime) continue;

        const channels = (m.channels ?? [])
          .map((c) => c?.name)
          .filter((n) => typeof n === 'string' && n.trim())
          .filter(isRealChannel)
          .map((n, i) => ({ name: n.trim(), type: classifyChannel(n), position: i }));

        spiele.push({
          sourceMatchId: m.id,
          leagueId: gruppe.leagueId ?? m.leagueId ?? null,
          leagueName: gruppe.leagueName ?? m.leagueName ?? null,
          leagueCcode: gruppe.leagueCcode ?? m.leagueCcode ?? null,
          home: m.home.name,
          away: m.away.name,
          homeId: m.home.id ?? null,
          awayId: m.away.id ?? null,
          kickoffUtc: m.utcTime,
          channels,
        });
      }
    }
  }

  if (spiele.length === 0) {
    throw new Error('Seitendaten gelesen, aber kein einziges Spiel darin gefunden.');
  }

  return spiele;
}

/** Bequemer Einzelaufruf. */
export async function loadGuide(country = 'AT', options = {}) {
  const res = await fetchGuide(country, options);
  return { ...res, matches: parseGuide(res.html) };
}
