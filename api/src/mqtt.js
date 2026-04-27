import mqtt from "mqtt";
import { WebSocketServer } from "ws";
import { pool } from "./db.js";
import { writeReading } from "./influx.js";

let wss;
const liveClients = new Set();

export function attachLiveServer(server) {
  wss = new WebSocketServer({ server, path: "/ws/live" });
}

export function addLiveClient(res, user) {
  const client = { res, user };
  liveClients.add(client);
  res.write("event: connected\n");
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);
  return () => liveClients.delete(client);
}

function broadcast(event) {
  const data = JSON.stringify(event);
  if (wss) {
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  }
  for (const client of liveClients) {
    if (client.user.role !== "admin" && client.user.id !== event.device.user_id) continue;
    client.res.write("event: reading\n");
    client.res.write(`data: ${data}\n\n`);
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
  const clientId = parts.slice(0, devicesIndex).join("/");
  return {
    clientId,
    clientIdLeaf: clientId.split("/").at(-1),
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
    `select d.id, d.name, d.user_id, d.client_id, d.serial_number, d.history_sample_interval_seconds, mc.unit
     from devices d
     left join metric_configs mc on mc.device_id = d.id and mc.state_topic = $3
     where d.serial_number = $2
       and (
         d.client_id = $1
         or d.client_id = $4
         or mc.state_topic = $3
       )
     limit 1`,
    [parsed.clientId, parsed.serialNumber, topic, parsed.clientIdLeaf]
  );
  if (deviceResult.rowCount === 0) {
    console.warn("MQTT reading ignored: no registered device", {
      topic,
      clientId: parsed.clientId,
      clientIdLeaf: parsed.clientIdLeaf,
      serialNumber: parsed.serialNumber,
      metric: parsed.metric
    });
    return;
  }

  const device = deviceResult.rows[0];
  const createdAt = parsePayloadTimestamp(payload) || new Date().toISOString();
  const reading = {
    device_id: device.id,
    metric: parsed.metric,
    value,
    unit: device.unit || payload.unit || null,
    raw_payload: payload,
    created_at: createdAt
  };
  if (await shouldWriteHistory(device.id, parsed.metric, reading.created_at, device.history_sample_interval_seconds)) {
    await writeReading({ device, metric: parsed.metric, value, unit: reading.unit, payload });
    await markHistoryWritten(device.id, parsed.metric, reading.created_at);
  }
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

async function shouldWriteHistory(deviceId, metric, createdAt, intervalSeconds) {
  const interval = Math.max(Number(intervalSeconds) || 60, 1);
  const result = await pool.query(
    "select last_written_at from history_write_state where device_id = $1 and metric = $2",
    [deviceId, metric]
  );
  if (result.rowCount === 0) return true;

  const nextAt = new Date(createdAt).getTime();
  const lastAt = new Date(result.rows[0].last_written_at).getTime();
  return Number.isFinite(nextAt) && Number.isFinite(lastAt) && nextAt - lastAt >= interval * 1000;
}

async function markHistoryWritten(deviceId, metric, createdAt) {
  await pool.query(
    `insert into history_write_state (device_id, metric, last_written_at)
     values ($1, $2, $3)
     on conflict (device_id, metric) do update set
      last_written_at = excluded.last_written_at`,
    [deviceId, metric, createdAt]
  );
}

export function startMqttIngestion() {
  const url = process.env.MQTT_URL || "mqtt://localhost:1883";
  const username = process.env.MQTT_USERNAME || undefined;
  const password = process.env.MQTT_PASSWORD || undefined;
  console.log(`MQTT ingest connecting to ${url} as ${username || "anonymous"}`);
  const client = mqtt.connect(url, {
    username,
    password,
    clientId: `dashboard-ingest-${Math.random().toString(16).slice(2)}`
  });

  client.on("connect", () => {
    client.subscribe("#", { qos: 0 }, (error) => {
      if (error) console.error("MQTT subscribe failed", error.message);
      else console.log("MQTT ingest subscribed");
    });
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

function parsePayloadTimestamp(payload) {
  if (!payload?.timestamp) return null;
  const date = new Date(payload.timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
