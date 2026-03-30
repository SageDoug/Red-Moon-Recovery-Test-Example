# 🌕 Red Moon Recovery

A menstrual cycle tracking platform for athletes. Log daily physical metrics, cycle symptoms, training performance, mood, and nutrition — all tied to your personal login so your data persists across sessions.

## Features
- User registration & login (passwords encrypted)
- Per-user profile (goals, cycle status, sport, event dates)
- Daily journal with full cycle + performance tracking
- Reverse mapping calculator (predict phase for upcoming events)
- AI Guide chatbot (Luna)
- Dashboard with insights and entry history

---

## Running in GitHub Codespaces (Recommended — No install needed)

1. On the GitHub repo page, click the green **"Code"** button
2. Click the **"Codespaces"** tab
3. Click **"Create codespace on main"**
4. Wait about 60 seconds — it will automatically run `npm install` and start the server
5. A popup will appear saying "Your app is running on port 3000" — click **Open in Browser**

That's it. Your app is live with a database saving all data.

---

## Running Locally

### Prerequisites
- Node.js 18 or higher — download at https://nodejs.org

### Steps
```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/red-moon-recovery.git
cd red-moon-recovery

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Then open your browser and go to: **http://localhost:3000**

---

## File Structure

```
red-moon-recovery/
├── server.js              ← Express server + all API routes + database setup
├── package.json           ← Dependencies
├── .gitignore             ← Keeps node_modules and database out of git
├── .devcontainer/
│   └── devcontainer.json  ← Codespaces configuration (auto-start)
└── public/
    └── index.html         ← Full frontend (HTML + CSS + JavaScript)
```

The SQLite database is created automatically at `data/redmoon.db` when you first run the server. It is excluded from git so each deployment starts fresh (user data stays on the server only).

---

## Tech Stack
- **Backend:** Node.js + Express
- **Database:** SQLite via better-sqlite3
- **Auth:** bcryptjs (password hashing) + express-session
- **Frontend:** Vanilla HTML/CSS/JavaScript (no framework needed)
