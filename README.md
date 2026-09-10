# ⚽ Fußball-Programm

Private Web-App, die anzeigt **welches Spiel wann auf welchem Sender läuft** —
Champions League, Europa League, Conference League, deutsche und österreichische
Bundesliga, Premier League, La Liga, Serie A, Ligue 1.

Gebaut für den Eigenbedarf: läuft auf einem Rechner im Heimnetz, ohne Login-System,
mit optionalem Passwortschutz.

---

## Schnellstart

```bash
npm install
npm run db:init
npm run seed        # Beispieldaten, damit man ohne API-Key etwas sieht
npm start
```

Dann `http://localhost:3000` im Browser öffnen.

Für echte Daten brauchst du einen API-Key (siehe unten) und dann:

```bash
npm run seed -- --clear
npm run sync
```

---

## Die Web-Ansicht

Reines HTML/CSS/JS, kein Build-Schritt, kein Framework. Änderungen an
`frontend/` werden mit einem Browser-Reload sofort sichtbar.

**Aufbau**

- **Tabs:** Heute · Morgen · Diese Woche · 14 Tage
- **Pro Tag** eine Überschrift („Heute“, „Morgen“, sonst „Sonntag, 13. September“),
  darunter die Spiele **nach Uhrzeit sortiert**
- **Pro Spiel:** Anstoßzeit, beide Mannschaften mit Wappen, Wettbewerb und
  Spieltag, der TV-Sender. Bei laufenden Spielen `LIVE` in Rot, bei
  beendeten der Endstand
- **Farbstreifen links** je Wettbewerb, damit man beim Scrollen ohne Lesen
  erkennt, worum es geht

**Filter**

| | |
|---|---|
| Wettbewerb | Chips unter „Ligen ▾“, Mehrfachauswahl |
| Freitext | „Verein suchen …“ |
| Lieblingsvereine | ★-Knopf, siehe unten |
| Land | Auswahl oben rechts (AT/DE) — steuert die Senderangaben |

Alle Einstellungen liegen in `localStorage` und überstehen einen Neustart.

**Lieblingsvereine**

Im Spielplan auf einen **Vereinsnamen tippen** merkt ihn vor (★, fett).
Der ★-Knopf oben zeigt dann nur noch Spiele dieser Vereine — die Filterung
passiert im Browser, die Merkliste verlässt das Gerät also nie.

Weil die Quellen denselben Verein unterschiedlich schreiben („Bayern“ vs
„Bayern München“), wird nicht auf exakte Gleichheit geprüft, sondern
normalisiert und auf Teilstrings.

**Mobil**

Mobile-first aufgebaut: einspaltig, Fingerflächen groß genug, klebriger
Kopfbereich, horizontal scrollende Tab- und Chip-Leisten, `safe-area`-Ränder
für Geräte mit Notch. Hell und dunkel folgen automatisch der Systemeinstellung.
Ab 620 px rücken die Sender neben die Paarung.

### Lokal ausprobieren

```bash
npm run dev
```

`node --watch` startet den Server bei Änderungen an `backend/` neu.
Für `frontend/` genügt ein Reload im Browser — die Dateien werden statisch
ausgeliefert.

Läuft schon eine Instanz auf Port 3000, sagt der Server das jetzt im Klartext
statt mit einem Stacktrace. Zweite Instanz parallel:

```bash
$env:PORT=3001; npm run dev      # PowerShell
PORT=3001 npm run dev            # macOS/Linux
```

Ohne echte Daten zum Ansehen:

```bash
npm run seed                     # erfundene Spiele quer durch die Ligen
npm run seed -- --clear          # wieder weg
```

---

## Ordnerstruktur

```
Fussball Programm/
├─ backend/
│  ├─ server.js              Express-App: statische Dateien, API, Cron, Basic-Auth
│  ├─ config/
│  │  ├─ competitions.js     die 9 Wettbewerbe + Provider-IDs + Chip-Farben
│  │  └─ broadcasters.json   ⭐ Wettbewerb + Land → Sender (von Hand gepflegt)
│  ├─ db/
│  │  ├─ index.js            öffnet SQLite, wendet das Schema an
│  │  └─ schema.sql          Tabellen (idempotent, läuft bei jedem Start)
│  ├─ routes/
│  │  └─ api.js              alle /api-Endpunkte
│  └─ services/
│     ├─ matches.js          Abfragen + Gruppierung nach Kalendertag
│     ├─ broadcasts.js       Sender-Zuordnung (Regeln + manuelle Overrides)
│     ├─ sync.js             Abgleich Provider → Datenbank
│     └─ providers/
│        ├─ footballData.js  football-data.org
│        ├─ apiFootball.js   api-football.com
│        └─ index.js         Auswahl über DATA_PROVIDER
├─ frontend/                 reines HTML/CSS/JS, kein Build-Schritt
│  ├─ index.html
│  ├─ styles.css             mobile-first, dunkel + hell automatisch
│  └─ app.js
├─ scripts/
│  ├─ init-db.js             Datenbank anlegen / zurücksetzen
│  ├─ import-matches.js      Spielpläne holen → Tabelle `matches` (speist die Web-App)
│  ├─ fetch-fixtures.js      Spielpläne holen → Tabelle `fixtures` (schlanke Spiegelung)
│  └─ seed-demo.js           erfundene Testspiele
├─ data/                     SQLite-Datei (nicht im Git)
├─ .env                      deine Keys (nicht im Git)
└─ .env.example              Vorlage zum Weitergeben
```

