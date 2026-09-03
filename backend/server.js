// server.js — Backend HabitForge (Express + MariaDB)
// API REST per a hàbits i registres diaris, amb sistema multi-usuari

const express = require('express');
const pool = require('./database');
const webpush = require('web-push');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// La contrasenya d'admin ha de venir SEMPRE de l'entorn. Un valor per defecte
// aquí és una porta oberta el dia que algú desplegui sense definir-la: el
// servei arrencaria "bé" i ningú se n'assabentaria. Millor no arrencar.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    console.error('❌ ADMIN_PASSWORD no definida o massa curta (mínim 12 caràcters).');
    console.error('   Defineix-la al .env de l\'arrel. El servidor no arrenca sense.');
    process.exit(1);
}

// Claus VAPID per a Web Push. Defineix-les a .env per a producció.
// Si no n'hi ha, se'n generen de temporals (les subscripcions es perdran en reiniciar).
let publicVapidKey = process.env.VAPID_PUBLIC_KEY;
let privateVapidKey = process.env.VAPID_PRIVATE_KEY;
if (!publicVapidKey || !privateVapidKey) {
    const generated = webpush.generateVAPIDKeys();
    publicVapidKey = generated.publicKey;
    privateVapidKey = generated.privateKey;
    console.warn('⚠️  VAPID keys no definides a .env — generades temporalment. Defineix-les per a producció.');
}
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);

