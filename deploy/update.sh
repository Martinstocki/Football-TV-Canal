#!/usr/bin/env bash
# Aenderungen auf den Server holen und neu starten.
#
#   cd ~/fussball-programm && ./deploy/update.sh
#
# set -e: bei jedem Fehler abbrechen, statt weiterzumachen und am Ende
# faelschlich "fertig" zu melden.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Code holen"
git pull --ff-only

echo "==> Abhaengigkeiten"
# npm ci statt npm install: installiert exakt das, was in package-lock.json
# steht. Keine Ueberraschungen durch neuere Nebenversionen.
npm ci --omit=dev --no-audit --no-fund

echo "==> Neu starten"
sudo systemctl restart fussball-programm

# Kurz warten und nachsehen, ob er auch oben bleibt - ein Dienst, der
# sofort wieder abstuerzt, meldet sonst faelschlich Erfolg.
sleep 3
if systemctl is-active --quiet fussball-programm; then
  echo "==> Laeuft."
  systemctl status fussball-programm --no-pager --lines=8
else
  echo "==> FEHLER: Dienst laeuft nicht. Letzte Zeilen:"
  journalctl -u fussball-programm --no-pager --lines=30
  exit 1
fi