**Warum diese Aufteilung:** `routes` kennt nur HTTP, `services` nur Fachlogik,
`providers` nur die jeweilige fremde API. Ein neuer Datenanbieter ist eine neue
Datei in `providers/` — sonst ändert sich nichts.

---

## Woher welcher Wettbewerb kommt

| Wettbewerb | Spielplan | Sender |
|---|---|---|
| Champions League | football-data.org | FotMob |
| Premier League, La Liga, Serie A, Ligue 1 | football-data.org | FotMob |
| Bundesliga (DE) | football-data.org | FotMob |
| **Bundesliga (AT)** | **FotMob** | FotMob |
| **Europa League, Conference League** | **FotMob** | FotMob |

Die letzten drei liefert football-data.org im Free-Tier nicht. Sie kommen
deshalb aus dem TV-Programm — mit einer Einschränkung, die man kennen muss:

> **Das TV-Programm listet nur Spiele, die in Österreich übertragen werden,
> und nur sieben Tage im Voraus.**
>
> Für die **österreichische Bundesliga** ist das unkritisch: eine Runde wird
> komplett übertragen, es fehlt nichts.
>
> Für **Europa und Conference League** ist die Liste dagegen unvollständig —
> von 18 Partien eines Spieltags erscheinen nur die hier gezeigten. Für ein
> Fernsehprogramm ist genau das die richtige Auswahl. Wer einen vollständigen
> Spielplan braucht, nimmt `DATA_PROVIDER=api-football`.

Steuerbar über `FOTMOB_ONLY_COMPETITIONS` in
[`backend/config/competitions.js`](backend/config/competitions.js).

### FotMob-Liga-IDs

