import crypto from 'node:crypto';

/**
 * Zeitkonstanter Vergleich - verraet ueber die Dauer nichts ueber das Passwort.
 * Genutzt fuer Basic Auth und den Kalender-Token.
 */
export function gleich(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // timingSafeEqual verlangt gleiche Laenge, deshalb vorher hashen.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
