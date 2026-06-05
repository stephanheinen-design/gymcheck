'use strict';

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'gymcheck-jwt-secret-changeme';
const VAPID_KEYS_FILE = '/tmp/vapid-keys.json';

// ─── VAPID Keys ───────────────────────────────────────────────────────────────
let vapidKeys;
if (fs.existsSync(VAPID_KEYS_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf-8'));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(vapidKeys, null, 2));
  console.log('Generated new VAPID keys and saved to', VAPID_KEYS_FILE);
}
webpush.setVapidDetails(
  'mailto:admin@gymcheck.app',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ─── Database Setup ───────────────────────────────────────────────────────────
let db;
let isPostgres = false;

// ─── PostgreSQL pool factory (lazy, so we can fall back to SQLite) ───────────
async function trySetupPostgres() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000
  });

  // Test the connection before committing to PostgreSQL mode
  await pool.query('SELECT 1');

  // Convert ? placeholders to $1, $2, etc.
  function pgQuery(sql, params = []) {
    let i = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++i}`);
    return pool.query(pgSql, params);
  }

  return {
    prepare: (sql) => ({
      get: async (...params) => {
        const flat = params.flat();
        const result = await pgQuery(sql, flat);
        return result.rows[0] || null;
      },
      all: async (...params) => {
        const flat = params.flat();
        const result = await pgQuery(sql, flat);
        return result.rows;
      },
      run: async (...params) => {
        const flat = params.flat();
        const result = await pgQuery(sql, flat);
        return { lastInsertRowid: result.rows[0] ? result.rows[0].id : null, changes: result.rowCount };
      }
    }),
    exec: async (sql) => {
      const statements = sql.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) await pool.query(stmt);
      }
    }
  };
}

function setupSqlite() {
  const Database = require('better-sqlite3');
  const sqliteDb = new Database(process.env.DB_PATH || '/tmp/gymcheck.db');
  return {
    prepare: (sql) => ({
      get: (...params) => sqliteDb.prepare(sql).get(...params),
      all: (...params) => sqliteDb.prepare(sql).all(...params),
      run: (...params) => sqliteDb.prepare(sql).run(...params)
    }),
    exec: (sql) => sqliteDb.exec(sql)
  };
}

// setupDatabase: async – must be called before routes are used
async function setupDatabase() {
  if (process.env.DATABASE_URL) {
    // Attempt PostgreSQL; fall back to SQLite on any connection error
    try {
      db = await trySetupPostgres();
      isPostgres = true;
      console.log('Using PostgreSQL database');
    } catch (pgErr) {
      console.error('PostgreSQL connection failed:', pgErr.message);
      console.error('DATABASE_URL is set but the database is not reachable.');
      console.error('Possible causes:');
      console.error('  1. DATABASE_URL environment variable is incorrect');
      console.error('  2. PostgreSQL service is still starting up');
      console.error('  3. SSL/network configuration mismatch');
      console.error('Falling back to SQLite for this session.');
      isPostgres = false;
      db = setupSqlite();
      console.log('Using SQLite database (fallback):', process.env.DB_PATH || '/tmp/gymcheck.db');
    }
  } else {
    db = setupSqlite();
    console.log('Using SQLite database:', process.env.DB_PATH || '/tmp/gymcheck.db');
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────
const pgSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    lat REAL,
    lng REAL,
    location_name TEXT,
    note TEXT,
    checked_in_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id SERIAL PRIMARY KEY,
    checkin_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS medals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    week_label TEXT NOT NULL,
    awarded_at TIMESTAMP DEFAULT NOW()
  );
`;

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (requester_id) REFERENCES users(id),
    FOREIGN KEY (addressee_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    lat REAL,
    lng REAL,
    location_name TEXT,
    note TEXT,
    checked_in_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkin_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (checkin_id) REFERENCES checkins(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS medals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_label TEXT NOT NULL,
    awarded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`;

// ─── Database Schema Initialization (with retry + no crash on failure) ────────
async function initializeDatabase(retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await db.exec(isPostgres ? pgSchema : sqliteSchema);
      console.log('Database tables initialized successfully');
      return;
    } catch (err) {
      console.error(`Database init attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt === retries) {
        console.error('WARNING: Could not initialize database schema after', retries, 'attempts.');
        console.error('The app will continue; schema will be retried on the next restart.');
        return; // Don't crash — let the process stay alive
      }
      const wait = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 1s, 2s, 4s, 8s, 10s
      console.log(`Retrying database init in ${wait}ms...`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

// ─── Bootstrap (async startup) ────────────────────────────────────────────────
// All async setup (DB connection + schema init) happens here, then the server
// starts. This avoids top-level await (not supported in CJS modules).
(async () => {
  // 1. Set up the database connection (with PostgreSQL → SQLite fallback)
  await setupDatabase();

  // 2. Initialize schema with retry logic (non-fatal on failure)
  await initializeDatabase();

  // 3. Start the HTTP server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GymCheck API listening on port ${PORT}`);
    console.log(`Frontend dist: ${frontendDist}`);
    console.log(`Frontend exists: ${fs.existsSync(frontendDist)}`);
  });
})().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

