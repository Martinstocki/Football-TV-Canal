# Live schalten — Schritt für Schritt

Ziel: Die App läuft rund um die Uhr im Netz, aber **nur du und deine Familie
kommen rein**. Kein Google-Treffer, kein öffentlicher Zugang.

Geschrieben für jemanden, der das zum ersten Mal macht. Dauer: etwa 30 Minuten.

---

## Vorweg: Brauchst du überhaupt einen Server?

Es gibt zwei Wege, und der zweite ist für deinen Fall möglicherweise besser.

### Weg A — Railway (diese Anleitung)

Die App läuft in der Cloud. Erreichbar von überall, auch aus dem Mobilfunknetz,
ohne dass zu Hause ein Rechner laufen muss.

- Kostet aktuell etwa **5 $/Monat** (Hobby-Plan, Stand meiner Kenntnis —
  **prüf den Preis selbst**, das ändert sich).
- Die Adresse ist öffentlich erreichbar. Der Schutz ist das Passwort.

### Weg B — Tailscale, ohne Cloud

Die App bleibt auf deinem Rechner zu Hause. [Tailscale](https://tailscale.com)
baut ein privates Netz zwischen deinen Geräten — die App ist dann vom Handy
aus erreichbar, **ohne dass sie im Internet steht**.

- **Kostenlos** für bis zu 100 Geräte.
- **Wirklich nicht auffindbar**, nicht nur passwortgeschützt.
- Nachteil: Der Rechner zu Hause muss laufen. Jedes Familienmitglied muss
  Tailscale einmal installieren.

**Meine Einschätzung:** Wenn „keine öffentliche Auffindbarkeit" dein
Hauptmotiv ist, ist Weg B die ehrlichere Lösung — da steht nichts im
Internet, was jemand finden könnte. Weg A ist bequemer, wenn der Rechner
zu Hause nicht durchlaufen soll.

Du hast nach Railway gefragt, also geht es unten damit weiter.

### Was für diese App nicht funktioniert

Die App braucht zwei Dinge, die viele Gratis-Angebote nicht bieten: eine
**Datei, die Neustarts übersteht** (die SQLite-Datenbank) und einen
**dauerhaft laufenden Prozess** (den Zeitplan um 08:00 und 18:00).

| | Warum es scheitert |
|---|---|
| Render Free | keine persistente Festplatte → Datenbank nach jedem Neustart leer; schläft nach 15 Min → Zeitplan feuert nicht |
| Vercel, Netlify | serverlos, kein dauerhafter Prozess, kein beschreibbares Dateisystem |
| Cloudflare Pages | dasselbe — für statische Seiten gedacht |

### Warum Railway und nicht Fly.io

Beide funktionieren. Für den ersten Versuch empfehle ich **Railway**:

| | Railway | Fly.io |
|---|---|---|
| Einrichtung | Weboberfläche, GitHub verbinden, fertig | Kommandozeile, eigene `fly.toml` |
| Deployment | automatisch bei jedem `git push` | `fly deploy` von Hand |
| Speicher (Volume) | zwei Klicks | CLI-Befehle, Region beachten |
| Konzepte zum Lernen | wenige | Machines, Regionen, Volumes |

Fly.io ist mächtiger und in manchen Konstellationen günstiger. Aber du machst
das zum ersten Mal — Railway hält dir mehr vom Leib.

---

## Schritt 0 — Git-Repository anlegen

Railway holt den Code aus GitHub. Das Projekt ist **noch kein Git-Repository**.

```bash
git init
git add .
git commit -m "Fussball-Programm"
```

> **Wichtig:** `.gitignore` schließt `.env`, `data/` und `log.txt` aus. Prüf
> vor dem ersten Commit, dass dein API-Key **nicht** dabei ist:
>
> ```bash
> git status --short
> ```
>
> Taucht dort `.env` auf, stimmt etwas nicht — dann **nicht** committen und
> nachsehen, ob `.gitignore` wirklich im Projektordner liegt.

Dann auf GitHub ein **privates** Repository anlegen (github.com → New
repository → Private) und hochladen:

```bash
git remote add origin https://github.com/DEIN-NAME/fussball-programm.git
git branch -M main
git push -u origin main
```

---

## Schritt 1 — Railway-Projekt anlegen

1. Auf [railway.app](https://railway.app) mit dem GitHub-Konto anmelden.
2. **New Project** → **Deploy from GitHub repo**.
3. Railway fragt nach Zugriff auf deine Repositories — gib ihm Zugriff auf
   das eine Repository, nicht auf alle.
4. Repository auswählen. Railway erkennt Node.js selbst und startet den ersten
   Build.

**Der erste Build wird fehlschlagen oder eine leere App zeigen.** Das ist
normal — die Umgebungsvariablen fehlen noch.

Im Projekt liegt bereits `railway.json`. Darin steht unter anderem
`"numReplicas": 1` — **das ist wichtig** und sollte so bleiben. Bei zwei
Instanzen würde der Zeitplan doppelt laufen und die API-Kontingente doppelt
verbrauchen.

---

## Schritt 2 — Speicher, der Neustarts übersteht

**Diesen Schritt nicht überspringen.** Ohne ihn ist nach jedem Deployment die
Datenbank leer.

Der Dateisystem eines Containers ist flüchtig: Bei jedem Neustart wird alles
zurückgesetzt, was nicht auf einem Volume liegt. Die Datenbank
(`data/fussball.db`), der Scraper-Zwischenspeicher (`data/cache/`) und das
Protokoll gehören dazu.

1. Im Railway-Projekt auf den Service klicken.
2. Reiter **Settings** → Abschnitt **Volumes** → **Add Volume**.
3. **Mount path:** `/app/data`
4. Größe: 1 GB reicht dicke (die Datenbank ist ~300 KB).

Der Mount-Pfad muss genau `/app/data` heißen — Railway legt den Code unter
`/app` ab, und `DATABASE_PATH=data/fussball.db` ist relativ dazu.

---

## Schritt 3 — Umgebungsvariablen setzen

Reiter **Variables** → **New Variable**. Diese Werte eintragen:

### Unverzichtbar

| Variable | Wert | Warum |
|---|---|---|
| `FOOTBALL_DATA_API_KEY` | dein Key | Spielpläne |
| `APP_USER` | z. B. `familie` | Benutzername für die Passwortabfrage |
| `APP_PASSWORD` | **langes, neues Passwort** | siehe unten |
| `ADMIN_TOKEN` | langer Zufallswert | schützt `/api/sync` und die Sender-Overrides |
| `TZ` | `Europe/Vienna` | **kritisch**, siehe unten |
| `HOST` | `0.0.0.0` | sonst nimmt der Container keine Anfragen an |
| `DATABASE_PATH` | `data/fussball.db` | landet damit auf dem Volume |
| `LOG_FILE` | `data/log.txt` | landet damit auf dem Volume |

### Empfohlen

| Variable | Wert |
|---|---|
| `DEFAULT_COUNTRY` | `AT` |
| `BROADCAST_FALLBACK` | `placeholder` |
| `SCHEDULE_ENABLED` | `true` |
| `SCHEDULE_CRON` | `0 8,18 * * *` |
| `SCHEDULE_JOBS` | `sync,fixtures,tv` |
| `SYNC_ON_START` | `true` — füllt die Datenbank direkt beim ersten Start |
| `SCRAPER_MIN_INTERVAL_SEC` | `21600` |

**`PORT` NICHT setzen.** Railway vergibt den selbst und übergibt ihn als
Umgebungsvariable. Der Server liest ihn aus.

### Zu `TZ=Europe/Vienna`

Container laufen standardmäßig in UTC. Ohne diese Variable würde der Zeitplan
um **08:00 UTC = 10:00 Wiener Zeit** laufen, und alle Anstoßzeiten in der App
wären um zwei Stunden verschoben. Node richtet sich nach `TZ`.

### Zum Passwort

- **Nimm ein neues**, keines, das du woanders benutzt.
- Lang statt kompliziert: vier zufällige Wörter sind besser als `Xy7!q`.
- Basic Auth überträgt es bei jeder Anfrage. Über HTTPS ist das in Ordnung —
  Railway stellt automatisch HTTPS bereit. Über HTTP wäre es Klartext.
- Es steht danach im Klartext in den Railway-Variablen. Wer Zugriff auf dein
  Railway-Konto hat, sieht es.

`ADMIN_TOKEN` erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Schritt 4 — Passwortschutz prüfen

Der Schutz ist bereits eingebaut und schaltet sich ein, **sobald `APP_USER`
und `APP_PASSWORD` gesetzt sind**. Ist eines davon leer, ist die App offen —
der Server schreibt dann beim Start eine Warnung ins Log.

Nach dem Deployment im Reiter **Deployments** → **View Logs** nachsehen:

```
Zugangsschutz aktiv (Basic Auth).
Fussball-Programm laeuft auf http://0.0.0.0:8080
Zeitplan aktiv: "0 8,18 * * *" (Europe/Vienna), Jobs: sync, fixtures, tv
```

Steht dort stattdessen `WARNUNG: Kein Zugangsschutz`, fehlt eine der beiden
Variablen.

**Was geschützt ist:** alles — die Webseite und die gesamte API.
**Was offen ist:** nur `/healthz`, das gibt ausschließlich `ok` zurück.
Railway braucht das, sonst hält es den Dienst für kaputt und startet ihn
endlos neu.

Zusätzlich schickt der Server `X-Robots-Tag: noindex, nofollow, noarchive`
und liefert eine `robots.txt`, die alles ausschließt. Das hält seriöse
Suchmaschinen fern — ein Zugriffsschutz ist es nicht, das macht das Passwort.

---

## Schritt 5 — Der Zeitplan läuft mit

Hier musst du **nichts einrichten**. Der Zeitplan steckt im Server: `npm start`
startet beide. Läuft der Dienst auf Railway, laufen die Abgleiche um 08:00 und
18:00 Wiener Zeit.

Das ist auch der Grund, warum `numReplicas: 1` wichtig ist.

**Nachprüfen**, ob er wirklich läuft — direkt nach dem Deployment im Log:

```
Zeitplan aktiv: "0 8,18 * * *" (Europe/Vienna), Jobs: sync, fixtures, tv
```

Nach dem ersten geplanten Lauf steht dort:

```
[start   ] Lauf gestartet (Zeitplan): sync, fixtures, tv
[ok      ] sync       34.6s  Fertig: 6 ok, 3 uebersprungen
[ok      ] fixtures   34.7s  Gesamt: 0 neu, 61 aktualisiert.
[ok      ] tv          0.3s  tv_channels: 503 Zeilen
[ende    ] 3 ok, 0 fehlgeschlagen, 69.6s gesamt
```

Nicht bis 08:00 warten wollen? Setz einmalig `SYNC_ON_START=true`, dann läuft
alles direkt beim Start durch.

---

## Schritt 6 — Adresse holen und testen

Reiter **Settings** → **Networking** → **Generate Domain**. Du bekommst etwas
wie `fussball-programm-production-a1b2.up.railway.app`.

Prüfliste:

1. Adresse im Browser öffnen → **Passwortabfrage muss kommen**.
2. Abbrechen → du darfst **nichts** sehen.
3. Mit Benutzername und Passwort → Spielplan erscheint.
4. `https://DEINE-ADRESSE/healthz` → zeigt `ok`, ohne Passwort. Richtig so.
5. Am Handy öffnen und zum Startbildschirm hinzufügen.

Klappt Punkt 1 nicht und die App ist sofort da, sind die Auth-Variablen nicht
angekommen — Variablen prüfen und neu deployen.

---

## Danach

**Änderungen ausrollen:** `git push` — Railway baut und deployt automatisch.

**Logs ansehen:** Reiter **Deployments** → **View Logs**. Alles aus `log.txt`
steht auch dort.

**Passwort ändern:** Variable `APP_PASSWORD` anpassen, Railway startet neu.

**Datenbank neu aufbauen:** falls mal etwas schiefgeht — im Railway-Terminal
oder lokal `npm run db:reset`, dann `npm run scheduler:once`.

---

## Womit du rechnen solltest

**Kosten.** Railway hat keinen dauerhaft kostenlosen Plan mehr. Rechne mit
etwa 5 $/Monat. Prüf das selbst, meine Angabe kann veraltet sein.

**API-Kontingente.** football-data.org im Free-Tier: 10 Anfragen/Minute. Zwei
Läufe täglich mit je 6 Wettbewerben sind unkritisch. FotMob wird durch die
6-Stunden-Sperre höchstens viermal täglich angefragt.

**Basic Auth ist grob.** Ein Benutzer, ein Passwort, für alle gleich. Kein
Abmelden, keine einzelnen Konten. Für eine Familien-App ist das angemessen —
wenn du Zugänge einzeln entziehen können willst, brauchst du mehr.

**Die Adresse ist erreichbar.** Auch mit Passwort und `noindex` steht die
App im Internet. Wer die Adresse hat, sieht die Passwortabfrage. Wenn dich
das stört, ist Weg B (Tailscale) die passendere Lösung.