app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const asyncHandler = fn => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function requireAdmin(req, res, next) {
    const pwd = req.headers['x-admin-password'];
    if (pwd !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Contrasenya incorrecta' });
    next();
}

// ── Migracions ─────────────────────────────────────────────────
async function runMigrations() {
    try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_hour INT NOT NULL DEFAULT 15`);
        await pool.query(`ALTER TABLE habits ADD COLUMN IF NOT EXISTS ordre INT NOT NULL DEFAULT 0`);
        await pool.query(`ALTER TABLE habits ADD COLUMN IF NOT EXISTS descripcio VARCHAR(255) DEFAULT '' AFTER nom`);
        // Assignar ordre inicial als hàbits existents (per user_id, per ordre d'id)
        const [users] = await pool.query('SELECT id FROM users');
        for (const u of users) {
            const [habits] = await pool.query(
                'SELECT id FROM habits WHERE user_id = ? AND ordre = 0 ORDER BY id ASC', [u.id]
            );
            for (let i = 0; i < habits.length; i++) {
                await pool.query('UPDATE habits SET ordre = ? WHERE id = ?', [i, habits[i].id]);
            }
        }
        console.log('✅ Migracions completades');
    } catch (err) {
        console.error('⚠️ Error en migracions:', err.message);
    }
}

// ── Helpers ────────────────────────────────────────────────────
// Data LOCAL en format YYYY-MM-DD (respecta TZ del procés, no UTC com toISOString)
function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function avuiISO() {
    return ymd(new Date());
}

async function calcStreak(habitId) {
    const [rows] = await pool.query(
        `SELECT data FROM registres WHERE habit_id = ? ORDER BY data DESC`, [habitId]
    );
    if (!rows.length) return 0;
    const dates = rows.map(r => String(r.data).slice(0, 10));
    const avui = avuiISO();
    const ahir = ymd(new Date(Date.now() - 86400000));
    if (dates[0] !== avui && dates[0] !== ahir) return 0;
    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
        const diff = (new Date(dates[i - 1]) - new Date(dates[i])) / 86400000;
        if (diff === 1) streak++;
        else break;
    }
    return streak;
}

// Envia un payload push a totes les subscripcions d'un usuari (neteja les caducades)
async function sendPushToUser(userId, payload) {
    const [subs] = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
    let sent = 0;
    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                JSON.stringify(payload)
            );
            sent++;
        } catch (err) {
            console.error('❌ [PUSH] statusCode:', err.statusCode, '| body:', err.body);
            if ([404, 410].includes(err.statusCode))
                await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
        }
    }
    return sent;
}

// Hora "aleatòria" però estable per dia+usuari, dins la franja 9:00–21:00.
// Així cada dia surt a una hora diferent però sense repetir-se ni saltar-se dins del mateix dia.
function randomDailyHour(userId, dateStr) {
    const WINDOW_START = 9, WINDOW_SIZE = 13; // 9..21
    let h = 0;
    const s = dateStr + ':' + userId;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return WINDOW_START + (h % WINDOW_SIZE);
}

// Hàbits pendents que toquen avui (no completats), amb nom i icona
async function getPendingHabits(userId, today, dayOfWeek) {
    const [habits] = await pool.query(
        `SELECT h.id, h.nom, h.icona FROM habits h
         WHERE h.user_id = ?
         AND (h.frequencia = 'daily' OR (h.frequencia = 'custom' AND h.dies LIKE ?))
         AND h.id NOT IN (SELECT habit_id FROM registres WHERE data = ?)`,
        [userId, `%${dayOfWeek}%`, today]
    );
    return habits;
}

// Estadístiques d'un període (últims nDays dies) per a un usuari
async function periodStatsForUser(userId, nDays) {
    const avui = new Date(); avui.setHours(0, 0, 0, 0);
    const [habitRows] = await pool.query('SELECT * FROM habits WHERE user_id = ?', [userId]);
    const from = new Date(avui); from.setDate(from.getDate() - (nDays - 1));
    const fromStr = ymd(from);
    const [[{ completions }]] = await pool.query(
        `SELECT COUNT(*) AS completions FROM registres r
         JOIN habits h ON h.id = r.habit_id
         WHERE h.user_id = ? AND r.data >= ?`, [userId, fromStr]
    );
    let total = 0;
    for (let i = 0; i < nDays; i++) {
        const d = new Date(avui); d.setDate(d.getDate() - i);
        let dow = d.getDay(); if (dow === 0) dow = 7;
        for (const h of habitRows) {
            const cr = h.creat_el ? new Date(h.creat_el) : new Date(0); cr.setHours(0, 0, 0, 0);
            if (d < cr) continue;
            if (h.frequencia === 'daily') total++;
            else if (h.frequencia === 'custom' && String(h.dies || '').includes(String(dow))) total++;
        }
    }
    return { done: parseInt(completions), total, pct: total > 0 ? Math.round(completions / total * 100) : 0 };
}

// ── USERS ──────────────────────────────────────────────────────
app.get('/api/users', asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
        'SELECT id, nom, rol, COALESCE(notify_hour, 15) as notify_hour FROM users ORDER BY id'
    );
    res.json(rows);
}));

app.post('/api/users', requireAdmin, asyncHandler(async (req, res) => {
    const { nom } = req.body;
    if (!nom || !nom.trim()) return res.status(400).json({ error: 'El nom és obligatori' });
    const [r] = await pool.query('INSERT INTO users (nom, rol) VALUES (?, ?)', [nom.trim(), 'user']);
    res.status(201).json({ id: r.insertId, nom: nom.trim(), rol: 'user', notify_hour: 15 });
}));

app.put('/api/users/:id', requireAdmin, asyncHandler(async (req, res) => {
    const uid = parseInt(req.params.id);
    const { nom, rol, notify_hour } = req.body;
    if (!nom || !nom.trim()) return res.status(400).json({ error: 'El nom és obligatori' });
    if (!['user', 'admin'].includes(rol)) return res.status(400).json({ error: 'Rol invàlid' });
    if (uid === 1 && rol !== 'admin') return res.status(400).json({ error: 'No es pot treure el rol admin a l\'usuari principal' });

    let r;
    if (notify_hour !== undefined) {
        const hour = parseInt(notify_hour);
        if (hour < -1 || hour > 23) return res.status(400).json({ error: 'Hora invàlida (-1=aleatori, 0-23)' });
        [r] = await pool.query('UPDATE users SET nom=?, rol=?, notify_hour=? WHERE id=?', [nom.trim(), rol, hour, uid]);
    } else {
        // No es toca notify_hour si no s'envia (evita resetejar-la en editar nom/rol)
        [r] = await pool.query('UPDATE users SET nom=?, rol=? WHERE id=?', [nom.trim(), rol, uid]);
    }
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Usuari no trobat' });
    res.json({ ok: true, nom: nom.trim(), rol });
}));

// PATCH sense password admin — l'usuari pot canviar la seva pròpia hora
app.patch('/api/users/:id/notify', asyncHandler(async (req, res) => {
    const uid = parseInt(req.params.id);
    const { notify_hour } = req.body;
    if (notify_hour === undefined || notify_hour < -1 || notify_hour > 23)
        return res.status(400).json({ error: 'Hora invàlida (-1=aleatori, 0-23)' });
    await pool.query('UPDATE users SET notify_hour=? WHERE id=?', [parseInt(notify_hour), uid]);
    res.json({ ok: true, notify_hour: parseInt(notify_hour) });
}));

app.delete('/api/users/:id', requireAdmin, asyncHandler(async (req, res) => {
    const uid = parseInt(req.params.id);
    if (uid === 1) return res.status(400).json({ error: "No es pot eliminar l'usuari admin" });
    const [r] = await pool.query('DELETE FROM users WHERE id=?', [uid]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Usuari no trobat' });
    res.json({ ok: true });
}));

app.post('/api/auth/admin', (req, res) => {
    const { password } = req.body;
    res.json(password === ADMIN_PASSWORD ? { ok: true } : { ok: false, error: 'Contrasenya incorrecta' });
});

// ── HABITS CRUD ────────────────────────────────────────────────
app.get('/api/habits', asyncHandler(async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'Cal especificar user_id' });
    const avui = avuiISO();
    const [habits] = await pool.query(
        'SELECT * FROM habits WHERE user_id = ? ORDER BY ordre ASC, id ASC', [userId]
    );
    const result = await Promise.all(habits.map(async h => {
        const [[check]] = await pool.query(
            'SELECT id FROM registres WHERE habit_id = ? AND data = ?', [h.id, avui]
        );
        const streak = await calcStreak(h.id);
        return { ...h, completat_avui: !!check, streak };
    }));
    res.json(result);
}));

// Valida i normalitza freqüència + dies. Retorna {freq, dies} o {error}
function validateHabit(body) {
    const freq = body.frequencia || 'daily';
    if (!['daily', 'custom'].includes(freq)) return { error: 'Freqüència invàlida' };
    let dies = String(body.dies || '1234567');
    if (freq === 'custom') {
        if (!/^[1-7]{1,7}$/.test(dies)) return { error: 'Dies invàlids (han de ser dígits 1-7)' };
    } else {
        dies = '1234567';
    }
    return { freq, dies };
}

app.post('/api/habits', asyncHandler(async (req, res) => {
    const { nom, descripcio = '', icona = '⭐', color = '#8b5cf6', user_id } = req.body;
    if (!nom || !nom.trim()) return res.status(400).json({ error: 'El nom és obligatori' });
    if (!user_id) return res.status(400).json({ error: 'Cal especificar user_id' });
    const v = validateHabit(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const [[{ maxOrdre }]] = await pool.query(
        'SELECT COALESCE(MAX(ordre), -1) as maxOrdre FROM habits WHERE user_id = ?', [user_id]
    );
    const ordre = maxOrdre + 1;
    const [r] = await pool.query(
        'INSERT INTO habits (user_id, nom, descripcio, icona, color, frequencia, dies, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [user_id, nom.trim(), descripcio, icona, color, v.freq, v.dies, ordre]
    );
    res.status(201).json({ id: r.insertId, user_id, nom: nom.trim(), descripcio, icona, color, frequencia: v.freq, dies: v.dies, ordre, completat_avui: false, streak: 0 });
}));

app.put('/api/habits/:id', asyncHandler(async (req, res) => {
    const { nom, descripcio = '', icona, color } = req.body;
    if (!nom || !nom.trim()) return res.status(400).json({ error: 'El nom és obligatori' });
    const v = validateHabit(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const [r] = await pool.query(
        'UPDATE habits SET nom=?, descripcio=?, icona=?, color=?, frequencia=?, dies=? WHERE id=?',
        [nom.trim(), descripcio, icona, color, v.freq, v.dies, req.params.id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Hàbit no trobat' });
    res.json({ ok: true });
}));

// PATCH /api/habits/:id/ordre — Reordena un hàbit
app.patch('/api/habits/:id/ordre', asyncHandler(async (req, res) => {
    const { ordre } = req.body;
    if (ordre === undefined) return res.status(400).json({ error: 'Cal especificar ordre' });
    await pool.query('UPDATE habits SET ordre=? WHERE id=?', [parseInt(ordre), req.params.id]);
    res.json({ ok: true });
}));

app.delete('/api/habits/:id', asyncHandler(async (req, res) => {
    const [r] = await pool.query('DELETE FROM habits WHERE id=?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Hàbit no trobat' });
    res.json({ ok: true });
}));

// ── REGISTRES ──────────────────────────────────────────────────
app.post('/api/habits/:id/toggle', asyncHandler(async (req, res) => {
    const avui = avuiISO();
    const [[existing]] = await pool.query(
        'SELECT id FROM registres WHERE habit_id = ? AND data = ?', [req.params.id, avui]
    );
    if (existing) {
        await pool.query('DELETE FROM registres WHERE id = ?', [existing.id]);
        const streak = await calcStreak(req.params.id);
        return res.json({ completat: false, streak });
    } else {
        await pool.query('INSERT INTO registres (habit_id, data) VALUES (?, ?)', [req.params.id, avui]);
        const streak = await calcStreak(req.params.id);
        // La celebració de fites (7/30/100/365) es fa amb una animació dins la web app,
        // no amb push, perquè l'usuari ja és a l'app en marcar l'hàbit.
        return res.json({ completat: true, streak });
    }
}));

app.get('/api/habits/:id/history', asyncHandler(async (req, res) => {
    const nDays = Math.min(parseInt(req.query.days) || 14, 60);
    const avui = new Date(); avui.setHours(0,0,0,0);
    const [rows] = await pool.query(
        `SELECT data FROM registres WHERE habit_id = ?
         AND data >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         ORDER BY data ASC`, [req.params.id, nDays]
    );
    const doneSet = new Set(rows.map(r => String(r.data).slice(0,10)));
    const result = [];
    for (let i = nDays - 1; i >= 0; i--) {
        const d = new Date(avui); d.setDate(d.getDate() - i);
        const dateStr = ymd(d);
        result.push({ date: dateStr, completed: doneSet.has(dateStr) });
    }
    res.json(result);
}));

// ── Health check ───────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/vapid-public-key', (req, res) => res.json({ key: publicVapidKey }));

// ── Estadístiques ──────────────────────────────────────────────
app.get('/api/stats', asyncHandler(async (req, res) => {
    const { user_id, period = 'week' } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Cal user_id' });
    const intervals = { day: 1, week: 7, month: 30, year: 365 };
    const days = intervals[period] || 7;
    const avui = new Date(); avui.setHours(0, 0, 0, 0);
    const fromDate = new Date(avui); fromDate.setDate(fromDate.getDate() - (days - 1));
    const fromDateStr = ymd(fromDate);
    const [habitRows] = await pool.query('SELECT * FROM habits WHERE user_id = ?', [user_id]);
    const total = habitRows.length;
    const [[{ completions }]] = await pool.query(
        `SELECT COUNT(*) AS completions FROM registres r
         JOIN habits h ON h.id = r.habit_id
         WHERE h.user_id = ? AND r.data >= ?`, [user_id, fromDateStr]
    );
    let maxPossible = 0;
    for (let i = 0; i < days; i++) {
        const d = new Date(avui); d.setDate(d.getDate() - i);
        let curDayOfWeek = d.getDay(); if (curDayOfWeek === 0) curDayOfWeek = 7;
        for (const h of habitRows) {
            const creacio = h.creat_el ? new Date(h.creat_el) : new Date(0);
            creacio.setHours(0, 0, 0, 0);
            if (d < creacio) continue;
            if (h.frequencia === 'daily') maxPossible++;
            else if (h.frequencia === 'custom' && h.dies && String(h.dies).includes(String(curDayOfWeek))) maxPossible++;
        }
    }
    const rate = maxPossible > 0 ? Math.round((completions / maxPossible) * 100) : 0;
    let bestStreak = 0;
    for (const h of habitRows) {
        const s = await calcStreak(h.id);
        if (s > bestStreak) bestStreak = s;
    }
    const [[{ activeDays }]] = await pool.query(
        `SELECT COUNT(DISTINCT r.data) AS activeDays FROM registres r
         JOIN habits h ON h.id = r.habit_id
         WHERE h.user_id = ? AND r.data >= ?`, [user_id, fromDateStr]
    );
    res.json({ period, days, total, completions, rate, bestStreak, activeDays });
}));

app.get('/api/stats/days', asyncHandler(async (req, res) => {
    const { user_id, days = 7 } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Cal user_id' });
    const n = Math.min(parseInt(days) || 7, 365);
    const avui = new Date(); avui.setHours(0, 0, 0, 0);
    const fromDate = new Date(avui); fromDate.setDate(fromDate.getDate() - (n - 1));
    const fromDateStr = ymd(fromDate);
    const [habitRows] = await pool.query('SELECT * FROM habits WHERE user_id = ?', [user_id]);
    const [rows] = await pool.query(
        `SELECT r.data as dateStr, COUNT(DISTINCT r.habit_id) as done
         FROM registres r JOIN habits h ON h.id = r.habit_id
         WHERE h.user_id = ? AND r.data >= ?
         GROUP BY r.data ORDER BY r.data ASC`, [user_id, fromDateStr]
    );
    const result = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(avui); d.setDate(d.getDate() - i);
        const dateStr = ymd(d);
        let curDayOfWeek = d.getDay(); if (curDayOfWeek === 0) curDayOfWeek = 7;
        let totalForDay = 0;
        for (const h of habitRows) {
            const creacio = h.creat_el ? new Date(h.creat_el) : new Date(0);
            creacio.setHours(0, 0, 0, 0);
            if (d < creacio) continue;
            if (h.frequencia === 'daily') totalForDay++;
            else if (h.frequencia === 'custom' && h.dies && String(h.dies).includes(String(curDayOfWeek))) totalForDay++;
        }
        const found = rows.find(r => (r.dateStr ? String(r.dateStr) : String(r.date)).slice(0, 10) === dateStr);
        const done = found ? parseInt(found.done) : 0;
        result.push({ date: dateStr, done, total: totalForDay, pct: totalForDay > 0 ? Math.round((done / totalForDay) * 100) : 0 });
    }
    res.json(result);
}));

// ── Estadístiques Overview (format complet per frontend) ───────
app.get('/api/stats/overview', asyncHandler(async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'Cal user_id' });

    const avui = new Date(); avui.setHours(0,0,0,0);
    const [habitRows] = await pool.query('SELECT * FROM habits WHERE user_id = ?', [user_id]);

    // Helper: compta maxPossible i completions per rang de dies
    async function periodStats(nDays) {
        const from = new Date(avui); from.setDate(from.getDate() - (nDays - 1));
        const fromStr = ymd(from);
        const [[{ completions }]] = await pool.query(
            `SELECT COUNT(*) AS completions FROM registres r
             JOIN habits h ON h.id = r.habit_id
             WHERE h.user_id = ? AND r.data >= ?`, [user_id, fromStr]
        );
        let total = 0;
        for (let i = 0; i < nDays; i++) {
            const d = new Date(avui); d.setDate(d.getDate() - i);
            let dow = d.getDay(); if (dow === 0) dow = 7;
            for (const h of habitRows) {
                const cr = h.creat_el ? new Date(h.creat_el) : new Date(0);
                cr.setHours(0,0,0,0);
                if (d < cr) continue;
                if (h.frequencia === 'daily') total++;
                else if (h.frequencia === 'custom' && String(h.dies||'').includes(String(dow))) total++;
            }
        }
        return { done: parseInt(completions), total };
    }

    const [day, week, month, year] = await Promise.all([
        periodStats(1), periodStats(7), periodStats(30), periodStats(365)
    ]);

    // Per-habit streaks
    const streaks = {};
    for (const h of habitRows) {
        streaks[h.id] = await calcStreak(h.id);
    }

    // Last 7 days bar chart
    const [reg7] = await pool.query(
        `SELECT r.data as ds, COUNT(DISTINCT r.habit_id) as done
         FROM registres r JOIN habits h ON h.id = r.habit_id
         WHERE h.user_id = ? AND r.data >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
         GROUP BY r.data`, [user_id]
    );
    const last7days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(avui); d.setDate(d.getDate() - i);
        const ds = ymd(d);
        let dow = d.getDay(); if (dow === 0) dow = 7;
        let total = 0;
        for (const h of habitRows) {
            const cr = h.creat_el ? new Date(h.creat_el) : new Date(0);
            cr.setHours(0,0,0,0);
            if (d < cr) continue;
            if (h.frequencia === 'daily') total++;
            else if (h.frequencia === 'custom' && String(h.dies||'').includes(String(dow))) total++;
        }
        const found = reg7.find(r => String(r.ds).slice(0,10) === ds);
        const done = found ? parseInt(found.done) : 0;
        last7days.push({ date: ds, done, total, pct: total > 0 ? Math.round((done/total)*100) : 0 });
    }

    // Heatmap anual (últims 365 dies)
    const [regYear] = await pool.query(
        `SELECT r.data as ds, COUNT(DISTINCT r.habit_id) as done
         FROM registres r JOIN habits h ON h.id = r.habit_id
         WHERE h.user_id = ? AND r.data >= DATE_SUB(CURDATE(), INTERVAL 364 DAY)
         GROUP BY r.data`, [user_id]
    );
    const heatmap = [];
    for (let i = 364; i >= 0; i--) {
        const d = new Date(avui); d.setDate(d.getDate() - i);
        const ds = ymd(d);
        let dow = d.getDay(); if (dow === 0) dow = 7;
        let total = 0;
        for (const h of habitRows) {
            const cr = h.creat_el ? new Date(h.creat_el) : new Date(0);
            cr.setHours(0,0,0,0);
            if (d < cr) continue;
            if (h.frequencia === 'daily') total++;
            else if (h.frequencia === 'custom' && String(h.dies||'').includes(String(dow))) total++;
        }
        const found = regYear.find(r => String(r.ds).slice(0,10) === ds);
        const done = found ? parseInt(found.done) : 0;
        heatmap.push({ date: ds, done, total, pct: total > 0 ? Math.round((done/total)*100) : 0 });
    }

    res.json({ day, week, month, year, streaks, last7days, heatmap });
}));

// ── Web Push ───────────────────────────────────────────────────
// Accepta /api/subscribe i /api/push/subscribe (compatibilitat)
async function handleSubscribe(req, res) {
    const uid = req.body.user_id || req.body.userId;
    const subscription = req.body.subscription;
    if (!uid || !subscription) return res.status(400).json({ error: 'Falten dades' });
    const { endpoint, keys: { p256dh, auth } } = subscription;
    await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), p256dh=VALUES(p256dh), auth=VALUES(auth)`,
        [uid, endpoint, p256dh, auth]
    );
    res.status(201).json({ ok: true });
}

