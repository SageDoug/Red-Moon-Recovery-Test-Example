const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Ensure data directory exists ──
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

// ── Database Setup ──
const db = new Database('./data/redmoon.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER UNIQUE NOT NULL,
    name          TEXT,
    age           INTEGER,
    cycle_status  TEXT,
    goals         TEXT,
    sport         TEXT,
    event_date    TEXT,
    desired_phase TEXT,
    cycles_data   TEXT,
    training_load TEXT,
    acl_history   TEXT,
    updated_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    entry_date     TEXT NOT NULL,
    cycle_day      INTEGER,
    phase          TEXT,
    hrv            TEXT,
    sleep_quality  INTEGER,
    sleep_hours    REAL,
    energy         TEXT,
    soreness       TEXT,
    pain_notes     TEXT,
    workout        TEXT,
    rpe            INTEGER,
    motivation     INTEGER,
    perf_notes     TEXT,
    flow           TEXT,
    cramps         TEXT,
    mucus          TEXT,
    digestion      TEXT,
    symptom_time   TEXT,
    mood           TEXT,
    cognitive      TEXT,
    social         TEXT,
    cravings       TEXT,
    hydration      TEXT,
    recovery_steps TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    session_date TEXT DEFAULT (date('now')),
    messages     TEXT NOT NULL DEFAULT '[]',
    updated_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'redmoon-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── Auth Middleware ──
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// ── Anthropic API helper (no SDK needed — pure https) ──
function callClaude(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return reject(new Error('ANTHROPIC_API_KEY is not set. Please add it to your environment variables or Codespaces secrets.'));

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          if (!parsed.content || !parsed.content[0]) return reject(new Error('Empty response from AI'));
          resolve(parsed.content[0].text);
        } catch (e) {
          reject(new Error('Failed to parse AI response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Build system prompt with user's profile + journal context ──
function buildSystemPrompt(userId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const recentEntries = db.prepare(
    'SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 10'
  ).all(userId);

  let system = `You are Luna, a warm and knowledgeable AI guide for Red Moon Recovery — a menstrual cycle tracking platform built for athletes. You combine the expertise of a sports physiologist and a women's health coach.

YOUR ROLE:
- Have natural, flowing conversations that adapt based on what the user tells you
- Ask smart follow-up questions to better understand their situation
- Give personalized advice grounded in their actual profile and journal data
- Help athletes understand how their cycle phase affects training, recovery, injury risk, and performance
- Notice and flag patterns across their logged data (e.g. "I notice your energy dips on day 22-24 consistently")
- Guide users through reverse mapping for upcoming competitions
- Be encouraging, never judgmental, and always evidence-based

CONVERSATION STYLE:
- Keep responses to 3-5 sentences unless explaining a concept that needs more
- Always end with a follow-up question OR a concrete suggestion — never just close a topic
- If they mention a symptom, ask: where, how intense, when it started, does it affect training
- If they mention fatigue, ask about sleep quality, nutrition, and training load
- If they mention a competition or race date, calculate or estimate their cycle phase for that date
- Mirror their energy — casual and warm if they're chatting, focused and detailed if they ask technical questions

CYCLE SCIENCE TO DRAW ON:
- Menstrual phase (day 1-5): Prostaglandins → cramps, fatigue. Iron loss matters for endurance. Prioritize rest, yoga, light movement. Pain tolerance is lower. Core temperature is lower.
- Follicular phase (day 6-13): Rising estrogen → more strength, better mood, higher pain tolerance, better coordination. Best time for PRs, new skills, high-intensity blocks.
- Ovulatory phase (day 14-17): Estrogen peaks → peak strength and power. BUT ligament laxity increases (ACL risk goes up — important for field athletes). Best window for competition.
- Luteal phase (day 18-28): Progesterone rises → higher core temp, more perceived effort, more fatigue. Endurance can stay good but intensity feels harder. Late luteal (day 25+) → PMS risk, emotional sensitivity, carb cravings, disrupted sleep.

INJURY AWARENESS:
- ACL tears are 2-8x more likely around ovulation due to ligament laxity from estrogen
- Always note this for users who have ACL history or play sports with cutting/pivoting
- Core temp is ~0.3-0.5°C higher in luteal — impacts heat tolerance and RPE

Never diagnose medical conditions. Recommend seeing a doctor for severe or unusual symptoms.
Do not ask more than 2 questions at once.`;

  if (profile) {
    const goals = (() => { try { return JSON.parse(profile.goals || '[]').join(', '); } catch { return ''; } })();
    system += `\n\n=== USER PROFILE ===`;
    if (profile.name) system += `\nName: ${profile.name}`;
    if (profile.age) system += `\nAge: ${profile.age}`;
    if (profile.cycle_status) system += `\nCycle status: ${profile.cycle_status}`;
    if (goals) system += `\nGoals: ${goals}`;
    if (profile.sport) system += `\nSport/Activity: ${profile.sport}`;
    if (profile.training_load) system += `\nTraining load: ${profile.training_load}`;
    if (profile.acl_history) system += `\nACL/soft tissue injury history: ${profile.acl_history}`;
    if (profile.event_date) system += `\nUpcoming event date: ${profile.event_date}`;
    if (profile.desired_phase) system += `\nDesired phase for event: ${profile.desired_phase}`;
  }

  if (recentEntries.length > 0) {
    system += `\n\n=== RECENT JOURNAL DATA (use this to personalize advice) ===`;
    recentEntries.forEach(e => {
      const parts = [
        `[${e.entry_date}]`,
        e.cycle_day ? `Day ${e.cycle_day}` : null,
        e.phase ? `Phase: ${e.phase}` : null,
        e.energy ? `Energy: ${e.energy}` : null,
        e.sleep_quality ? `Sleep: ${e.sleep_quality}/10` : null,
        e.sleep_hours ? `(${e.sleep_hours}hrs)` : null,
        e.rpe ? `RPE: ${e.rpe}` : null,
        e.motivation ? `Motivation: ${e.motivation}/10` : null,
        e.mood ? `Mood: ${e.mood}` : null,
        e.flow ? `Flow: ${e.flow}` : null,
        e.soreness ? `Soreness: ${e.soreness}` : null,
        e.cramps ? `Cramps: ${e.cramps}` : null,
        e.workout ? `Workout: ${e.workout}` : null,
      ].filter(Boolean);
      system += `\n${parts.join(' | ')}`;
      if (e.perf_notes) system += `\n  Notes: ${e.perf_notes}`;
      if (e.pain_notes) system += `\n  Pain: ${e.pain_notes}`;
    });
  } else {
    system += `\n\n=== JOURNAL DATA ===\nNo journal entries yet. Encourage the user to start logging.`;
  }

  return system;
}

// ══════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════

app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.json({ success: false, error: 'All fields are required.' });
  if (password.length < 6)
    return res.json({ success: false, error: 'Password must be at least 6 characters.' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    ).run(username.trim().toLowerCase(), email.trim().toLowerCase(), hash);
    req.session.userId = result.lastInsertRowid;
    req.session.username = username.trim();
    res.json({ success: true, username: username.trim() });
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      res.json({ success: false, error: 'Username or email already taken.' });
    else
      res.json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.json({ success: false, error: 'Username and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.json({ success: false, error: 'Invalid username or password.' });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session.userId)
    res.json({ loggedIn: true, username: req.session.username, userId: req.session.userId });
  else
    res.json({ loggedIn: false });
});

// ══════════════════════════════════════
//  PROFILE ROUTES
// ══════════════════════════════════════

app.get('/api/profile', requireAuth, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.session.userId);
  res.json({ success: true, profile: profile || null });
});

app.post('/api/profile', requireAuth, (req, res) => {
  const { name, age, cycle_status, goals, sport, event_date, desired_phase, cycles_data, training_load, acl_history } = req.body;
  const existing = db.prepare('SELECT id FROM profiles WHERE user_id = ?').get(req.session.userId);
  if (existing) {
    db.prepare(`UPDATE profiles SET name=?, age=?, cycle_status=?, goals=?, sport=?,
      event_date=?, desired_phase=?, cycles_data=?, training_load=?, acl_history=?,
      updated_at=datetime('now') WHERE user_id=?`)
      .run(name, age, cycle_status, JSON.stringify(goals), sport, event_date, desired_phase, cycles_data, training_load, acl_history, req.session.userId);
  } else {
    db.prepare(`INSERT INTO profiles (user_id, name, age, cycle_status, goals, sport, event_date, desired_phase, cycles_data, training_load, acl_history)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.session.userId, name, age, cycle_status, JSON.stringify(goals), sport, event_date, desired_phase, cycles_data, training_load, acl_history);
  }
  res.json({ success: true });
});

// ══════════════════════════════════════
//  JOURNAL ROUTES
// ══════════════════════════════════════

app.post('/api/journal', requireAuth, (req, res) => {
  const e = req.body;
  db.prepare(`INSERT INTO journal_entries
    (user_id, entry_date, cycle_day, phase, hrv, sleep_quality, sleep_hours, energy,
     soreness, pain_notes, workout, rpe, motivation, perf_notes, flow, cramps, mucus,
     digestion, symptom_time, mood, cognitive, social, cravings, hydration, recovery_steps)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.session.userId, e.entry_date, e.cycle_day || null, e.phase, e.hrv,
      e.sleep_quality, e.sleep_hours || null, e.energy, e.soreness, e.pain_notes,
      e.workout, e.rpe, e.motivation, e.perf_notes, e.flow, e.cramps, e.mucus,
      e.digestion, e.symptom_time, e.mood, e.cognitive, e.social, e.cravings, e.hydration,
      JSON.stringify(e.recovery_steps || []));
  res.json({ success: true });
});

app.get('/api/journal', requireAuth, (req, res) => {
  const entries = db.prepare(
    'SELECT * FROM journal_entries WHERE user_id = ? ORDER BY entry_date DESC'
  ).all(req.session.userId);
  res.json({ success: true, entries });
});

app.get('/api/journal/:id', requireAuth, (req, res) => {
  const entry = db.prepare(
    'SELECT * FROM journal_entries WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.session.userId);
  if (!entry) return res.json({ success: false, error: 'Entry not found' });
  res.json({ success: true, entry });
});

app.delete('/api/journal/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM journal_entries WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// ══════════════════════════════════════
//  AI CHAT ROUTES
// ══════════════════════════════════════

// Send a message and get an AI response
app.post('/api/chat', requireAuth, async (req, res) => {
  const { message, session_id } = req.body;
  if (!message || !message.trim())
    return res.json({ success: false, error: 'Message is required.' });

  // Load or create chat session
  let chatSession;
  if (session_id) {
    chatSession = db.prepare(
      'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?'
    ).get(session_id, req.session.userId);
  }
  if (!chatSession) {
    const result = db.prepare(
      'INSERT INTO chat_sessions (user_id, messages) VALUES (?, ?)'
    ).run(req.session.userId, '[]');
    chatSession = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(result.lastInsertRowid);
  }

  let messages = [];
  try { messages = JSON.parse(chatSession.messages); } catch { messages = []; }

  // Keep last 40 messages (20 exchanges) to stay within context limits
  if (messages.length > 40) messages = messages.slice(messages.length - 40);

  messages.push({ role: 'user', content: message.trim() });

  try {
    const systemPrompt = buildSystemPrompt(req.session.userId);
    const aiReply = await callClaude(messages, systemPrompt);
    messages.push({ role: 'assistant', content: aiReply });

    db.prepare(`UPDATE chat_sessions SET messages=?, updated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(messages), chatSession.id);

    res.json({ success: true, reply: aiReply, session_id: chatSession.id });
  } catch (err) {
    console.error('Claude API error:', err.message);
    // Save user message even on failure
    db.prepare(`UPDATE chat_sessions SET messages=?, updated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(messages), chatSession.id);
    res.json({ success: false, error: err.message });
  }
});

// Get list of all chat sessions
app.get('/api/chat/sessions', requireAuth, (req, res) => {
  const sessions = db.prepare(
    'SELECT id, session_date, updated_at FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(req.session.userId);
  res.json({ success: true, sessions });
});

// Load a specific chat session
app.get('/api/chat/sessions/:id', requireAuth, (req, res) => {
  const session = db.prepare(
    'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.session.userId);
  if (!session) return res.json({ success: false, error: 'Session not found' });
  let messages = [];
  try { messages = JSON.parse(session.messages); } catch {}
  res.json({ success: true, session_id: session.id, messages, session_date: session.session_date });
});

// Delete a chat session
app.delete('/api/chat/sessions/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.session.userId);
  res.json({ success: true });
});

// Start a fresh chat session
app.post('/api/chat/new', requireAuth, (req, res) => {
  const result = db.prepare(
    'INSERT INTO chat_sessions (user_id, messages) VALUES (?, ?)'
  ).run(req.session.userId, '[]');
  res.json({ success: true, session_id: result.lastInsertRowid });
});

// ── Start Server ──
app.listen(PORT, () => {
  console.log(`🌕 Red Moon Recovery running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  WARNING: ANTHROPIC_API_KEY is not set.');
    console.warn('   Add it as a Codespaces secret or in a .env file to enable AI chat.');
  }
});
