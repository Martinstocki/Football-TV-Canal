import ical, { ICalEventStatus } from 'ical-generator';

import { getCompetition } from '../config/competitions.js';
import { findMatches } from '../services/matches.js';
import { availableCountries } from '../services/broadcasts.js';
import { isoDate } from '../services/sync.js';
import { gleich } from '../services/auth.js';

/**
 * Abonnierbarer Kalender: GET /kalender.ics?token=...
 *
 * Liest dieselben Daten wie die Web-Ansicht (findMatches), damit Kalender
 * und App nie unterschiedliche Sender zeigen. Die Tabelle "fixtures" reicht
 * nur 7 Tage voraus und kennt keine Spieltage - fuer den Feed zu wenig.
 *
 * Zeiten stehen als UTC im Feed ("...Z"). Das Handy rechnet sie selbst in
 * seine Zeitzone um, in Oesterreich also nach Europe/Vienna. Die Variante
 * mit TZID=Europe/Vienna scheidet aus: ical-generator schreibt dann den
 * Pflicht-Zeitstempel DTSTAMP ohne Zeitzone, abhaengig von der Zeitzone des
 * Servers - das verstoesst gegen RFC 5545.
 */

const TAGE = 14;
const SPIELDAUER_MS = 2 * 60 * 60 * 1000;
const SENDER_OFFEN = 'Sender noch offen';

// Wie oft Kalender-Apps neu laden sollen. Die Daten aendern sich zweimal
// taeglich (08:00 und 18:00). Google haelt sich nicht daran und laedt nach
// eigenem Takt, Apple beachtet es.
const AKTUALISIERUNG_SEK = 3 * 60 * 60;

const RUNDEN = {
  LEAGUE_STAGE: 'Ligaphase',
  PLAYOFFS: 'Play-offs',
  LAST_32: 'Sechzehntelfinale',
  LAST_16: 'Achtelfinale',
  QUARTER_FINALS: 'Viertelfinale',
  SEMI_FINALS: 'Halbfinale',
  FINAL: 'Finale',
};

const uhrzeitWien = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Sky Sport Austria 2, Sky X" - oder der Platzhalter. */
function senderText(broadcasts = []) {
  const echte = broadcasts.filter((b) => b.source !== 'placeholder');
  if (echte.length === 0) return SENDER_OFFEN;
  const namen = echte.map((b) => b.name).join(', ');
  // Grobe Regel-Angabe (BROADCAST_FALLBACK=rule) als solche kenntlich machen.
  return echte.some((b) => b.approximate) ? `${namen} (vorläufig)` : namen;
}

/** "Premier League · 5. Spieltag" bzw. "Champions League · Ligaphase, 2. Spieltag" */
function rundeText(m) {
  const teile = [];
  if (m.stage && RUNDEN[m.stage]) teile.push(RUNDEN[m.stage]);
  if (m.matchday) teile.push(`${m.matchday}. Spieltag`);
  return teile.join(', ');
}

function beschreibung(m, sender) {
  const zeilen = [
    [m.competitionName, rundeText(m)].filter(Boolean).join(' · '),
    `Anstoß: ${uhrzeitWien.format(new Date(m.utcDate))} Uhr (Wien)`,
    `Sender: ${sender}`,
  ];
  if (m.status === 'POSTPONED') zeilen.push('Achtung: Spiel wurde verschoben.');
  if (m.status === 'CANCELLED') zeilen.push('Achtung: Spiel wurde abgesagt.');
  return zeilen.join('\n');
}

export function kalenderErstellen({ country } = {}) {
  const matches = findMatches({
    // Gleiches Fenster wie der Tab "14 Tage" der Web-Ansicht. Wird bei
    // jedem Abruf neu berechnet, der Feed rollt also von selbst weiter.
    from: isoDate(0),
    to: isoDate(TAGE - 1),
    country,
  });

  const cal = ical({
    name: 'Fußball im TV',
    description: `Spiele der nächsten ${TAGE} Tage mit Sender`,
    prodId: { company: 'fussball-programm', product: 'kalender', language: 'DE' },
    ttl: AKTUALISIERUNG_SEK,
  });

  for (const m of matches) {
    const start = new Date(m.utcDate);
    const kuerzel = getCompetition(m.competitionCode)?.abbr ?? m.competitionCode;
    const sender = senderText(m.broadcasts);
    const verschoben = m.status === 'POSTPONED' ? 'Verschoben: ' : '';

    cal.createEvent({
      // Feste ID je Spiel: aendert sich der Sender, aktualisiert die
      // Kalender-App den bestehenden Termin statt einen zweiten anzulegen.
      id: `spiel-${m.id}@fussball-programm`,
      start,
      end: new Date(start.getTime() + SPIELDAUER_MS),
      summary: `${verschoben}⚽ ${m.homeTeam} – ${m.awayTeam} (${kuerzel})`,
      location: sender,
      description: beschreibung(m, sender),
      status: m.status === 'CANCELLED' ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
    });
  }

  return { cal, anzahl: matches.length };
}

/**
 * Express-Handler. Laeuft VOR der Basic Auth: Google Kalender kann keine
 * Passwoerter mitschicken, nur eine URL abrufen. Der Token in der URL
 * ersetzt deshalb fuer genau diesen Endpunkt das Passwort.
 */
export function kalenderRoute(req, res) {
  const erwartet = process.env.KALENDER_TOKEN;

  // Ohne Token in der .env ist der Feed abgeschaltet - nie "offen".
  if (!erwartet) {
    return res.status(404).type('text').send('Kalender-Feed ist nicht eingerichtet.');
  }
  if (!gleich(req.query.token ?? '', erwartet)) {
    return res.status(403).type('text').send('Ungültiger Token.');
  }

  const standard = (process.env.DEFAULT_COUNTRY || 'AT').toUpperCase();
  const gewuenscht = String(req.query.country || standard).toUpperCase();
  const land = Object.keys(availableCountries()).includes(gewuenscht) ? gewuenscht : standard;
  const { cal } = kalenderErstellen({ country: land });

  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="fussball-tv.ics"',
    // Die URL enthaelt den Token - Zwischenspeicher unterwegs sollen die
    // Antwort nicht aufheben und an andere ausliefern.
    'Cache-Control': 'private, no-cache',
  });
  res.send(cal.toString());
}
