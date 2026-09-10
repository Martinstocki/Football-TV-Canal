#!/usr/bin/env node
/**
 * Zeigt die letzten Protokollzeilen.
 *
 *   npm run log              letzte 40 Zeilen
 *   npm run log -- 100       letzte 100
 *   npm run log -- --fehler  nur Fehler und Warnungen
 */
import 'dotenv/config';
import { tail, logPath } from '../backend/services/logger.js';

const nurFehler = process.argv.includes('--fehler');
const anzahl = Number(process.argv.find((a) => /^\d+$/.test(a))) || 40;

const zeilen = tail(nurFehler ? 2000 : anzahl).filter(
  (z) => !nurFehler || /\[(fehler|warnung)/.test(z)
);

console.log(`${logPath()}\n`);

if (zeilen.length === 0) {
  console.log(nurFehler ? 'Keine Fehler protokolliert.' : 'Protokoll ist noch leer.');
  process.exit(0);
}

for (const z of nurFehler ? zeilen.slice(-anzahl) : zeilen) console.log(z);
