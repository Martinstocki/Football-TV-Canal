# Oracle Cloud Always Free — Schritt für Schritt

Dauerhaft kostenloser Server für die App. Kein Ablaufdatum, keine
Testphase, echte Festplatte, läuft durch.

**Zeitaufwand:** 1 bis 2 Stunden beim ersten Mal.
**Laufende Kosten:** 0 €.

---

## Ehrlich vorweg: worauf du dich einlässt

Railway wären zehn Klicks in einer Weboberfläche gewesen. Hier verwaltest du
einen echten Linux-Server: Anmeldung per SSH, Dienste einrichten, Firewall
konfigurieren. Das ist zu schaffen, aber es ist eine andere Liga.

Vier Dinge, über die fast jeder stolpert — deshalb vorab:

1. **Oracle verlangt eine Kreditkarte** zur Identitätsprüfung. Für „Always
   Free"-Ressourcen wird nichts abgebucht. Wechsle das Konto **nicht** auf
   „Pay As You Go", sonst kann es kosten.
2. **Zwei Firewalls.** Oracle blockiert Ports in der Weboberfläche *und*
   nochmal per `iptables` auf dem Server selbst. Wer nur eine öffnet, sucht
   stundenlang.
3. **ARM-Kapazität ist oft erschöpft.** „Out of capacity" ist normal — dann
   nimmst du die AMD-Variante (siehe Schritt 2).
4. **Oracle darf ungenutzte Always-Free-Instanzen zurückfordern.** Bei einer
   App, die zweimal täglich arbeitet, ist das unwahrscheinlich, aber es ist
   kein Vertrag mit Garantie. **Mach Sicherungen deiner Datenbank.**

Wenn dir das zu viel ist: Ein Hetzner-VPS kostet ~4 €/Monat, die Schritte 3
bis 9 sind dort identisch, aber die Firewall-Fallstricke entfallen.

---

## Schritt 1 — Konto anlegen

