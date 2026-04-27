import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bolt,
  ChevronDown,
  Clock3,
  Download,
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
const defaultRefreshSeconds = 15;
const defaultChartMetrics = ["L1_active_power", "L2_active_power", "L3_active_power"];

const translations = {
  de: {
    dashboardSubtitle: "Dashboard für Eltako ZGW Messdaten",
    logout: "Abmelden",
    noDevice: "Noch kein Gerät angelegt",
    lastSeen: "Zuletzt",
    waiting: "Wartet auf Daten",
    liveConnected: "Live verbunden",
    liveDisconnected: "Live getrennt",
    totalPower: "Gesamtleistung",
    importedTotal: "Bezug total",
    exportedTotal: "Einspeisung total",
    noExportData: "Keine Daten für den Export vorhanden.",
    userCreate: "User erstellen",
    deviceRegister: "Gerät registrieren",
    chooseUser: "User wählen",
    delete: "Löschen",
    maintenance: "Wartung",
    cleanupHistory: "History bereinigen",
    olderThanDays: "Älter als Tage",
    device: "Gerät",
    allDevices: "Alle Geräte",
    wipeHistory: "Komplette History löschen",
    deleteOldHistory: "Alte History löschen",
    completeHistoryDeleted: "Komplette History wurde gelöscht.",
    historyDeletedBefore: "History-Daten vor {{date}} wurden gelöscht.",
    confirmWipe: "Komplette History für {{scope}} wirklich löschen?",
    confirmDeleteOlder: "History-Daten für {{scope}} löschen, die älter als {{days}} Tage sind?",
    thisDevice: "dieses Gerät",
    allDevicesScope: "alle Geräte",
    deviceAssigned: "Gerät wurde zugewiesen.",
    claimDevice: "Gerät selbst zuweisen",
    deviceData: "Gerätedaten",
    meterType: "Zähler Typ",
    voltage: "Spannung",
    current: "Strom",
    power: "Leistung",
    energy: "Energie",
    from: "Von",
    to: "Bis",
    untilNow: "Bis jetzt",
    metricsCount: "Metriken",
    resettableImport: "Bezug resettable",
    resettableExport: "Einspeisung resettable",
    powerDefault: "Power L1-L3"
  },
  en: {
    dashboardSubtitle: "Dashboard for Eltako ZGW meter data",
    logout: "Log out",
    noDevice: "No device created yet",
    lastSeen: "Last",
    waiting: "Waiting for data",
    liveConnected: "Live connected",
    liveDisconnected: "Live disconnected",
    totalPower: "Total power",
    importedTotal: "Imported total",
    exportedTotal: "Exported total",
    noExportData: "No data available for export.",
    userCreate: "Create user",
    deviceRegister: "Register device",
    chooseUser: "Choose user",
    delete: "Delete",
    maintenance: "Maintenance",
    cleanupHistory: "Clean history",
    olderThanDays: "Older than days",
    device: "Device",
    allDevices: "All devices",
    wipeHistory: "Delete full history",
    deleteOldHistory: "Delete old history",
    completeHistoryDeleted: "Full history was deleted.",
    historyDeletedBefore: "History data before {{date}} was deleted.",
    confirmWipe: "Really delete the full history for {{scope}}?",
    confirmDeleteOlder: "Delete history data for {{scope}} older than {{days}} days?",
    thisDevice: "this device",
    allDevicesScope: "all devices",
    deviceAssigned: "Device was assigned.",
    claimDevice: "Assign device yourself",
    deviceData: "Device data",
    meterType: "Meter type",
    voltage: "Voltage",
    current: "Current",
    power: "Power",
    energy: "Energy",
    from: "From",
    to: "To",
    untilNow: "Until now",
    metricsCount: "Metrics",
    resettableImport: "Resettable import",
    resettableExport: "Resettable export",
    powerDefault: "Power L1-L3"
  }
};

