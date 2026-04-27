import { InfluxDB, Point } from "@influxdata/influxdb-client";

const url = process.env.INFLUX_URL || "http://localhost:8086";
const token = process.env.INFLUX_TOKEN || "change-me-influx-token";
const org = process.env.INFLUX_ORG || "thumm-lb";
const bucket = process.env.INFLUX_BUCKET || "mqtt_energy";

const influx = new InfluxDB({ url, token });
const writeApi = influx.getWriteApi(org, bucket, "ms");
const queryApi = influx.getQueryApi(org);

export async function writeReading({ device, metric, value, unit, payload }) {
  const point = new Point("mqtt_reading")
    .tag("device_id", device.id)
    .tag("user_id", device.user_id)
    .tag("client_id", device.client_id)
    .tag("serial_number", device.serial_number)
    .tag("metric", metric)
    .floatField("value", value);

  if (unit) point.stringField("unit", unit);
  if (payload) point.stringField("payload", JSON.stringify(payload).slice(0, 4000));

  writeApi.writePoint(point);
  await writeApi.flush();
}

export async function queryReadings({ deviceId, metric, hours = 24, start, end }) {
  const metricFilter = metric ? `|> filter(fn: (r) => r.metric == "${escapeFlux(metric)}")` : "";
  const range = start
    ? `|> range(start: time(v: "${escapeFlux(start)}")${end ? `, stop: time(v: "${escapeFlux(end)}")` : ""})`
    : `|> range(start: -${Number(hours)}h)`;
  const flux = `
    from(bucket: "${escapeFlux(bucket)}")
      ${range}
      |> filter(fn: (r) => r._measurement == "mqtt_reading")
      |> filter(fn: (r) => r.device_id == "${escapeFlux(deviceId)}")
      |> filter(fn: (r) => r._field == "value")
      ${metricFilter}
      |> sort(columns: ["_time"])
  `;
  const rows = [];
  for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
    const row = tableMeta.toObject(values);
    rows.push({
      device_id: row.device_id,
      metric: row.metric,
      value: row._value,
      unit: "",
      created_at: row._time
    });
  }
  return rows;
}

export async function queryLatest({ userId, isAdmin }) {
  const userFilter = isAdmin ? "" : `|> filter(fn: (r) => r.user_id == "${escapeFlux(userId)}")`;
  const flux = `
    from(bucket: "${escapeFlux(bucket)}")
      |> range(start: -30d)
      |> filter(fn: (r) => r._measurement == "mqtt_reading")
      |> filter(fn: (r) => r._field == "value")
      ${userFilter}
      |> group(columns: ["device_id", "metric"])
      |> last()
  `;
  const rows = [];
  for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
    const row = tableMeta.toObject(values);
    rows.push({
      device_id: row.device_id,
      metric: row.metric,
      value: row._value,
      unit: "",
      created_at: row._time
    });
  }
  return rows;
}

export async function deleteReadings({ before, deviceId }) {
  const stop = new Date(before);
  if (Number.isNaN(stop.getTime())) throw new Error("Ungueltiges Enddatum fuer Influx-Loeschung");

  const predicates = ['_measurement="mqtt_reading"'];
  if (deviceId) predicates.push(`device_id="${escapePredicate(deviceId)}"`);

  const response = await fetch(`${url}/api/v2/delete?org=${encodeURIComponent(org)}&bucket=${encodeURIComponent(bucket)}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      start: "1970-01-01T00:00:00Z",
      stop: stop.toISOString(),
      predicate: predicates.join(" AND ")
    })
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Influx-Loeschung fehlgeschlagen: ${message || response.statusText}`);
  }
}

function escapeFlux(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapePredicate(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
