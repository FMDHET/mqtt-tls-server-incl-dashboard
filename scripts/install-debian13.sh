#!/usr/bin/env bash
set -euo pipefail

DOMAIN_DEFAULT="mqtt-tls.thumm-lb.de"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

random_secret() {
  openssl rand -hex 32
}

prompt() {
  local label="$1"
  local default="$2"
  local secret="${3:-false}"
  local value
  if [[ "$secret" == "true" ]]; then
    read -r -s -p "$label [$default]: " value
    echo
  else
    read -r -p "$label [$default]: " value
  fi
  echo "${value:-$default}"
}

echo "== MQTT TLS Dashboard Installer fuer Debian 13 =="
echo "Arbeitsverzeichnis: $APP_DIR"

if ! need_cmd openssl; then
  $SUDO apt update
  $SUDO apt install -y openssl
fi

DOMAIN="$(prompt "Domain" "$DOMAIN_DEFAULT")"
LE_EMAIL="$(prompt "Let's Encrypt E-Mail" "admin@thumm-lb.de")"
ADMIN_EMAIL="$(prompt "Admin E-Mail" "admin@$DOMAIN")"
ADMIN_PASSWORD="$(prompt "Admin Passwort" "$(random_secret)" true)"
POSTGRES_PASSWORD="$(prompt "Postgres Passwort" "$(random_secret)" true)"
INFLUX_PASSWORD="$(prompt "Influx Admin Passwort" "$(random_secret)" true)"
INFLUX_TOKEN="$(prompt "Influx Token" "$(random_secret)" true)"
JWT_SECRET="$(random_secret)"
EMQX_DASHBOARD_PASSWORD="$(prompt "EMQX Dashboard Passwort" "$(random_secret)" true)"
MQTT_INGEST_PASSWORD="$(prompt "Dashboard MQTT Ingest Passwort" "$(random_secret)" true)"

echo "== Pakete installieren =="
$SUDO apt update
$SUDO apt install -y ca-certificates curl gnupg ufw certbot openssl

if ! need_cmd docker; then
  echo "== Docker installieren =="
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER" || true
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose Plugin wurde nicht gefunden."
  exit 1
fi

echo "== .env schreiben =="
cat > .env <<EOF_ENV
APP_URL=https://$DOMAIN
CADDY_DOMAIN=$DOMAIN
CADDY_EMAIL=$LE_EMAIL

POSTGRES_DB=mqtt_dashboard
POSTGRES_USER=mqtt_dashboard
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

INFLUX_USERNAME=admin
INFLUX_PASSWORD=$INFLUX_PASSWORD
INFLUX_TOKEN=$INFLUX_TOKEN
INFLUX_ORG=thumm-lb
INFLUX_BUCKET=mqtt_energy

JWT_SECRET=$JWT_SECRET
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD

MQTT_URL=mqtt://emqx:1883
MQTT_USERNAME=dashboard_ingest
MQTT_PASSWORD=$MQTT_INGEST_PASSWORD

EMQX_DASHBOARD_USER=admin
EMQX_DASHBOARD_PASSWORD=$EMQX_DASHBOARD_PASSWORD
EOF_ENV

echo "== Firewall konfigurieren =="
$SUDO ufw allow 22/tcp
$SUDO ufw allow 80/tcp
$SUDO ufw allow 443/tcp
$SUDO ufw allow 1883/tcp
$SUDO ufw allow 8883/tcp
$SUDO ufw --force enable

echo "== Let's Encrypt Zertifikat fuer MQTT TLS holen =="
mkdir -p deploy/emqx/certs
if $SUDO test -d "/etc/letsencrypt/live/$DOMAIN"; then
  echo "Vorhandenes Zertifikat wird verwendet."
else
  docker compose down >/dev/null 2>&1 || true
  $SUDO certbot certonly --standalone --non-interactive --agree-tos \
    --email "$LE_EMAIL" -d "$DOMAIN"
fi

$SUDO cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" deploy/emqx/certs/fullchain.pem
$SUDO cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" deploy/emqx/certs/privkey.pem
$SUDO chown -R "$USER":"$USER" deploy/emqx/certs

echo "== Services bauen und starten =="
docker compose up -d --build

echo
echo "Fertig."
echo "Dashboard: https://$DOMAIN"
echo "EMQX Dashboard: http://$DOMAIN:18083"
echo "MQTT: $DOMAIN:1883"
echo "MQTT TLS: $DOMAIN:8883"
echo
echo "Admin Login:"
echo "  E-Mail: $ADMIN_EMAIL"
echo "  Passwort: $ADMIN_PASSWORD"