function randomHex() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

function isoWeekLabel(date) {
  const d = new Date(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function periodFilter(period) {
  if (isPostgres) {
    switch (period) {
      case '24h': return "NOW() - INTERVAL '24 hours'";
      case 'week': return "NOW() - INTERVAL '7 days'";
      case 'month': return "NOW() - INTERVAL '30 days'";
      case 'year': return "NOW() - INTERVAL '365 days'";
      default: return null;
    }
  } else {
    switch (period) {
      case '24h': return "datetime('now', '-24 hours')";
      case 'week': return "datetime('now', '-7 days')";
      case 'month': return "datetime('now', '-30 days')";
      case 'year': return "datetime('now', '-365 days')";
      default: return null;
    }
  }
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return fail(res, 'Missing or invalid Authorization header', 401);
  }
  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return fail(res, 'Ongeldige of verlopen sessie. Log opnieuw in.', 401);
  }
  try {
    const userId = Number(payload.id);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return fail(res, 'Gebruiker niet gevonden. Log opnieuw in.', 401);
    req.user = user;
    next();
  } catch (e) {
    console.error('[authMiddleware] Database error:', e.message);
    return fail(res, 'Serverfout bij authenticatie', 500);
  }
}

// ─── Push Notification Helper ─────────────────────────────────────────────────
async function sendPushToFriends(userId, payload) {
  const friends = await db.prepare(`
    SELECT u.id FROM users u
    JOIN friendships f ON (
      (f.requester_id = ? AND f.addressee_id = u.id) OR
      (f.addressee_id = ? AND f.requester_id = u.id)
    )
    WHERE f.status = 'accepted'
  `).all(userId, userId);

  for (const friend of friends) {
    const subs = await db.prepare(
      'SELECT * FROM push_subscriptions WHERE user_id = ?'
    ).all(friend.id);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (e) {
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

// ─── Medal Logic ──────────────────────────────────────────────────────────────
async function tryAwardMedal(userId) {
  // Compute ISO week label (Monday = start of week)
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Start of this ISO week (Monday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfWeekISO = startOfWeek.toISOString();

  // ISO week label e.g. "2025-W22"
  const weekLabel = isoWeekLabel(now);

  // Get all friends
  const friendRows = await db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
    FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);
  const allUserIds = [userId, ...friendRows.map(r => r.friend_id)];
  const placeholders = allUserIds.map(() => '?').join(',');

  // Count check-ins since Monday for all users in the group
  let countSql;
  if (isPostgres) {
    countSql = `
      SELECT user_id, COUNT(*) as count
      FROM checkins
      WHERE user_id IN (${placeholders})
        AND checked_in_at >= ?
      GROUP BY user_id
      ORDER BY count DESC
    `;
  } else {
    countSql = `
      SELECT user_id, COUNT(*) as count
      FROM checkins
      WHERE user_id IN (${placeholders})
        AND checked_in_at >= ?
      GROUP BY user_id
      ORDER BY count DESC
    `;
  }
  const counts = await db.prepare(countSql).all(...allUserIds, startOfWeekISO);

  if (counts.length === 0) return;

  const maxCount = Number(counts[0].count);
  if (maxCount === 0) return;

  // Award medal to all tied winners (anyone matching the max count)
  const winners = counts.filter(c => Number(c.count) === maxCount);
  for (const winner of winners) {
    const alreadyAwarded = await db.prepare(
      'SELECT id FROM medals WHERE user_id = ? AND week_label = ?'
    ).get(winner.user_id, weekLabel);
    if (!alreadyAwarded) {
      if (isPostgres) {
        await db.prepare('INSERT INTO medals (user_id, week_label) VALUES (?, ?) RETURNING id').run(winner.user_id, weekLabel);
      } else {
        db.prepare('INSERT INTO medals (user_id, week_label) VALUES (?, ?)').run(winner.user_id, weekLabel);
      }
    }
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH routes
// ═══════════════════════════════════════════════════════════════════════════════
const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return fail(res, 'username, email, and password are required');
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const color = randomHex();
    let userId;
    if (isPostgres) {
      const r = await db.prepare(
        'INSERT INTO users (username, email, password_hash, avatar_color) VALUES (?, ?, ?, ?) RETURNING id'
      ).run(username, email, hash, color);
      userId = r.lastInsertRowid;
    } else {
      const r = db.prepare(
        'INSERT INTO users (username, email, password_hash, avatar_color) VALUES (?, ?, ?, ?)'
      ).run(username, email, hash, color);
      userId = r.lastInsertRowid;
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    return ok(res, { token, user: { id: user.id, username: user.username, email: user.email, avatar_color: user.avatar_color, created_at: user.created_at } }, 201);
  } catch (e) {
    if (e.message && (e.message.includes('UNIQUE') || e.message.includes('unique'))) {
      return fail(res, 'Username or email already exists');
    }
    return fail(res, e.message, 500);
  }
});

// Bug 1 fix: accept username OR email for login
authRouter.post('/login', async (req, res) => {
  const { username, email, password } = req.body;
  const identifier = username || email;
  if (!identifier || !password) return fail(res, 'gebruikersnaam en wachtwoord zijn verplicht');

  let user = await db.prepare('SELECT * FROM users WHERE username = ?').get(identifier);
  if (!user) user = await db.prepare('SELECT * FROM users WHERE email = ?').get(identifier);
  if (!user) return fail(res, 'Gebruiker niet gevonden', 401);

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return fail(res, 'Onjuist wachtwoord', 401);

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  return ok(res, { token, user: { id: user.id, username: user.username, email: user.email, avatar_color: user.avatar_color } });
});

authRouter.get('/me', authMiddleware, async (req, res) => {
  const u = req.user;
  return ok(res, { id: u.id, username: u.username, email: u.email, avatar_color: u.avatar_color, created_at: u.created_at });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USERS routes
// ═══════════════════════════════════════════════════════════════════════════════
const usersRouter = express.Router();
usersRouter.use(authMiddleware);

usersRouter.get('/search', async (req, res) => {
  const q = req.query.q || '';
  const rows = await db.prepare(
    "SELECT id, username, email, avatar_color FROM users WHERE username LIKE ? AND id != ? LIMIT 20"
  ).all(`%${q}%`, req.user.id);
  return ok(res, rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FRIENDS routes
// ═══════════════════════════════════════════════════════════════════════════════
const friendsRouter = express.Router();
friendsRouter.use(authMiddleware);

friendsRouter.get('/', async (req, res) => {
  const userId = req.user.id;
  const friends = await db.prepare(`
    SELECT u.id, u.username, u.email, u.avatar_color,
      (SELECT checked_in_at FROM checkins WHERE user_id = u.id ORDER BY checked_in_at DESC LIMIT 1) as last_checkin,
      (SELECT COUNT(*) FROM medals WHERE user_id = u.id) as medal_count
    FROM users u
    JOIN friendships f ON (
      (f.requester_id = ? AND f.addressee_id = u.id) OR
      (f.addressee_id = ? AND f.requester_id = u.id)
    )
    WHERE f.status = 'accepted'
  `).all(userId, userId);
  return ok(res, friends);
});

friendsRouter.get('/requests', async (req, res) => {
  const rows = await db.prepare(`
    SELECT f.id as friendship_id, u.id, u.username, u.email, u.avatar_color, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE f.addressee_id = ? AND f.status = 'pending'
  `).all(req.user.id);
  return ok(res, rows);
});

// Bug 2 fix: accept addressee_id OR user_id in friend request
friendsRouter.post('/request', async (req, res) => {
  const { user_id, addressee_id } = req.body;
  const targetId = user_id || addressee_id;
  if (!targetId) return fail(res, 'Selecteer een gebruiker om toe te voegen');
  if (Number(targetId) === Number(req.user.id)) return fail(res, 'Cannot friend yourself');
  const existing = await db.prepare(`
    SELECT id FROM friendships WHERE
      (requester_id = ? AND addressee_id = ?) OR
      (requester_id = ? AND addressee_id = ?)
  `).get(req.user.id, targetId, targetId, req.user.id);
  if (existing) return fail(res, 'Friendship already exists');
  const result = await db.prepare(
    'INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)'
  ).run(req.user.id, targetId, 'pending');
  return ok(res, { friendship_id: result.lastInsertRowid }, 201);
});

friendsRouter.post('/accept/:id', async (req, res) => {
  const friendship = await db.prepare(
    'SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = ?'
  ).get(req.params.id, req.user.id, 'pending');
  if (!friendship) return fail(res, 'Friend request not found', 404);
  await db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', friendship.id);
  return ok(res, { friendship_id: friendship.id });
});

friendsRouter.delete('/:id', async (req, res) => {
  const userId = req.user.id;
  const friendship = await db.prepare(`
    SELECT id FROM friendships WHERE
      (requester_id = ? AND addressee_id = ?) OR
      (requester_id = ? AND addressee_id = ?)
  `).get(userId, req.params.id, req.params.id, userId);
  if (!friendship) return fail(res, 'Friendship not found', 404);
  await db.prepare('DELETE FROM friendships WHERE id = ?').run(friendship.id);
  return ok(res, { removed: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK-INS routes
// ═══════════════════════════════════════════════════════════════════════════════
const checkinsRouter = express.Router();
checkinsRouter.use(authMiddleware);

checkinsRouter.post('/', async (req, res) => {
  // Bug 4 fix: max 1 check-in per day
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let alreadyCheckedIn;
  if (isPostgres) {
    alreadyCheckedIn = await db.prepare(
      "SELECT id FROM checkins WHERE user_id = ? AND DATE(checked_in_at) = ?::date"
    ).get(req.user.id, today);
  } else {
    alreadyCheckedIn = await db.prepare(
      "SELECT id FROM checkins WHERE user_id = ? AND DATE(checked_in_at) = DATE(?)"
    ).get(req.user.id, today);
  }
  if (alreadyCheckedIn) {
    return fail(res, 'Je hebt vandaag al ingecheckt. Kom morgen terug! 💪', 429);
  }

  const { lat, lng, location_name, note } = req.body;
  const userId = req.user.id;

  let checkinId;
  if (isPostgres) {
    const r = await db.prepare(
      'INSERT INTO checkins (user_id, lat, lng, location_name, note) VALUES (?, ?, ?, ?, ?) RETURNING id'
    ).run(userId, lat || null, lng || null, location_name || null, note || null);
    checkinId = r.lastInsertRowid;
  } else {
    const r = db.prepare(
      'INSERT INTO checkins (user_id, lat, lng, location_name, note) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, lat || null, lng || null, location_name || null, note || null);
    checkinId = r.lastInsertRowid;
  }
  const checkin = await db.prepare('SELECT * FROM checkins WHERE id = ?').get(checkinId);

  tryAwardMedal(userId).catch(console.error);

  sendPushToFriends(userId, {
    title: `${req.user.username} is aan het sporten!`,
    body: location_name || 'Gym',
    data: { checkin_id: checkin.id, lat: checkin.lat, lng: checkin.lng }
  }).catch(console.error);

  return ok(res, checkin, 201);
});

checkinsRouter.get('/feed', async (req, res) => {
  const userId = req.user.id;
  const rows = await db.prepare(`
    SELECT c.*, u.username, u.avatar_color
    FROM checkins c
    JOIN users u ON u.id = c.user_id
    WHERE c.user_id = ? OR c.user_id IN (
      SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
      FROM friendships
      WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
    )
    ORDER BY c.checked_in_at DESC
    LIMIT 50
  `).all(userId, userId, userId, userId);

  const feed = [];
  for (const row of rows) {
    const reactions = await db.prepare(
      'SELECT r.*, u.username FROM reactions r JOIN users u ON u.id = r.user_id WHERE r.checkin_id = ?'
    ).all(row.id);
    feed.push({ ...row, reactions });
  }
  return ok(res, feed);
});

checkinsRouter.get('/mine', async (req, res) => {
  const userId = req.user.id;
  const period = req.query.period || 'total';
  const since = periodFilter(period);
  let rows;
  if (since) {
    rows = await db.prepare(
      `SELECT * FROM checkins WHERE user_id = ? AND checked_in_at >= ${since} ORDER BY checked_in_at DESC`
    ).all(userId);
  } else {
    rows = await db.prepare(
      'SELECT * FROM checkins WHERE user_id = ? ORDER BY checked_in_at DESC'
    ).all(userId);
  }
  return ok(res, { count: rows.length, checkins: rows });
});

checkinsRouter.get('/stats', async (req, res) => {
  const userId = req.user.id;
  async function count(filter) {
    if (filter) {
      const row = await db.prepare(
        `SELECT COUNT(*) as cnt FROM checkins WHERE user_id = ? AND checked_in_at >= ${filter}`
      ).get(userId);
      return row ? Number(row.cnt) : 0;
    }
    const row = await db.prepare('SELECT COUNT(*) as cnt FROM checkins WHERE user_id = ?').get(userId);
    return row ? Number(row.cnt) : 0;
  }
  return ok(res, {
    today: await count(periodFilter('24h')),
    this_week: await count(periodFilter('week')),
    this_month: await count(periodFilter('month')),
    this_year: await count(periodFilter('year')),
    total: await count(null)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REACTIONS routes
// ═══════════════════════════════════════════════════════════════════════════════
const reactionsRouter = express.Router();
reactionsRouter.use(authMiddleware);

reactionsRouter.post('/checkins/:id/react', async (req, res) => {
  const { type, message } = req.body;
  if (!type || !['coming', 'great', 'custom'].includes(type)) {
    return fail(res, 'type must be coming, great, or custom');
  }
  const checkin = await db.prepare('SELECT * FROM checkins WHERE id = ?').get(req.params.id);
  if (!checkin) return fail(res, 'Checkin not found', 404);

  let reactionId;
  if (isPostgres) {
    const r = await db.prepare(
      'INSERT INTO reactions (checkin_id, user_id, type, message) VALUES (?, ?, ?, ?) RETURNING id'
    ).run(req.params.id, req.user.id, type, message || null);
    reactionId = r.lastInsertRowid;
  } else {
    const r = db.prepare(
      'INSERT INTO reactions (checkin_id, user_id, type, message) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, req.user.id, type, message || null);
    reactionId = r.lastInsertRowid;
  }
  const reaction = await db.prepare('SELECT * FROM reactions WHERE id = ?').get(reactionId);

  // Send push notification to check-in owner (not to yourself)
  if (checkin.user_id !== req.user.id) {
    const reactor = await db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
    const subscriptions = await db.prepare(
      'SELECT * FROM push_subscriptions WHERE user_id = ?'
    ).all(checkin.user_id);

    const notificationTitle = type === 'coming'
      ? `${reactor.username} komt er ook aan! 🏃`
      : type === 'great'
      ? `${reactor.username} reageert: Goed bezig! 💪`
      : `${reactor.username} reageert${message ? `: ${message}` : ''}`;

    const notificationPayload = JSON.stringify({
      title: notificationTitle,
      body: checkin.location_name || 'Je check-in',
      data: { checkin_id: checkin.id }
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notificationPayload
        );
      } catch (err) {
        console.log('Push failed, removing subscription:', err.message);
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }

  return ok(res, reaction, 201);
});

reactionsRouter.delete('/reactions/:id', async (req, res) => {
  const reaction = await db.prepare(
    'SELECT * FROM reactions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!reaction) return fail(res, 'Reaction not found', 404);
  await db.prepare('DELETE FROM reactions WHERE id = ?').run(reaction.id);
  return ok(res, { removed: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RANKINGS routes
// ═══════════════════════════════════════════════════════════════════════════════
const rankingsRouter = express.Router();
rankingsRouter.use(authMiddleware);

rankingsRouter.get('/', async (req, res) => {
  const period = req.query.period || 'week';
  const since = periodFilter(period);
  const userId = req.user.id;

  const friendRows = await db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
    FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);

  const groupIds = [userId, ...friendRows.map(r => r.fid)];
  const placeholders = groupIds.map(() => '?').join(',');

  let rows;
  if (since) {
    rows = await db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count,
             (SELECT COUNT(*) FROM medals WHERE user_id = u.id) as medal_count
      FROM users u
      LEFT JOIN checkins c ON c.user_id = u.id AND c.checked_in_at >= ${since}
      WHERE u.id IN (${placeholders})
      GROUP BY u.id, u.username, u.avatar_color ORDER BY count DESC
    `).all(...groupIds);
  } else {
    rows = await db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count,
             (SELECT COUNT(*) FROM medals WHERE user_id = u.id) as medal_count
      FROM users u
      LEFT JOIN checkins c ON c.user_id = u.id
      WHERE u.id IN (${placeholders})
      GROUP BY u.id, u.username, u.avatar_color ORDER BY count DESC
    `).all(...groupIds);
  }

  return ok(res, rows.map((r, i) => ({ ...r, count: Number(r.count), rank: i + 1 })));
});

rankingsRouter.get('/group/:group_id', async (req, res) => {
  const period = req.query.period || 'week';
  const since = periodFilter(period);
  const groupId = req.params.group_id;

  const member = await db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, req.user.id);
  if (!member) return fail(res, 'Not a member of this group', 403);

  let rows;
  if (since) {
    rows = await db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      LEFT JOIN checkins c ON c.user_id = u.id AND c.checked_in_at >= ${since}
      WHERE gm.group_id = ?
      GROUP BY u.id, u.username, u.avatar_color ORDER BY count DESC
    `).all(groupId);
  } else {
    rows = await db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      LEFT JOIN checkins c ON c.user_id = u.id
      WHERE gm.group_id = ?
      GROUP BY u.id, u.username, u.avatar_color ORDER BY count DESC
    `).all(groupId);
  }
  return ok(res, rows.map((r, i) => ({ ...r, count: Number(r.count), rank: i + 1 })));
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEDALS routes
// ═══════════════════════════════════════════════════════════════════════════════
const medalsRouter = express.Router();
medalsRouter.use(authMiddleware);

medalsRouter.get('/', async (req, res) => {
  const rows = await db.prepare(
    'SELECT * FROM medals WHERE user_id = ? ORDER BY awarded_at DESC'
  ).all(req.user.id);
  return ok(res, rows);
});

medalsRouter.get('/group/:group_id', async (req, res) => {
  const groupId = req.params.group_id;
  const member = await db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, req.user.id);
  if (!member) return fail(res, 'Not a member of this group', 403);

  const rows = await db.prepare(`
    SELECT u.id as user_id, u.username, u.avatar_color, COUNT(m.id) as medal_count
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    LEFT JOIN medals m ON m.user_id = u.id
    WHERE gm.group_id = ?
    GROUP BY u.id, u.username, u.avatar_color ORDER BY medal_count DESC
  `).all(groupId);
  return ok(res, rows.map(r => ({ ...r, medal_count: Number(r.medal_count) })));
});

medalsRouter.get('/friends', async (req, res) => {
  const userId = req.user.id;
  const friendRows = await db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
    FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);

  const groupIds = [userId, ...friendRows.map(r => r.fid)];
  const placeholders = groupIds.map(() => '?').join(',');

  const rows = await db.prepare(`
    SELECT u.id as user_id, u.username, u.avatar_color, COUNT(m.id) as medal_count
    FROM users u
    LEFT JOIN medals m ON m.user_id = u.id
    WHERE u.id IN (${placeholders})
    GROUP BY u.id, u.username, u.avatar_color ORDER BY medal_count DESC
  `).all(...groupIds);
  return ok(res, rows.map(r => ({ ...r, medal_count: Number(r.medal_count) })));
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUPS routes
// ═══════════════════════════════════════════════════════════════════════════════
const groupsRouter = express.Router();
groupsRouter.use(authMiddleware);

groupsRouter.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return fail(res, 'name is required');

  let groupId;
  if (isPostgres) {
    const r = await db.prepare(
      'INSERT INTO groups (name, created_by) VALUES (?, ?) RETURNING id'
    ).run(name, req.user.id);
    groupId = r.lastInsertRowid;
  } else {
    const r = db.prepare(
      'INSERT INTO groups (name, created_by) VALUES (?, ?)'
    ).run(name, req.user.id);
    groupId = r.lastInsertRowid;
  }

  await db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, req.user.id);
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  return ok(res, group, 201);
});

groupsRouter.get('/', async (req, res) => {
  const rows = await db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
  `).all(req.user.id);
  return ok(res, rows);
});

groupsRouter.get('/:id', async (req, res) => {
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return fail(res, 'Group not found', 404);
  const members = await db.prepare(`
    SELECT u.id, u.username, u.email, u.avatar_color, gm.joined_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
  `).all(req.params.id);
  return ok(res, { ...group, members });
});

groupsRouter.post('/:id/invite', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return fail(res, 'Selecteer een gebruiker om uit te nodigen');
  const group = await db.prepare('SELECT * FROM groups WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!group) return fail(res, 'Group not found or not authorized', 403);
  const existing = await db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(req.params.id, user_id);
  if (existing) return fail(res, 'User already in group');
  await db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, user_id);
  return ok(res, { invited: true });
});

groupsRouter.post('/:id/join', async (req, res) => {
  const existing = await db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (existing) return fail(res, 'Already a member');
  const group = await db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return fail(res, 'Group not found', 404);
  await db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  return ok(res, { joined: true });
});

groupsRouter.delete('/:id/leave', async (req, res) => {
  const member = await db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!member) return fail(res, 'Not a member of this group', 404);
  await db.prepare('DELETE FROM group_members WHERE id = ?').run(member.id);
  return ok(res, { left: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUSH routes
// ═══════════════════════════════════════════════════════════════════════════════
const pushRouter = express.Router();
pushRouter.use(authMiddleware);

pushRouter.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return fail(res, 'endpoint and keys (p256dh, auth) are required');
  }
  const existing = await db.prepare(
    'SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'
  ).get(endpoint, req.user.id);
  if (existing) {
    await db.prepare(
      'UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE id = ?'
    ).run(keys.p256dh, keys.auth, existing.id);
  } else {
    await db.prepare(
      'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, endpoint, keys.p256dh, keys.auth);
  }
  return ok(res, { subscribed: true });
});

pushRouter.get('/vapid-public-key', (req, res) => {
  return ok(res, { vapidPublicKey: vapidKeys.publicKey });
});

// ─── Mount Routers ────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/checkins', checkinsRouter);
app.use('/api', reactionsRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/medals', medalsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/push', pushRouter);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  return res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN route
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/admin', async (req, res) => {
  if (req.query.key !== 'gymcheck-admin') {
    return res.status(401).send('<h1>Toegang geweigerd</h1><p>Voeg ?key=gymcheck-admin toe aan de URL</p>');
  }
  
  const users = await db.prepare(`
    SELECT u.id, u.username, u.email, u.created_at,
           COUNT(c.id) as checkin_count
    FROM users u
    LEFT JOIN checkins c ON c.user_id = u.id
    GROUP BY u.id, u.username, u.email, u.created_at
    ORDER BY u.created_at DESC
  `).all();
  
  const recentCheckins = await db.prepare(`
    SELECT c.id, u.username, c.location_name, c.checked_in_at
    FROM checkins c
    JOIN users u ON u.id = c.user_id
    ORDER BY c.checked_in_at DESC
    LIMIT 50
  `).all();
  
  const friendCount = await db.prepare(
    "SELECT COUNT(*) as cnt FROM friendships WHERE status = 'accepted'"
  ).get();
  
  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GymCheck Admin</title>
  <style>
    body { font-family: system-ui; background: #0f172a; color: #e2e8f0; padding: 20px; max-width: 900px; margin: 0 auto; }
    h1 { color: #22c55e; }
    h2 { color: #94a3b8; font-size: 14px; text-transform: uppercase; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #1e293b; padding: 10px; text-align: left; font-size: 12px; color: #94a3b8; }
    td { padding: 10px; border-bottom: 1px solid #1e293b; font-size: 14px; }
    tr:hover td { background: #1e293b; }
    .badge { background: #22c55e; color: #0f172a; padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .stats { display: flex; gap: 20px; margin: 20px 0; }
    .stat { background: #1e293b; padding: 20px; border-radius: 12px; flex: 1; text-align: center; }
    .stat-value { font-size: 32px; font-weight: bold; color: #22c55e; }
    .stat-label { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>🏋️ GymCheck Admin</h1>
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${users.length}</div>
      <div class="stat-label">Gebruikers</div>
    </div>
    <div class="stat">
      <div class="stat-value">${users.reduce((s, u) => s + Number(u.checkin_count || 0), 0)}</div>
      <div class="stat-label">Check-ins totaal</div>
    </div>
    <div class="stat">
      <div class="stat-value">${Number(friendCount?.cnt || 0)}</div>
      <div class="stat-label">Vriendschappen</div>
    </div>
  </div>
  
  <h2>👥 Gebruikers (${users.length})</h2>
  <table>
    <tr><th>Gebruikersnaam</th><th>Email</th><th>Check-ins</th><th>Aangemeld op</th></tr>
    ${users.map(u => `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.email}</td>
        <td><span class="badge">${u.checkin_count || 0}</span></td>
        <td>${new Date(u.created_at).toLocaleString('nl-NL')}</td>
      </tr>
    `).join('')}
  </table>
  
  <h2>📍 Recente check-ins</h2>
  <table>
    <tr><th>Gebruiker</th><th>Locatie</th><th>Wanneer</th></tr>
    ${recentCheckins.map(c => `
      <tr>
        <td><strong>${c.username}</strong></td>
        <td>${c.location_name || 'Onbekend'}</td>
        <td>${new Date(c.checked_in_at).toLocaleString('nl-NL')}</td>
      </tr>
    `).join('')}
  </table>
  
  <p style="color:#475569; margin-top:40px; font-size:12px">Pagina geladen op ${new Date().toLocaleString('nl-NL')}</p>
</body>
</html>`;
  
  res.send(html);
});


// ─── Serve Frontend ──────────────────────────────────────────────────────────
const frontendDist = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ─── 404 + Error Handlers ─────────────────────────────────────────────────────
app.use((req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, _next) => {
  console.error(err);
  return fail(res, err.message || 'Internal server error', 500);
});

module.exports = app;