app.post('/api/subscribe', asyncHandler(handleSubscribe));
app.post('/api/push/subscribe', asyncHandler(handleSubscribe));

app.post('/api/unsubscribe', asyncHandler(async (req, res) => {
    const { endpoint } = req.body;
    if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    res.json({ ok: true });
}));

// Envia una notificació de PROVA immediata a totes les subscripcions de l'usuari
app.post('/api/push/test', asyncHandler(async (req, res) => {
    const uid = req.body.user_id || req.body.userId;
    if (!uid) return res.status(400).json({ error: 'Cal user_id' });
    const [subs] = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = ?', [uid]);
    if (!subs.length) return res.status(404).json({ error: 'no_subscription', message: 'No hi ha cap subscripció guardada per aquest usuari' });

    const payload = JSON.stringify({
        title: '🔔 HabitForge',
        body: 'Les notificacions funcionen correctament! 🎉',
    });
    let sent = 0, removed = 0;
    const errors = [];
    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload
            );
            sent++;
        } catch (err) {
            console.error('❌ [PUSH TEST] statusCode:', err.statusCode, '| body:', err.body, '| msg:', err.message);
            errors.push({ statusCode: err.statusCode, body: err.body });
            if ([404, 410].includes(err.statusCode)) {
                await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
                removed++;
            }
        }
    }
    res.json({ ok: sent > 0, sent, removed, total: subs.length, errors });
}));