1. [cloud.oracle.com](https://cloud.oracle.com) → **Start for free**
2. **Home Region wählen — das lässt sich später nicht ändern.** Nimm etwas
   Nahes: Frankfurt oder Amsterdam.
3. Kreditkarte zur Verifizierung hinterlegen.
4. Nach der Anmeldung oben prüfen: Steht dort **Always Free Eligible**?

---

## Schritt 2 — Server erstellen

**Menü → Compute → Instances → Create Instance**

**Image:** Canonical Ubuntu 24.04

**Shape:** Auf *Change shape* klicken.

| Variante | Ausstattung | Hinweis |
|---|---|---|
| `VM.Standard.A1.Flex` (ARM) | bis 4 Kerne, 24 GB | erste Wahl — oft „out of capacity" |
| `VM.Standard.E2.1.Micro` (AMD) | 1/8 Kern, 1 GB | immer verfügbar, **reicht für diese App** |

Bei ARM: 1 Kern und 6 GB genügen völlig. Kommt „Out of capacity", nimm die
AMD-Variante — 1 GB RAM ist für diese App ausreichend.

**SSH-Schlüssel:** *Generate a key pair for me* → **beide Dateien
herunterladen**. Der private Schlüssel ist dein einziger Zugang; ist er weg,
kommst du nicht mehr auf den Server.

**Create** klicken und die **Public IP address** notieren.

---

## Schritt 3 — Erste Firewall: Oracle-Weboberfläche

Instanz öffnen → **Virtual Cloud Network** anklicken → **Security Lists** →
**Default Security List** → **Add Ingress Rules**.

Zwei Regeln anlegen:

| Source CIDR | Protokoll | Zielport | Wofür |
|---|---|---|---|
| `0.0.0.0/0` | TCP | 80 | Zertifikatsprüfung von Let's Encrypt |
| `0.0.0.0/0` | TCP | 443 | HTTPS |

Port 3000 bleibt **zu**. Die App wird nur über Caddy erreichbar sein.

---

## Schritt 4 — Anmelden

In PowerShell auf deinem Surface (Pfad zum heruntergeladenen Schlüssel
anpassen):

```bash
ssh -i C:\Users\marti\Downloads\ssh-key.key ubuntu@DEINE-IP
```

Fehlermeldung wegen zu offener Dateirechte? Dann:

```bash
icacls C:\Users\marti\Downloads\ssh-key.key /inheritance:r /grant:r "%USERNAME%:R"
```

---

## Schritt 5 — Zweite Firewall: iptables auf dem Server

**Der Schritt, den fast alle vergessen.** Oracles Ubuntu-Abbilder bringen
eigene `iptables`-Regeln mit, die alles außer SSH blockieren. Schritt 3
allein reicht deshalb nicht.

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

`netfilter-persistent save` nicht vergessen — sonst sind die Regeln nach dem
nächsten Neustart weg.

---

## Schritt 6 — Grundausstattung installieren

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Europe/Vienna
```

Node 22 (die Version aus der `.nvmrc`):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node --version
```

---

## Schritt 7 — App holen

```bash
cd ~
git clone https://github.com/DEIN-NAME/fussball-programm.git
cd fussball-programm
npm ci --omit=dev
```

Läuft in Sekunden durch. Falls doch ein `node-gyp`-Fehler kommt, fehlt die
`.npmrc` — die schaltet die Kompilierversuche ab und ist Teil des Projekts.

---

## Schritt 8 — Konfiguration anlegen

```bash
cp .env.example .env
nano .env
```

Diese Werte setzen:

```
HOST=127.0.0.1
PORT=3000
TZ=Europe/Vienna

FOOTBALL_DATA_API_KEY=dein-key
APP_USER=familie
APP_PASSWORD=dein-langes-passwort
ADMIN_TOKEN=dein-zufallstoken

DEFAULT_COUNTRY=AT
BROADCAST_FALLBACK=placeholder

DATABASE_PATH=data/fussball.db
LOG_FILE=data/log.txt

SCHEDULE_ENABLED=true
SCHEDULE_CRON=0 8,18 * * *
SCHEDULE_JOBS=sync,fixtures,tv
SYNC_ON_START=true
```

**`HOST=127.0.0.1` ist wichtig:** So lauscht die App nur lokal. Von außen
kommt man ausschließlich über Caddy und damit nur über HTTPS.

Speichern mit `Strg+O`, `Enter`, `Strg+X`.

Erster Testlauf im Vordergrund:

```bash
node backend/server.js
```

Erwartet:

```
Zugangsschutz aktiv (Basic Auth).
Fussball-Programm laeuft auf http://127.0.0.1:3000
Zeitplan aktiv: "0 8,18 * * *" (Europe/Vienna), Jobs: sync, fixtures, tv
```

Steht dort `WARNUNG: Kein Zugangsschutz`, fehlt `APP_USER` oder
`APP_PASSWORD`. Mit `Strg+C` beenden.

---

## Schritt 9 — Als Dienst einrichten

Damit die App beim Booten startet und nach Abstürzen wiederkommt:

```bash
sudo cp deploy/fussball-programm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fussball-programm
sudo systemctl status fussball-programm
```

Logs mitlesen:

```bash
sudo journalctl -u fussball-programm -f
```

---

## Schritt 10 — Adresse und HTTPS

Eine Adresse brauchst du, weil Let's Encrypt keine Zertifikate für nackte
IP-Adressen ausstellt.

**Kostenlos über [duckdns.org](https://duckdns.org):** mit GitHub anmelden,
Namen wählen (z. B. `martin-fussball`), deine Oracle-IP eintragen. Du bekommst
`martin-fussball.duckdns.org`.

Caddy installieren:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Konfigurieren:

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # DEINE-ADRESSE.duckdns.org eintragen
sudo systemctl reload caddy
```

Caddy holt das Zertifikat automatisch — das dauert etwa eine halbe Minute.

---

## Schritt 11 — Prüfen

Im Browser `https://DEINE-ADRESSE.duckdns.org`:

1. **Schloss-Symbol** in der Adresszeile → HTTPS steht.
2. **Passwortabfrage** kommt → Schutz greift.
3. Abbrechen → nichts zu sehen.
4. Mit Zugangsdaten → Spielplan.
5. `https://DEINE-ADRESSE.duckdns.org/healthz` → `ok` ohne Passwort. Richtig so.

Klemmt es, in dieser Reihenfolge nachsehen:

```bash
sudo systemctl status fussball-programm    # laeuft die App?
sudo systemctl status caddy                # laeuft Caddy?
curl -I http://127.0.0.1:3000/healthz      # antwortet sie lokal?
sudo journalctl -u caddy -n 30             # Zertifikatsprobleme?
```

Antwortet die App lokal, aber von außen kommt nichts: Das ist fast immer
Schritt 5 (iptables).

---

## Danach

**Änderungen ausrollen:**

```bash
cd ~/fussball-programm && ./deploy/update.sh
```

**Datenbank sichern** — Oracle gibt keine Garantie. Wöchentlich per cron:

```bash
crontab -e
```

```
0 3 * * 0 cd ~/fussball-programm && sqlite3 data/fussball.db ".backup ~/backup-$(date +\%Y\%m\%d).db"
```

Dafür einmalig `sudo apt install -y sqlite3`. Ab und zu eine Sicherung auf
dein Surface holen:

```bash
scp -i DEIN-SCHLUESSEL ubuntu@DEINE-IP:~/backup-*.db .
```

**Sicherheitsupdates:**

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Was du dir damit einhandelst

Ein Server ist deine Verantwortung: Updates einspielen, Logs im Blick behalten,
Sicherungen machen. Für eine Familien-App mit einer Handvoll Nutzern ist das
überschaubar — aber es ist mehr als bei Railway, wo das jemand anderes tut.

Wenn dir das nach einigen Wochen lästig wird, ist der Wechsel leicht: Die App
ist dieselbe, nur die Umgebung wäre eine andere.
