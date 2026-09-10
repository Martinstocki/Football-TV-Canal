import express from 'express';
import { db } from '../db/index.js';
import { COMPETITION_CODES } from '../config/competitions.js';
import { findMatches, findMatchById, groupByDay, stats } from '../services/matches.js';
import { availableCountries, setOverride, clearOverrides } from '../services/broadcasts.js';
import { syncMatches, isoDate, lastSyncInfo } from '../services/sync.js';

export const router = express.Router();

const DEFAULT_COUNTRY = () => (process.env.DEFAULT_COUNTRY || 'AT').toUpperCase();

function country(req) {
  const c = String(req.query.country || DEFAULT_COUNTRY()).toUpperCase();
  return Object.keys(availableCountries()).includes(c) ? c : DEFAULT_COUNTRY();
}

function competitionsFilter(req) {
  const raw = req.query.competitions ?? req.query.competition;
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => COMPETITION_CODES.includes(s));
}

/** Nur fuer Admin-Endpunkte: Token aus .env im Header oder Query. */
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const given = req.get('x-admin-token') || req.query.token;
  if (!expected || given !== expected) {
    return res.status(401).json({ error: 'Ungültiges oder fehlendes Admin-Token.' });
  }
  next();
}

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    provider: process.env.DATA_PROVIDER || 'football-data',
    defaultCountry: DEFAULT_COUNTRY(),
    timeZone: process.env.TZ || 'Europe/Vienna',
    matches: stats(),
  });
});

router.get('/competitions', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT code, name, short_name AS shortName, country, color, sort_order AS sortOrder
           FROM competitions WHERE active = 1 ORDER BY sort_order`
      )
      .all()
  );
});

router.get('/countries', (_req, res) => {
  res.json({ default: DEFAULT_COUNTRY(), countries: availableCountries() });
});

/**
 * GET /api/matches?days=7&from=&to=&competitions=CL,PL&team=Salzburg&group=true
 */
router.get('/matches', (req, res) => {
  const days = Number(req.query.days);
  const from = req.query.from || isoDate(0);
  const to = req.query.to || (Number.isFinite(days) ? isoDate(Math.max(0, days - 1)) : isoDate(6));

  const matches = findMatches({
    from,
    to,
    competitions: competitionsFilter(req),
    country: country(req),
    team: req.query.team ? String(req.query.team) : '',
  });

  const grouped = req.query.group !== 'false';
  res.json({
    from,
    to,
    country: country(req),
    count: matches.length,
    days: grouped ? groupByDay(matches) : undefined,
    matches: grouped ? undefined : matches,
  });
});

router.get('/matches/today', (req, res) => {
  const today = isoDate(0);
  const matches = findMatches({
    from: today,
    to: today,
    competitions: competitionsFilter(req),
    country: country(req),
  });
  res.json({ date: today, count: matches.length, matches });
});

router.get('/matches/:id', (req, res) => {
  const match = findMatchById(Number(req.params.id), country(req));
  if (!match) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  res.json(match);
});

// --- Admin -------------------------------------------------------------

router.post('/sync', requireAdmin, async (req, res) => {
  try {
    const result = await syncMatches({
      competitions: competitionsFilter(req).length ? competitionsFilter(req) : undefined,
      daysAhead: Number(req.query.daysAhead) || undefined,
      daysBack: Number(req.query.daysBack) || undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sync/log', requireAdmin, (_req, res) => res.json(lastSyncInfo()));

router.put('/matches/:id/broadcasts', requireAdmin, (req, res) => {
  const matchId = Number(req.params.id);
  if (!findMatchById(matchId)) {
    return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  }

  const land = country(req);
  const channels = Array.isArray(req.body?.channels) ? req.body.channels : null;
  if (!channels) {
    return res.status(400).json({ error: 'Body braucht ein Array "channels".' });
  }

  clearOverrides(matchId, land);
  for (const ch of channels) {
    if (!ch?.name) continue;
    setOverride({
      matchId,
      country: land,
      channel: String(ch.name),
      type: ch.type === 'stream' ? 'stream' : 'tv',
      note: ch.note ? String(ch.note) : null,
    });
  }

  res.json(findMatchById(matchId, land));
});

router.delete('/matches/:id/broadcasts', requireAdmin, (req, res) => {
  clearOverrides(Number(req.params.id), country(req));
  res.json(findMatchById(Number(req.params.id), country(req)));
});
