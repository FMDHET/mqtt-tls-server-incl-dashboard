# MQTT TLS Server inkl. Dashboard

MVP fuer einen VPS mit EMQX MQTT-Broker, HTTPS Dashboard, Admin/User-Login,
Geraeteverwaltung und Eltako ZGW/Home-Assistant-Discovery Daten.

Ziel-Domain: `mqtt-tls.thumm-lb.de`

## Stack

- EMQX als MQTT-Broker
- PostgreSQL fuer User, Geraete und MQTT-Credentials
- InfluxDB fuer Live- und History-Messwerte
- Node.js API fuer Login, Userverwaltung, MQTT-Ingestion und Live-Websocket
- React Dashboard mit moderner Live- und History-Ansicht
- Caddy als Reverse Proxy mit automatischem Let's Encrypt HTTPS

## Lokal starten

```bash
cp .env.example .env
docker compose up --build
```

Danach:

- Dashboard: <http://localhost:8080>
- API: <http://localhost:3000/health>
- EMQX Dashboard: <http://localhost:18083>

Default-Admin aus `.env.example`:

- E-Mail: `admin@mqtt-tls.thumm-lb.de`
- Passwort: `ChangeMeNow123!`

Bitte direkt in `.env` aendern.

## VPS Deployment auf Debian 13

Am einfachsten:

```bash
./scripts/install-debian13.sh
```

Das Skript installiert Docker, Certbot, richtet die Firewall ein, erzeugt eine
`.env`, holt ein Let's-Encrypt-Zertifikat fuer `mqtt-tls.thumm-lb.de`, kopiert
es fuer EMQX TLS und startet alle Container.

Manuell:

1. DNS A-Record fuer `mqtt-tls.thumm-lb.de` auf die IONOS VPS-IP setzen.
2. Docker installieren:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

3. Repo auf den Server kopieren und `.env` anlegen:

```bash
cp .env.example .env
nano .env
```

4. In `.env` mindestens setzen:

```env
APP_URL=https://mqtt-tls.thumm-lb.de
CADDY_DOMAIN=mqtt-tls.thumm-lb.de
CADDY_EMAIL=admin@thumm-lb.de
JWT_SECRET=<langes-zufaelliges-secret>
POSTGRES_PASSWORD=<starkes-db-passwort>
INFLUX_PASSWORD=<starkes-influx-passwort>
INFLUX_TOKEN=<langes-zufaelliges-token>
ADMIN_EMAIL=<deine-admin-mail>
ADMIN_PASSWORD=<starkes-admin-passwort>
EMQX_DASHBOARD_PASSWORD=<starkes-emqx-dashboard-passwort>
```

5. Firewall oeffnen:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 1883/tcp
sudo ufw allow 8883/tcp
sudo ufw enable
```

6. Starten:

```bash
docker compose up -d --build
```

## MQTT Topics fuer Eltako ZGW

Die App versteht Home-Assistant-Discovery Configs, z. B.:

```json
{
  "name": "ZGW16-IP L1_active_power",
  "unique_id": "ZGW16-IP_L1_active_power_1",
  "state_topic": "ZGW16-IP/devices/1/L1_active_power",
  "availability_topic": "ZGW16-IP/status",
  "device_class": "power",
  "state_class": "measurement",
  "unit_of_measurement": "W",
  "value_template": "{{ value_json.value }}",
  "device": {
    "name": "Einspeisepunkt",
    "manufacturer": "Eltako",
    "model": "DSZ15DZMOD",
    "identifiers": ["eltako_1"]
  }
}
```

Messwerte werden aus Topics dieser Form gelesen:

```text
<client-id>/devices/<serialnumber>/<metric>
```

Beispiel:

```text
ZGW16-IP/devices/1/L1_active_power
```

Payload:

```json
{"value":123.4}
```

Damit Werte einem User zugeordnet werden, muss im Adminbereich ein Geraet mit
passender Client-ID `ZGW16-IP` und Serialnumber `1` angelegt werden. Alternativ
kann ein normaler User sein eigenes Geraet selbst zuweisen, wenn er Client-ID,
Serialnumber, MQTT-Username und MQTT-Passwort festlegt.

## MQTT Login pro ZGW

Jedes Geraet bekommt einen eigenen MQTT-Username und ein MQTT-Passwort.
EMQX prueft diese Logins gegen PostgreSQL. Beim Registrieren eines Geraets wird
das Passwort nur gehasht gespeichert.

Beispiel fuer ein ZGW:

- MQTT Host: `mqtt-tls.thumm-lb.de`
- MQTT TLS Port: `8883`
- Client-ID: `ZGW16-IP`
- Username: z. B. `zgw16-ip-1`
- Passwort: aus dem Dashboard
- Topic: `ZGW16-IP/devices/1/L1_active_power`

## MQTT TLS

Caddy stellt HTTPS fuer Website/API automatisch bereit. Fuer MQTT-over-TLS auf
Port `8883` braucht EMQX Zertifikatsdateien in `deploy/emqx/certs/`.

Auf dem VPS kannst du dafuer z. B. Certbot im Standalone-Modus verwenden, wenn
Port 80 kurz frei ist:

```bash
sudo apt install -y certbot
sudo systemctl stop caddy || true
sudo certbot certonly --standalone -d mqtt-tls.thumm-lb.de
sudo mkdir -p deploy/emqx/certs
sudo cp /etc/letsencrypt/live/mqtt-tls.thumm-lb.de/fullchain.pem deploy/emqx/certs/fullchain.pem
sudo cp /etc/letsencrypt/live/mqtt-tls.thumm-lb.de/privkey.pem deploy/emqx/certs/privkey.pem
sudo chown -R $USER:$USER deploy/emqx/certs
docker compose restart emqx
```

Danach kann ein Client per MQTT TLS auf `mqtt-tls.thumm-lb.de:8883`
verbinden. Authentifizierung pro Geraet ist aktiviert. ACLs pro Topic sind der
naechste sinnvolle Haertungsschritt, damit ein Geraet nur in seine eigenen
Topics schreiben darf.