function fillTemplate(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), template);
}

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
  const [language, setLanguage] = useState(() => localStorage.getItem("mqtt-dashboard-language") || "de");

  function saveSession(next) {
    setSession(next);
    if (next) localStorage.setItem("mqtt-dashboard-session", JSON.stringify(next));
    else localStorage.removeItem("mqtt-dashboard-session");
  }

  function saveLanguage(next) {
    setLanguage(next);
    localStorage.setItem("mqtt-dashboard-language", next);
  }

  if (!session) return <Login onLogin={saveSession} language={language} />;
  return <Dashboard session={session} onLogout={() => saveSession(null)} language={language} onLanguageChange={saveLanguage} />;
}

function Login({ onLogin, language }) {
  const t = translations[language] || translations.de;
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
            <p>{t.dashboardSubtitle}</p>
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

function Dashboard({ session, onLogout, language, onLanguageChange }) {
  const t = translations[language] || translations.de;
  const { token, user } = session;
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [readings, setReadings] = useState([]);
  const [selectedChartMetrics, setSelectedChartMetrics] = useState([]);
  const [historyRange, setHistoryRange] = useState(() => defaultHistoryRange());
  const [historyEndsNow, setHistoryEndsNow] = useState(true);
  const [message, setMessage] = useState("");
  const [liveConnected, setLiveConnected] = useState(false);
  const readingsSignatureRef = useRef("");

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) || devices[0];
  const isAdmin = user.role === "admin";

  const load = useCallback(async () => {
    const [devicesData, summaryData, usersData] = await Promise.all([
      request("/devices", token),
      request("/summary", token),
      isAdmin ? request("/users", token) : Promise.resolve({ users: [] })
    ]);
    setDevices(devicesData.devices);
    setSummary(summaryData.summary);
    setUsers(usersData.users);
    if (!devicesData.devices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(devicesData.devices[0]?.id || "");
    }
  }, [isAdmin, selectedDeviceId, token]);

  useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, [load]);

  useEffect(() => {
    if (!selectedDevice?.id) return;
    let active = true;

    async function refreshReadings() {
      try {
        if (!historyRange.start || !historyRange.end) return;
        const effectiveEnd = historyEndsNow ? toLocalDateTimeValue(new Date()) : historyRange.end;
        const params = new URLSearchParams({
          start: new Date(historyRange.start).toISOString(),
          end: new Date(effectiveEnd).toISOString()
        });
        const data = await request(`/devices/${selectedDevice.id}/readings?${params.toString()}`, token);
        if (active) {
          const lastReading = data.readings.at(-1);
          const nextSignature = `${data.readings.length}:${lastReading?.created_at || ""}:${lastReading?.metric || ""}:${lastReading?.value || ""}`;
          const hasNewHistory = readingsSignatureRef.current !== nextSignature;
          readingsSignatureRef.current = nextSignature;
          setReadings(data.readings);
          if (historyEndsNow && hasNewHistory) setHistoryRange((current) => ({ ...current, end: effectiveEnd }));
        }
      } catch (err) {
        if (active) setMessage(err.message);
      }
    }

    refreshReadings();
    const interval = window.setInterval(refreshReadings, defaultRefreshSeconds * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedDevice?.id, token, historyRange.start, historyRange.end, historyEndsNow]);

  useEffect(() => {
    const source = new EventSource(`${apiBase}/live?token=${encodeURIComponent(token)}`);
    source.addEventListener("connected", () => {
      setLiveConnected(true);
      setMessage("");
    });
    source.addEventListener("reading", (event) => {
      const data = JSON.parse(event.data);
      if (data.type !== "reading") return;
      setSummary((current) => updateSummary(current, data));
      setDevices((current) => current.map((device) => (
        device.id === data.reading.device_id
          ? { ...device, last_seen_at: data.reading.created_at }
          : device
      )));
    });
    source.onerror = () => setLiveConnected(false);
    return () => {
      source.close();
      setLiveConnected(false);
    };
  }, [token]);

  useEffect(() => {
    if (liveConnected) return undefined;
    const interval = window.setInterval(() => {
      load().catch((err) => setMessage(err.message));
    }, defaultRefreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [liveConnected, load]);

  const latestByMetric = useMemo(() => {
    const rows = summary.filter((row) => row.device_id === selectedDevice?.id && row.metric);
    return Object.fromEntries(rows.map((row) => [row.metric, row]));
  }, [summary, selectedDevice?.id]);

  const chartData = useMemo(() => {
    const grouped = new Map();
    for (const reading of readings) {
      const timestamp = new Date(reading.created_at).getTime();
      if (!Number.isFinite(timestamp)) continue;
      grouped.set(timestamp, {
        ...(grouped.get(timestamp) || { timestamp }),
        [reading.metric]: Number(reading.value.toFixed(2))
      });
    }
    return Array.from(grouped.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [readings]);

  const chartDomain = useMemo(() => {
    const start = new Date(historyRange.start).getTime();
    const end = new Date(historyRange.end).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start < end
      ? [start, end]
      : ["dataMin", "dataMax"];
  }, [historyRange.start, historyRange.end]);

  const chartMetrics = useMemo(() => {
    const metrics = Array.from(new Set(readings.map((reading) => reading.metric)));
    return selectedChartMetrics.length
      ? selectedChartMetrics.filter((metric) => metrics.includes(metric))
      : defaultChartMetrics.filter((metric) => metrics.includes(metric));
  }, [readings, selectedChartMetrics]);

  const availableChartMetrics = useMemo(() => {
    const metrics = new Set([
      ...Object.keys(latestByMetric),
      ...readings.map((reading) => reading.metric)
    ]);
    return Array.from(metrics).sort((a, b) => humanMetric(a, t).localeCompare(humanMetric(b, t)));
  }, [latestByMetric, readings, t]);

  function exportChartCsv() {
    const csv = buildChartCsv(chartData, chartMetrics);
    if (!csv) {
      setMessage(t.noExportData);
      return;
    }
    const filename = [
      "mqtt-export",
      selectedDevice?.name || "device",
      historyRange.start,
      historyRange.end
    ]
      .filter(Boolean)
      .join("_")
      .replace(/[^\w.-]+/g, "-");
    downloadTextFile(`${filename}.csv`, csv, "text/csv;charset=utf-8");
  }

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
          {t.logout}
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Live Monitoring</p>
            <h2>{selectedDevice?.name || t.noDevice}</h2>
          </div>
          <div className="topbar-status">
            <div className="status-pill">
              <Activity size={18} />
              {selectedDevice?.last_seen_at ? `${t.lastSeen} ${formatDate(selectedDevice.last_seen_at)}` : t.waiting}
            </div>
            <div className={liveConnected ? "status-pill live-pill" : "status-pill live-pill offline"}>
              <Activity size={18} />
              {liveConnected ? t.liveConnected : t.liveDisconnected}
            </div>
            <label className="language-select">
              <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </header>

        {message && <p className="notice">{message}</p>}

        <section className="kpi-grid">
          <MetricTile icon={<Gauge />} label="Power L1" row={latestByMetric.L1_active_power} />
          <MetricTile icon={<Gauge />} label="Power L2" row={latestByMetric.L2_active_power} />
          <MetricTile icon={<Gauge />} label="Power L3" row={latestByMetric.L3_active_power} />
          <MetricTile icon={<Bolt />} label={t.totalPower} row={latestByMetric.Total_active_power} />
          <MetricTile icon={<Clock3 />} label={t.importedTotal} row={latestByMetric.Total_imported_active_energy} />
          <MetricTile icon={<Clock3 />} label={t.exportedTotal} row={latestByMetric.Total_exported_active_energy} />
        </section>

        <MetricOverview latestByMetric={latestByMetric} t={t} />

        <section className="chart-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">History</p>
              <h3>{historyRangeLabel(historyRange)}</h3>
            </div>
            <div className="chart-controls">
              <label>
                {t.from}
                <input
                  type="datetime-local"
                  value={historyRange.start}
                  onChange={(event) => setHistoryRange((current) => ({ ...current, start: event.target.value }))}
                />
              </label>
              <label>
                {t.to}
                <input
                  type="datetime-local"
                  value={historyRange.end}
                  onChange={(event) => {
                    setHistoryEndsNow(false);
                    setHistoryRange((current) => ({ ...current, end: event.target.value }));
                  }}
                />
              </label>
              <button
                className={historyEndsNow ? "toggle-button active" : "toggle-button"}
                type="button"
                onClick={() => {
                  setHistoryEndsNow(true);
                  setHistoryRange((current) => ({ ...current, end: toLocalDateTimeValue(new Date()) }));
                }}
              >
                {t.untilNow}
              </button>
              <ChartMetricSelect
                metrics={availableChartMetrics}
                selectedMetrics={selectedChartMetrics}
                onChange={setSelectedChartMetrics}
                t={t}
              />
              <button
                className="export-button"
                type="button"
                onClick={exportChartCsv}
                disabled={chartData.length === 0 || chartMetrics.length === 0}
              >
                <Download size={18} />
                Export
              </button>
            </div>
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
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={chartDomain}
                  tickFormatter={(value) => formatChartTick(value, historyRange)}
                  tick={{ fill: "#60717d", fontSize: 12 }}
                  minTickGap={28}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fill: "#60717d", fontSize: 12 }} />
                <Tooltip labelFormatter={(value) => formatChartTooltipLabel(value)} />
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
                    isAnimationActive={false}
                    dot={false}
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
            t={t}
          />
        )}
        {!isAdmin && <ClaimDevice token={token} onChanged={() => load().catch((err) => setMessage(err.message))} t={t} />}
      </section>
    </main>
  );
}

