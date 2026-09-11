import 'dotenv/config';
import path from 'node:path';
import express from 'express';

import { initSchema, DB_PATH, PROJECT_ROOT } from './db/index.js';
import { router as api } from './routes/api.js';
import { kalenderRoute } from './routes/kalender.js';
import { gleich } from './services/auth.js';
import { laufStarten, planEinrichten, jobsAusUmgebung } from './services/scheduler.js';
import { logPath } from './services/logger.js';

const { dbPath } = initSchema();

const app = express();
app.disable('x-powered-by');

// Hinter dem Reverse Proxy von Railway/Fly kommt die echte Client-IP und das
// urspruengliche Protokoll nur ueber die X-Forwarded-*-Header an.
app.set('trust proxy', 1);

app.use(express.json({ limit: '256kb' }));

/**
 * Suchmaschinen fernhalten. Die Adresse ist zwar oeffentlich erreichbar,
 * soll aber nicht auffindbar sein. Der Header wirkt auch fuer /api.
 */
app.use((_req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

/**
 * Gesundheitspruefung der Plattform - MUSS ohne Passwort erreichbar sein,
 * sonst haelt Railway den Dienst fuer kaputt und startet ihn im Kreis neu.
 * Gibt bewusst keine Daten preis.
 */
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

/**
 * Kalender-Abo - ebenfalls vor der Basic Auth, weil Kalender-Apps (vor allem
 * Google) keine Passwoerter mitschicken koennen. Geschuetzt durch den Token
 * aus KALENDER_TOKEN, ohne Token ist der Endpunkt abgeschaltet.
 */
app.get('/kalender.ics', kalenderRoute);

if (process.env.KALENDER_TOKEN) {
  console.log('Kalender-Feed aktiv: /kalender.ics?token=... (Token aus KALENDER_TOKEN)');
  if (process.env.KALENDER_TOKEN.length < 20) {
    console.warn('WARNUNG: KALENDER_TOKEN ist kurz und damit leichter zu erraten. Empfohlen: 32 Zeichen.');
  }
}

// Zugangsschutz: aktiv, sobald APP_USER und APP_PASSWORD gesetzt sind.
if (process.env.APP_USER && process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, encoded] = header.split(' ');

    if (scheme === 'Basic' && encoded) {
      const roh = Buffer.from(encoded, 'base64').toString('utf8');
      const trenner = roh.indexOf(':');
      const user = trenner === -1 ? roh : roh.slice(0, trenner);
      const pass = trenner === -1 ? '' : roh.slice(trenner + 1);

      if (gleich(user, process.env.APP_USER) && gleich(pass, process.env.APP_PASSWORD)) {
        return next();
      }
    }

    res.set('WWW-Authenticate', 'Basic realm="Fussball-Programm", charset="UTF-8"');
    res.status(401).type('text').send('Zugang erforderlich');
  });
  console.log('Zugangsschutz aktiv (Basic Auth).');
} else {
  console.warn(
    'WARNUNG: Kein Zugangsschutz - APP_USER und APP_PASSWORD sind nicht gesetzt.'
  );
}

app.use('/api', api);
app.use(express.static(path.join(PROJECT_ROOT, 'frontend'), { extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Unbekannter Endpunkt.' });
  res.sendFile(path.join(PROJECT_ROOT, 'frontend', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[fehler]', err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const server = app.listen(PORT, HOST, () => {
  console.log(`Fussball-Programm laeuft auf http://${HOST}:${PORT}`);
  console.log(`Datenbank: ${dbPath}`);
  console.log(`Datenquelle: ${process.env.DATA_PROVIDER || 'football-data'}`);
  console.log(`Protokoll:  ${logPath()}`);

  // Der Zeitplan laeuft mit dem Server mit. Wer die Abgleiche ohne Webserver
  // braucht, nimmt stattdessen "npm run scheduler".
  if (process.env.SCHEDULE_ENABLED === 'false') {
    console.log('Zeitplan abgeschaltet (SCHEDULE_ENABLED=false).');
  } else {
    planEinrichten({ jobs: jobsAusUmgebung() });
  }

  if (process.env.SYNC_ON_START === 'true') {
    laufStarten({ jobs: jobsAusUmgebung(), anlass: 'Serverstart' }).catch((e) =>
      console.error('[zeitplan]', e.message)
    );
  }
});

// Der haeufigste Startfehler: es laeuft schon eine Instanz. Ohne Hinweis
// steht da nur ein nackter Stacktrace.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} ist bereits belegt - vermutlich laeuft die App schon.\n`);
    console.error('Entweder die laufende Instanz verwenden:');
    console.error(`   http://${HOST}:${PORT}\n`);
    console.error('Oder diese hier auf einem anderen Port starten:');
    console.error('   Windows (PowerShell):  $env:PORT=3001; npm run dev');
    console.error('   macOS/Linux:           PORT=3001 npm run dev\n');
    console.error('Laufende Instanz finden und beenden:');
    console.error(`   Get-NetTCPConnection -LocalPort ${PORT} -State Listen`);
    process.exit(1);
  }

  if (err.code === 'EACCES') {
    console.error(`\nKeine Berechtigung fuer Port ${PORT}. Ports unter 1024 brauchen Adminrechte.`);
    console.error('In der .env einen hoeheren Port eintragen, z. B. PORT=3000\n');
    process.exit(1);
  }

  console.error('Server konnte nicht starten:', err);
  process.exit(1);
});

export { DB_PATH };
