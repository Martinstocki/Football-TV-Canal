/**
 * Alias-Tabelle fuer Vereinsnamen.
 *
 * football-data.org und FotMob schreiben viele Vereine unterschiedlich
 * ("Man United" vs "Manchester United", "Slavia Praha" vs "Slavia Prague").
 * Die Normalisierung in services/teamMatching.js faengt schon viel ab
 * (Akzente, "FC"/"SC"-Zusaetze, Jahreszahlen). Hier stehen nur die Faelle,
 * die sich daraus NICHT ergeben - echte Namensunterschiede.
 *
 * Format: kanonischer Name -> Liste von Schreibweisen.
 * Verglichen wird immer in normalisierter Form, Gross-/Kleinschreibung
 * und Akzente sind also egal.
 *
 * Wenn scripts/fetch-tv-guide.js ein Spiel nicht zuordnen kann, listet es die
 * beiden Namen am Ende auf - dann hier ergaenzen.
 */
export const TEAM_ALIASES = {
  // --- England ---
  'manchester united': ['man united', 'man utd', 'manchester utd'],
  'manchester city': ['man city'],
  'tottenham hotspur': ['tottenham', 'spurs'],
  'wolverhampton wanderers': ['wolves'],
  'brighton hove albion': ['brighton hove', 'brighton'],
  'nottingham forest': ['nottingham'],
  'newcastle united': ['newcastle'],
  'west ham united': ['west ham'],
  'leeds united': ['leeds'],
  'leicester city': ['leicester'],
  'ipswich town': ['ipswich'],
  'hull city': ['hull'],
  'coventry city': ['coventry'],

  // --- Spanien ---
  barcelona: ['barca', 'fc barcelona'],
  'atletico madrid': ['atleti', 'atletico', 'atletico de madrid'],
  'athletic club': ['athletic', 'athletic bilbao'],
  'racing santander': ['santander', 'racing de santander'],
  'celta vigo': ['celta'],
  'deportivo la coruna': ['deportivo', 'depor'],
  'real betis': ['betis'],
  'rayo vallecano': ['rayo'],
  'real sociedad': ['la real'],

  // --- Deutschland ---
  'bayern munchen': ['bayern', 'bayern munich', 'fc bayern'],
  'borussia dortmund': ['dortmund', 'bvb'],
  // "M'gladbach" wird ohne Apostroph zu einem Token - beide Formen eintragen.
  'borussia monchengladbach': ['m gladbach', 'mgladbach', 'gladbach', 'monchengladbach'],
  'bayer leverkusen': ['leverkusen'],
  'vfb stuttgart': ['stuttgart'],
  'tsg hoffenheim': ['hoffenheim'],
  'sc freiburg': ['freiburg'],
  'fsv mainz': ['mainz'],
  'fc augsburg': ['augsburg'],
  'eintracht frankfurt': ['frankfurt'],
  'werder bremen': ['bremen'],
  'hamburger sv': ['hsv', 'hamburg'],
  'rb leipzig': ['leipzig'],
  'schalke': ['schalke 04'],
  koln: ['1 fc koln', 'fc koln'],
  'union berlin': ['1 fc union berlin'],
  'arminia bielefeld': ['bielefeld', 'arminia'],
  'sc paderborn': ['paderborn'],
  'hansa rostock': ['rostock'],
  'hannover': ['hannover 96'],
  nurnberg: ['1 fc nurnberg'],

  // --- Italien ---
  inter: ['inter milan', 'internazionale', 'fc internazionale'],
  milan: ['ac milan'],
  roma: ['as roma'],
  napoli: ['ssc napoli'],
  juventus: ['juve'],
  'hellas verona': ['verona'],
  'virtus entella': ['entella'],

  // --- Frankreich ---
  'paris saint germain': ['psg'],
  'olympique marseille': ['marseille', 'om'],
  'olympique lyonnais': ['olympique lyon', 'lyon', 'ol'],
  'stade rennais': ['rennes', 'rennais'],
  lens: ['rc lens'],
  'le havre': ['havre'],
  'angers sco': ['angers'],
  'paris fc': [],
  'stade brestois': ['brest'],
  strasbourg: ['rc strasbourg'],

  // --- Oesterreich ---
  'red bull salzburg': ['salzburg', 'fc salzburg', 'rb salzburg'],
  'rapid wien': ['rapid', 'sk rapid wien', 'sk rapid'],
  'sturm graz': ['sk sturm graz'],
  'austria wien': ['fk austria wien', 'austria'],
  'wolfsberger ac': ['wolfsberger', 'wac'],
  lask: ['lask linz'],
  ried: ['sv ried'],
  'blau weiss linz': ['blau weiss linz'],
  'grazer ak': ['gak'],
  'wsg tirol': ['tirol'],

  // --- Uebriges Europa ---
  'psv eindhoven': ['psv'],
  'shakhtar donetsk': ['shaktar', 'shakhtar', 'shakhtar donetsk'],
  'slavia prague': ['slavia praha', 'sk slavia praha', 'slavia'],
  'sparta prague': ['sparta praha'],
  'bodo glimt': ['bodo/glimt', 'fk bodo/glimt', 'bodoglimt'],
  como: ['como 1907'],
  'club brugge': ['brugge', 'club brugge kv'],
  'red star belgrade': ['crvena zvezda', 'roter stern belgrad'],
  'dinamo zagreb': ['gnk dinamo zagreb'],
  galatasaray: ['galatasaray sk'],
  fenerbahce: ['fenerbahce sk'],
  benfica: ['sl benfica'],
  porto: ['fc porto'],
  'sporting cp': ['sporting', 'sporting lissabon', 'sporting lisbon'],
  'estrela da amadora': ['estrela'],
  ajax: ['ajax amsterdam', 'afc ajax'],
  feyenoord: ['feyenoord rotterdam'],
  'olympiacos piraeus': ['olympiacos', 'olympiakos'],
  'sabah fk': ['sabah'],
  'kairat almaty': ['kairat'],
  'pafos fc': ['pafos'],
  'qarabag agdam': ['qarabag'],
};

/** Umgedrehte Sicht: Schreibweise -> kanonischer Name. Wird beim Start gebaut. */
export function buildAliasIndex(normalize) {
  const index = new Map();

  for (const [canonical, variants] of Object.entries(TEAM_ALIASES)) {
    const key = normalize(canonical);
    index.set(key, key);
    for (const variant of variants) {
      index.set(normalize(variant), key);
    }
  }

  return index;
}