function MetricTile({ icon, label, row }) {
  return (
    <article className="metric-tile">
      <div className="tile-icon">{icon}</div>
      <p>{label}</p>
      <strong>{row ? formatMetricValue(row) : "--"}</strong>
      <span>{row ? formatDate(row.created_at) : "keine Daten"}</span>
    </article>
  );
}

function ChartMetricSelect({ metrics, selectedMetrics, onChange, t }) {
  function toggle(metric) {
    onChange(selectedMetrics.includes(metric)
      ? selectedMetrics.filter((item) => item !== metric)
      : [...selectedMetrics, metric]);
  }

  function selectGroup(groupMetrics) {
    onChange(groupMetrics.filter((metric) => metrics.includes(metric)));
  }

  const label = selectedMetrics.length === 0
    ? t.powerDefault
    : selectedMetrics.length === 1
      ? humanMetric(selectedMetrics[0], t)
      : `${selectedMetrics.length} ${t.metricsCount}`;

  return (
    <details className="multi-select">
      <summary>
        <span>{label}</span>
        <ChevronDown size={18} />
      </summary>
      <div className="multi-select-menu">
        <div className="quick-selects">
          {chartQuickGroups.map((group) => (
            <button key={group.label} type="button" onClick={() => selectGroup(group.metrics)}>
              {group.label}
            </button>
          ))}
          <button type="button" onClick={() => onChange([])}>{t.powerDefault}</button>
        </div>
        <div className="metric-options">
          {metrics.map((metric) => (
            <label key={metric} className="metric-option">
              <input
                type="checkbox"
                checked={selectedMetrics.includes(metric)}
                onChange={() => toggle(metric)}
              />
              <span>{humanMetric(metric, t)}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}

function MetricOverview({ latestByMetric, t }) {
  const rows = Object.values(latestByMetric);
  const sections = metricSections(t);
  const visibleMetrics = new Set(sections.flatMap((section) => section.metrics.map((metric) => metric.key)));
  const otherRows = rows
    .filter((row) => !visibleMetrics.has(row.metric))
    .sort((a, b) => a.metric.localeCompare(b.metric));

  return (
    <section className="metric-overview">
      {sections.map((section) => (
        <MetricGroup key={section.title} title={section.title} rows={section.metrics.map((metric) => ({
          ...metric,
          row: latestByMetric[metric.key]
        }))} />
      ))}
      {otherRows.length > 0 && (
        <MetricGroup
          title="Weitere Werte"
          rows={otherRows.map((row) => ({ key: row.metric, label: humanMetric(row.metric, t), row }))}
        />
      )}
    </section>
  );
}

function MetricGroup({ title, rows }) {
  return (
    <article className="metric-group">
      <div className="section-heading">
        <h3>{title}</h3>
      </div>
      <div className="metric-list">
        {rows.map(({ key, label, row }) => (
          <div className="metric-row" key={key}>
            <span>{label}</span>
            <strong title={row ? formatMetricValue(row) : "--"}>{row ? formatMetricValue(row) : "--"}</strong>
            <small>{row ? formatDate(row.created_at) : "keine Daten"}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function formatMetricValue(row) {
  const value = Number(row.value);
  const formatted = Number.isFinite(value) ? value.toLocaleString("de-DE", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 1 : 3
  }) : String(row.value);
  return `${formatted}${row.unit ? ` ${normalizeUnit(row.unit)}` : ""}`;
}

function normalizeUnit(unit) {
  return unit === "Watt" ? "W" : unit;
}

function humanMetric(metric, t = translations.de) {
  const labels = {
    Total_imported_active_energy: t.importedTotal,
    Total_exported_active_energy: t.exportedTotal,
    Resettable_total_imported_active_energy: t.resettableImport,
    Resettable_total_exported_active_energy: t.resettableExport
  };
  if (labels[metric]) return labels[metric];
  return metric
    .replaceAll("_", " ")
    .replace(/\bL([123])\b/g, "L$1")
    .replace(/\bFW\b/g, "Firmware");
}

function AdminPanel({ token, users, devices, onChanged, t }) {
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "user" });
  const [editingUser, setEditingUser] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState({ olderThanDays: 90, device_id: "", wipeAll: false });
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [deviceForm, setDeviceForm] = useState({
    user_id: "",
    name: "Einspeisepunkt",
    client_id: "ZGW16-IP",
    serial_number: "1",
    mqtt_username: "zgw16-ip-1",
    mqtt_password: "",
    mqtt_topic: "ZGW16-IP/devices/1",
    history_sample_interval_seconds: 60,
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

  async function deleteOldHistory(event) {
    event.preventDefault();
    setError("");
    setMaintenanceMessage("");
    const days = Math.max(Number(maintenanceForm.olderThanDays) || 1, 1);
    const before = maintenanceForm.wipeAll
      ? new Date().toISOString()
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const scope = maintenanceForm.device_id
      ? devices.find((device) => device.id === maintenanceForm.device_id)?.name || t.thisDevice
      : t.allDevicesScope;
    const confirmText = maintenanceForm.wipeAll
      ? fillTemplate(t.confirmWipe, { scope })
      : fillTemplate(t.confirmDeleteOlder, { scope, days });
    if (!window.confirm(confirmText)) return;

    try {
      await request("/maintenance/history", token, {
        method: "DELETE",
        body: JSON.stringify({
          before,
          device_id: maintenanceForm.device_id || null,
          all: maintenanceForm.wipeAll
        })
      });
      setMaintenanceMessage(maintenanceForm.wipeAll
        ? t.completeHistoryDeleted
        : fillTemplate(t.historyDeletedBefore, { date: formatDate(before) }));
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
            <h3>{t.userCreate}</h3>
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
                <button title={t.delete} onClick={() => remove(`/users/${row.id}`)}><Trash2 size={16} /></button>
              </div>
            </>
          )
        )} />
      </div>

      <div className="admin-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ZGW</p>
            <h3>{t.deviceRegister}</h3>
          </div>
          <Server size={22} />
        </div>
        <form className="form inline-form" onSubmit={createDevice}>
          <select value={deviceForm.user_id} onChange={(event) => setDeviceForm({ ...deviceForm, user_id: event.target.value })}>
            <option value="">{t.chooseUser}</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <input placeholder="Name" value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} />
          <input placeholder="Client-ID" value={deviceForm.client_id} onChange={(event) => setDeviceForm({ ...deviceForm, client_id: event.target.value })} />
          <input placeholder="Serialnumber" value={deviceForm.serial_number} onChange={(event) => setDeviceForm({ ...deviceForm, serial_number: event.target.value })} />
          <input placeholder="MQTT-Topic" value={deviceForm.mqtt_topic} onChange={(event) => setDeviceForm({ ...deviceForm, mqtt_topic: event.target.value })} />
          <input placeholder="History-Intervall (Sek.)" type="number" min="1" value={deviceForm.history_sample_interval_seconds} onChange={(event) => setDeviceForm({ ...deviceForm, history_sample_interval_seconds: event.target.value })} />
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
              <input value={editingDevice.mqtt_topic || ""} onChange={(event) => setEditingDevice({ ...editingDevice, mqtt_topic: event.target.value })} />
              <input type="number" min="1" value={editingDevice.history_sample_interval_seconds || 60} onChange={(event) => setEditingDevice({ ...editingDevice, history_sample_interval_seconds: event.target.value })} />
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
              <small>{row.mqtt_topic || `${row.client_id}/devices/${row.serial_number}`} · History {row.history_sample_interval_seconds || 60}s · MQTT {row.mqtt_username} · {row.user_email}</small>
              <div className="row-actions">
                <button className="edit-button" title="Bearbeiten" onClick={() => setEditingDevice({ ...row, mqtt_password: "" })}><Pencil size={16} /></button>
                <button title={t.delete} onClick={() => remove(`/devices/${row.id}`)}><Trash2 size={16} /></button>
              </div>
            </>
          )
        )} />
      </div>

      <div className="admin-panel maintenance-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t.maintenance}</p>
            <h3>{t.cleanupHistory}</h3>
          </div>
          <Trash2 size={22} />
        </div>
        <form className="form inline-form" onSubmit={deleteOldHistory}>
          <label>
            {t.olderThanDays}
            <input
              type="number"
              min="1"
              disabled={maintenanceForm.wipeAll}
              value={maintenanceForm.olderThanDays}
              onChange={(event) => setMaintenanceForm({ ...maintenanceForm, olderThanDays: event.target.value })}
            />
          </label>
          <label>
            {t.device}
            <select
              value={maintenanceForm.device_id}
              onChange={(event) => setMaintenanceForm({ ...maintenanceForm, device_id: event.target.value })}
            >
              <option value="">{t.allDevices}</option>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={maintenanceForm.wipeAll}
              onChange={(event) => setMaintenanceForm({ ...maintenanceForm, wipeAll: event.target.checked })}
            />
            {t.wipeHistory}
          </label>
          <button className="danger-button">
            <Trash2 size={18} />
            {maintenanceForm.wipeAll ? t.wipeHistory : t.deleteOldHistory}
          </button>
        </form>
        {maintenanceMessage && <p className="notice">{maintenanceMessage}</p>}
      </div>
    </section>
  );
}

function ClaimDevice({ token, onChanged, t }) {
  const [form, setForm] = useState({
    name: "Mein Eltako ZGW",
    client_id: "ZGW16-IP",
    serial_number: "",
    mqtt_username: "",
    mqtt_password: "",
    mqtt_topic: "ZGW16-IP/devices/1",
    history_sample_interval_seconds: 60,
    manufacturer: "Eltako",
    model: "DSZ15DZMOD"
  });
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    try {
      await request("/devices/claim", token, { method: "POST", body: JSON.stringify(form) });
      setMessage(t.deviceAssigned);
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
          <h3>{t.claimDevice}</h3>
        </div>
        <Server size={22} />
      </div>
      <form className="form inline-form" onSubmit={submit}>
        <input placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input placeholder="Client-ID" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })} />
        <input placeholder="Serialnumber" value={form.serial_number} onChange={(event) => setForm({ ...form, serial_number: event.target.value })} />
        <input placeholder="MQTT-Topic" value={form.mqtt_topic} onChange={(event) => setForm({ ...form, mqtt_topic: event.target.value })} />
        <input placeholder="History-Intervall (Sek.)" type="number" min="1" value={form.history_sample_interval_seconds} onChange={(event) => setForm({ ...form, history_sample_interval_seconds: event.target.value })} />
        <input placeholder="MQTT-User" value={form.mqtt_username} onChange={(event) => setForm({ ...form, mqtt_username: event.target.value })} />
        <input placeholder="MQTT-Passwort" type="password" value={form.mqtt_password} onChange={(event) => setForm({ ...form, mqtt_password: event.target.value })} />
        <input placeholder="Hersteller" value={form.manufacturer} onChange={(event) => setForm({ ...form, manufacturer: event.target.value })} />
        <input placeholder="Modell" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
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

function formatChartTick(value, range) {
  const date = new Date(value);
  const start = new Date(range.start);
  const end = new Date(range.end);
  const spanHours = Math.abs(end.getTime() - start.getTime()) / 36e5;
  const crossesDay = start.toDateString() !== end.toDateString();
  if (spanHours > 48) {
    return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  }
  if (crossesDay) {
    return date.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatChartTooltipLabel(value) {
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function buildChartCsv(chartData, metrics) {
  if (!chartData.length || !metrics.length) return "";
  const header = ["Zeit", ...metrics];
  const lines = [
    header.map(csvCell).join(";"),
    ...chartData.map((row) => [
      formatCsvTimestamp(row.timestamp),
      ...metrics.map((metric) => row[metric] ?? "")
    ].map(csvCell).join(";"))
  ];
  return `\uFEFF${lines.join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function formatCsvTimestamp(value) {
  return new Date(value).toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function defaultHistoryRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return {
    start: toLocalDateTimeValue(start),
    end: toLocalDateTimeValue(end)
  };
}

function toLocalDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function historyRangeLabel(range) {
  if (!range.start || !range.end) return "Zeitraum";
  return `${formatDate(range.start)} - ${formatDate(range.end)}`;
}
const palette = ["#0f8b8d", "#ff6b35", "#2f52e0", "#7a5cfa", "#179a55", "#d1495b"];

function metricSections(t) {
  return [
  {
    title: t.voltage,
    metrics: [
      { key: "Voltage_of_L1_to_N", label: "L1 gegen N" },
      { key: "Voltage_of_L2_to_N", label: "L2 gegen N" },
      { key: "Voltage_of_L3_to_N", label: "L3 gegen N" }
    ]
  },
  {
    title: t.current,
    metrics: [
      { key: "L1_Current", label: "L1 Strom" },
      { key: "L2_Current", label: "L2 Strom" },
      { key: "L3_Current", label: "L3 Strom" }
    ]
  },
  {
    title: t.power,
    metrics: [
      { key: "L1_active_power", label: "L1 Wirkleistung" },
      { key: "L2_active_power", label: "L2 Wirkleistung" },
      { key: "L3_active_power", label: "L3 Wirkleistung" },
      { key: "Total_active_power", label: "Gesamtwirkleistung" }
    ]
  },
  {
    title: "Leistungsfaktor",
    metrics: [
      { key: "L1_power_factor", label: "L1 Power Factor" },
      { key: "L2_power_factor", label: "L2 Power Factor" },
      { key: "L3_power_factor", label: "L3 Power Factor" },
      { key: "Total_power_factor", label: "Gesamt Power Factor" }
    ]
  },
  {
    title: t.energy,
    metrics: [
      { key: "Total_imported_active_energy", label: "Imported Total Energy" },
      { key: "Total_exported_active_energy", label: "Exported Total Energy" },
      { key: "Resettable_total_imported_active_energy", label: t.resettableImport },
      { key: "Resettable_total_exported_active_energy", label: t.resettableExport }
    ]
  },
  {
    title: t.deviceData,
    metrics: [
      { key: "Modbus_address", label: "Modbus Adresse" },
      { key: "Serial_number", label: "Seriennummer" },
      { key: "Manufacturing_code", label: "Manufacturing Code" },
      { key: "Meter_type", label: t.meterType },
      { key: "FW_version", label: "Firmware Version" }
    ]
  }
  ];
}

const chartQuickGroups = [
  {
    label: "Power L1-L3",
    metrics: defaultChartMetrics
  },
  {
    label: "Spannung L1-L3",
    metrics: ["Voltage_of_L1_to_N", "Voltage_of_L2_to_N", "Voltage_of_L3_to_N"]
  },
  {
    label: "Strom L1-L3",
    metrics: ["L1_Current", "L2_Current", "L3_Current"]
  },
  {
    label: "Imported/Exported Energy",
    metrics: ["Total_imported_active_energy", "Total_exported_active_energy"]
  }
];

createRoot(document.getElementById("root")).render(<App />);
