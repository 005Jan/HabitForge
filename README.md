# 🔥 HabitForge

Tracker d'hàbits diari **multi-usuari**, auto-allotjat amb Docker. Progressive Web App
instal·lable al mòbil, amb notificacions push intel·ligents, estadístiques i ratxes.

> Projecte personal per practicar una stack completa i auto-allotjada:
> API REST, base de dades relacional, PWA offline, Web Push i desplegament amb Docker + reverse proxy.

---

## ✨ Funcionalitats

- 👥 **Multi-usuari** — pantalla de selecció de perfil, sense fricció (sense contrasenya)
- ✅ **Check-in diari** — marca/desmarca hàbits amb un toc
- 🔥 **Ratxes** — comptador de dies consecutius per hàbit
- 🎉 **Celebració de fites** — animació de confeti en arribar a 7, 30, 100 i 365 dies
- 📊 **Estadístiques** — resum diari, setmanal, mensual i anual + gràfic de 7 dies i mapa de calor anual
- 🗓 **Freqüència flexible** — cada dia o dies concrets de la setmana
- 🎨 **Personalització** — icona i color per cada hàbit
- ↕️ **Reordenació** — organitza els hàbits al teu gust
- 🔔 **Notificacions push intel·ligents** *(vegeu més avall)*
- ⚙️ **Panell d'administrador** — gestió d'usuaris protegida per contrasenya
- 📱 **PWA** — instal·lable com a app nativa, funciona offline (app shell cachejat)

---

## 🔔 Notificacions intel·ligents

Un únic recordatori diari sol ser insuficient. HabitForge envia, com a màxim, **una notificació
per hora i usuari**, amb un sistema de prioritats perquè motivi sense atabalar:

| Notificació | Quan | Objectiu |
|---|---|---|
| **Recordatori diari** | A l'hora escollida (o **aleatòria** cada dia) | Recordar els hàbits pendents |
| **Ratxa en perill** | 20:00, si un hàbit amb ratxa ≥ 3 dies segueix pendent | Evitar trencar ratxes llargues |
| **Última oportunitat** | 21:00, si encara queden pendents | Recuperar el dia abans que acabi |
| **Resum setmanal** | Diumenge 19:00 | % completat i motivació |

Tot és condicional: si ja ho tens tot fet, no reps res. Les subscripcions caducades es netegen soles.

---

## 🧱 Stack tècnic

| Capa | Tecnologia |
|------|-----------|
| Frontend | HTML + CSS + **JavaScript vanilla** (sense frameworks), servit per **Nginx** |
| Backend | **Node.js** + Express |
| Base de dades | **MariaDB 10.11** |
| Infraestructura | **Docker Compose** (provat en ARM64 i x86) |
| Reverse proxy | **Traefik v2** amb TLS automàtic (Let's Encrypt) |
| Push | **Web Push API** + VAPID |

Sense dependències de frontend: tota la lògica de la PWA (Service Worker, push, offline,
gràfics, animacions) està escrita a mà amb JS vanilla.

---

## 📁 Estructura del projecte

```
HabitForge/
├── backend/
│   ├── server.js          # API REST (Express) + cron de notificacions
│   ├── database.js        # Pool de connexions MariaDB
│   ├── database-sqlite.js # Alternativa SQLite per a desenvolupament local
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── public/
│   │   ├── index.html     # Interfície (SPA)
│   │   ├── script.js      # Lògica del client
│   │   ├── style.css
│   │   ├── sw.js          # Service Worker (offline + Web Push)
│   │   └── manifest.json  # Manifest PWA
│   ├── nginx.conf         # Serveix estàtics + proxy /api → backend
│   └── Dockerfile
├── init.sql               # Esquema inicial de la BD
├── docker-compose.yml
└── .env.example           # Variables d'entorn (còpia a .env)
```

---

## 🚀 Posada en marxa

### Requisits
- Docker i Docker Compose
- *(Opcional)* Traefik a la xarxa `proxy_net` per a HTTPS amb domini propi. Sense Traefik,
  adapta el `docker-compose.yml` per exposar el port del frontend.

### 1. Variables d'entorn

```bash
cp .env.example .env
```

Edita `.env` i omple els valors. Per generar les claus VAPID (necessàries per a les push):

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

| Variable | Descripció |
|---|---|
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | Contrasenyes de la base de dades |
| `ADMIN_PASSWORD` | Contrasenya del panell d'administració |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Claus Web Push |
| `VAPID_SUBJECT` | Contacte del remitent, p. ex. `mailto:admin@exemple.com` |
| `HABITFORGE_HOST` | Domini públic (per a Traefik). Local: `localhost` |
| `TZ` | Zona horària (afecta recordatoris i el càlcul del dia) |

### 2. Aixecar els serveis

```bash
docker compose up -d --build
```

Amb Traefik, l'app queda a `https://<HABITFORGE_HOST>/habits`.

---

## 🔌 API REST

**Usuaris**
| Mètode | Endpoint | Descripció |
|--------|----------|-----------|
| GET | `/api/users` | Llista d'usuaris |
| POST | `/api/users` | Crear usuari *(admin)* |
| PUT | `/api/users/:id` | Editar usuari *(admin)* |
| DELETE | `/api/users/:id` | Eliminar usuari *(admin)* |
| PATCH | `/api/users/:id/notify` | Canviar l'hora de recordatori |
| POST | `/api/auth/admin` | Validar contrasenya d'admin |

**Hàbits i registres**
| Mètode | Endpoint | Descripció |
|--------|----------|-----------|
| GET | `/api/habits?user_id=X` | Hàbits d'un usuari (amb ratxa i estat d'avui) |
| POST | `/api/habits` | Crear hàbit |
| PUT | `/api/habits/:id` | Editar hàbit |
| PATCH | `/api/habits/:id/ordre` | Reordenar |
| DELETE | `/api/habits/:id` | Eliminar hàbit |
| POST | `/api/habits/:id/toggle` | Marcar/desmarcar avui |
| GET | `/api/habits/:id/history?days=N` | Historial d'un hàbit |

**Estadístiques i push**
| Mètode | Endpoint | Descripció |
|--------|----------|-----------|
| GET | `/api/stats/overview?user_id=X` | Resum complet (dia/setmana/mes/any, ratxes, 7 dies, heatmap) |
| GET | `/api/vapid-public-key` | Clau pública VAPID |
| POST | `/api/subscribe` · `/api/unsubscribe` | Gestió de subscripcions push |
| POST | `/api/push/test` | Enviar una notificació de prova |
| GET | `/api/health` | Health check |

---

## 📝 Notes

- Les contrasenyes i claus reals viuen a `.env` (ignorat per git). Mai es publiquen secrets.
- La base de dades usa la zona horària de `TZ` perquè les ratxes i el canvi de dia siguin correctes.

## 📄 Llicència

MIT — vegeu [LICENSE](LICENSE).
