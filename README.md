# 🔥 HabitForge

A self-hosted, **multi-user** daily habit tracker running on Docker. Installable Progressive
Web App with smart push notifications, statistics and streaks.

> A personal project to practise a complete self-hosted stack:
> REST API, relational database, offline PWA, Web Push and deployment with Docker + reverse proxy.
>
> The app's interface is in Catalan.

---

## ✨ Features

- 👥 **Multi-user**: a frictionless profile picker (no password)
- ✅ **Daily check-in**: tick or untick a habit with a single tap
- 🔥 **Streaks**: counter of consecutive days per habit
- 🎉 **Milestone celebrations**: confetti animation at 7, 30, 100 and 365 days
- 📊 **Statistics**: daily, weekly, monthly and yearly summary, plus a 7-day chart and a yearly heatmap
- 🗓 **Flexible frequency**: every day or specific days of the week
- 🎨 **Customisation**: an icon and colour for each habit
- ↕️ **Reordering**: arrange your habits however you like
- 🔔 **Smart push notifications** *(see below)*
- ⚙️ **Admin panel**: password-protected user management
- 📱 **PWA**: installable as a native app, works offline (cached app shell)

---

## 🔔 Smart notifications

A single daily reminder is usually not enough. HabitForge sends **at most one notification
per user per hour**, with a priority system designed to motivate without nagging:

| Notification | When | Goal |
|---|---|---|
| **Daily reminder** | At the chosen time (or a **random** time each day) | Remind you of pending habits |
| **Streak at risk** | 20:00, if a habit with a streak ≥ 3 days is still pending | Avoid breaking long streaks |
| **Last chance** | 21:00, if anything is still pending | Rescue the day before it ends |
| **Weekly summary** | Sunday 19:00 | Completion % and motivation |

Everything is conditional: if you've already done everything, you get nothing. Expired
subscriptions are cleaned up automatically.

---

## 🧱 Tech stack

| Layer | Technology |
|------|-----------|
| Frontend | HTML + CSS + **vanilla JavaScript** (no frameworks), served by **Nginx** |
| Backend | **Node.js** + Express |
| Database | **MariaDB 10.11** |
| Infrastructure | **Docker Compose** (tested on ARM64 and x86) |
| Reverse proxy | **Traefik v2** with automatic TLS (Let's Encrypt) |
| Push | **Web Push API** + VAPID |

No frontend dependencies: all the PWA logic (Service Worker, push, offline, charts,
animations) is hand-written in vanilla JS.

---

## 📁 Project structure

```
HabitForge/
├── backend/
│   ├── server.js          # REST API (Express) + notification cron
│   ├── database.js        # MariaDB connection pool
│   ├── database-sqlite.js # SQLite alternative for local development
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── public/
│   │   ├── index.html     # Interface (SPA)
│   │   ├── script.js      # Client logic
│   │   ├── style.css
│   │   ├── sw.js          # Service Worker (offline + Web Push)
│   │   └── manifest.json  # PWA manifest
│   ├── nginx.conf         # Serves static files + proxies /api → backend
│   └── Dockerfile
├── init.sql               # Initial database schema
├── docker-compose.yml
└── .env.example           # Environment variables (copy to .env)
```

---

## 🚀 Getting started

### Requirements
- Docker and Docker Compose
- *(Optional)* Traefik on the `proxy_net` network for HTTPS on your own domain. Without
  Traefik, adapt `docker-compose.yml` to expose the frontend port.

### 1. Environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in the values. To generate the VAPID keys (required for push):

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

| Variable | Description |
|---|---|
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | Database passwords |
| `ADMIN_PASSWORD` | Admin panel password |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys |
| `VAPID_SUBJECT` | Sender contact, e.g. `mailto:admin@example.com` |
| `HABITFORGE_HOST` | Public domain (for Traefik). Local: `localhost` |
| `TZ` | Time zone (affects reminders and when the day rolls over) |

### 2. Start the services

```bash
docker compose up -d --build
```

With Traefik, the app is served at `https://<HABITFORGE_HOST>/habits`.

---

## 🔌 REST API

**Users**
| Method | Endpoint | Description |
|--------|----------|-----------|
| GET | `/api/users` | List users |
| POST | `/api/users` | Create a user *(admin)* |
| PUT | `/api/users/:id` | Edit a user *(admin)* |
| DELETE | `/api/users/:id` | Delete a user *(admin)* |
| PATCH | `/api/users/:id/notify` | Change the reminder time |
| POST | `/api/auth/admin` | Validate the admin password |

**Habits and logs**
| Method | Endpoint | Description |
|--------|----------|-----------|
| GET | `/api/habits?user_id=X` | A user's habits (with streak and today's status) |
| POST | `/api/habits` | Create a habit |
| PUT | `/api/habits/:id` | Edit a habit |
| PATCH | `/api/habits/:id/ordre` | Reorder |
| DELETE | `/api/habits/:id` | Delete a habit |
| POST | `/api/habits/:id/toggle` | Tick/untick for today |
| GET | `/api/habits/:id/history?days=N` | A habit's history |

**Statistics and push**
| Method | Endpoint | Description |
|--------|----------|-----------|
| GET | `/api/stats/overview?user_id=X` | Full summary (day/week/month/year, streaks, 7 days, heatmap) |
| GET | `/api/vapid-public-key` | VAPID public key |
| POST | `/api/subscribe` · `/api/unsubscribe` | Manage push subscriptions |
| POST | `/api/push/test` | Send a test notification |
| GET | `/api/health` | Health check |

---

## 📝 Notes

- Real passwords and keys live in `.env` (ignored by git). Secrets are never published.
- The database uses the `TZ` time zone so that streaks and the day rollover are correct.

## 📄 License

MIT. See [LICENSE](LICENSE).
