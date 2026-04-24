import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bolt,
  Clock3,
  Pencil,
  Gauge,
  LogOut,
  Plus,
  Save,
  Server,
  Shield,
  Trash2,
  X,
  UserPlus,
  Users
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

const apiBase = "/api";

function request(path, token, options = {}) {
  return fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Request fehlgeschlagen");
    }
    if (res.status === 204) return null;
    return res.json();
  });
}

function App() {
  const [session, setSession] = useState(() => {
    const raw = localStorage.getItem("mqtt-dashboard-session");
    return raw ? JSON.parse(raw) : null;
  });

  function saveSession(next) {
    setSession(next);
    if (next) localStorage.setItem("mqtt-dashboard-session", JSON.stringify(next));
    else localStorage.removeItem("mqtt-dashboard-session");
  }

  if (!session) return <Login onLogin={saveSession} />;
  return <Dashboard session={session} onLogout={() => saveSession(null)} />;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("admin@mqtt-tls.thumm-lb.de");
  const [password, setPassword] = useState("ChangeMeNow123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await request("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-row">
          <span className="brand-mark"><Bolt size={24} /></span>
          <div>
            <h1>MQTT TLS</h1>
            <p>Dashboard fuer Eltako ZGW Messdaten</p>
          </div>
        </div>
        <form onSubmit={submit} className="form">
          <label>
            E-Mail
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            Passwort
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary-button" disabled={loading}>
            <Shield size={18} />
            {loading ? "Anmelden..." : "Anmelden"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ session, onLogout }) {
  const { token, user } = session;
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [readings, setReadings] = useState([]);
  const [metricFilter, setMetricFilter] = useState("");
  const [message, setMessage] = useState("");

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) || devices[0];
  const isAdmin = user.role === "admin";

  async function load() {
    const [devicesData, summaryData, usersData] = await Promise.all([
      request("/devices", token),
      request("/summary", token),
      isAdmin ? request("/users", token) : Promise.resolve({ users: [] })
    ]);
    setDevices(devicesData.devices);
    setSummary(summaryData.summary);
    setUsers(usersData.users);
    if (!selectedDeviceId && devicesData.devices[0]) setSelectedDeviceId(devicesData.devices[0].id);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, []);

  useEffect(() => {
    if (!selectedDevice?.id) return;
    request(`/devices/${selectedDevice.id}/readings?hours=24${metricFilter ? `&metric=${encodeURIComponent(metricFilter)}` : ""}`, token)
      .then((data) => setReadings(data.readings))
      .catch((err) => setMessage(err.message));
  }, [selectedDevice?.id, metricFilter]);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/live`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type !== "reading") return;
      setSummary((current) => updateSummary(current, data));
      if (data.reading.device_id === selectedDeviceId) {
        setReadings((current) => [...current.slice(-400), data.reading]);
      }
    };
    return () => ws.close();
  }, [selectedDeviceId]);

  const latestByMetric = useMemo(() => {
    const rows = summary.filter((row) => row.device_id === selectedDevice?.id && row.metric);
    return Object.fromEntries(rows.map((row) => [row.metric, row]));
  }, [summary, selectedDevice?.id]);

  const chartData = useMemo(() => {
    const grouped = new Map();
    for (const reading of readings) {
      const key = new Date(reading.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      grouped.set(key, { ...(grouped.get(key) || { time: key }), [reading.metric]: Number(reading.value.toFixed(2)) });
    }
    return Array.from(grouped.values());
  }, [readings]);

  const chartMetrics = useMemo(() => {
    const metrics = Array.from(new Set(readings.map((reading) => reading.metric)));
    return metricFilter ? metrics.filter((metric) => metric === metricFilter) : metrics.slice(0, 6);
  }, [readings, metricFilter]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row compact">
          <span className="brand-mark"><Bolt size={22} /></span>
          <div>
            <h1>MQTT TLS</h1>
            <p>{user.name}</p>
          </div>
        </div>
        <nav className="device-nav">
          {devices.map((device) => (
            <button
              key={device.id}
              className={device.id === selectedDevice?.id ? "active" : ""}
              onClick={() => setSelectedDeviceId(device.id)}
            >
              <Server size={18} />
              <span>{device.name}</span>
            </button>
          ))}
        </nav>
        <button className="ghost-button logout" onClick={onLogout}>
          <LogOut size={18} />
          Abmelden
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Live Monitoring</p>
            <h2>{selectedDevice?.name || "Noch kein Geraet angelegt"}</h2>
          </div>
          <div className="status-pill">
            <Activity size={18} />
            {selectedDevice?.last_seen_at ? `Zuletzt ${formatDate(selectedDevice.last_seen_at)}` : "Wartet auf Daten"}
          </div>
        </header>

        {message && <p className="notice">{message}</p>}

        <section className="kpi-grid">
          <MetricTile icon={<Gauge />} label="Power L1" row={latestByMetric.L1_active_power} />
          <MetricTile icon={<Gauge />} label="Power L2" row={latestByMetric.L2_active_power} />
          <MetricTile icon={<Gauge />} label="Power L3" row={latestByMetric.L3_active_power} />
          <MetricTile icon={<Clock3 />} label="Tagesbezug" row={latestByMetric.daily_import || latestByMetric.energy_import_day} />
          <MetricTile icon={<Bolt />} label="Einspeisung" row={latestByMetric.daily_export || latestByMetric.energy_export_day} />
        </section>

        <section className="chart-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">History</p>
              <h3>Letzte 24 Stunden</h3>
            </div>
            <select value={metricFilter} onChange={(event) => setMetricFilter(event.target.value)}>
              <option value="">Alle Metriken</option>
              {Object.keys(latestByMetric).map((metric) => (
                <option key={metric} value={metric}>{metric}</option>
              ))}
            </select>
          </div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height={340}>
              <AreaChart data={chartData}>
                <defs>
                  {chartMetrics.map((metric, index) => (
                    <linearGradient key={metric} id={`grad-${index}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={palette[index % palette.length]} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={palette[index % palette.length]} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e2e7" />
                <XAxis dataKey="time" tick={{ fill: "#60717d", fontSize: 12 }} />
                <YAxis tick={{ fill: "#60717d", fontSize: 12 }} />
                <Tooltip />
                <Legend />
                {chartMetrics.map((metric, index) => (
                  <Area
                    key={metric}
                    type="monotone"
                    dataKey={metric}
                    stroke={palette[index % palette.length]}
                    fill={`url(#grad-${index})`}
                    strokeWidth={2}
                    connectNulls
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {isAdmin && (
          <AdminPanel
            token={token}
            users={users}
            devices={devices}
            onChanged={() => load().catch((err) => setMessage(err.message))}
          />
        )}
        {!isAdmin && <ClaimDevice token={token} onChanged={() => load().catch((err) => setMessage(err.message))} />}
      </section>
    </main>
  );
}

function MetricTile({ icon, label, row }) {
  return (
    <article className="metric-tile">
      <div className="tile-icon">{icon}</div>
      <p>{label}</p>
      <strong>{row ? `${Number(row.value).toFixed(1)} ${row.unit || ""}` : "--"}</strong>
      <span>{row ? formatDate(row.created_at) : "keine Daten"}</span>
    </article>
  );
}

function AdminPanel({ token, users, devices, onChanged }) {
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "user" });
  const [editingUser, setEditingUser] = useState(null);
  const [deviceForm, setDeviceForm] = useState({
    user_id: "",
    name: "Einspeisepunkt",
    client_id: "ZGW16-IP",
    serial_number: "1",
    mqtt_username: "zgw16-ip-1",
    mqtt_password: "",
    manufacturer: "Eltako",
    model: "DSZ15DZMOD"
  });
  const [editingDevice, setEditingDevice] = useState(null);
  const [error, setError] = useState("");

  async function createUser(event) {
    event.preventDefault();
    setError("");
    try {
      await request("/users", token, { method: "POST", body: JSON.stringify(userForm) });
      setUserForm({ name: "", email: "", password: "", role: "user" });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createDevice(event) {
    event.preventDefault();
    setError("");
    try {
      await request("/devices", token, { method: "POST", body: JSON.stringify(deviceForm) });
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(path) {
    await request(path, token, { method: "DELETE" });
    onChanged();
  }

  async function updateUser(event) {
    event.preventDefault();
    setError("");
    try {
      const body = { ...editingUser };
      if (!body.password) delete body.password;
      await request(`/users/${editingUser.id}`, token, { method: "PATCH", body: JSON.stringify(body) });
      setEditingUser(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateDevice(event) {
    event.preventDefault();
    setError("");
    try {
      const body = { ...editingDevice };
      if (!body.mqtt_password) delete body.mqtt_password;
      await request(`/devices/${editingDevice.id}`, token, { method: "PATCH", body: JSON.stringify(body) });
      setEditingDevice(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="admin-grid">
      <div className="admin-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Admin</p>
            <h3>User erstellen</h3>
          </div>
          <Users size={22} />
        </div>
        <form className="form inline-form" onSubmit={createUser}>
          <input placeholder="Name" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} />
          <input placeholder="E-Mail" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
          <input placeholder="Passwort" type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
          <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button className="primary-button"><UserPlus size={18} /> Anlegen</button>
        </form>
        {error && <p className="error">{error}</p>}
        <List rows={users} render={(row) => (
          editingUser?.id === row.id ? (
            <form className="list-edit" onSubmit={updateUser}>
              <input value={editingUser.name} onChange={(event) => setEditingUser({ ...editingUser, name: event.target.value })} />
              <input value={editingUser.email} onChange={(event) => setEditingUser({ ...editingUser, email: event.target.value })} />
              <input placeholder="Neues Passwort optional" type="password" value={editingUser.password} onChange={(event) => setEditingUser({ ...editingUser, password: event.target.value })} />
              <select value={editingUser.role} onChange={(event) => setEditingUser({ ...editingUser, role: event.target.value })}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <div className="edit-actions">
                <button className="save-button" title="Speichern"><Save size={16} /></button>
                <button className="cancel-button" type="button" title="Abbrechen" onClick={() => setEditingUser(null)}><X size={16} /></button>
              </div>
            </form>
          ) : (
            <>
              <span>{row.name}</span>
              <small>{row.email} · {row.role}</small>
              <div className="row-actions">
                <button className="edit-button" title="Bearbeiten" onClick={() => setEditingUser({ ...row, password: "" })}><Pencil size={16} /></button>
                <button title="Loeschen" onClick={() => remove(`/users/${row.id}`)}><Trash2 size={16} /></button>
              </div>
            </>
          )
        )} />
      </div>

      <div className="admin-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ZGW</p>
            <h3>Geraet registrieren</h3>
          </div>
          <Server size={22} />
        </div>
        <form className="form inline-form" onSubmit={createDevice}>
          <select value={deviceForm.user_id} onChange={(event) => setDeviceForm({ ...deviceForm, user_id: event.target.value })}>
            <option value="">User waehlen</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <input placeholder="Name" value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} />
          <input placeholder="Client-ID" value={deviceForm.client_id} onChange={(event) => setDeviceForm({ ...deviceForm, client_id: event.target.value })} />
          <input placeholder="Serialnumber" value={deviceForm.serial_number} onChange={(event) => setDeviceForm({ ...deviceForm, serial_number: event.target.value })} />
          <input placeholder="MQTT-User" value={deviceForm.mqtt_username} onChange={(event) => setDeviceForm({ ...deviceForm, mqtt_username: event.target.value })} />
          <input placeholder="MQTT-Passwort" type="password" value={deviceForm.mqtt_password} onChange={(event) => setDeviceForm({ ...deviceForm, mqtt_password: event.target.value })} />
          <input placeholder="Hersteller" value={deviceForm.manufacturer} onChange={(event) => setDeviceForm({ ...deviceForm, manufacturer: event.target.value })} />
          <input placeholder="Modell" value={deviceForm.model} onChange={(event) => setDeviceForm({ ...deviceForm, model: event.target.value })} />
          <button className="primary-button"><Plus size={18} /> Registrieren</button>
        </form>
        {error && <p className="error">{error}</p>}
        <List rows={devices} render={(row) => (
          editingDevice?.id === row.id ? (
            <form className="list-edit device-edit" onSubmit={updateDevice}>
              <select value={editingDevice.user_id} onChange={(event) => setEditingDevice({ ...editingDevice, user_id: event.target.value })}>
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
              <input value={editingDevice.name} onChange={(event) => setEditingDevice({ ...editingDevice, name: event.target.value })} />
              <input value={editingDevice.client_id} onChange={(event) => setEditingDevice({ ...editingDevice, client_id: event.target.value })} />
              <input value={editingDevice.serial_number} onChange={(event) => setEditingDevice({ ...editingDevice, serial_number: event.target.value })} />
              <input value={editingDevice.mqtt_username} onChange={(event) => setEditingDevice({ ...editingDevice, mqtt_username: event.target.value })} />
              <input placeholder="Neues MQTT-Passwort optional" type="password" value={editingDevice.mqtt_password} onChange={(event) => setEditingDevice({ ...editingDevice, mqtt_password: event.target.value })} />
              <input value={editingDevice.manufacturer || ""} onChange={(event) => setEditingDevice({ ...editingDevice, manufacturer: event.target.value })} />
              <input value={editingDevice.model || ""} onChange={(event) => setEditingDevice({ ...editingDevice, model: event.target.value })} />
              <div className="edit-actions">
                <button className="save-button" title="Speichern"><Save size={16} /></button>
                <button className="cancel-button" type="button" title="Abbrechen" onClick={() => setEditingDevice(null)}><X size={16} /></button>
              </div>
            </form>
          ) : (
            <>
              <span>{row.name}</span>
              <small>{row.client_id}/devices/{row.serial_number} · MQTT {row.mqtt_username} · {row.user_email}</small>
              <div className="row-actions">
                <button className="edit-button" title="Bearbeiten" onClick={() => setEditingDevice({ ...row, mqtt_password: "" })}><Pencil size={16} /></button>
                <button title="Loeschen" onClick={() => remove(`/devices/${row.id}`)}><Trash2 size={16} /></button>
              </div>
            </>
          )
        )} />
      </div>
    </section>
  );
}

function ClaimDevice({ token, onChanged }) {
  const [form, setForm] = useState({
    name: "Mein Eltako ZGW",
    client_id: "ZGW16-IP",
    serial_number: "",
    mqtt_username: "",
    mqtt_password: ""
  });
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    try {
      await request("/devices/claim", token, { method: "POST", body: JSON.stringify(form) });
      setMessage("Geraet wurde zugewiesen.");
      onChanged();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <section className="admin-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ZGW</p>
          <h3>Geraet selbst zuweisen</h3>
        </div>
        <Server size={22} />
      </div>
      <form className="form inline-form" onSubmit={submit}>
        <input placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input placeholder="Client-ID" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })} />
        <input placeholder="Serialnumber" value={form.serial_number} onChange={(event) => setForm({ ...form, serial_number: event.target.value })} />
        <input placeholder="MQTT-User" value={form.mqtt_username} onChange={(event) => setForm({ ...form, mqtt_username: event.target.value })} />
        <input placeholder="MQTT-Passwort" type="password" value={form.mqtt_password} onChange={(event) => setForm({ ...form, mqtt_password: event.target.value })} />
        <button className="primary-button"><Plus size={18} /> Zuweisen</button>
      </form>
      {message && <p className="notice">{message}</p>}
    </section>
  );
}

function List({ rows, render }) {
  return <div className="list">{rows.map((row) => <div className="list-row" key={row.id}>{render(row)}</div>)}</div>;
}

function updateSummary(current, event) {
  const next = current.filter((row) => !(row.device_id === event.reading.device_id && row.metric === event.reading.metric));
  next.push({
    device_id: event.reading.device_id,
    device_name: event.device.name,
    metric: event.reading.metric,
    value: event.reading.value,
    unit: event.reading.unit,
    created_at: event.reading.created_at
  });
  return next;
}

function formatDate(value) {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const palette = ["#0f8b8d", "#ff6b35", "#2f52e0", "#7a5cfa", "#179a55", "#d1495b"];

createRoot(document.getElementById("root")).render(<App />);
