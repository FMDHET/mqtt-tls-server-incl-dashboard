import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

const jwtSecret = process.env.JWT_SECRET || "dev-secret";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.name },
    jwtSecret,
    { expiresIn: "12h" }
  );
}

export async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@mqtt-tls.thumm-lb.de";
  const password = process.env.ADMIN_PASSWORD || "ChangeMeNow123!";
  const existing = await pool.query("select id from users where email = $1", [email]);
  if (existing.rowCount > 0) return;

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    "insert into users (email, name, password_hash, role) values ($1, $2, $3, 'admin')",
    [email, "Admin", hash]
  );
}

export async function ensureMqttIngestCredential() {
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  if (!username || !password) return;

  const salt = crypto.randomBytes(12).toString("hex");
  const passwordHash = crypto.createHash("sha256").update(`${password}${salt}`).digest("hex");
  await pool.query(
    `insert into mqtt_credentials (username, password_hash, salt, is_superuser, enabled)
     values ($1, $2, $3, true, true)
     on conflict (username) do update set
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      is_superuser = true,
      enabled = true`,
    [username, passwordHash, salt]
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Nicht angemeldet" });

  try {
    req.user = await userFromToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Session ungueltig" });
  }
}

export async function userFromToken(token) {
  const payload = jwt.verify(token, jwtSecret);
  const result = await pool.query(
    "select id, email, name, role, created_at from users where id = $1",
    [payload.sub]
  );
  if (result.rowCount === 0) throw new Error("User nicht gefunden");
  return result.rows[0];
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin-Rechte erforderlich" });
  next();
}
