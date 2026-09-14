/**
 * Pfade des Projekts - bewusst OHNE weitere Importe.
 *
 * WARUM ES DIESE DATEI GIBT:
 * PROJECT_ROOT stand frueher in db/index.js. Wer den Pfad brauchte, musste
 * also das Datenbankmodul importieren - und das oeffnet beim Laden sofort
 * die SQLite-Datei und legt das Schema an (siehe Kommentar dort).
 *
 * Fuer den FotMob-Scraper ist das ein Klotz am Bein: er braucht den Pfad nur,
 * um seinen Zwischenspeicher unter data/cache/ abzulegen, aber keine
 * Datenbank. In Umgebungen ohne dauerhafte Festplatte - etwa einem
 * GitHub-Actions-Runner, der nur eine Discord-Nachricht verschicken soll -
 * wuerde sonst bei jedem Lauf eine leere Wegwerf-Datenbank entstehen.
 *
 * Diese Datei importiert nichts. Damit kann jedes Modul den Pfad haben,
 * ohne better-sqlite3 ueberhaupt zu laden.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Wurzel des Projektordners (eine Ebene ueber backend/). */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
