import mqtt from "mqtt";
import { WebSocketServer } from "ws";
import { pool } from "./db.js";
import { writeReading } from "./influx.js";

let wss;

export function attachLiveServer(server) {
  wss = new WebSocketServer({ server, path: "/ws/live" });
}

function broadcast(event) {
  if (!wss) return;
  const data = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

function parseJson(buffer) {
  const text = buffer.toString("utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const number = Number(text);
    return Number.isFinite(number) ? { value: number } : { value: text };
  }
}

function parseStateTopic(topic) {
  const parts = topic.split("/");
  const devicesIndex = parts.indexOf("devices");
  if (devicesIndex <= 0 || parts.length < devicesIndex + 3) return null;
  return {
    clientId: parts.slice(0, devicesIndex).join("/"),
    serialNumber: parts[devicesIndex + 1],
    metric: parts.slice(devicesIndex + 2).join("/")
  };
}

function parseDiscoveryTopic(topic) {
  if (!topic.startsWith("homeassistant/") || !topic.endsWith("/config")) return null;
  return true;
}

async function upsertDiscoveryConfig(config) {
  if (!config?.state_topic || !config?.unique_id) return;
  const parsed = parseStateTopic(config.state_topic);
  if (!parsed) return;

  const device = await pool.query(
    `select id from devices where client_id = $1 and serial_number = $2`,
    [parsed.clientId, parsed.serialNumber]
  );
  const deviceId = device.rows[0]?.id || null;

  await pool.query(
    `insert into metric_configs
      (device_id, unique_id, state_topic, metric, name, device_class, state_class, unit, raw_config, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (unique_id) do update set
      device_id = excluded.device_id,
      state_topic = excluded.state_topic,
      metric = excluded.metric,
      name = excluded.name,
      device_class = excluded.device_class,
      state_class = excluded.state_class,
      unit = excluded.unit,
      raw_config = excluded.raw_config,
      updated_at = now()`,
    [
      deviceId,
      config.unique_id,
      config.state_topic,
      parsed.metric,
      config.name || parsed.metric,
      config.device_class || null,
      config.state_class || null,
      config.unit_of_measurement || null,
      config
    ]
  );
}

async function storeReading(topic, payload) {
  const parsed = parseStateTopic(topic);
  if (!parsed) return;

  const value = Number(payload?.value);
  if (!Number.isFinite(value)) return;

  const deviceResult = await pool.query(
    `select d.id, d.name, d.user_id, d.client_id, d.serial_number, mc.unit
     from devices d
     left join metric_configs mc on mc.device_id = d.id and mc.state_topic = $3
     where d.client_id = $1 and d.serial_number = $2
     limit 1`,
    [parsed.clientId, parsed.serialNumber, topic]
  );
  if (deviceResult.rowCount === 0) return;

  const device = deviceResult.rows[0];
  const reading = {
    device_id: device.id,
    metric: parsed.metric,
    value,
    unit: device.unit || payload.unit || null,
    raw_payload: payload,
    created_at: new Date().toISOString()
  };
  await writeReading({ device, metric: parsed.metric, value, unit: reading.unit, payload });
  await pool.query(
    `insert into latest_readings (device_id, metric, value, unit, raw_payload, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (device_id, metric) do update set
      value = excluded.value,
      unit = excluded.unit,
      raw_payload = excluded.raw_payload,
      created_at = excluded.created_at`,
    [device.id, parsed.metric, value, reading.unit, payload, reading.created_at]
  );
  await pool.query("update devices set last_seen_at = $2 where id = $1", [device.id, reading.created_at]);

  broadcast({
    type: "reading",
    reading,
    device: { id: device.id, name: device.name, user_id: device.user_id }
  });
}

export function startMqttIngestion() {
  const url = process.env.MQTT_URL || "mqtt://localhost:1883";
  const client = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: `dashboard-ingest-${Math.random().toString(16).slice(2)}`
  });

  client.on("connect", () => {
    client.subscribe(["homeassistant/+/+/config", "+/devices/+/+"], { qos: 0 });
  });

  client.on("message", async (topic, buffer) => {
    try {
      const payload = parseJson(buffer);
      if (parseDiscoveryTopic(topic)) await upsertDiscoveryConfig(payload);
      else await storeReading(topic, payload);
    } catch (error) {
      console.error("MQTT ingest failed", { topic, error });
    }
  });

  client.on("error", (error) => {
    console.error("MQTT connection error", error.message);
  });
}
