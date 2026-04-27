import bcrypt from "bcryptjs";
import crypto from "crypto";
import express from "express";
import { pool } from "./db.js";
import { requireAdmin, requireAuth, signToken } from "./auth.js";
import { deleteReadings, queryLatest, queryReadings } from "./influx.js";

export const router = express.Router();

router.get("/health", (req, res) => res.json({ ok: true }));

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const result = await pool.query("select * from users where email = $1", [String(email || "").toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    return res.status(401).json({ error: "E-Mail oder Passwort falsch" });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  const users = await pool.query(
    "select id, email, name, role, created_at from users order by created_at desc"
  );
  res.json({ users: users.rows });
});

router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  const { email, name, password, role = "user" } = req.body || {};
  if (!email || !name || !password) return res.status(400).json({ error: "E-Mail, Name und Passwort sind Pflicht" });
  if (!["admin", "user"].includes(role)) return res.status(400).json({ error: "Ungueltige Rolle" });

  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `insert into users (email, name, password_hash, role)
     values ($1, $2, $3, $4)
     returning id, email, name, role, created_at`,
    [String(email).toLowerCase(), name, hash, role]
  );
  res.status(201).json({ user: result.rows[0] });
});

router.patch("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (role && !["admin", "user"].includes(role)) return res.status(400).json({ error: "Ungueltige Rolle" });
  if (!email && !name && !password && !role) return res.status(400).json({ error: "Keine Aenderung angegeben" });

  const current = await pool.query("select * from users where id = $1", [req.params.id]);
  if (current.rowCount === 0) return res.status(404).json({ error: "User nicht gefunden" });

  if (req.params.id === req.user.id && role && role !== "admin") {
    return res.status(400).json({ error: "Eigenen Admin nicht herabstufen" });
  }

  const hash = password ? await bcrypt.hash(password, 12) : null;
  const result = await pool.query(
    `update users
     set email = coalesce($2, email),
         name = coalesce($3, name),
         role = coalesce($4, role),
         password_hash = coalesce($5, password_hash)
     where id = $1
     returning id, email, name, role, created_at`,
    [
      req.params.id,
      email ? String(email).toLowerCase() : null,
      name || null,
      role || null,
      hash
    ]
  );
  res.json({ user: result.rows[0] });
});

router.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Eigenen Admin nicht loeschen" });
  await pool.query("delete from users where id = $1", [req.params.id]);
  res.status(204).end();
});

router.get("/devices", requireAuth, async (req, res) => {
  const params = [];
  let where = "";
  if (req.user.role !== "admin") {
    params.push(req.user.id);
    where = "where d.user_id = $1";
  }
  const result = await pool.query(
    `select d.*, u.email as user_email, u.name as user_name
     from devices d
     join users u on u.id = d.user_id
     ${where}
     order by d.created_at desc`,
    params
  );
  res.json({ devices: result.rows });
});

