'use strict';

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'gymcheck-jwt-secret-changeme';
const VAPID_KEYS_FILE = '/tmp/vapid-keys.json';
const DB_FILE = process.env.DB_PATH || '/tmp/gymcheck.db';

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

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_FILE);

db.exec(`
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
`);

console.log('Database tables initialized');

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
  switch (period) {
    case '24h': return "datetime('now', '-24 hours')";
    case 'week': return "datetime('now', '-7 days')";
    case 'month': return "datetime('now', '-30 days')";
    case 'year': return "datetime('now', '-365 days')";
    default: return null;
  }
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return fail(res, 'Missing or invalid Authorization header', 401);
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Fetch fresh user from DB
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return fail(res, 'User not found', 401);
    req.user = user;
    next();
  } catch (e) {
    return fail(res, 'Invalid or expired token', 401);
  }
}

// ─── Push Notification Helper ─────────────────────────────────────────────────
async function sendPushToFriends(userId, payload) {
  const friends = db.prepare(`
    SELECT u.id FROM users u
    JOIN friendships f ON (
      (f.requester_id = ? AND f.addressee_id = u.id) OR
      (f.addressee_id = ? AND f.requester_id = u.id)
    )
    WHERE f.status = 'accepted'
  `).all(userId, userId);

  for (const friend of friends) {
    const subs = db.prepare(
      'SELECT * FROM push_subscriptions WHERE user_id = ?'
    ).all(friend.id);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (e) {
        // Remove invalid subscription
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

// ─── Medal Logic ──────────────────────────────────────────────────────────────
function tryAwardMedal(userId) {
  const weekLabel = isoWeekLabel(new Date());
  // Find friend group (self + accepted friends)
  const groupIds = [userId, ...db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
    FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId).map(r => r.friend_id)];

  const placeholders = groupIds.map(() => '?').join(',');
  const leader = db.prepare(`
    SELECT user_id, COUNT(*) as cnt
    FROM checkins
    WHERE user_id IN (${placeholders})
      AND checked_in_at >= datetime('now', 'weekday 0', '-7 days')
    GROUP BY user_id
    ORDER BY cnt DESC
    LIMIT 1
  `).get(...groupIds);

  if (leader && leader.user_id === userId) {
    const existing = db.prepare(
      'SELECT id FROM medals WHERE user_id = ? AND week_label = ?'
    ).get(userId, weekLabel);
    if (!existing) {
      db.prepare('INSERT INTO medals (user_id, week_label) VALUES (?, ?)').run(userId, weekLabel);
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
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, avatar_color) VALUES (?, ?, ?, ?)'
    ).run(username, email, hash, color);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
    return ok(res, { token, user: { id: user.id, username: user.username, email: user.email, avatar_color: user.avatar_color, created_at: user.created_at } }, 201);
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return fail(res, 'Username or email already exists');
    }
    return fail(res, e.message, 500);
  }
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return fail(res, 'email and password are required');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return fail(res, 'Invalid credentials', 401);
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return fail(res, 'Invalid credentials', 401);
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  return ok(res, { token, user: { id: user.id, username: user.username, email: user.email, avatar_color: user.avatar_color, created_at: user.created_at } });
});