Die Zuordnung läuft über `leagueId`, nicht über den Namen — bei FotMob heißen
die deutsche und die österreichische Bundesliga beide schlicht „Bundesliga“.
Alle IDs stammen aus der [Liga-Sitemap](https://www.fotmob.com/sitemap/de/leagues.xml)
und sind verifiziert, nicht geraten:

| Wettbewerb | Hauptrunde | Qualifikation |
|---|---|---|
| Champions League | 42 | 10611 |
| Europa League | 73 | 10613 |
| **Conference League** | **10216** | **10615** |
| Bundesliga (DE) | 54 | — |
| Bundesliga (AT) | 38 | — |
| Premier League | 47 | — |
| LaLiga | 87 | — |
| Serie A | 55 | — |
| Ligue 1 | 53 | — |

Die Qualifikationsrunden laufen bei FotMob unter **eigenen** IDs. Ohne diese
Zeilen fänden die Sommer-Qualifikationsspiele österreichischer Vereine gar
nicht in die App.

**Conference League:** Die Ligaphase 2026/27 beginnt am **15. Oktober 2026**.
Bis dahin liefert der Scraper dafür keine Spiele — das ist kein Fehler. Die
Datenstruktur, der Filter-Chip und die Sender-Logik stehen bereits; sobald
FotMob Spiele mit `leagueId 10216` ausliefert, erscheinen sie automatisch.

Zum Ansehen der Darstellung vorab:

```bash
npm run seed:uecl -- --date 2026-09-17   # Demospieltag anlegen
npm run seed:uecl -- --clear             # wieder entfernen
```

Die Demo läuft durch dieselbe Filterlogik wie echte Daten — sie zeigt also,
was am Spieltag tatsächlich herauskommt.

---

## Datenquelle wählen

In der `.env` über `DATA_PROVIDER`:

| | football-data.org | api-football.com |
|---|---|---|
| Kosten | gratis | gratis (100 Anfragen/Tag) |
| Limit | 10 Anfragen/Minute | 100 Anfragen/Tag |
| CL, BL1, PL, La Liga, Serie A, Ligue 1 | ✅ | ✅ |
| Europa League, Conference League | ❌ (Bezahl-Tarif) | ✅ |
| **Bundesliga Österreich** | ❌ | ✅ |
| Key holen | [football-data.org/client/register](https://www.football-data.org/client/register) | [dashboard.api-football.com](https://dashboard.api-football.com) |

Wettbewerbe, die der eingestellte Provider nicht liefert, werden beim Abgleich
sauber übersprungen (Status `skipped`) — es bricht nichts ab.

**Wenn dir die österreichische Bundesliga wichtig ist, nimm `api-football`.**
100 Anfragen/Tag reichen bequem: 9 Wettbewerbe × 1 Abgleich täglich = 9 Anfragen.

---

## Zwei Tabellen mit Spielplänen

Aktuell gibt es zwei Wege, Spiele in die Datenbank zu holen:

| | `npm run sync` | `npm run fixtures` |
|---|---|---|
| Skript | `import-matches.js` | `fetch-fixtures.js` |
| Zieltabelle | `matches` | `fixtures` |
| Wettbewerbe | alle 9 (Provider-abhängig) | die 6 im Free-Tier |
| Felder | inkl. Wappen, Ergebnis, Spieltag, Stadion | nur die sechs Kernfelder |
| **Speist die Web-App** | **ja** | nein |

Wichtig: **Das Frontend liest ausschließlich `matches`.** `fetch-fixtures.js`
schreibt in eine eigene, bewusst schlanke Tabelle — praktisch zum Nachschauen
und für eigene Abfragen, aber im Browser taucht davon nichts auf. Wer die
Web-App füllen will, nimmt `npm run sync`.

Die beiden zusammenzulegen ist der nächste sinnvolle Schritt, sobald die
Alternative für ÖBL/Europa League/Conference League steht.

---

## `fetch-fixtures.js`

Holt die nächsten 7 Tage für CL, PL, PD, FL1, SA, BL1 in die Tabelle `fixtures`.

```bash
npm run fixtures                                    # 7 Tage, alle 6 Ligen
npm run fixtures:show                               # nur anzeigen, kein Abruf
node scripts/fetch-fixtures.js --days 14
node scripts/fetch-fixtures.js --competitions CL,PL
```

Der Abruf dauert rund 35 Sekunden: der Free-Tier erlaubt 10 Anfragen pro Minute,
das Skript pausiert deshalb 6,5 s zwischen den Ligen.

**Kein Duplizieren:** `id` ist die Match-ID von football-data.org und zugleich
Primärschlüssel. Ein zweiter Durchlauf aktualisiert dieselbe Zeile
(`INSERT … ON CONFLICT (id) DO UPDATE`) und schreibt `fetched_at` neu.

`status` wird unverändert vom Anbieter übernommen — `TIMED`, `SCHEDULED`,
`IN_PLAY`, `PAUSED`, `FINISHED`, `POSTPONED`, `CANCELLED`. `TIMED` heißt
dabei: Anstoßzeit steht fest.

---

## Woher die Sender kommen

Die exakten Sender **inklusive Kanalnummer** liefert der Scraper
[`scripts/fetch-tv-guide.js`](scripts/fetch-tv-guide.js) aus dem TV-Programm
von FotMob.

```bash
npm run tv           # abrufen und zuordnen
npm run tv:dry       # Trockenlauf, zeigt jede Zuordnung, schreibt nichts
npm run tv:force     # Zwischenspeicher übergehen, frisch abrufen
npm run tv:verify    # belegt, dass die Werte live von der Seite kommen
```

### Warum weder Puppeteer noch Cheerio

FotMob ist eine Next.js-Seite und liefert den **kompletten Datensatz schon im
ausgelieferten HTML** mit, im Script-Tag `__NEXT_DATA__`:

```
props.pageProps.fallback["tvguide-groups:at"]["20260912"][]
  → { leagueId, leagueName, leagueCcode,
      matches: [{ id, utcTime, home:{id,name}, away:{id,name},
                  channels:[{ name }] }] }
```

Das Ergebnis ist also bereits strukturiertes JSON:

- **Puppeteer** würde einen kompletten Chromium (~300 MB) starten, um
  JavaScript auszuführen, dessen Ergebnis ohnehin schon im HTML steht.
- **Cheerio** würde HTML-Elemente abklappern — brüchiger als das JSON, und
  die Liga-Zuordnung steckt im DOM nur in der Überschrift daneben.

Ein einziges `fetch()` genügt und liefert sieben Tage auf einmal. Sollte
FotMob je auf reines Client-Rendering umstellen, bricht der Parser mit einer
klaren Meldung ab — dann wäre Puppeteer der Plan B.

Nebeneffekt der `leagueId`: nur so lassen sich die **deutsche** Bundesliga
(54) und die **österreichische** (38) auseinanderhalten — beide heißen bei
FotMob schlicht „Bundesliga“.

### Rücksicht auf die Quelle

| Maßnahme | Umsetzung |
|---|---|
| Wenige Anfragen | genau **eine** pro Lauf, sieben Tage auf einmal |
| Mindestabstand | 6 h (`SCRAPER_MIN_INTERVAL_SEC`), dazwischen aus `data/cache/` |
| Ehrlicher User-Agent | gängiger Browser-Kennstring, via `SCRAPER_USER_AGENT` änderbar |
| Nicht hämmern | 25 s Zeitlimit, max. 2 Wiederholungen mit wachsender Pause |
| Ausfall abfedern | bei Fehlern wird der Zwischenspeicher genutzt und als veraltet markiert |
| `robots.txt` beachtet | `/api/*` ist dort für alle Agents gesperrt und wird **nicht** angefragt |

### Die Tabelle `tv_channels`

Rohergebnis, eine Zeile je **Spiel und Sender**:

| Spalte | Inhalt |
|---|---|
| `fixture_id`, `match_id` | Verweis auf unsere Spiele, `NULL` wenn nicht zuzuordnen |
| `source`, `source_match_id` | Identität bei FotMob |
| `league_id`, `league_name`, `competition` | Liga bei FotMob und unser Code |
| `home_team`, `away_team`, `home_team_id` … | Namen und FotMob-Team-IDs |
| `kickoff_utc` | Anstoß |
| `sender_name`, `sender_type`, `position` | der Sender, `tv` oder `stream`, Reihenfolge |

Bewusst nah an der Quelle: was FotMob liefert, steht unverändert drin — auch
für Spiele, die wir (noch) nicht zuordnen können. Daraus abgeleitet werden
`fixtures.channels` und `broadcast_overrides`.

FotMobs eigener Pseudo-Sender „Noch zu bestätigen“ wird herausgefiltert, damit
nicht zwei verschiedene Platzhaltertexte nebeneinander stehen.

### Welche Sender angezeigt werden

FotMob listet pro Spiel **alle Abspielwege**, die es kennt. Für ein
Champions-League-Spiel sind das schnell vier Einträge, von denen nur einer
die Frage „welche Taste drücke ich?“ beantwortet:

```
✗  Sky Sport Austria 1     Konferenz – läuft parallel auf allen Spielen
✓  Sky Sport Austria 3     DIESES Spiel
✗  Sky X                   Streaming-App desselben Abos
✗  Sky Go                  Streaming-App desselben Abos
```

Die Regeln stehen in
[`backend/config/channelRules.js`](backend/config/channelRules.js) und sind
als reine Listen gehalten — erweitern geht ohne Codeänderung:

| Stufe | Regel | Beispiel |
|---|---|---|
| 1 | `EXCLUDED_CHANNELS` — Abspielwege und unerwünschte Anbieter | `Sky X`, `Sky Go`, `OneFootball PPV` |
| 2 | `EXCLUDED_PATTERNS` — Namensmuster | `/\bppv\b/`, `/\bapp\b/`, `/\.de\b/` |
| 3 | Konferenz-Erkennung | `Sky Sport Bundesliga` auf 5 zeitgleichen Spielen tritt hinter `Sky Sport Bundesliga 3` zurück |
| 4 | Konkretheit je Familie | nummerierter Kanal schlägt unnummerierten |
| 5 | Simulcasts je Anbieter | `Sky Sport Top Event`, `Sky Sport News`, `… UHD` treten hinter jeden konkreten Sky-Kanal zurück |

**Die Konferenz-Erkennung ist datengetrieben, nicht fest verdrahtet:** Ob
`Sky Sport Austria 1` die Konferenz ist oder der Kanal dieses Spiels, sieht
man daran, auf wie vielen *zeitgleichen* Partien er läuft. Läuft er auf
mehreren und gibt es einen exklusiven Kanal, gewinnt der exklusive.

Nichts geht dabei verloren: `tv_channels` speichert weiterhin **alle**
Einträge, mit `is_selected`, `drop_reason` und `parallel_count` daneben.

```bash
npm run tv:channels    # Beispielspiele mit ✓/✗ und Begründung
npm run tv:dropped     # alle ausgeblendeten Einträge, gruppiert
```

### ServusTV, ORF & Co. — Sender, die nur ein Spiel zeigen

Der wichtigste Grund für die per-Spiel-Auflösung: **ServusTV hält in
Österreich die Free-TV-Rechte an genau einem ausgewählten Europa-League-
bzw. Conference-League-Spiel pro Spieltag** (unterlizenziert von Puls 4,
Vertrag über 2024/25 bis 2026/27). Sky und Canal+ haben den Rest.
Bei ORF 1 und ORF Sport + ist es dieselbe Logik.

Solche Sender sind pauschal fast immer falsch — pro Einzelspiel aber die
wichtigste Information überhaupt, weil sie den einzigen abofreien Weg
darstellen. Deshalb gilt:

- **Nicht** in `broadcasters.json` (die grobe Regeltabelle)
- **Nicht** in `EXCLUDED_CHANNELS` — meldet FotMob ServusTV für ein Spiel,
  wird es angezeigt
- **Wohl** ausgefiltert werden die Abspielwege daneben: `ServusTV On`,
  `Joyn`, `ORF ON App`

Abgesichert durch `npm run test:channels`: Ein simulierter
Conference-League-Spieltag prüft, dass ServusTV beim Rapid-Spiel erscheint
und bei den drei zeitgleichen Partien **nicht**.

### Warum bei DAZN nur „DAZN“ steht

Das ist **kein Fehler der Filterlogik**, sondern die Datenlage. Geprüft am
10.09.2026:

| | Österreich | Deutschland (Kontrolle) |
|---|---|---|
| DAZN-Schreibweisen bei FotMob | **1** — nur `DAZN` (94×) | **1** — nur `DAZN Deutschland` (91×) |
| Sky-Schreibweisen bei FotMob | **19**, davon viele nummeriert | **13**, davon viele nummeriert |
| 9 zeitgleiche DAZN-Spiele | alle identisch `DAZN` | alle identisch `DAZN Deutschland` |
| 5 zeitgleiche Sky-Spiele | `Bundesliga 1` … `Bundesliga 5` | ebenso unterschieden |

Entscheidend ist die Kontrollgruppe: **In Deutschland gibt es die linearen
Kanäle DAZN 1 und DAZN 2 nachweislich — FotMob gibt sie trotzdem nicht aus.**
FotMob bildet DAZNs lineare Kanäle also generell nicht ab, in keinem Land.

Und laut [Sky Österreich Hilfecenter](https://www.sky.at/hilfe/apps/bedienung/dazn-ueber-sky-at)
sind DAZN 1 und DAZN 2 **auch in Österreich** über Sky Q, Sky+ und das
Sky CI+ Modul empfangbar. Die verbreitete Annahme „DAZN ist in Österreich
reine App, deshalb keine Kanäle“ stimmt so also nicht.

**Folge für diese App:** `DAZN` ist die vollständigste Angabe, die aus der
Quelle zu holen ist. Wer DAZN über die App nutzt, wählt das Spiel ohnehin
direkt aus — dort ist die Angabe ausreichend. Wer DAZN über Sky schaut,
erfährt von uns nicht, ob es DAZN 1 oder DAZN 2 ist. Das ließe sich nur über
eine zweite Quelle ergänzen.

### Warum das nötig ist

Eine feste Tabelle *Wettbewerb → Sender* ist für diesen Zweck zu grob:

- An einem Champions-League-Abend laufen sechs Parallelspiele auf
  **Sky Sport Austria 1 bis 5**. „Sky Sport Austria“ allein sagt einem nicht,
  welche Taste man drücken muss.
- Sender mit Zweitverwertungsrecht (ServusTV bei CL/EL/UECL, ORF 1 bei der
  österreichischen Bundesliga) zeigen nur **ein ausgewähltes Spiel pro Spieltag**.
  Pauschal eingetragen sind sie fast immer falsch — deshalb stehen sie
  **nicht** mehr in der Regeltabelle. Der Scraper liefert sie korrekt für
  genau das Spiel, für das sie gelten.

### Wie der Scraper arbeitet

FotMob bettet das Programm als **JSON-LD nach schema.org** in die öffentliche
Seite ein (`SportsEvent` → `broadcastEvent.publishedOn`). Das ist strukturierte
Auszeichnung, die ausdrücklich zum maschinellen Auslesen veröffentlicht wird —
deutlich stabiler als HTML-Elemente abzuklappern. Ein einziger Seitenabruf
liefert das komplette Programm der nächsten sieben Tage.

Die interne JSON-API von FotMob wird **bewusst nicht** angesprochen: deren
`robots.txt` sperrt `/api/*` für alle Agents. Die Seite selbst ist erlaubt.

### Zuordnung über Vereinsnamen

football-data.org und FotMob schreiben Vereine unterschiedlich
(„Man United“ vs „Manchester United“, „Slavia Praha“ vs „Slavia Prague“).
Die Zuordnung läuft in drei Stufen, siehe
[`backend/services/teamMatching.js`](backend/services/teamMatching.js):

1. **Normalisieren** — Akzente, Rechtsformen (`FC`, `SC`, `SV`) und Jahreszahlen
   raus: `1. FC Köln` → `koln`, `Como 1907` → `como`
2. **Alias nachschlagen** — echte Namensunterschiede aus
   [`teamAliases.js`](backend/config/teamAliases.js)
3. **Ähnlichkeit messen** — Token-Enthaltensein, sonst Dice-Koeffizient über
   Zeichen-Bigramme; beide Mannschaften müssen die Schwelle (Standard 0,7)
   erreichen, zusätzlich muss die Anstoßzeit auf ±120 Minuten passen

Eine Sicherung, die leicht übersehen wird: Zusätze wie `II`, `U19` und `(W)`
werden **nicht** wegnormalisiert und müssen auf beiden Seiten übereinstimmen.
Sonst bekäme „Rapid Wien II“ aus der 2. Liga den Sender des Bundesligaspiels.

```bash
npm run test:matching     # 31 Fälle, inklusive der Fallen
```

Wenn ein Spiel nicht zugeordnet werden kann, listet `npm run tv` es am Ende
mit seiner normalisierten Form auf — dann die Schreibweise in `teamAliases.js`
ergänzen und erneut laufen lassen.

### Wenn nichts gefunden wird

Dann steht dort **„Sender wird noch bekannt gegeben“** — bewusst kein geratenes
Sky/DAZN. Steuerbar über `BROADCAST_FALLBACK` in der `.env`:

| Wert | Verhalten ohne Treffer |
|---|---|
| `placeholder` (Standard) | „Sender wird noch bekannt gegeben“ |
| `rule` | grobe Angabe aus `broadcasters.json`, sichtbar als „ca. …“ |

### Reihenfolge der Quellen

1. **Manueller Override** (`source='manual'`) — schlägt alles
2. **Scraper-Treffer** (`source='fotmob'`) — exakter Kanal
3. **Regeltabelle** — nur bei `BROADCAST_FALLBACK=rule`
4. **Platzhalter**

Ein neuer Scraper-Lauf ersetzt nur seine eigenen Einträge. Von Hand gesetzte
Sender bleiben unangetastet:

```bash
curl -X PUT "http://localhost:3000/api/matches/42/broadcasts?country=AT" \
  -H "x-admin-token: DEIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"channels":[{"name":"ServusTV","type":"tv","note":"frei empfangbar"}]}'
```

---

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Status, Provider, Anzahl Spiele |
| GET | `/api/competitions` | die 9 Wettbewerbe |
| GET | `/api/countries` | verfügbare Länder für die Senderangabe |
| GET | `/api/matches` | Spiele, nach Tagen gruppiert |
| GET | `/api/matches/today` | nur heute |
| GET | `/api/matches/:id` | ein Spiel |
| POST | `/api/sync` 🔒 | Abgleich anstoßen |
| GET | `/api/sync/log` 🔒 | letzte 20 Abgleiche |
| PUT | `/api/matches/:id/broadcasts` 🔒 | Sender überschreiben |
| DELETE | `/api/matches/:id/broadcasts` 🔒 | Override löschen |

🔒 = braucht den Header `x-admin-token` mit dem Wert aus `ADMIN_TOKEN`.

Parameter für `/api/matches`:
`days`, `from`, `to` (YYYY-MM-DD), `competitions=CL,PL,AT1`, `team=Salzburg`,
`country=AT|DE`, `group=false`.

---

## Automatischer Abgleich

Täglich **08:00 und 18:00** laufen alle Abgleiche automatisch. Der Zeitplan
läuft mit dem Server mit — `npm start` genügt.

```bash
npm start                # Server + Zeitplan
npm run scheduler        # nur der Zeitplan, ohne Webserver
npm run scheduler:once   # einmal sofort durchlaufen
npm run log              # letzte Protokollzeilen
npm run log -- --fehler  # nur Fehler und Warnungen
```

### Die drei Jobs — Reihenfolge zählt

| Job | Skript | Schreibt nach |
|---|---|---|
| `sync` | `import-matches.js` | `matches` — **speist die Web-App** |
| `fixtures` | `fetch-fixtures.js` | `fixtures` |
| `tv` | `fetch-tv-guide.js` | Sender + AT1/EL/UECL |

Sie laufen **nacheinander**, nicht parallel: `tv` ordnet die Sender den
Spielen zu, die die beiden anderen gerade geholt haben. Ein Fehler in einem
Job stoppt die übrigen nicht.

> **`sync` gehört zwingend dazu.** `fetch-fixtures.js` schreibt nur nach
> `fixtures`, das Frontend liest aber `matches`. Ohne `sync` blieben
> Champions League, Premier League, La Liga, Serie A, Bundesliga und Ligue 1
> in der App stehen — nur AT1, EL und UECL würden sich aktualisieren.

Steuerbar über `SCHEDULE_JOBS` in der `.env`.

### Warum Kindprozesse

Alle drei Skripte beenden sich mit `process.exit()`. Als Import in den
Serverprozess würde der erste Aufruf den Webserver mitreißen. Als Kindprozess
kann außerdem weder ein Absturz noch eine Endlosschleife im Skript den Server
treffen — schlimmstenfalls greift das Zeitlimit (`SCHEDULE_TIMEOUT_MS`,
Standard 10 Minuten).

Ein Überholschutz verhindert, dass sich zwei Läufe überschneiden.

### Das Protokoll

Alles landet in `log.txt` (Pfad über `LOG_FILE`, ab 5 MB wird nach
`log.1.txt` rotiert; beides ist in `.gitignore`):

```
2026-09-10 18:00:00  [start   ] Lauf gestartet (Zeitplan): sync, fixtures, tv
2026-09-10 18:00:35  [ok      ] sync       34.6s  Fertig: 6 ok, 3 uebersprungen, 0 fehlgeschlagen
2026-09-10 18:01:09  [ok      ] fixtures   34.7s  Gesamt: 0 neu, 61 aktualisiert.
2026-09-10 18:01:10  [ok      ] tv          0.3s  tv_channels: 507 Zeilen
2026-09-10 18:01:10  [ende    ] 3 ok, 0 fehlgeschlagen, 69.6s gesamt
```

Bei Fehlern werden die erklärenden Ausgabezeilen mitgeschrieben — gesucht
wird gezielt nach der Fehlermeldung, nicht einfach das Ende der Ausgabe
genommen (`fetch-fixtures.js` druckt auch im Fehlerfall zum Schluss die
komplette Spieltabelle):

```
2026-09-10 14:29:39  [fehler  ] fixtures   34.3s  Beendet mit Code 1
                       | CL   Champions League   FEHLER – HTTP 400: {"message":"Your API token is invalid."}
                       | PL   Premier League     FEHLER – HTTP 400: {"message":"Your API token is invalid."}
```

Ein Schreibfehler am Protokoll (volles Laufwerk) stoppt den Abgleich nicht —
er landet nur auf der Konsole.

### Lokal testen

```bash
npm run scheduler:test
```

Läuft **jede Minute**, aber nur mit dem `tv`-Job. Beenden mit Strg+C, dann
`npm run log` ansehen. Nach etwa zwei Minuten stehen zwei Läufe im Protokoll:

```
17:25:00  [start] Lauf gestartet (Zeitplan): tv
17:25:00  [ok   ] tv   0.3s  tv_channels: 507 Zeilen
17:25:00  [ende ] 1 ok, 0 fehlgeschlagen, 0.3s gesamt
17:26:00  [start] Lauf gestartet (Zeitplan): tv
```

**Warum nur `tv` im Minutentakt?** `sync` und `fixtures` brauchen je ~35 s
und fragen football-data.org an (10 Anfragen/Minute im Free-Tier) — im
Minutentakt wäre das Tageskontingent schnell aufgebraucht. Der `tv`-Job
nutzt dagegen seinen 6-Stunden-Zwischenspeicher und belastet FotMob nicht.

Eigener Rhythmus:

```bash
node scripts/scheduler.js --cron "*/2 * * * *" --jobs tv
node scripts/scheduler.js --once --jobs fixtures,tv
```

> **PowerShell:** Den Cron-Ausdruck in Anführungszeichen setzen, sonst zerlegt
> die Shell `* * * * *` in fünf Argumente. Das Skript setzt sie zwar wieder
> zusammen, sauberer ist die quotierte Form.

Zurück zum echten Rhythmus: einfach `npm run scheduler:test` beenden. Der
Normalbetrieb steht in der `.env` (`SCHEDULE_CRON=0 8,18 * * *`) und wird vom
Test nicht verändert.

Zeitfenster der Abgleiche steuern `SYNC_DAYS_AHEAD` (Vorschau) und
`SYNC_DAYS_BACK` (rückwirkend, damit Endergebnisse nachgetragen werden).

---

## Live schalten

Schritt-für-Schritt-Anleitung für Railway (inklusive Passwortschutz,
persistentem Speicher und Zeitplan auf dem Server): **[DEPLOY.md](DEPLOY.md)**

Dort steht auch, warum für „nur die Familie, nicht auffindbar" ein privates
Netz per Tailscale die ehrlichere Alternative sein kann als jede Cloud.

---

## Im Heimnetz erreichbar machen

Standardmäßig lauscht der Server nur auf `127.0.0.1`. Damit die Familie
drauf kommt, in der `.env`:

```
HOST=0.0.0.0
APP_USER=familie
APP_PASSWORD=<etwas-langes>
```

Setze **beide** Auth-Werte, sobald `HOST` nicht mehr `127.0.0.1` ist — sonst
liegt die App offen im Netz. Im Browser kommt dann eine Passwortabfrage.

Ins offene Internet gehört das so nicht: Basic Auth über unverschlüsseltes HTTP
überträgt das Passwort im Klartext. Dafür bräuchte es zusätzlich HTTPS
(z. B. über Tailscale oder einen Reverse Proxy).

---

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm start` | Server starten |
| `npm run dev` | Server mit Auto-Neustart bei Änderungen |
| `npm run db:init` | Schema anlegen/aktualisieren |
| `npm run db:reset` | alle Spiele und Overrides löschen |
| `npm run seed` | Demo-Spiele anlegen |
| `npm run sync` | Spielpläne holen → `matches` (für die Web-App) |
| `npm run fixtures` | Spielpläne holen → `fixtures` |
| `npm run fixtures:show` | Inhalt von `fixtures` anzeigen, ohne API-Abruf |
| `npm run tv` | exakte Sender von FotMob holen und zuordnen |
| `npm run tv:dry` | Trockenlauf mit Einzelzuordnungen, schreibt nichts |
| `npm run tv:force` | Zwischenspeicher übergehen, frisch abrufen |
| `npm run tv:verify` | ALT/DB/LIVE nebeneinander als Nachweis |
| `npm run tv:channels` | je Spiel alle Sender mit ✓/✗ und Begründung |
| `npm run tv:dropped` | alle ausgeblendeten Einträge, gruppiert |
| `npm run test:matching` | Vereinsnamen-Zuordnung testen (kein Netz nötig) |
| `npm run test:channels` | Sender-Filterregeln testen, inkl. ServusTV-Fall |
| `npm run scheduler` | Zeitplan ohne Webserver starten |
| `npm run scheduler:once` | alle Jobs einmal sofort durchlaufen |
| `npm run scheduler:test` | Minutentakt zum Ausprobieren (nur `tv`) |
| `npm run log` | letzte Protokollzeilen |
| `npm run seed:uecl` | Conference-League-Demospieltag anlegen |
| `node scripts/import-matches.js --days 30 --competitions CL,AT1` | gezielter Abgleich |

---

## Rechtliches — was ich prüfen konnte und was nicht

Diese App ist für den **privaten, nicht-kommerziellen Gebrauch** gebaut: keine
Veröffentlichung, keine Weitergabe der Daten, ein Haushalt.

Was sich objektiv feststellen lässt:

- **`robots.txt` von fotmob.com erlaubt die Seite.** Der Eintrag lautet
  `User-agent: * / Allow: /`, mit `Disallow: /api/*`. Die TV-Programm-Seite ist
  ausdrücklich freigegeben, die interne JSON-API nicht — deshalb wird sie
  **nicht** angefragt, obwohl sie bequemer wäre.
- **Gelesen wird nur, was die Seite selbst mitliefert** (`__NEXT_DATA__`),
  also der Inhalt, den jeder Browser beim Aufruf ebenfalls bekommt.
- **Die Last ist minimal:** eine Anfrage alle sechs Stunden, also maximal vier
  pro Tag.

Was ich **nicht** beurteilen kann und was deine Entscheidung bleibt:

- Die Nutzungsbedingungen von FotMob habe ich nicht geprüft. Viele Anbieter
  untersagen darin automatisiertes Auslesen unabhängig von der `robots.txt`.
- Ob eine Datenbank-Schutzrechtslage greift, ist eine Rechtsfrage. **Ich bin
  keine Rechtsberatung.** Praktisch bewegt sich privates Auslesen in geringem
  Umfang ohne Weiterverbreitung am risikoarmen Ende — eine Garantie ist das
  nicht.

Wenn du das nicht möchtest, gibt es Wege ohne Scraping — siehe unten.

### Alternativen ohne Scraper

**1. Feste Zuordnungstabelle** (`BROADCAST_FALLBACK=rule`)

Funktioniert sofort, kostet nichts — aber genau das haben wir verworfen, weil
es zu ungenau ist: An einem CL-Abend laufen sechs Parallelspiele auf
Sky Sport Austria 1 bis 5. Eine feste Tabelle sagt für alle sechs dasselbe.
Und Sender mit Zweitverwertungsrecht (ServusTV, ORF 1) zeigen nur ein
ausgewähltes Spiel pro Runde — pauschal eingetragen sind sie meistens falsch.

Der Vorschlag „feste Tabelle + nur Sky-Kanalnummern scrapen“ hilft leider
nicht: die Kanalnummer ist ja gerade der Teil, für den man scrapen muss.

**2. `api-football.com`** (`DATA_PROVIDER=api-football`)

Deckt alle neun Wettbewerbe mit vollständigem Spielplan ab, gratis bis
100 Anfragen/Tag, mit regulärem API-Zugang statt Scraping. Liefert aber
**keine** deutschen/österreichischen Senderdaten — die Kanalnummern fehlen
weiterhin.

**3. Von Hand pflegen**

Die Overrides (`source='manual'`) sind bereits eingebaut und schlagen jede
automatische Quelle. Für ein paar Spiele pro Woche durchaus machbar:

```bash
curl -X PUT "http://localhost:3000/api/matches/42/broadcasts?country=AT" \
  -H "x-admin-token: DEIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"channels":[{"name":"Sky Sport Austria 3","type":"tv"}]}'
```

**Ehrliche Einschätzung:** Nur Variante 1 und 3 kommen ohne Scraper zum Ziel,
und beide bedeuten entweder ungenaue Angaben oder Handarbeit. Wenn dir die
exakte Kanalnummer wichtig ist — und das war ja der Auslöser — führt an einer
Scraping-Lösung derzeit kein Weg vorbei.

---

## Hinweis zu better-sqlite3

Das Paket ist ein natives Modul. Für Node 26 gibt es fertige Binaries erst ab
**better-sqlite3 v13** — mit v11 versucht npm, selbst zu kompilieren, und
scheitert ohne Python/Visual-Studio-Buildtools. Die `package.json` ist deshalb
auf `^13.0.3` festgelegt.