router.post("/devices", requireAuth, requireAdmin, async (req, res) => {
  const {
    user_id,
    name,
    client_id,
    serial_number,
    mqtt_topic,
    history_sample_interval_seconds,
    manufacturer,
    model,
    mqtt_username,
    mqtt_password
  } = req.body || {};
  if (!user_id || !name || !client_id || !serial_number || !mqtt_password) {
    return res.status(400).json({ error: "User, Name, Client-ID, Serialnumber und MQTT-Passwort sind Pflicht" });
  }
  const username = mqtt_username || `${client_id}_${serial_number}`;
  const topic = mqtt_topic || defaultDeviceTopic(client_id, serial_number);
  const historyInterval = normalizeHistoryInterval(history_sample_interval_seconds);
  const result = await pool.query(
    `insert into devices (user_id, name, client_id, serial_number, mqtt_username, mqtt_topic, history_sample_interval_seconds, manufacturer, model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [user_id, name, client_id, serial_number, username, topic, historyInterval, manufacturer || null, model || null]
  );
  await upsertMqttCredential(username, mqtt_password, result.rows[0].id);
  res.status(201).json({ device: result.rows[0] });
});

router.patch("/devices/:id", requireAuth, requireAdmin, async (req, res) => {
  const {
    user_id,
    name,
    client_id,
    serial_number,
    mqtt_topic,
    history_sample_interval_seconds,
    mqtt_username,
    mqtt_password,
    manufacturer,
    model
  } = req.body || {};
  const current = await pool.query("select * from devices where id = $1", [req.params.id]);
  if (current.rowCount === 0) return res.status(404).json({ error: "Geraet nicht gefunden" });

  const nextUsername = mqtt_username || current.rows[0].mqtt_username;
  const usernameTaken = await pool.query(
    "select device_id from mqtt_credentials where username = $1 and coalesce(device_id::text, '') <> $2",
    [nextUsername, req.params.id]
  );
  if (usernameTaken.rowCount > 0) return res.status(409).json({ error: "MQTT-Username ist bereits vergeben" });
  if (current.rows[0].mqtt_username !== nextUsername && !mqtt_password) {
    return res.status(400).json({ error: "Beim Aendern des MQTT-Users ist ein neues MQTT-Passwort erforderlich" });
  }
  const historyInterval = history_sample_interval_seconds == null
    ? null
    : normalizeHistoryInterval(history_sample_interval_seconds);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update devices
       set user_id = coalesce($2, user_id),
           name = coalesce($3, name),
           client_id = coalesce($4, client_id),
           serial_number = coalesce($5, serial_number),
           mqtt_username = coalesce($6, mqtt_username),
           mqtt_topic = coalesce($7, mqtt_topic),
           history_sample_interval_seconds = coalesce($8, history_sample_interval_seconds),
           manufacturer = coalesce($9, manufacturer),
           model = coalesce($10, model)
       where id = $1
       returning *`,
      [
        req.params.id,
        user_id || null,
        name || null,
        client_id || null,
        serial_number || null,
        nextUsername,
        mqtt_topic || null,
        historyInterval,
        manufacturer || null,
        model || null
      ]
    );

    if (current.rows[0].mqtt_username !== nextUsername) {
      await client.query("delete from mqtt_credentials where username = $1", [current.rows[0].mqtt_username]);
    }
    if (mqtt_password || current.rows[0].mqtt_username !== nextUsername) {
      await upsertMqttCredential(nextUsername, mqtt_password, result.rows[0].id, client);
    }
    await client.query("commit");
    res.json({ device: result.rows[0] });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/devices/claim", requireAuth, async (req, res) => {
  const {
    client_id,
    serial_number,
    mqtt_username,
    mqtt_password,
    name,
    mqtt_topic,
    history_sample_interval_seconds,
    manufacturer,
    model
  } = req.body || {};
  if (!client_id || !serial_number || !mqtt_username || !mqtt_password) {
    return res.status(400).json({ error: "Client-ID, Serialnumber, MQTT-User und MQTT-Passwort sind Pflicht" });
  }

  const usernameAvailable = await pool.query(
    "select username from mqtt_credentials where username = $1",
    [mqtt_username]
  );
  if (usernameAvailable.rowCount > 0) return res.status(409).json({ error: "MQTT-Username ist bereits vergeben" });

  const existing = await pool.query(
    "select id from devices where client_id = $1 and serial_number = $2",
    [client_id, serial_number]
  );
  if (existing.rowCount > 0) return res.status(409).json({ error: "Dieses Geraet ist bereits registriert" });

  const result = await pool.query(
    `insert into devices (user_id, name, client_id, serial_number, mqtt_username, mqtt_topic, history_sample_interval_seconds, manufacturer, model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      req.user.id,
      name || "Eltako ZGW",
      client_id,
      serial_number,
      mqtt_username,
      mqtt_topic || defaultDeviceTopic(client_id, serial_number),
      normalizeHistoryInterval(history_sample_interval_seconds),
      manufacturer || "Eltako",
      model || "ZGW"
    ]
  );
  await upsertMqttCredential(mqtt_username, mqtt_password, result.rows[0].id);
  res.status(201).json({ device: result.rows[0] });
});

router.delete("/devices/:id", requireAuth, requireAdmin, async (req, res) => {
  await pool.query("delete from devices where id = $1", [req.params.id]);
  res.status(204).end();
});

router.delete("/maintenance/history", requireAuth, requireAdmin, async (req, res) => {
  const { before, device_id } = req.body || {};
  const cutoff = parseDateQuery(before);
  if (!cutoff) return res.status(400).json({ error: "Gueltiges Datum fuer 'before' ist Pflicht" });

  if (device_id) {
    const device = await pool.query("select id from devices where id = $1", [device_id]);
    if (device.rowCount === 0) return res.status(404).json({ error: "Geraet nicht gefunden" });
  }

  await deleteReadings({ before: cutoff, deviceId: device_id || null });

  const params = [cutoff];
  let deviceFilter = "";
  if (device_id) {
    params.push(device_id);
    deviceFilter = " and device_id = $2";
  }
  const deleted = await pool.query(`delete from readings where created_at < $1${deviceFilter}`, params);

  res.json({
    ok: true,
    postgres_deleted: deleted.rowCount,
    before: cutoff,
    device_id: device_id || null
  });
});

router.get("/devices/:id/metrics", requireAuth, async (req, res) => {
  const device = await visibleDevice(req.params.id, req.user);
  if (!device) return res.status(404).json({ error: "Geraet nicht gefunden" });

  const result = await pool.query(
    `select metric, unit, created_at as last_seen_at
     from latest_readings
     where device_id = $1
     order by metric`,
    [req.params.id]
  );
  res.json({ metrics: result.rows });
});

router.get("/devices/:id/readings", requireAuth, async (req, res) => {
  const device = await visibleDevice(req.params.id, req.user);
  if (!device) return res.status(404).json({ error: "Geraet nicht gefunden" });

  const metric = req.query.metric;
  const hours = Math.min(Number(req.query.hours || 24), 24 * 365);
  const start = parseDateQuery(req.query.start);
  const end = parseDateQuery(req.query.end);
  if (req.query.start && !start) return res.status(400).json({ error: "Startdatum ist ungueltig" });
  if (req.query.end && !end) return res.status(400).json({ error: "Enddatum ist ungueltig" });
  const params = [req.params.id, hours];
  let metricFilter = "";
  if (metric) {
    params.push(metric);
    metricFilter = "and metric = $3";
  }

  void params;
  void metricFilter;
  const readings = await queryReadings({ deviceId: req.params.id, metric, hours, start, end });
  res.json({ readings });
});

router.get("/summary", requireAuth, async (req, res) => {
  const params = [];
  let where = "";
  if (req.user.role !== "admin") {
    params.push(req.user.id);
    where = "where d.user_id = $1";
  }

  const devicesResult = await pool.query(
    `select
       d.id as device_id,
       d.name as device_name,
       lr.metric,
       lr.value,
       lr.unit,
       lr.raw_payload,
       lr.created_at
     from devices d
     left join latest_readings lr on lr.device_id = d.id
     ${where}
     order by d.name, lr.metric`,
    params
  );
  const rows = devicesResult.rows.filter((row) => row.metric);
  if (rows.length > 0) return res.json({ summary: rows });

  const visibleDevices = new Map(devicesResult.rows.map((row) => [row.device_id, row.device_name]));
  const latest = await queryLatest({ userId: req.user.id, isAdmin: req.user.role === "admin" });
  res.json({
    summary: latest
      .filter((row) => visibleDevices.has(row.device_id))
      .map((row) => ({
        ...row,
        device_name: visibleDevices.get(row.device_id),
        raw_payload: null
      }))
  });
});

async function visibleDevice(id, user) {
  const params = [id];
  let where = "id = $1";
  if (user.role !== "admin") {
    params.push(user.id);
    where += " and user_id = $2";
  }
  const result = await pool.query(`select * from devices where ${where}`, params);
  return result.rows[0] || null;
}

function parseDateQuery(value) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultDeviceTopic(clientId, serialNumber) {
  return `${clientId}/devices/${serialNumber}`;
}

function normalizeHistoryInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return 60;
  return Math.min(Math.max(Math.round(interval), 1), 86400);
}

async function upsertMqttCredential(username, password, deviceId, db = pool) {
  const salt = crypto.randomBytes(12).toString("hex");
  const passwordHash = crypto.createHash("sha256").update(`${password}${salt}`).digest("hex");
  await db.query(
    `insert into mqtt_credentials (username, password_hash, salt, device_id)
     values ($1, $2, $3, $4)
     on conflict (username) do update set
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      enabled = true,
      device_id = excluded.device_id`,
    [username, passwordHash, salt, deviceId]
  );
}
