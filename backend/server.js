
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.join(__dirname, "..", "frontend");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const SQLITE_FILE = path.join(DATA_DIR, "tracker.sqlite");
const LEGACY_JSON = path.join(DATA_DIR, "db.json");
const SESSION_COOKIE = "mt_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const LOGIN_WINDOW_MS = 1000 * 60 * 10;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 1000 * 60 * 15;

const LEGACY_SEED_EMAIL = "johnbett414@gmail.com";
const LEGACY_SEED_PASSWORD = "johnbett41";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function defaultTrackerData() {
  return { expenses: [], habits: [], tasks: [], inventory: [] };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, saved] = storedHash.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(saved, "hex"), Buffer.from(check, "hex"));
}

function validatePasswordStrength(password) {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must include at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must include at least one lowercase letter";
  if (!/\d/.test(password)) return "Password must include at least one number";
  return null;
}

ensureDataDir();
const db = new DatabaseSync(SQLITE_FILE);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tracker_data (
  user_id INTEGER PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS login_attempts (
  throttle_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`);

const findUserByEmailStmt = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?");
const insertUserStmt = db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)");
const findTrackerDataStmt = db.prepare("SELECT data_json FROM tracker_data WHERE user_id = ?");
const upsertTrackerDataStmt = db.prepare(`
INSERT INTO tracker_data (user_id, data_json, updated_at) VALUES (?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
`);
const insertResetStmt = db.prepare("INSERT INTO password_resets (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)");
const findResetStmt = db.prepare("SELECT id, user_id, token, expires_at, used FROM password_resets WHERE token = ?");
const markResetUsedStmt = db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?");
const updatePasswordStmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
const insertSessionStmt = db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)");
const findSessionStmt = db.prepare(`
SELECT s.token, s.user_id, s.expires_at, u.email
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token = ?
`);
const deleteSessionByTokenStmt = db.prepare("DELETE FROM sessions WHERE token = ?");
const deleteSessionsByUserStmt = db.prepare("DELETE FROM sessions WHERE user_id = ?");
const deleteExpiredSessionsStmt = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");
const getLoginAttemptStmt = db.prepare("SELECT throttle_key, window_start, attempts, blocked_until FROM login_attempts WHERE throttle_key = ?");
const upsertLoginAttemptStmt = db.prepare(`
INSERT INTO login_attempts (throttle_key, window_start, attempts, blocked_until, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(throttle_key) DO UPDATE SET
  window_start = excluded.window_start,
  attempts = excluded.attempts,
  blocked_until = excluded.blocked_until,
  updated_at = excluded.updated_at
`);
const deleteLoginAttemptStmt = db.prepare("DELETE FROM login_attempts WHERE throttle_key = ?");

function seedIfNeeded() {
  if (findUserByEmailStmt.get(LEGACY_SEED_EMAIL)) return;
  insertUserStmt.run(LEGACY_SEED_EMAIL, hashPassword(LEGACY_SEED_PASSWORD), new Date().toISOString());
}

function migrateLegacyJsonIfExists() {
  if (!fs.existsSync(LEGACY_JSON)) return;
  try {
    const raw = fs.readFileSync(LEGACY_JSON, "utf8");
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    const trackerDataByUser = parsed.trackerDataByUser && typeof parsed.trackerDataByUser === "object" ? parsed.trackerDataByUser : {};

    users.forEach((user) => {
      const email = String(user.email || "").trim().toLowerCase();
      const password = String(user.password || "");
      if (!email || !password) return;
      if (!findUserByEmailStmt.get(email)) {
        insertUserStmt.run(email, hashPassword(password), new Date().toISOString());
      }
    });

    Object.entries(trackerDataByUser).forEach(([email, data]) => {
      const user = findUserByEmailStmt.get(String(email).trim().toLowerCase());
      if (!user) return;
      const payload = {
        expenses: Array.isArray(data.expenses) ? data.expenses : [],
        habits: Array.isArray(data.habits) ? data.habits : [],
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
        inventory: Array.isArray(data.inventory) ? data.inventory : []
      };
      upsertTrackerDataStmt.run(user.id, JSON.stringify(payload), new Date().toISOString());
    });
  } catch (_) {}
}

seedIfNeeded();
migrateLegacyJsonIfExists();
function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    out[trimmed.slice(0, idx)] = decodeURIComponent(trimmed.slice(idx + 1));
  });
  return out;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": MIME[".json"], ...headers });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function cookieIsSecure(req) {
  if (process.env.NODE_ENV !== "production") return false;
  const proto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return proto === "https" || proto.startsWith("https,");
}

function buildSessionCookie(req, token, maxAgeSeconds) {
  const secure = cookieIsSecure(req) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

function createSession(userId) {
  deleteExpiredSessionsStmt.run(Date.now());
  const token = crypto.randomBytes(32).toString("hex");
  insertSessionStmt.run(token, userId, Date.now() + SESSION_TTL_MS, new Date().toISOString());
  return token;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const record = findSessionStmt.get(token);
  if (!record) return null;
  if (Date.now() > Number(record.expires_at)) {
    deleteSessionByTokenStmt.run(token);
    return null;
  }
  return { token, email: record.email, userId: record.user_id };
}

function clearSession(req) {
  const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
  if (token) deleteSessionByTokenStmt.run(token);
}

function clearAllUserSessions(userId) {
  deleteSessionsByUserStmt.run(userId);
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function throttleKey(email, ip) {
  return `${email}|${ip}`;
}

function checkLoginRateLimit(email, ip) {
  const now = Date.now();
  const row = getLoginAttemptStmt.get(throttleKey(email, ip));
  if (!row) return { allowed: true };
  if (Number(row.blocked_until) > now) {
    const retryAfterSec = Math.max(1, Math.ceil((Number(row.blocked_until) - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true };
}

function recordLoginFailure(email, ip) {
  const now = Date.now();
  const key = throttleKey(email, ip);
  const row = getLoginAttemptStmt.get(key);
  let attempts = 1;
  let windowStart = now;
  if (row && now - Number(row.window_start) < LOGIN_WINDOW_MS) {
    attempts = Number(row.attempts) + 1;
    windowStart = Number(row.window_start);
  }
  const blockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0;
  upsertLoginAttemptStmt.run(key, windowStart, attempts, blockedUntil, new Date().toISOString());
}

function clearLoginFailures(email, ip) {
  deleteLoginAttemptStmt.run(throttleKey(email, ip));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function requireAuthApi(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, message: "Not authenticated" });
    return null;
  }
  return session;
}

function requireAuthPage(req, res) {
  const session = getSession(req);
  if (!session) {
    redirect(res, "/login.html");
    return null;
  }
  return session;
}

function loadUserDataByEmail(email) {
  const user = findUserByEmailStmt.get(email);
  if (!user) return defaultTrackerData();
  const row = findTrackerDataStmt.get(user.id);
  if (!row) return defaultTrackerData();
  try {
    const parsed = JSON.parse(row.data_json);
    return {
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      habits: Array.isArray(parsed.habits) ? parsed.habits : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : []
    };
  } catch {
    return defaultTrackerData();
  }
}

function saveUserDataByEmail(email, data) {
  const user = findUserByEmailStmt.get(email);
  if (!user) return;
  const payload = {
    expenses: Array.isArray(data.expenses) ? data.expenses : [],
    habits: Array.isArray(data.habits) ? data.habits : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    inventory: Array.isArray(data.inventory) ? data.inventory : []
  };
  upsertTrackerDataStmt.run(user.id, JSON.stringify(payload), new Date().toISOString());
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/") return serveFile(res, path.join(ROOT, "index.html"));
    if (req.method === "GET" && pathname === "/home.html") { if (!requireAuthPage(req, res)) return; return serveFile(res, path.join(ROOT, "home.html")); }
    if (req.method === "GET" && pathname === "/admin.html") { if (!requireAuthPage(req, res)) return; return serveFile(res, path.join(ROOT, "admin.html")); }

    if (req.method === "POST" && pathname === "/api/signup") {
      const body = await readJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || !password) return sendJson(res, 400, { ok: false, message: "Email and password are required" });
      const passwordError = validatePasswordStrength(password);
      if (passwordError) return sendJson(res, 400, { ok: false, message: passwordError });
      if (findUserByEmailStmt.get(email)) return sendJson(res, 409, { ok: false, message: "Account already exists. Please sign in." });

      insertUserStmt.run(email, hashPassword(password), new Date().toISOString());
      saveUserDataByEmail(email, defaultTrackerData());
      const user = findUserByEmailStmt.get(email);
      const token = createSession(user.id);
      return sendJson(res, 201, { ok: true }, { "Set-Cookie": buildSessionCookie(req, token, SESSION_TTL_MS / 1000) });
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const ip = getClientIp(req);
      const rateLimit = checkLoginRateLimit(email, ip);
      if (!rateLimit.allowed) {
        return sendJson(
          res,
          429,
          { ok: false, message: `Too many login attempts. Try again in ${rateLimit.retryAfterSec} seconds.` },
          { "Retry-After": String(rateLimit.retryAfterSec) }
        );
      }
      const user = findUserByEmailStmt.get(email);
      if (!user || !verifyPassword(password, user.password_hash)) {
        recordLoginFailure(email, ip);
        return sendJson(res, 401, { ok: false, message: "Invalid email or password" });
      }

      clearLoginFailures(email, ip);
      const token = createSession(user.id);
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": buildSessionCookie(req, token, SESSION_TTL_MS / 1000) });
    }

    if (req.method === "POST" && pathname === "/api/forgot-password") {
      const body = await readJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const user = findUserByEmailStmt.get(email);
      if (!user) return sendJson(res, 200, { ok: true, message: "If account exists, reset instructions are generated." });

      const token = crypto.randomBytes(20).toString("hex");
      const expiresAt = Date.now() + 1000 * 60 * 30;
      insertResetStmt.run(user.id, token, expiresAt, new Date().toISOString());
      return sendJson(res, 200, { ok: true, message: "Reset token generated for local use.", resetToken: token });
    }

    if (req.method === "POST" && pathname === "/api/reset-password") {
      const body = await readJsonBody(req);
      const token = String(body.token || "").trim();
      const newPassword = String(body.newPassword || "");
      if (!token || !newPassword) return sendJson(res, 400, { ok: false, message: "Token and new password are required" });
      const passwordError = validatePasswordStrength(newPassword);
      if (passwordError) return sendJson(res, 400, { ok: false, message: passwordError });

      const row = findResetStmt.get(token);
      if (!row || row.used || Date.now() > Number(row.expires_at)) return sendJson(res, 400, { ok: false, message: "Invalid or expired token" });

      updatePasswordStmt.run(hashPassword(newPassword), row.user_id);
      markResetUsedStmt.run(row.id);
      return sendJson(res, 200, { ok: true, message: "Password reset successful" });
    }

    if (req.method === "GET" && pathname === "/api/session") {
      const session = getSession(req);
      return sendJson(res, 200, { authenticated: Boolean(session), email: session ? session.email : null });
    }

    if (req.method === "GET" && pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, service: "multi-tracker", now: new Date().toISOString() });
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      clearSession(req);
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": buildSessionCookie(req, "", 0) });
    }

    if (req.method === "POST" && pathname === "/api/logout-all") {
      const session = getSession(req);
      if (!session) return sendJson(res, 200, { ok: true }, { "Set-Cookie": buildSessionCookie(req, "", 0) });
      clearAllUserSessions(session.userId);
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": buildSessionCookie(req, "", 0) });
    }

    if (req.method === "GET" && pathname === "/api/data") {
      const session = requireAuthApi(req, res);
      if (!session) return;
      return sendJson(res, 200, { ok: true, data: loadUserDataByEmail(session.email) });
    }

    if (req.method === "PUT" && pathname === "/api/data") {
      const session = requireAuthApi(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      saveUserDataByEmail(session.email, body && body.data ? body.data : {});
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET") {
      const safePath = pathname === "/" ? "/index.html" : pathname;
      const normalized = path.normalize(safePath).replace(/^([.][.][/\\])+/, "");
      const fullPath = path.join(ROOT, normalized);
      if (!fullPath.startsWith(ROOT)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }
      return serveFile(res, fullPath);
    }

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Internal Server Error", details: error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Multi Tracker backend running on http://${HOST}:${PORT}`);
});
