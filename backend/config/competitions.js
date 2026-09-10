/**
 * Alle Wettbewerbe, die die App kennt.
 *
 * code            interner Schluessel (auch in der DB und im Frontend)
 * footballData    Code bei football-data.org (null = im Gratis-Tarif nicht verfuegbar)
 * apiFootball     League-ID bei api-football.com
 * color           Farbe des Filter-Chips im Frontend
 */
export const COMPETITIONS = [
  {
    code: 'CL',
    name: 'Champions League',
    shortName: 'CL',
    country: 'EU',
    footballData: 'CL',
    apiFootball: 2,
    color: '#3b6bd6',
    sortOrder: 1,
  },
  {
    code: 'EL',
    name: 'Europa League',
    shortName: 'EL',
    country: 'EU',
    footballData: null, // nur im Bezahl-Tarif
    apiFootball: 3,
    color: '#e07b39',
    sortOrder: 2,
  },
  {
    code: 'UECL',
    name: 'Conference League',
    shortName: 'Conference',
    country: 'EU',
    footballData: null,
    apiFootball: 848,
    color: '#3fa65a',
    sortOrder: 3,
  },
  {
    code: 'BL1',
    name: 'Bundesliga (Deutschland)',
    shortName: 'Bundesliga',
    country: 'DE',
    footballData: 'BL1',
    apiFootball: 78,
    color: '#c8102e',
    sortOrder: 4,
  },
  {
    code: 'AT1',
    name: 'Bundesliga (Österreich)',
    shortName: 'ÖBL',
    country: 'AT',
    footballData: null, // bei football-data.org gar nicht vorhanden
    apiFootball: 218,
    color: '#ef3340',
    sortOrder: 5,
  },
  {
    code: 'PL',
    name: 'Premier League',
    shortName: 'Premier L.',
    country: 'GB',
    footballData: 'PL',
    apiFootball: 39,
    color: '#38003c',
    sortOrder: 6,
  },
  {
    code: 'PD',
    name: 'La Liga',
    shortName: 'La Liga',
    country: 'ES',
    footballData: 'PD',
    apiFootball: 140,
    color: '#ee8707',
    sortOrder: 7,
  },
  {
    code: 'SA',
    name: 'Serie A',
    shortName: 'Serie A',
    country: 'IT',
    footballData: 'SA',
    apiFootball: 135,
    color: '#1b5e9c',
    sortOrder: 8,
  },
  {
    code: 'FL1',
    name: 'Ligue 1',
    shortName: 'Ligue 1',
    country: 'FR',
    footballData: 'FL1',
    apiFootball: 61,
    color: '#0a2472',
    sortOrder: 9,
  },
];

export const COMPETITION_CODES = COMPETITIONS.map((c) => c.code);

/**
 * FotMob-Liga-ID -> unser Wettbewerbs-Code.
 *
 * Ueber die ID und nicht ueber den Namen, weil "Bundesliga" bei FotMob
 * sowohl die deutsche (54) als auch die oesterreichische (38) meint.
 * IDs am 10.09.2026 von fotmob.com/de/tv-guide/at abgelesen.
 */
export const FOTMOB_LEAGUE_MAP = {
  // Europapokal - Ligaphase und K.-o.-Runden
  42: 'CL',      // Champions League          (INT)
  73: 'EL',      // Europa League             (INT)
  10216: 'UECL', // Conference League         (INT)

  // Europapokal - Qualifikation laeuft bei FotMob unter eigenen IDs.
  // Ohne diese Zeilen faenden die Sommer-Qualifikationsspiele
  // oesterreichischer Vereine gar nicht in die App.
  10611: 'CL',   // Champions League Qualifikation
  10613: 'EL',   // Europa League Qualifikation
  10615: 'UECL', // Conference League Qualifikation

  // Nationale Ligen
  54: 'BL1',   // Bundesliga            (GER)
  38: 'AT1',   // Bundesliga            (AUT)  <- im Free-Tier von football-data nicht enthalten
  47: 'PL',    // Premier League        (ENG)
  87: 'PD',    // LaLiga                (ESP)
  55: 'SA',    // Serie A               (ITA)
  53: 'FL1',   // Ligue 1               (FRA)
};
// Alle IDs am 10.09.2026 aus der Liga-Sitemap von FotMob verifiziert
// (https://www.fotmob.com/sitemap/de/leagues.xml), nicht geraten.

/**
 * Wettbewerbe, deren Spielplan NUR aus dem TV-Programm kommt, weil
 * football-data.org sie im Free-Tier nicht liefert.
 *
 * ACHTUNG, wichtige Einschraenkung: Das TV-Programm listet ausschliesslich
 * Spiele, die in Oesterreich uebertragen werden, und nur sieben Tage im Voraus.
 *
 * Fuer AT1 ist das unkritisch - eine Runde der oesterreichischen Bundesliga
 * wird komplett uebertragen, es fehlt also nichts.
 *
 * Fuer EL und UECL ist die Liste dagegen UNVOLLSTAENDIG: von einem
 * Europa-League-Spieltag mit 18 Partien erscheinen nur die in Oesterreich
 * gezeigten. Fuer ein Fernsehprogramm ist genau das die richtige Auswahl -
 * wer einen vollstaendigen Spielplan braucht, nimmt DATA_PROVIDER=api-football.
 */
export const FOTMOB_ONLY_COMPETITIONS = ['AT1', 'EL', 'UECL'];

export function competitionFromFotmob(leagueId, leagueName = '') {
  const byId = FOTMOB_LEAGUE_MAP[leagueId];
  if (byId) return byId;

  // Notnagel, falls FotMob eine ID aendert: eindeutige Namen ohne Doppeldeutigkeit.
  if (/conference league/i.test(leagueName)) return 'UECL';
  if (/europa league/i.test(leagueName)) return 'EL';
  if (/champions league/i.test(leagueName)) return 'CL';

  return null;
}

export function getCompetition(code) {
  return COMPETITIONS.find((c) => c.code === code) ?? null;
}