// ── Cron: cada hora a les X:00 — decideix UNA notificació per usuari ──
// Prioritats per hora:
//   • Diumenge 19:00 → resum setmanal
//   • notify_hour    → recordatori diari (si queden pendents)
//   • 20:00          → ratxa en perill (hàbits amb ratxa ≥3 pendents)
//   • 21:00          → última oportunitat (si queden pendents)
const ICON = { icon: '/habits/favicon-192x192.png', badge: '/habits/favicon-96x96.png', data: { url: '/habits/' } };

cron.schedule('0 * * * *', async () => {
    const now = new Date();
    const hour = now.getHours();
    const dow = now.getDay() || 7;        // 1=dl ... 7=dg
    const isSunday = now.getDay() === 0;
    const today = avuiISO();
    console.log(`⏰ [CRON] ${hour}:00 (dia ${dow}) — Comprovant notificacions...`);

    try {
        const [users] = await pool.query(
            'SELECT id, COALESCE(notify_hour, 15) AS notify_hour FROM users'
        );
        for (const u of users) {
            // Només usuaris amb subscripcions actives
            const [[{ cnt }]] = await pool.query(
                'SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE user_id = ?', [u.id]
            );
            if (!cnt) continue;

            // 1) RESUM SETMANAL — diumenge 19:00
            if (isSunday && hour === 19) {
                const w = await periodStatsForUser(u.id, 7);
                if (w.total > 0) {
                    let emoji = w.pct >= 80 ? '🏆' : w.pct >= 50 ? '💪' : '📊';
                    await sendPushToUser(u.id, {
                        title: `${emoji} Resum de la setmana`,
                        body: `Has completat el ${w.pct}% dels teus hàbits (${w.done}/${w.total}). ${w.pct >= 80 ? 'Increïble!' : w.pct >= 50 ? 'Bon ritme!' : 'La propera anirà millor!'}`,
                        ...ICON
                    });
                }
                continue; // res més aquesta hora
            }

            const pending = await getPendingHabits(u.id, today, dow);

            // 2) RECORDATORI DIARI — a la seva hora (o hora aleatòria del dia si notify_hour = -1)
            const reminderHour = u.notify_hour === -1 ? randomDailyHour(u.id, today) : u.notify_hour;
            if (hour === reminderHour && pending.length) {
                await sendPushToUser(u.id, {
                    title: 'HabitForge',
                    body: `Tens ${pending.length} hàbit${pending.length !== 1 ? 's' : ''} pendent${pending.length !== 1 ? 's' : ''} per avui! 💪`,
                    ...ICON
                });
                continue;
            }

            // 3) RATXA EN PERILL — 20:00
            if (hour === 20 && pending.length) {
                const atRisk = [];
                for (const h of pending) {
                    const s = await calcStreak(h.id);
                    if (s >= 3) atRisk.push(`${h.icona || ''} ${h.nom} (${s}🔥)`);
                }
                if (atRisk.length) {
                    await sendPushToUser(u.id, {
                        title: '⚠️ Ratxa en perill!',
                        body: `No la perdis! Encara no has fet: ${atRisk.join(', ')}`,
                        ...ICON
                    });
                    continue;
                }
            }

            // 4) ÚLTIMA OPORTUNITAT — 21:00
            if (hour === 21 && pending.length) {
                await sendPushToUser(u.id, {
                    title: '🌙 Última oportunitat',
                    body: `Encara ets a temps! Tens ${pending.length} hàbit${pending.length !== 1 ? 's' : ''} pendent${pending.length !== 1 ? 's' : ''} per completar avui.`,
                    ...ICON
                });
                continue;
            }
        }
    } catch (err) {
        console.error('❌ Error en el Cron:', err);
    }
});

// ── Error handler ──────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('❌', err.message);
    res.status(500).json({ error: 'Error intern del servidor' });
});

// ── Arrencada amb migracions ───────────────────────────────────
(async () => {
    await runMigrations();
    app.listen(PORT, () => console.log(`✅ HabitForge backend al port ${PORT}`));
})();