authRouter.get('/me', authMiddleware, (req, res) => {
  const u = req.user;
  return ok(res, { id: u.id, username: u.username, email: u.email, avatar_color: u.avatar_color, created_at: u.created_at });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USERS routes
// ═══════════════════════════════════════════════════════════════════════════════
const usersRouter = express.Router();
usersRouter.use(authMiddleware);

usersRouter.get('/search', (req, res) => {
  const q = req.query.q || '';
  const rows = db.prepare(
    "SELECT id, username, email, avatar_color FROM users WHERE username LIKE ? AND id != ? LIMIT 20"
  ).all(`%${q}%`, req.user.id);
  return ok(res, rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FRIENDS routes
// ═══════════════════════════════════════════════════════════════════════════════
const friendsRouter = express.Router();
friendsRouter.use(authMiddleware);

friendsRouter.get('/', (req, res) => {
  const userId = req.user.id;
  const friends = db.prepare(`
    SELECT u.id, u.username, u.email, u.avatar_color,
           c.id as checkin_id, c.lat, c.lng, c.location_name, c.note, c.checked_in_at
    FROM users u
    JOIN friendships f ON (
      (f.requester_id = ? AND f.addressee_id = u.id) OR
      (f.addressee_id = ? AND f.requester_id = u.id)
    )
    LEFT JOIN checkins c ON c.id = (
      SELECT id FROM checkins WHERE user_id = u.id ORDER BY checked_in_at DESC LIMIT 1
    )
    WHERE f.status = 'accepted'
  `).all(userId, userId);
  return ok(res, friends);
});

friendsRouter.get('/requests', (req, res) => {
  const rows = db.prepare(`
    SELECT f.id as friendship_id, u.id, u.username, u.email, u.avatar_color, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE f.addressee_id = ? AND f.status = 'pending'
  `).all(req.user.id);
  return ok(res, rows);
});

friendsRouter.post('/request', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return fail(res, 'user_id is required');
  if (user_id === req.user.id) return fail(res, 'Cannot friend yourself');
  const existing = db.prepare(`
    SELECT id FROM friendships WHERE
      (requester_id = ? AND addressee_id = ?) OR
      (requester_id = ? AND addressee_id = ?)
  `).get(req.user.id, user_id, user_id, req.user.id);
  if (existing) return fail(res, 'Friendship already exists');
  const result = db.prepare(
    'INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)'
  ).run(req.user.id, user_id, 'pending');
  return ok(res, { friendship_id: result.lastInsertRowid }, 201);
});

friendsRouter.post('/accept/:id', (req, res) => {
  const friendship = db.prepare(
    'SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = ?'
  ).get(req.params.id, req.user.id, 'pending');
  if (!friendship) return fail(res, 'Friend request not found', 404);
  db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', friendship.id);
  return ok(res, { friendship_id: friendship.id });
});

friendsRouter.delete('/:id', (req, res) => {
  const userId = req.user.id;
  // id here is the OTHER user's id
  const friendship = db.prepare(`
    SELECT id FROM friendships WHERE
      (requester_id = ? AND addressee_id = ?) OR
      (requester_id = ? AND addressee_id = ?)
  `).get(userId, req.params.id, req.params.id, userId);
  if (!friendship) return fail(res, 'Friendship not found', 404);
  db.prepare('DELETE FROM friendships WHERE id = ?').run(friendship.id);
  return ok(res, { removed: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK-INS routes
// ═══════════════════════════════════════════════════════════════════════════════
const checkinsRouter = express.Router();
checkinsRouter.use(authMiddleware);

checkinsRouter.post('/', async (req, res) => {
  const { lat, lng, location_name, note } = req.body;
  const userId = req.user.id;
  const result = db.prepare(
    'INSERT INTO checkins (user_id, lat, lng, location_name, note) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, lat || null, lng || null, location_name || null, note || null);
  const checkin = db.prepare('SELECT * FROM checkins WHERE id = ?').get(result.lastInsertRowid);

  // Award medal if applicable
  tryAwardMedal(userId);

  // Send push notifications (async, don't block response)
  sendPushToFriends(userId, {
    title: `${req.user.username} is aan het sporten!`,
    body: location_name || 'Gym',
    data: { checkin_id: checkin.id, lat: checkin.lat, lng: checkin.lng }
  }).catch(console.error);

  return ok(res, checkin, 201);
});

checkinsRouter.get('/feed', (req, res) => {
  const userId = req.user.id;
  const rows = db.prepare(`
    SELECT c.*, u.username, u.avatar_color
    FROM checkins c
    JOIN users u ON u.id = c.user_id
    WHERE c.user_id = ? OR c.user_id IN (
      SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
      FROM friendships
      WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
    )
    ORDER BY c.checked_in_at DESC
    LIMIT 20
  `).all(userId, userId, userId, userId);

  // Attach reactions
  const feed = rows.map(row => {
    const reactions = db.prepare(
      'SELECT r.*, u.username FROM reactions r JOIN users u ON u.id = r.user_id WHERE r.checkin_id = ?'
    ).all(row.id);
    return { ...row, reactions };
  });
  return ok(res, feed);
});

checkinsRouter.get('/mine', (req, res) => {
  const userId = req.user.id;
  const period = req.query.period || 'total';
  const since = periodFilter(period);
  let rows;
  if (since) {
    rows = db.prepare(
      `SELECT * FROM checkins WHERE user_id = ? AND checked_in_at >= ${since} ORDER BY checked_in_at DESC`
    ).all(userId);
  } else {
    rows = db.prepare(
      'SELECT * FROM checkins WHERE user_id = ? ORDER BY checked_in_at DESC'
    ).all(userId);
  }
  return ok(res, { count: rows.length, checkins: rows });
});

checkinsRouter.get('/stats', (req, res) => {
  const userId = req.user.id;
  function count(filter) {
    if (filter) {
      return db.prepare(
        `SELECT COUNT(*) as cnt FROM checkins WHERE user_id = ? AND checked_in_at >= ${filter}`
      ).get(userId).cnt;
    }
    return db.prepare('SELECT COUNT(*) as cnt FROM checkins WHERE user_id = ?').get(userId).cnt;
  }
  return ok(res, {
    h24: count(periodFilter('24h')),
    week: count(periodFilter('week')),
    month: count(periodFilter('month')),
    year: count(periodFilter('year')),
    total: count(null)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REACTIONS routes
// ═══════════════════════════════════════════════════════════════════════════════
const reactionsRouter = express.Router();
reactionsRouter.use(authMiddleware);

reactionsRouter.post('/checkins/:id/react', (req, res) => {
  const { type, message } = req.body;
  if (!type || !['coming', 'great', 'custom'].includes(type)) {
    return fail(res, 'type must be coming, great, or custom');
  }
  const checkin = db.prepare('SELECT id FROM checkins WHERE id = ?').get(req.params.id);
  if (!checkin) return fail(res, 'Checkin not found', 404);
  const result = db.prepare(
    'INSERT INTO reactions (checkin_id, user_id, type, message) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, req.user.id, type, message || null);
  const reaction = db.prepare('SELECT * FROM reactions WHERE id = ?').get(result.lastInsertRowid);
  return ok(res, reaction, 201);
});

reactionsRouter.delete('/reactions/:id', (req, res) => {
  const reaction = db.prepare(
    'SELECT * FROM reactions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!reaction) return fail(res, 'Reaction not found', 404);
  db.prepare('DELETE FROM reactions WHERE id = ?').run(reaction.id);
  return ok(res, { removed: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RANKINGS routes
// ═══════════════════════════════════════════════════════════════════════════════
const rankingsRouter = express.Router();
rankingsRouter.use(authMiddleware);

rankingsRouter.get('/', (req, res) => {
  const period = req.query.period || 'week';
  const since = periodFilter(period);
  const userId = req.user.id;

  const friendIds = db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
    FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId).map(r => r.fid);

  const groupIds = [userId, ...friendIds];
  const placeholders = groupIds.map(() => '?').join(',');

  let rows;
  if (since) {
    rows = db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count
      FROM users u
      LEFT JOIN checkins c ON c.user_id = u.id AND c.checked_in_at >= ${since}
      WHERE u.id IN (${placeholders})
      GROUP BY u.id ORDER BY count DESC
    `).all(...groupIds);
  } else {
    rows = db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count
      FROM users u
      LEFT JOIN checkins c ON c.user_id = u.id
      WHERE u.id IN (${placeholders})
      GROUP BY u.id ORDER BY count DESC
    `).all(...groupIds);
  }

  return ok(res, rows.map((r, i) => ({ ...r, rank: i + 1 })));
});

rankingsRouter.get('/group/:group_id', (req, res) => {
  const period = req.query.period || 'week';
  const since = periodFilter(period);
  const groupId = req.params.group_id;

  // Check membership
  const member = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, req.user.id);
  if (!member) return fail(res, 'Not a member of this group', 403);

  let rows;
  if (since) {
    rows = db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      LEFT JOIN checkins c ON c.user_id = u.id AND c.checked_in_at >= ${since}
      WHERE gm.group_id = ?
      GROUP BY u.id ORDER BY count DESC
    `).all(groupId);
  } else {
    rows = db.prepare(`
      SELECT u.id as user_id, u.username, u.avatar_color, COUNT(c.id) as count
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      LEFT JOIN checkins c ON c.user_id = u.id
      WHERE gm.group_id = ?
      GROUP BY u.id ORDER BY count DESC
    `).all(groupId);
  }
  return ok(res, rows.map((r, i) => ({ ...r, rank: i + 1 })));
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEDALS routes
// ═══════════════════════════════════════════════════════════════════════════════
const medalsRouter = express.Router();
medalsRouter.use(authMiddleware);

medalsRouter.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM medals WHERE user_id = ? ORDER BY awarded_at DESC'
  ).all(req.user.id);
  return ok(res, rows);
});

medalsRouter.get('/group/:group_id', (req, res) => {
  const groupId = req.params.group_id;
  const member = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, req.user.id);
  if (!member) return fail(res, 'Not a member of this group', 403);

  const rows = db.prepare(`
    SELECT u.id as user_id, u.username, u.avatar_color, COUNT(m.id) as medal_count
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    LEFT JOIN medals m ON m.user_id = u.id
    WHERE gm.group_id = ?
    GROUP BY u.id ORDER BY medal_count DESC
  `).all(groupId);
  return ok(res, rows);
});

medalsRouter.get('/friends', (req, res) => {
  const userId = req.user.id;
  const friendIds = db.prepare(`
    SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
    FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId).map(r => r.fid);

  const groupIds = [userId, ...friendIds];
  const placeholders = groupIds.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT u.id as user_id, u.username, u.avatar_color, COUNT(m.id) as medal_count
    FROM users u
    LEFT JOIN medals m ON m.user_id = u.id
    WHERE u.id IN (${placeholders})
    GROUP BY u.id ORDER BY medal_count DESC
  `).all(...groupIds);
  return ok(res, rows);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUPS routes
// ═══════════════════════════════════════════════════════════════════════════════
const groupsRouter = express.Router();
groupsRouter.use(authMiddleware);

groupsRouter.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return fail(res, 'name is required');
  const result = db.prepare(
    'INSERT INTO groups (name, created_by) VALUES (?, ?)'
  ).run(name, req.user.id);
  const groupId = result.lastInsertRowid;
  // Automatically add creator as member
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, req.user.id);
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  return ok(res, group, 201);
});

groupsRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT g.* FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
  `).all(req.user.id);
  return ok(res, rows);
});

groupsRouter.get('/:id', (req, res) => {
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return fail(res, 'Group not found', 404);
  const members = db.prepare(`
    SELECT u.id, u.username, u.email, u.avatar_color, gm.joined_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
  `).all(req.params.id);
  return ok(res, { ...group, members });
});

groupsRouter.post('/:id/invite', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return fail(res, 'user_id is required');
  const group = db.prepare('SELECT * FROM groups WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!group) return fail(res, 'Group not found or not authorized', 403);
  const existing = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(req.params.id, user_id);
  if (existing) return fail(res, 'User already in group');
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, user_id);
  return ok(res, { invited: true });
});

groupsRouter.post('/:id/join', (req, res) => {
  const existing = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (existing) return fail(res, 'Already a member');
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return fail(res, 'Group not found', 404);
  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  return ok(res, { joined: true });
});

groupsRouter.delete('/:id/leave', (req, res) => {
  const member = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  if (!member) return fail(res, 'Not a member of this group', 404);
  db.prepare('DELETE FROM group_members WHERE id = ?').run(member.id);
  return ok(res, { left: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUSH routes
// ═══════════════════════════════════════════════════════════════════════════════
const pushRouter = express.Router();
pushRouter.use(authMiddleware);

pushRouter.post('/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return fail(res, 'endpoint and keys (p256dh, auth) are required');
  }
  // Upsert by endpoint
  const existing = db.prepare(
    'SELECT id FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'
  ).get(endpoint, req.user.id);
  if (existing) {
    db.prepare(
      'UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE id = ?'
    ).run(keys.p256dh, keys.auth, existing.id);
  } else {
    db.prepare(
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
// Reactions are split: POST under /api/checkins/:id/react, DELETE under /api/reactions/:id
app.use('/api', reactionsRouter);
app.use('/api/rankings', rankingsRouter);
app.use('/api/medals', medalsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/push', pushRouter);


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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`GymCheck API listening on port ${PORT}`);
});

module.exports = app;
