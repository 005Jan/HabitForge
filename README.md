# 🔥 HabitForge

Tracker d'hàbits diari multi-usuari, auto-allotjat amb Docker.

---

## Funcionalitats

- 👥 **Multi-usuari** — pantalla de selecció de perfil sense contrasenya
- ✅ **Check-in diari** — marca/desmarca hàbits amb un clic
- 🔥 **Streaks** — comptador de dies consecutius per hàbit
- 📊 **Estadístiques** — vista diària, setmanal, mensual i anual amb % de completació
- 🗓 **Freqüència flexible** — cada dia o dies concrets de la setmana
- 🎨 **Personalització** — icona emoji i color per cada hàbit
- 🔔 **Notificacions push** — recordatori diari a les 15:00 si tens hàbits pendents
- ⚙️ **Panell d'administrador** — gestió d'usuaris protegida per contrasenya
- 📱 **PWA** — instal·lable al mòbil com a app nativa

---

## Stack tècnic

| Capa | Tecnologia |
|------|-----------|
| Frontend | HTML + CSS + JS vanilla, servit per **Nginx** |
| Backend | **Node.js** + Express |
| Base de dades | **MariaDB 10.11** |
| Infraestructura | **Docker Compose** a Raspberry Pi 4 (ARM64) |
| Reverse proxy | **Traefik v2** amb TLS automàtic (Let's Encrypt) |
| Push | Web Push API + VAPID |

---

## Estructura del projecte

```
HabitForge/
├── backend/
│   ├── server.js        # API REST (Express)
│   ├── database.js      # Pool de connexions MariaDB
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── public/
│   │   ├── index.html   # SPA
│   │   ├── script.js    # Lògica del frontend
│   │   ├── style.css
│   │   └── sw.js        # Service Worker (Web Push)
│   ├── nginx.conf
│   └── Dockerfile
├── init.sql             # Esquema inicial de la BD
└── docker-compose.yml
```

---

## Posada en marxa

### Requisits

- Docker i Docker Compose
- Traefik corrent a la xarxa `proxy_net` (o adaptar el `docker-compose.yml`)

### Variables d'entorn

Copia `backend/.env.example` a `backend/.env` i omple els valors:

```env
ADMIN_PASSWORD=la_teva_contrasenya
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Per generar claus VAPID:
```bash
node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k);"
```

### Aixecar els serveis

```bash
docker compose up -d --build
```

L'aplicació estarà disponible a `http://localhost` (o via Traefik al domini configurat).

---

## API

| Mètode | Endpoint | Descripció |
|--------|----------|-----------|
| GET | `/api/users` | Llista d'usuaris |
| POST | `/api/users` | Crear usuari *(admin)* |
| PUT | `/api/users/:id` | Editar usuari *(admin)* |
| DELETE | `/api/users/:id` | Eliminar usuari *(admin)* |
| GET | `/api/habits?user_id=X` | Hàbits d'un usuari |
| POST | `/api/habits` | Crear hàbit |
| PUT | `/api/habits/:id` | Editar hàbit |
| DELETE | `/api/habits/:id` | Eliminar hàbit |
| POST | `/api/habits/:id/toggle` | Marcar/desmarcar avui |
| GET | `/api/habits/:id/history` | Últims 30 dies |
| GET | `/api/stats?user_id=X&period=week` | Estadístiques |
| GET | `/api/health` | Health check |

---

## Llicència

Ús personal. Tots els drets reservats.
