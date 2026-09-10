/**
 * Regeln, welche Sendereintraege angezeigt werden.
 *
 * FotMob listet pro Spiel alle Abspielwege, die es kennt. Fuer ein Spiel auf
 * Sky sind das schnell vier Eintraege:
 *
 *   Sky Sport Austria 1   <- Konferenz, laeuft parallel auf allen Spielen
 *   Sky Sport Austria 3   <- DIESES Spiel
 *   Sky X                 <- Streaming-App desselben Abos
 *   Sky Go                <- Streaming-App desselben Abos
 *
 * Anzeigen wollen wir davon nur "Sky Sport Austria 3".
 *
 * Diese Datei ist bewusst als reine Liste gehalten und laesst sich ohne
 * Codeaenderung erweitern. Was aussortiert wurde und warum, steht danach in
 * der Spalte tv_channels.drop_reason - dort kann man nachsehen, bevor man
 * hier etwas ergaenzt.
 */

/**
 * Komplett ausblenden. Exakte Namen, Gross-/Kleinschreibung egal.
 * Das sind Abspielwege eines Abos, keine eigenen Sender - oder Anbieter,
 * die wir schlicht nicht sehen wollen.
 */
export const EXCLUDED_CHANNELS = [
  // Streaming-Zugaenge zum Sky-Abo
  'Sky X',
  'Sky Go',
  'Sky Stream',
  'Sky Ticket',
  'WOW',

  // separater Pay-per-View-Anbieter
  'OneFootball PPV',
  'OneFootball',

  // Mediatheken/Apps neben dem eigentlichen Sender
  'ORF ON App',
  'ORF ON',
  'Joyn+',
  'Joyn',
  'RTL+',

  // ServusTV streamt sein Spiel zusaetzlich ueber "ServusTV On" und ueber
  // Joyn. Das sind Abspielwege, nicht zusaetzliche Sender.
  'ServusTV On',
  'Servus TV On',
  'ServusTV On App',
];

/**
 * NICHT ausblenden, niemals:
 *
 *   ServusTV  - haelt in Oesterreich die Free-TV-Rechte an EINEM ausgewaehlten
 *               Europa-League- bzw. Conference-League-Spiel pro Spieltag
 *               (unterlizenziert von Puls 4). Genau deshalb steht ServusTV
 *               nicht mehr in broadcasters.json: pauschal ist es falsch,
 *               pro Einzelspiel ist es richtig. Meldet FotMob ServusTV fuer
 *               ein bestimmtes Spiel, MUSS es angezeigt werden - es ist die
 *               einzige Moeglichkeit, das Spiel ohne Abo zu sehen.
 *
 *   ORF 1 / ORF Sport +  - dieselbe Logik bei oesterreichischen Spielen.
 *
 * scripts/test-channel-rules.js prueft das ab, damit es nicht versehentlich
 * durch eine spaetere Regel wieder herausfaellt.
 */

/**
 * Zusaetzlich ausblenden, wenn der Name auf eines dieser Muster passt.
 * Faengt Varianten ab, die nicht namentlich in der Liste oben stehen.
 */
export const EXCLUDED_PATTERNS = [
  /\bppv\b/i,          // Pay-per-View
  /\bapp\b/i,          // "... App"
  /\byoutube\b/i,
  /\.(de|com|at)\b/i,  // Website-Eintraege wie "Sportdigital.de"
];

/**
 * Familien: Eintraege derselben Familie beschreiben dasselbe Abo und
 * konkurrieren miteinander - am Ende bleibt der konkreteste uebrig.
 * Eintraege VERSCHIEDENER Familien bleiben nebeneinander stehen
 * (ein Spiel kann echt auf Sky UND im ORF laufen).
 *
 * Reihenfolge zaehlt: die erste passende Familie gewinnt.
 */
/**
 * Anbieter - die grobe Ebene ueber den Familien.
 *
 * Braucht es, weil Simulcasts quer durch die Familien laufen: "Sky Sport
 * Top Event" und "Sky Sport News" gehoeren zu keiner bestimmten Sky-Familie,
 * treten aber trotzdem hinter jeden konkreten Sky-Kanal zurueck. Laeuft ein
 * Spiel auf "Sky Sport Bundesliga", ist der Hinweis auf "Sky Sport News"
 * ueberfluessig - dort laeuft es naemlich nicht.
 */
export const CHANNEL_PROVIDERS = [
  { id: 'sky', test: /^sky\b/i },
  { id: 'dazn', test: /^dazn\b/i },
  { id: 'orf', test: /^orf\b/i },
  { id: 'servustv', test: /^servus\s?tv/i },
  { id: 'canal', test: /^canal\+/i },
  { id: 'sportdigital', test: /^sportdigital/i },
  { id: 'rtl', test: /^rtl\b/i },
];

export const CHANNEL_FAMILIES = [
  { id: 'sky-austria',  test: /^sky sports? austria/i },
  { id: 'sky-bundesliga', test: /^sky sports? bundesliga/i },
  { id: 'sky-premier', test: /^sky sports? premier league/i },
  { id: 'sky-other',   test: /^sky\b/i },
  { id: 'dazn',        test: /^dazn\b/i },
  { id: 'orf',         test: /^orf\b/i },
  { id: 'servustv',    test: /^servus\s?tv/i },
  { id: 'canal',       test: /^canal\+/i },
  { id: 'sportdigital', test: /^sportdigital/i },
];

/**
 * Kanaele, die ein Spiel nur mitnehmen, statt es exklusiv zu zeigen -
 * Simulcasts, Konferenzen, Parallelausstrahlungen in anderer Aufloesung.
 * Sie werden nur angezeigt, wenn es in der Familie nichts Konkreteres gibt.
 */
export const LOW_PRIORITY_PATTERNS = [
  /top event/i,
  /\buhd\b/i,
  /ultra hd/i,
  /showcase/i,
  /sports? news/i,
  /konferenz/i,
];

/**
 * Ab wie vielen zeitgleichen Spielen gilt ein Kanal als Konferenz?
 *
 * "Sky Sport Austria 1" laeuft am Champions-League-Abend auf allen sechs
 * Partien - das ist die Konferenz, nicht der Kanal fuer ein bestimmtes Spiel.
 * "Sky Sport Austria 3" laeuft nur auf einem. Taucht in derselben Familie
 * beides auf, gewinnt der exklusive Kanal.
 *
 * 2 heisst: sobald ein Kanal zwei zeitgleiche Spiele traegt und es eine
 * exklusive Alternative gibt, tritt er zurueck.
 */
export const KONFERENZ_MIN_PARALLEL = 2;
