/**
 * Waehlt aus den Sendereintraegen eines Spiels die aus, die angezeigt werden.
 *
 * Drei Stufen:
 *
 *   1. Blockliste       Abspielwege und unerwuenschte Anbieter fliegen raus
 *   2. Familien         Eintraege desselben Abos konkurrieren miteinander
 *   3. Konkretheit      innerhalb einer Familie gewinnt der spezifischste
 *
 * Fuer Stufe 3 braucht es den Blick ueber das einzelne Spiel hinaus: ob
 * "Sky Sport Austria 1" die Konferenz ist oder der Kanal dieses Spiels,
 * sieht man erst daran, ob er zur selben Anstosszeit auch auf anderen
 * Partien laeuft. Deshalb wird zuerst ein Index ueber alle Spiele gebaut.
 */
import {
  EXCLUDED_CHANNELS,
  EXCLUDED_PATTERNS,
  CHANNEL_FAMILIES,
  CHANNEL_PROVIDERS,
  LOW_PRIORITY_PATTERNS,
  KONFERENZ_MIN_PARALLEL,
} from '../config/channelRules.js';

const normalized = (s) => String(s).trim().toLowerCase();
const EXCLUDED_SET = new Set(EXCLUDED_CHANNELS.map(normalized));

/** Gehoert der Eintrag komplett ausgeblendet? Gibt den Grund zurueck oder null. */
export function exclusionReason(name) {
  if (EXCLUDED_SET.has(normalized(name))) return 'blockliste';

  const muster = EXCLUDED_PATTERNS.find((p) => p.test(name));
  return muster ? `muster ${muster}` : null;
}

export function familyOf(name) {
  return CHANNEL_FAMILIES.find((f) => f.test.test(name))?.id ?? `einzeln:${normalized(name)}`;
}

export function providerOf(name) {
  return CHANNEL_PROVIDERS.find((p) => p.test.test(name))?.id ?? `einzeln:${normalized(name)}`;
}

/**
 * Wie konkret ist der Kanalname?
 *   2 = benannter Kanal mit Nummer   ("Sky Sport Austria 3")
 *   1 = benannter Kanal ohne Nummer  ("Sky Sport Bundesliga", "DAZN")
 *   0 = Simulcast/Konferenz/UHD      ("Sky Sport Top Event")
 */
export function specificity(name) {
  if (LOW_PRIORITY_PATTERNS.some((p) => p.test(name))) return 0;
  return /\d\s*$/.test(name.trim()) ? 2 : 1;
}

/**
 * Zaehlt je Anstosszeit, auf wie vielen Spielen ein Kanal laeuft.
 * @param {Array<{kickoffUtc: string, channels: Array<{name: string}>}>} matches
 */
export function buildParallelIndex(matches) {
  const index = new Map(); // kickoff -> Map(kanalname -> Anzahl)

  for (const m of matches) {
    if (!index.has(m.kickoffUtc)) index.set(m.kickoffUtc, new Map());
    const proZeit = index.get(m.kickoffUtc);

    for (const c of m.channels) {
      const k = normalized(c.name);
      proZeit.set(k, (proZeit.get(k) ?? 0) + 1);
    }
  }

  return index;
}

/**
 * Entscheidet fuer EIN Spiel, welche Eintraege bleiben.
 *
 * @param {{kickoffUtc: string, channels: Array<{name, type, position}>}} match
 * @param {Map} parallelIndex  aus buildParallelIndex
 * @returns {Array<{name, type, position, selected: boolean, dropReason: string|null,
 *                  family: string, parallel: number}>}
 */
export function selectChannels(match, parallelIndex) {
  const proZeit = parallelIndex?.get(match.kickoffUtc) ?? new Map();

  const bewertet = match.channels.map((c) => ({
    ...c,
    family: familyOf(c.name),
    provider: providerOf(c.name),
    spec: specificity(c.name),
    parallel: proZeit.get(normalized(c.name)) ?? 1,
    selected: true,
    dropReason: null,
  }));

  // Stufe 1: Blockliste
  for (const c of bewertet) {
    const grund = exclusionReason(c.name);
    if (grund) {
      c.selected = false;
      c.dropReason = grund;
    }
  }

  // Stufe 2 + 3: innerhalb jeder Familie aussortieren
  const familien = new Map();
  for (const c of bewertet) {
    if (!c.selected) continue;
    if (!familien.has(c.family)) familien.set(c.family, []);
    familien.get(c.family).push(c);
  }

  for (const [, gruppe] of familien) {
    if (gruppe.length < 2) continue;

    // Zuerst: laeuft einer exklusiv auf diesem Spiel, treten die
    // Konferenzkanaele derselben Familie zurueck.
    const exklusiv = gruppe.filter((c) => c.parallel < KONFERENZ_MIN_PARALLEL);

    if (exklusiv.length > 0 && exklusiv.length < gruppe.length) {
      for (const c of gruppe) {
        if (c.parallel >= KONFERENZ_MIN_PARALLEL) {
          c.selected = false;
          c.dropReason = `konferenz (${c.parallel} zeitgleiche Spiele)`;
        }
      }
    }

    // Dann: unter den verbliebenen gewinnt die hoechste Konkretheit.
    const uebrig = gruppe.filter((c) => c.selected);
    if (uebrig.length < 2) continue;

    const maxSpec = Math.max(...uebrig.map((c) => c.spec));
    for (const c of uebrig) {
      if (c.spec < maxSpec) {
        c.selected = false;
        c.dropReason = `unspezifischer als "${uebrig.find((x) => x.spec === maxSpec).name}"`;
      }
    }
  }

  // Stufe 4: Simulcasts gegen den ganzen Anbieter.
  // "Sky Sport Top Event" und "Sky Sport News" gehoeren zu keiner Familie,
  // muessen aber hinter jedem konkreten Sky-Kanal zuruecktreten - sonst steht
  // bei Union Berlin - Schalke der Nachrichtenkanal als Uebertragungsort.
  const anbieter = new Map();
  for (const c of bewertet) {
    if (!c.selected) continue;
    if (!anbieter.has(c.provider)) anbieter.set(c.provider, []);
    anbieter.get(c.provider).push(c);
  }

  for (const [, gruppe] of anbieter) {
    if (gruppe.length < 2) continue;

    const konkret = gruppe.filter((c) => c.spec >= 1);
    if (konkret.length === 0) continue; // nur Simulcasts da - dann eben die

    for (const c of gruppe) {
      if (c.spec === 0) {
        c.selected = false;
        c.dropReason = `Parallelausstrahlung neben "${konkret[0].name}"`;
      }
    }
  }

  return bewertet;
}

/** Nur die uebriggebliebenen, sortiert: Fernsehkanaele vor Streaming. */
export function selectedOnly(bewertet) {
  return bewertet
    .filter((c) => c.selected)
    .sort((a, b) => {
      const typ = (a.type === 'tv' ? 0 : 1) - (b.type === 'tv' ? 0 : 1);
      return typ !== 0 ? typ : a.position - b.position;
    })
    .map((c) => ({ name: c.name, type: c.type }));
}
