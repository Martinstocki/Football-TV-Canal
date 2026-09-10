/**
 * Tolerante Zuordnung von Vereinsnamen zwischen zwei Datenquellen.
 *
 * Ablauf pro Namenspaar:
 *   1. normalisieren   (Akzente, Rechtsformen wie "FC"/"SC", Jahreszahlen weg)
 *   2. Alias nachschlagen (echte Namensunterschiede, siehe config/teamAliases.js)
 *   3. Aehnlichkeit messen (Token-Enthaltensein, sonst Dice-Koeffizient)
 *
 * Wichtig: Zusaetze, die eine ANDERE Mannschaft bezeichnen - "II", "B",
 * "U19", "(W)" - werden NICHT wegnormalisiert. Sonst wuerde "Rapid Wien II"
 * auf "Rapid Wien" passen und das Zweitliga-Spiel den Sender des
 * Bundesligaspiels bekommen.
 */
import { buildAliasIndex } from '../config/teamAliases.js';

// Rechtsformen und Vereinszusaetze ohne Unterscheidungskraft.
const NOISE_TOKENS = new Set([
  'fc', 'cf', 'sc', 'sk', 'ac', 'as', 'ss', 'ssc', 'rc', 'us', 'ud', 'sv', 'sd',
  'vfl', 'vfb', 'tsg', 'tsv', 'bsc', 'fsv', 'msv', 'spvgg', 'fk', 'nk', 'hnk',
  'gnk', 'afc', 'ufc', 'cd', 'ca', 'cs', 'rcd', 'rkc', 'club',
  'calcio', 'futbol', 'football', 'fussball', 'futebol', 'de', 'the',
]);
// Bewusst NICHT als Rauschen: "PSV", "AEK" und aehnliche Kuerzel sind der
// unterscheidende Teil des Namens, nicht ein Anhaengsel.

/**
 * Zusatz, der eine eigene Mannschaft kennzeichnet (Reserve, Jugend, Frauen).
 * Zwei Namen duerfen nur zusammenpassen, wenn dieser Marker identisch ist.
 */
export function teamMarker(raw) {
  const s = String(raw).toLowerCase();

  if (/\(w\)|\bfrauen\b|\bwomen\b|\bdamen\b/.test(s)) return 'W';

  const youth = /\bu\s?(\d{2})\b/.exec(s);
  if (youth) return `U${youth[1]}`;

  if (/\bii\b|\b2\b(?!\d)|\bres\.?\b|\bamateure\b|\bzweite\b/.test(s)) return 'II';
  if (/\bb\b$/.test(s.trim())) return 'II';

  return null;
}

/**
 * Vereinsname -> vergleichbare Form.
 * "1. FC Köln" -> "koln", "Como 1907" -> "como", "Bayern München" -> "bayern munchen"
 */
export function normalize(raw) {
  let s = String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // kombinierende Akzente entfernen
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/đ|ð/g, 'd')
    .replace(/ł/g, 'l');

  // Marker vor dem Tokenisieren wegschneiden, er wird separat verglichen.
  s = s.replace(/\(w\)|\bfrauen\b|\bwomen\b/g, ' ').replace(/\bu\s?\d{2}\b/g, ' ');

  s = s
    .replace(/[.'’`´]/g, '')     // Apostrophe und Punkte ersatzlos
    .replace(/[^a-z0-9]+/g, ' ') // Rest wird Trennzeichen
    .trim();

  const tokens = s
    .split(/\s+/)
    .filter((t) => t && !NOISE_TOKENS.has(t))
    .filter((t) => !/^\d+$/.test(t)) // reine Zahlen: "1907", "04", "96"
    .filter((t) => t !== 'ii');      // Marker, separat behandelt

  // Wenn nur Rauschen uebrig bleibt, lieber die Rohform behalten.
  return tokens.length > 0 ? tokens.join(' ') : s;
}

const ALIAS_INDEX = buildAliasIndex(normalize);

/** Normalisieren und, wenn bekannt, auf den kanonischen Namen abbilden. */
export function canonical(raw) {
  const n = normalize(raw);
  return ALIAS_INDEX.get(n) ?? n;
}

/** Dice-Koeffizient ueber Zeichen-Bigramme: 0 (nichts gemein) bis 1 (gleich). */
function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  let sizeA = 0;

  for (const [g, n] of A) {
    sizeA += n;
    const other = B.get(g);
    if (other) shared += Math.min(n, other);
  }

  const sizeB = [...B.values()].reduce((s, n) => s + n, 0);
  return (2 * shared) / (sizeA + sizeB);
}

/**
 * Aehnlichkeit zweier Vereinsnamen, 0 bis 1.
 * Gibt 0 zurueck, wenn die Mannschaftsmarker verschieden sind
 * (Erste gegen Zweite, Herren gegen Frauen, Profis gegen U19).
 */
export function similarity(a, b) {
  if (teamMarker(a) !== teamMarker(b)) return 0;

  const ca = canonical(a);
  const cb = canonical(b);

  if (ca === cb) return 1;

  const ta = new Set(ca.split(' '));
  const tb = new Set(cb.split(' '));

  // Enthaelt der laengere Name alle Tokens des kuerzeren? ("lens" in "rc lens")
  const [kurz, lang] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (kurz.size > 0 && [...kurz].every((t) => lang.has(t))) return 0.92;

  return diceCoefficient(ca, cb);
}

/**
 * Sucht zu einem Spiel das aehnlichste aus einer Liste von Kandidaten.
 *
 * @param {{home: string, away: string}} ziel
 * @param {Array<{home: string, away: string}>} kandidaten
 * @param {number} schwelle  Mindestaehnlichkeit, die BEIDE Teams erreichen muessen
 * @returns {{kandidat: object, index: number, score: number} | null}
 */
export function findBestMatch(ziel, kandidaten, schwelle = 0.7) {
  let best = null;

  for (const [index, k] of kandidaten.entries()) {
    const heim = similarity(ziel.home, k.home);
    if (heim < schwelle) continue; // frueh raus, spart den zweiten Vergleich

    const gast = similarity(ziel.away, k.away);
    if (gast < schwelle) continue;

    // Das schwaechere der beiden Teams entscheidet - ein perfekter Treffer
    // beim Heimteam darf einen schlechten beim Gastteam nicht ueberdecken.
    const score = Math.min(heim, gast);
    if (!best || score > best.score) best = { kandidat: k, index, score };
  }

  return best;
}
