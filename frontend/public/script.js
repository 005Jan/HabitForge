'use strict';

/* ══════════════════════════════════════════════
   CONSTANTS & STATE
══════════════════════════════════════════════ */
const API = '/habits/api';
const LAST_USER_KEY = 'hf_lastUserId';
var VAPID_PUBLIC_KEY = null; // es carrega des del backend

const EMOJIS = ['💪','🏃','📚','🧘','🥗','💧','😴','🎯','✍️','🚴','🏋️','🎨','🎸','🧹','🌞','🍎','🏊','🧠','💊','🌿','🔥','⭐','🎵','🌍'];
const COLORS = ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#a3e635','#f97316','#e879f9'];
const QUOTES = [
    "Cada dia és una nova oportunitat per millorar.",
    "La constància és la mare de l'èxit.",
    "El millor moment és ara.",
    "Petit a poc, lluny arribes.",
    "Avui + demà = canvi real.",
    "No cal ser perfecte, cal ser constant.",
    "Un hàbit a la vegada canvia una vida.",
];

let currentUser = null;
let allHabits = [];
let toastTimer = null;
let pendingDelete = null;
let openHistoryId = null;

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    renderDate();
    renderQuote();
    initEmojiColorGrids();
    initPushKey().then(() => initUserSelect());
    initPullToRefresh();
    registerPWA();

    document.querySelectorAll('#diesSelector .hf-die-btn').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('active'));
    });
});

/* ══════════════════════════════════════════════
   PWA: SERVICE WORKER + VAPID KEY
══════════════════════════════════════════════ */
async function initPushKey() {
    try {
        const res = await fetch(API + '/vapid-public-key');
        const data = await res.json();
        VAPID_PUBLIC_KEY = data.key;
    } catch (e) {
        console.warn('No s\'ha pogut obtenir la VAPID key');
    }
}

var deferredInstallPrompt = null;

function registerPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js', { scope: '/habits/' })
            .then(function(reg) { console.log('SW registrat, scope:', reg.scope); })
            .catch(function(err) { console.warn('Error SW:', err); });
    }

    // Captura l'event d'instal·lació (Android/Chrome)
    window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        deferredInstallPrompt = e;
        var banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.style.display = 'flex';
    });

    window.addEventListener('appinstalled', function() {
        deferredInstallPrompt = null;
        var banner = document.getElementById('pwaInstallBanner');
        if (banner) banner.style.display = 'none';
        showToast('✅ App instal·lada!');
    });
}

function installPWA() {
    if (!deferredInstallPrompt) {
        showToast('Usa "Afegir a la pantalla d\'inici" del navegador');
        return;
    }
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function(result) {
        deferredInstallPrompt = null;
        if (result.outcome === 'accepted') showToast('✅ App instal·lada!');
    });
}

/* ══════════════════════════════════════════════
   DATE & QUOTE
══════════════════════════════════════════════ */
function renderDate() {
    const now = new Date();
    const opts = { weekday: 'short', day: 'numeric', month: 'short' };
    document.getElementById('hfDate').textContent = now.toLocaleDateString('ca-ES', opts);
}

function renderQuote() {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    document.getElementById('hfQuote').textContent = '"' + q + '"';
}

/* ══════════════════════════════════════════════
   GRIDS D'EMOJI I COLOR
══════════════════════════════════════════════ */
function initEmojiColorGrids() {
    buildEmojiGrid('emojiGrid');
    buildColorGrid('colorGrid');
    buildEmojiGrid('editEmojiGrid');
    buildColorGrid('editColorGrid');
}

function buildEmojiGrid(containerId) {
    const eg = document.getElementById(containerId);
    if (!eg) return;
    EMOJIS.forEach((em, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'emoji-btn' + (i === 0 ? ' sel' : '');
        b.textContent = em;
        b.dataset.v = em;
        b.addEventListener('click', () => {
            document.querySelectorAll('#' + containerId + ' .emoji-btn').forEach(x => x.classList.remove('sel'));
            b.classList.add('sel');
        });
        eg.appendChild(b);
    });
}

function buildColorGrid(containerId) {
    const cg = document.getElementById(containerId);
    if (!cg) return;
    COLORS.forEach((col, i) => {
        const d = document.createElement('div');
        d.className = 'color-dot' + (i === 0 ? ' sel' : '');
        d.style.background = col;
        d.dataset.v = col;
        d.addEventListener('click', () => {
            document.querySelectorAll('#' + containerId + ' .color-dot').forEach(x => x.classList.remove('sel'));
            d.classList.add('sel');
        });
        cg.appendChild(d);
    });
}

/* ══════════════════════════════════════════════
   USER SELECT
══════════════════════════════════════════════ */
async function initUserSelect() {
    const grid = document.getElementById('userGrid');
    try {
        const res = await fetch(API + '/users');
        const users = await res.json();
        grid.innerHTML = '';
        users.forEach(u => {
            const card = document.createElement('div');
            card.className = 'user-card';
            const initials = u.nom.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
            card.innerHTML =
                '<div class="uc-avatar ' + (u.rol==='admin'?'admin':'') + '">' + initials + '</div>' +
                '<span class="uc-name">' + u.nom + '</span>' +
                (u.rol==='admin' ? '<span class="uc-badge">Admin</span>' : '');
            card.addEventListener('click', () => selectUser(u));
            grid.appendChild(card);
        });

        const lastId = localStorage.getItem(LAST_USER_KEY);
        if (lastId) {
            const found = users.find(u => String(u.id) === String(lastId));
            if (found) { selectUser(found); return; }
        }
    } catch (e) {
        grid.innerHTML = '<span style="color:#ef4444">Error carregant usuaris</span>';
    }
}

function selectUser(user) {
    currentUser = user;
    localStorage.setItem(LAST_USER_KEY, user.id);

    document.getElementById('userSelectScreen').classList.add('hidden');
    document.getElementById('hubName').textContent = user.nom;
    document.getElementById('hubRole').textContent = user.rol === 'admin' ? '👑 Admin' : '👤 Usuari';

    const initials = user.nom.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const avEl = document.getElementById('hubAvatar');
    avEl.textContent = initials;
    if (user.rol === 'admin') avEl.classList.add('admin');
    else avEl.classList.remove('admin');

    const sel = document.getElementById('notifyHourSel');
    if (user.notify_hour !== undefined && sel) sel.value = user.notify_hour;

    const btnAdmin = document.getElementById('btnAdmin');
    if (btnAdmin) btnAdmin.style.display = user.rol === 'admin' ? 'flex' : 'none';

    checkPushStatus();
    loadHabits();
}

function switchUser() {
    currentUser = null;
    allHabits = [];
    document.getElementById('userSelectScreen').classList.remove('hidden');
    initUserSelect();
}

/* ══════════════════════════════════════════════
   VIEWS
══════════════════════════════════════════════ */
function switchView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const idx = ['view-home','view-stats','view-profile'].indexOf(id);
    const navItems = document.querySelectorAll('.nav-item');
    if (navItems[idx]) navItems[idx].classList.add('active');
    if (id === 'view-stats') loadAllStats();
}

/* ══════════════════════════════════════════════
   LOAD & RENDER HABITS
══════════════════════════════════════════════ */
async function loadHabits() {
    if (!currentUser) return;
    showSkeleton();
    try {
        const res = await fetch(API + '/habits?user_id=' + currentUser.id);
        allHabits = await res.json();
        renderHabits(allHabits);
    } catch (e) {
        showToast('Error carregant habits');
        clearSkeleton();
    }
}

function showSkeleton() {
    const list = document.getElementById('habitsList');
    list.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const sk = document.createElement('div');
        sk.className = 'hf-skeleton';
        list.appendChild(sk);
    }
    document.getElementById('emptyState').style.display = 'none';
}

function clearSkeleton() {
    document.getElementById('habitsList').innerHTML = '';
}

function habitTocaAvui(h) {
    // frequencia: 'daily' = sempre toca, 'custom' = mirar dies
    if (!h.frequencia || h.frequencia === 'daily') return true;
    if (!h.dies) return true;
    const jsDay = new Date().getDay();
    const ourDay = jsDay === 0 ? 7 : jsDay; // 1=dl, 2=dt, ..., 7=dg
    return String(h.dies).includes(String(ourDay));
}

function renderHabits(habits) {
    const list = document.getElementById('habitsList');
    list.innerHTML = '';

    // Es mostren en l'ordre manual (ordre) perquè les fletxes ▲/▼ siguin coherents.
    // Els completats es marquen al lloc, no salten al final.
    const sorted = habits;

    const empty = document.getElementById('emptyState');
    if (!sorted.length) {
        empty.style.display = 'block';
        updateProgress(0, 0, false);
        return;
    }
    empty.style.display = 'none';

    // Progrés: només hàbits que toquen avui
    const tocaAvuiList = habits.filter(h => habitTocaAvui(h));
    const total = tocaAvuiList.length;
    const done = tocaAvuiList.filter(h => h.completat_avui).length;
    updateProgress(done, total, tocaAvuiList.length === 0);

    sorted.forEach(h => {
        const tocaAvui = habitTocaAvui(h);
        const wrap = document.createElement('div');
        wrap.className = 'hf-card-wrap';
        wrap.id = 'wrap-' + h.id;

        const card = document.createElement('div');
        card.className = 'hf-card' + (h.completat_avui ? ' done' : '') + (!tocaAvui ? ' no-toca' : '');
        card.style.setProperty('--hc', h.color || '#8b5cf6');
        card.dataset.id = h.id;

        if (tocaAvui) {
            card.addEventListener('click', function(e) {
                if (e.target.closest('.hf-card-actions')) return;
                toggleHabit(h.id);
            });
        }

        const descHtml = h.descripcio ? '<div class="hf-desc">' + escHtml(h.descripcio) + '</div>' : '';
        const badgeHtml = !tocaAvui ? '<span class="hf-badge-no-toca">Avui no toca</span>' : '';
        const streakTxt = h.streak > 0 ? '<span class="hf-fire">🔥 ' + h.streak + '</span>' : '';

        card.innerHTML =
            '<div class="hf-check" id="check-' + h.id + '">' +
                '<span class="hf-check-tick">✓</span>' +
                '<span class="hf-check-empty">' + (h.icona || '⭐') + '</span>' +
            '</div>' +
            '<div class="hf-info">' +
                '<div class="hf-nom">' + escHtml(h.nom) + badgeHtml + '</div>' +
                descHtml +
                '<div class="hf-streak-row">' + streakTxt + '</div>' +
            '</div>' +
            '<div class="hf-card-actions" onclick="event.stopPropagation()">' +
                '<button class="btn-up-habit" title="Moure amunt" onclick="moveHabit(event,' + h.id + ',\'up\')">▲</button>' +
                '<button class="btn-down-habit" title="Moure avall" onclick="moveHabit(event,' + h.id + ',\'down\')">▼</button>' +
                '<button class="btn-hist-habit" title="Historial" onclick="toggleHistory(event,' + h.id + ')">📅</button>' +
                '<button class="btn-edit-habit" title="Editar" onclick="openEditModal(' + h.id + ')">✏️</button>' +
                '<button class="btn-del-habit" title="Eliminar" onclick="deleteHabit(' + h.id + ')">🗑</button>' +
            '</div>';

        const hist = document.createElement('div');
        hist.className = 'hf-hist';
        hist.id = 'hist-' + h.id;
        hist.innerHTML = '<div class="hf-hist-dots" id="hdots-' + h.id + '">...</div>';

        wrap.appendChild(card);
        wrap.appendChild(hist);
        list.appendChild(wrap);
    });
}

function updateProgress(done, total, allRestDay) {
    if (allRestDay) {
        document.getElementById('progressFill').style.width = '100%';
        document.getElementById('progressFill').style.background = 'linear-gradient(90deg,#475569,#64748b)';
        document.getElementById('progressPct').textContent = '—';
        document.getElementById('progressLabel').textContent = '😌 Avui és dia de descans per tots els hàbits';
        return;
    }
    document.getElementById('progressFill').style.background = '';
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressPct').textContent = pct + '%';
    document.getElementById('progressLabel').textContent = getProgressMessage(done, total);
}

function getProgressMessage(done, total) {
    if (total === 0) return "Afegeix el teu primer habit!";
    if (done === 0) return '🌅 Comença el dia amb energia!';
    if (done === total) return '🏆 Perfecte! ' + done + '/' + total + ' completats';
    if (done / total >= 0.8) return '💪 Quasi! ' + done + '/' + total + ' completats';
    if (done / total >= 0.5) return '🚀 Bon ritme! ' + done + '/' + total + ' completats';
    return '⚡ Endavant! ' + done + '/' + total + ' completats';
}

/* ══════════════════════════════════════════════
   TOGGLE HABIT
══════════════════════════════════════════════ */
async function toggleHabit(id) {
    const h = allHabits.find(x => x.id === id);
    if (!h) return;

    const checkEl = document.getElementById('check-' + id);
    if (checkEl) { checkEl.classList.add('pop'); setTimeout(function(){ checkEl.classList.remove('pop'); }, 300); }

    try {
        const res = await fetch(API + '/habits/' + id + '/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id }),
        });
        const data = await res.json();
        h.completat_avui = data.completat;
        h.streak = data.streak;

        renderHabits(allHabits);

        const MILESTONES = [7, 30, 100, 365];
        const tocaAvuiList = allHabits.filter(x => habitTocaAvui(x));
        const allDone = tocaAvuiList.length > 0 && tocaAvuiList.every(x => x.completat_avui);

        if (h.completat_avui && MILESTONES.indexOf(h.streak) !== -1) {
            celebrateMilestone(h, h.streak);
        } else if (allDone && h.completat_avui) {
            launchConfetti(h.color || '#8b5cf6');
        }
    } catch (e) {
        showToast('Error actualitzant habit');
    }
}

/* ══════════════════════════════════════════════
   CELEBRACIÓ DE FITES (dins l'app)
══════════════════════════════════════════════ */
function celebrateMilestone(habit, streak) {
    const msgs = {
        7: 'Una setmana sencera! 🔥',
        30: 'Un mes complet! Imparable 💪',
        100: '100 dies! Ets una llegenda 👑',
        365: 'UN ANY SENCER! Increïble 🌍'
    };
    document.getElementById('milestoneStreak').textContent = streak;
    document.getElementById('milestoneHabit').textContent = (habit.icona || '') + ' ' + habit.nom;
    document.getElementById('milestoneMsg').textContent = msgs[streak] || 'Constància de ferro!';
    document.getElementById('milestoneOverlay').classList.add('show');

    launchConfetti(habit.color || '#8b5cf6');
    setTimeout(function(){ launchConfetti('#f59e0b'); }, 450);

    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

function closeMilestone() {
    document.getElementById('milestoneOverlay').classList.remove('show');
}

/* ══════════════════════════════════════════════
   CONFETTI
══════════════════════════════════════════════ */
function launchConfetti(mainColor) {
    const canvas = document.getElementById('confettiCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';

    const particles = [];
    const colors = [mainColor, '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#fff'];
    for (let i = 0; i < 120; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: -10 - Math.random() * 100,
            r: 4 + Math.random() * 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            vx: (Math.random() - 0.5) * 4,
            vy: 2 + Math.random() * 4,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.2,
        });
    }

    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(function(p) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.8);
            ctx.restore();
            p.x += p.vx; p.y += p.vy; p.angle += p.spin; p.vy += 0.08;
        });
        frame++;
        if (frame < 120) requestAnimationFrame(draw);
        else { canvas.style.display = 'none'; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }
    draw();
}

/* ══════════════════════════════════════════════
   HISTORIAL PER HABIT
══════════════════════════════════════════════ */
async function toggleHistory(e, habitId) {
    e.stopPropagation();
    const histEl = document.getElementById('hist-' + habitId);
    if (!histEl) return;

    if (openHistoryId === habitId) {
        histEl.classList.remove('open');
        openHistoryId = null;
        return;
    }
    if (openHistoryId) {
        const prev = document.getElementById('hist-' + openHistoryId);
        if (prev) prev.classList.remove('open');
    }
    openHistoryId = habitId;
    histEl.classList.add('open');

    const dotsEl = document.getElementById('hdots-' + habitId);
    dotsEl.innerHTML = '<span style="color:var(--text-secondary);font-size:0.8rem">Carregant...</span>';

    try {
        const res = await fetch(API + '/habits/' + habitId + '/history?days=14');
        const data = await res.json();
        const hObj = allHabits.find(function(h){ return h.id === habitId; });
        renderHistoryDots(dotsEl, data, hObj ? hObj.color : '#8b5cf6');
    } catch {
        dotsEl.innerHTML = '<span style="color:#ef4444;font-size:0.75rem">Error carregant historial</span>';
    }
}

function renderHistoryDots(container, data, color) {
    container.innerHTML = '';
    const days = ['Dg','Dl','Dt','Dc','Dj','Dv','Ds'];
    data.forEach(function(entry) {
        const d = new Date(entry.date + 'T12:00:00');
        const col = document.createElement('div');
        col.className = 'hf-hist-day';
        const dot = document.createElement('div');
        dot.className = 'hf-hist-dot';
        dot.style.background = entry.completed ? color : 'rgba(255,255,255,0.08)';
        dot.title = entry.date + (entry.completed ? ' ✓' : ' ✗');
        const lbl = document.createElement('div');
        lbl.className = 'hf-hist-dot-lbl';
        lbl.textContent = days[d.getDay()];
        col.appendChild(dot);
        col.appendChild(lbl);
        container.appendChild(col);
    });
}

/* ══════════════════════════════════════════════
   REORDENAR HABITS
══════════════════════════════════════════════ */
async function moveHabit(e, id, direction) {
    e.stopPropagation();
    const idx = allHabits.findIndex(function(h){ return h.id === id; });
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= allHabits.length) return;

    const myOrdre = allHabits[idx].ordre !== undefined ? allHabits[idx].ordre : idx;
    const theirOrdre = allHabits[swapIdx].ordre !== undefined ? allHabits[swapIdx].ordre : swapIdx;

    try {
        await Promise.all([
            fetch(API + '/habits/' + id + '/ordre', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ordre: theirOrdre }),
            }),
            fetch(API + '/habits/' + allHabits[swapIdx].id + '/ordre', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ordre: myOrdre }),
            }),
        ]);
        allHabits[idx].ordre = theirOrdre;
        allHabits[swapIdx].ordre = myOrdre;
        allHabits.sort(function(a, b){ return (a.ordre || 0) - (b.ordre || 0); });
        renderHabits(allHabits);
    } catch {
        showToast('Error reordenant');
    }
}

/* ══════════════════════════════════════════════
   SOFT DELETE AMB UNDO
══════════════════════════════════════════════ */
function deleteHabit(id) {
    const h = allHabits.find(function(x){ return x.id === id; });
    if (!h) return;

    if (pendingDelete) {
        commitDelete(pendingDelete.habit.id);
        clearTimeout(pendingDelete.timer);
    }

    const wrap = document.getElementById('wrap-' + id);
    if (wrap) wrap.style.display = 'none';

    const timer = setTimeout(function() {
        commitDelete(id);
        pendingDelete = null;
    }, 5000);

    pendingDelete = { habit: h, timer: timer };
    showToast('🗑 "' + h.nom + '" eliminat', true);
}

function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    const wrap = document.getElementById('wrap-' + pendingDelete.habit.id);
    if (wrap) wrap.style.display = '';
    pendingDelete = null;
    hideToast();
}

async function commitDelete(id) {
    try {
        await fetch(API + '/habits/' + id, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id }),
        });
        allHabits = allHabits.filter(function(h){ return h.id !== id; });
        renderHabits(allHabits);
    } catch {
        showToast('Error eliminant habit');
    }
}

/* ══════════════════════════════════════════════
   FORM CONTROLS
══════════════════════════════════════════════ */
var addFreq = 'daily';
var editFreq = 'daily';
var editingHabitId = null;

function toggleAddForm() {
    const form = document.getElementById('addForm');
    const toggle = document.getElementById('addToggle');
    const isOpen = form.classList.contains('open');
    form.classList.toggle('open', !isOpen);
    toggle.style.display = isOpen ? '' : 'none';
}

function closeAddForm() {
    document.getElementById('addForm').classList.remove('open');
    document.getElementById('addToggle').style.display = '';
}

function setFreq(f) {
    addFreq = f;
    document.getElementById('freqDaily').classList.toggle('active', f === 'daily');
    document.getElementById('freqCustom').classList.toggle('active', f === 'custom');
    document.getElementById('diesSelector').style.display = f === 'custom' ? 'block' : 'none';
}

function setEditFreq(f) {
    editFreq = f;
    document.getElementById('editFreqDaily').classList.toggle('active', f === 'daily');
    document.getElementById('editFreqCustom').classList.toggle('active', f === 'custom');
    document.getElementById('editDiesSelector').style.display = f === 'custom' ? 'block' : 'none';
}

function toggleEditDie(btn) {
    btn.classList.toggle('active');
}

function getSelectedDies(containerSelector) {
    // Format: digits concatenated "135" = dilluns, dimecres, divendres
    const active = document.querySelectorAll(containerSelector + ' .hf-die-btn.active');
    return Array.from(active).map(function(b){ return b.dataset.d; }).sort().join('');
}

/* ══════════════════════════════════════════════
   CREATE HABIT
══════════════════════════════════════════════ */
async function createHabit() {
    const nom = document.getElementById('inputNom').value.trim();
    if (!nom) { showToast("Cal un nom per l'habit"); return; }

    const icona = (document.querySelector('#emojiGrid .emoji-btn.sel') || {}).dataset.v || '⭐';
    const color = (document.querySelector('#colorGrid .color-dot.sel') || {}).dataset.v || '#8b5cf6';
    const desc = document.getElementById('inputDesc').value.trim();
    const frequencia = addFreq === 'custom' ? 'custom' : 'daily';
    const dies = addFreq === 'custom' ? (getSelectedDies('#diesSelector') || '1234567') : '1234567';

    try {
        await fetch(API + '/habits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom: nom, icona: icona, color: color, descripcio: desc, frequencia: frequencia, dies: dies, user_id: currentUser.id }),
        });
        document.getElementById('inputNom').value = '';
        document.getElementById('inputDesc').value = '';
        closeAddForm();
        showToast('✅ Habit creat!');
        loadHabits();
    } catch {
        showToast('Error creant habit');
    }
}

/* ══════════════════════════════════════════════
   EDIT HABIT MODAL
══════════════════════════════════════════════ */
function openEditModal(id) {
    const h = allHabits.find(function(x){ return x.id === id; });
    if (!h) return;
    editingHabitId = id;

    document.getElementById('editInputNom').value = h.nom;
    document.getElementById('editInputDesc').value = h.descripcio || '';

    document.querySelectorAll('#editEmojiGrid .emoji-btn').forEach(function(b){
        b.classList.toggle('sel', b.dataset.v === h.icona);
    });
    document.querySelectorAll('#editColorGrid .color-dot').forEach(function(d){
        d.classList.toggle('sel', d.dataset.v === h.color);
    });

    editFreq = h.frequencia === 'custom' ? 'custom' : 'daily';
    setEditFreq(editFreq);
    if (editFreq === 'custom') {
        const diesStr = String(h.dies || '1234567');
        document.querySelectorAll('#editDiesSelector .hf-die-btn').forEach(function(b){
            b.classList.toggle('active', diesStr.includes(b.dataset.d));
        });
    }

    document.getElementById('editHabitModal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('editHabitModal').classList.remove('active');
    editingHabitId = null;
}

async function saveEditHabit() {
    if (!editingHabitId) return;
    const nom = document.getElementById('editInputNom').value.trim();
    if (!nom) { showToast('Cal un nom'); return; }

    const icona = (document.querySelector('#editEmojiGrid .emoji-btn.sel') || {}).dataset.v || '⭐';
    const color = (document.querySelector('#editColorGrid .color-dot.sel') || {}).dataset.v || '#8b5cf6';
    const desc = document.getElementById('editInputDesc').value.trim();
    const frequencia = editFreq === 'custom' ? 'custom' : 'daily';
    const dies = editFreq === 'custom' ? (getSelectedDies('#editDiesSelector') || '1234567') : '1234567';

    try {
        await fetch(API + '/habits/' + editingHabitId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom: nom, icona: icona, color: color, descripcio: desc, frequencia: frequencia, dies: dies, user_id: currentUser.id }),
        });
        closeEditModal();
        showToast('✅ Habit actualitzat!');
        loadHabits();
    } catch {
        showToast('Error guardant canvis');
    }
}

/* ══════════════════════════════════════════════
   HORA NOTIFICACIO + DESAR CONFIGURACIÓ
══════════════════════════════════════════════ */
async function updateNotifyHour() {
    if (!currentUser) return;
    const hour = parseInt(document.getElementById('notifyHourSel').value, 10);
    try {
        await fetch(API + '/users/' + currentUser.id + '/notify', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notify_hour: hour }),
        });
        currentUser.notify_hour = hour;
    } catch {}
}

async function saveProfileSettings() {
    if (!currentUser) return;
    const btn = document.querySelector('[onclick="saveProfileSettings()"]');
    const wantsPush = document.getElementById('pushToggle').checked;

    // iOS: si cal demanar permís, fer-ho ABANS de cap altre await (primer gest)
    if (wantsPush && pushSupported() && Notification.permission === 'default') {
        let p;
        try { p = await Notification.requestPermission(); }
        catch (e) { p = await new Promise(function(res){ Notification.requestPermission(res); }); }
        if (p !== 'granted') {
            document.getElementById('pushToggle').checked = false;
            localStorage.removeItem(pushPrefKey());
        }
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Desant...'; }
    try {
        // 1. Desar hora notificació
        await updateNotifyHour();

        // 2. Gestionar push
        const finalWantsPush = document.getElementById('pushToggle').checked;
        if (finalWantsPush) {
            if (!pushSupported()) {
                showToast('Hora desada. Push no suportat en aquest navegador.');
                return;
            }
            if (Notification.permission !== 'granted') {
                showToast('Hora desada. Permís de notificació no concedit.');
                return;
            }
            await registerSubscription();
        } else {
            await unsubscribePush();
        }

        showToast('✅ Configuració desada!');
    } catch (e) {
        console.error(e);
        showToast(e.message === 'SW_TIMEOUT'
            ? 'Hora desada, però el SW no respon. Tanca i reobre l\'app.'
            : 'Error desant: ' + (e.message || 'desconegut'));
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '💾 Desar configuració'; }
    }
}

/* ══════════════════════════════════════════════
   ADMIN MODAL
══════════════════════════════════════════════ */
var adminUnlocked = false;
var adminPassword = '';

function adminHeaders() {
    return { 'Content-Type': 'application/json', 'X-Admin-Password': adminPassword };
}

function openAdminModal() {
    if (!adminUnlocked) {
        document.getElementById('admPwdSection').style.display = '';
        document.getElementById('admPanelSection').style.display = 'none';
        document.getElementById('adminPwdInput').value = '';
    }
    document.getElementById('adminModal').classList.add('active');
    setTimeout(function(){ var el = document.getElementById('adminPwdInput'); if(el) el.focus(); }, 100);
}

function closeAdminModal() {
    document.getElementById('adminModal').classList.remove('active');
}

async function verifyAdminPwd() {
    const pwd = document.getElementById('adminPwdInput').value;
    try {
        const res = await fetch(API + '/auth/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error();
        adminUnlocked = true;
        adminPassword = pwd;
        document.getElementById('admPwdSection').style.display = 'none';
        document.getElementById('admPanelSection').style.display = 'flex';
        loadAdminUsers();
    } catch {
        showToast('Contrasenya incorrecta');
        document.getElementById('adminPwdInput').value = '';
    }
}

async function loadAdminUsers() {
    const list = document.getElementById('admUsersList');
    list.innerHTML = '<span class="us-loading">Carregant...</span>';
    try {
        const res = await fetch(API + '/users');
        const users = await res.json();
        list.innerHTML = '';
        users.forEach(function(u) {
            const initials = u.nom.split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
            const row = document.createElement('div');
            const isMe = u.id === (currentUser && currentUser.id);
            row.innerHTML =
                '<div class="adm-user-row" id="aur-' + u.id + '">' +
                    '<div class="aur-av ' + (u.rol==='admin'?'admin':'') + '">' + initials + '</div>' +
                    '<span class="aur-name">' + escHtml(u.nom) + '</span>' +
                    (u.rol==='admin' ? '<span class="aur-role">Admin</span>' : '') +
                    '<button class="btn-edit-user" onclick="toggleUserEditForm(' + u.id + ')" title="Editar">✏️</button>' +
                    '<button class="btn-del-user" ' + (isMe ? 'disabled' : '') + ' onclick="adminDeleteUser(' + u.id + ')" title="Eliminar">🗑</button>' +
                '</div>' +
                '<div class="aur-edit-form" id="aurForm-' + u.id + '">' +
                    '<div class="aur-edit-row">' +
                        '<input type="text" class="hf-input" id="aurNom-' + u.id + '" value="' + escHtml(u.nom) + '" placeholder="Nom">' +
                        '<select class="aur-role-sel" id="aurRol-' + u.id + '">' +
                            '<option value="user"' + (u.rol!=='admin'?' selected':'') + '>User</option>' +
                            '<option value="admin"' + (u.rol==='admin'?' selected':'') + '>Admin</option>' +
                        '</select>' +
                        '<button class="btn-primary" style="width:auto;padding:6px 12px;font-size:0.82rem" onclick="adminSaveUser(' + u.id + ')">Desar</button>' +
                    '</div>' +
                '</div>';
            list.appendChild(row);
        });
    } catch {
        list.innerHTML = '<span style="color:#ef4444">Error carregant usuaris</span>';
    }
}

function toggleUserEditForm(id) {
    const form = document.getElementById('aurForm-' + id);
    if (form) form.classList.toggle('open');
}

async function adminSaveUser(id) {
    const nomEl = document.getElementById('aurNom-' + id);
    const rolEl = document.getElementById('aurRol-' + id);
    if (!nomEl) return;
    const nom = nomEl.value.trim();
    const rol = rolEl ? rolEl.value : 'user';
    if (!nom) return;
    try {
        await fetch(API + '/users/' + id, {
            method: 'PUT',
            headers: adminHeaders(),
            body: JSON.stringify({ nom: nom, rol: rol }),
        });
        showToast('✅ Usuari actualitzat');
        loadAdminUsers();
    } catch {
        showToast('Error actualitzant usuari');
    }
}

async function adminCreateUser() {
    const nom = document.getElementById('newUserNom').value.trim();
    if (!nom) return;
    try {
        await fetch(API + '/users', {
            method: 'POST',
            headers: adminHeaders(),
            body: JSON.stringify({ nom: nom }),
        });
        document.getElementById('newUserNom').value = '';
        showToast('✅ Usuari creat!');
        loadAdminUsers();
    } catch {
        showToast('Error creant usuari');
    }
}

async function adminDeleteUser(id) {
    if (!confirm('Eliminar aquest usuari i tots els seus habits?')) return;
    try {
        await fetch(API + '/users/' + id, { method: 'DELETE', headers: adminHeaders() });
        showToast('Usuari eliminat');
        loadAdminUsers();
    } catch {
        showToast('Error eliminant usuari');
    }
}

/* ══════════════════════════════════════════════
   ESTADISTIQUES
══════════════════════════════════════════════ */
async function loadAllStats() {
    if (!currentUser) return;
    try {
        const res = await fetch(API + '/stats/overview?user_id=' + currentUser.id);
        const s = await res.json();
        renderStatsOverview(s);
        render7DayChart(s.last7days || []);
        renderInsights(s);
        renderHeatmap(s.heatmap || []);
        renderWeekTrend(s);
    } catch (e) {
        console.error('Error stats', e);
    }
}

function renderStatsOverview(s) {
    function fmt(done, total) { return total > 0 ? Math.round((done/total)*100) + '%' : '—'; }

    var day = s.day || {}; var week = s.week || {}; var month = s.month || {}; var year = s.year || {};

    document.getElementById('overviewDayPct').textContent = fmt(day.done, day.total);
    document.getElementById('overviewDayText').textContent = (day.done||0) + ' de ' + (day.total||0);

    document.getElementById('overviewWeekPct').textContent = fmt(week.done, week.total);
    document.getElementById('overviewWeekText').textContent = (week.done||0) + ' de ' + (week.total||0);

    document.getElementById('overviewMonthPct').textContent = fmt(month.done, month.total);
    document.getElementById('overviewMonthText').textContent = (month.done||0) + ' de ' + (month.total||0);

    document.getElementById('overviewYearPct').textContent = fmt(year.done, year.total);
    document.getElementById('overviewYearText').textContent = (year.done||0) + ' de ' + (year.total||0);

    var streaks = s.streaks || {};
    var vals = Object.values(streaks).map(Number);
    var streak = vals.length > 0 ? Math.max.apply(null, vals) : 0;
    document.getElementById('overviewStreak').textContent = streak > 0 ? streak + ' dies 🔥' : '—';
}

function renderWeekTrend(s) {
    const el = document.getElementById('weekTrend');
    if (!el) return;
    const last7 = s.last7days || [];
    if (last7.length < 4) { el.innerHTML = ''; return; }

    const mid = Math.floor(last7.length / 2);
    var recentDone = 0, recentTotal = 0, prevDone = 0, prevTotal = 0;
    last7.slice(mid).forEach(function(d){ recentDone += d.done||0; recentTotal += d.total||0; });
    last7.slice(0, mid).forEach(function(d){ prevDone += d.done||0; prevTotal += d.total||0; });

    const recentPct = recentTotal > 0 ? recentDone / recentTotal : 0;
    const prevPct = prevTotal > 0 ? prevDone / prevTotal : 0;
    const diff = Math.round((recentPct - prevPct) * 100);

    var cls = 'neutral', arrow = '→', txt = 'Igual que abans';
    if (diff > 0) { cls='up'; arrow='↑'; txt='+' + diff + '% vs setmana anterior'; }
    else if (diff < 0) { cls='down'; arrow='↓'; txt=diff + '% vs setmana anterior'; }

    el.innerHTML = '<span class="hf-trend ' + cls + '">' + arrow + ' ' + txt + '</span>';
}

function render7DayChart(days) {
    const chart = document.getElementById('weekBarChart');
    if (!chart || !days.length) return;
    chart.innerHTML = '';

    const pcts = days.map(function(d){ return d.total > 0 ? (d.done/d.total)*100 : 0; });
    const maxPct = Math.max.apply(null, [1].concat(pcts));
    const dayNames = ['Dg','Dl','Dt','Dc','Dj','Dv','Ds'];
    const todayStr = ymdLocal(new Date());

    days.forEach(function(d) {
        const pct = d.total > 0 ? (d.done / d.total) * 100 : 0;
        const barH = Math.max(4, (pct / maxPct) * 68);
        const dateObj = new Date(d.date + 'T12:00:00');
        const isToday = d.date === todayStr;

        const col = document.createElement('div');
        col.className = 'hf-bar-col';
        col.innerHTML =
            '<div class="hf-bar-pct">' + (pct > 0 ? Math.round(pct) + '%' : '') + '</div>' +
            '<div class="hf-bar" title="' + d.date + ': ' + d.done + '/' + d.total + '" style="height:' + barH + 'px;background:' +
                (isToday ? 'linear-gradient(135deg,#8b5cf6,#06b6d4)' : 'rgba(139,92,246,0.35)') + '"></div>' +
            '<div class="hf-bar-lbl">' + dayNames[dateObj.getDay()] + '</div>';
        chart.appendChild(col);
    });
}

function renderInsights(s) {
    const container = document.getElementById('habitInsights');
    if (!container) return;
    container.innerHTML = '';

    const streaks = s.streaks || {};
    const keys = Object.keys(streaks);
    if (!keys.length) return;

    const entries = keys.map(function(k){ return [k, Number(streaks[k])]; });
    entries.sort(function(a,b){ return b[1]-a[1]; });

    const best = entries[0];
    const worst = entries[entries.length-1];

    if (best) {
        const h = allHabits.find(function(x){ return String(x.id) === String(best[0]); });
        if (h) container.innerHTML +=
            '<div class="hf-insight-row best">' +
                '<span class="hf-insight-icon">⭐</span>' +
                '<div class="hf-insight-info">' +
                    '<div class="hf-insight-label">Millor habit</div>' +
                    '<div class="hf-insight-name">' + (h.icona||'') + ' ' + escHtml(h.nom) + ' — ' + best[1] + ' dies de ratxa</div>' +
                '</div>' +
            '</div>';
    }
    if (worst && worst[0] !== best[0]) {
        const h = allHabits.find(function(x){ return String(x.id) === String(worst[0]); });
        if (h) container.innerHTML +=
            '<div class="hf-insight-row worst">' +
                '<span class="hf-insight-icon">💡</span>' +
                '<div class="hf-insight-info">' +
                    '<div class="hf-insight-label">Millora oportunitat</div>' +
                    '<div class="hf-insight-name">' + (h.icona||'') + ' ' + escHtml(h.nom) + ' — ' + worst[1] + ' dies de ratxa</div>' +
                '</div>' +
            '</div>';
    }
}

function renderHeatmap(heatmap) {
    const container = document.getElementById('overviewYearChart');
    if (!container) return;
    if (!heatmap.length) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85rem">No hi ha dades suficients per al mapa anual</span>';
        return;
    }

    const byDate = {};
    heatmap.forEach(function(d){ byDate[d.date] = d.pct || 0; });

    const now = new Date();
    const yearAgo = new Date(now);
    yearAgo.setFullYear(now.getFullYear()-1);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;gap:3px;overflow-x:auto;padding-bottom:4px';

    const cur = new Date(yearAgo);
    cur.setDate(cur.getDate() - cur.getDay());

    while (cur <= now) {
        const weekCol = document.createElement('div');
        weekCol.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex-shrink:0';
        for (var dd = 0; dd < 7; dd++) {
            const dateStr = ymdLocal(cur);
            const pct = byDate[dateStr] !== undefined ? byDate[dateStr] : -1;
            const cell = document.createElement('div');
            cell.style.cssText = 'width:11px;height:11px;border-radius:2px;cursor:default';
            cell.title = dateStr + (pct >= 0 ? ' (' + Math.round(pct) + '%)' : '');
            if (pct < 0 || cur > now) cell.style.background = 'transparent';
            else if (pct === 0) cell.style.background = 'rgba(255,255,255,0.06)';
            else if (pct < 50) cell.style.background = 'rgba(139,92,246,0.25)';
            else if (pct < 80) cell.style.background = 'rgba(139,92,246,0.55)';
            else cell.style.background = '#8b5cf6';
            weekCol.appendChild(cell);
            cur.setDate(cur.getDate()+1);
        }
        grid.appendChild(weekCol);
    }

    container.innerHTML = '<div style="font-size:0.75rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Mapa anual d\'activitat</div>';
    container.appendChild(grid);
}

/* ══════════════════════════════════════════════
   PUSH NOTIFICATIONS
══════════════════════════════════════════════ */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

function pushPrefKey() {
    return currentUser ? 'hf_push_' + currentUser.id : null;
}

function pushSupported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

// navigator.serviceWorker.ready amb timeout perquè mai es quedi penjat
function swReady(timeoutMs) {
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise(function(_, rej) {
            setTimeout(function(){ rej(new Error('SW_TIMEOUT')); }, timeoutMs || 8000);
        })
    ]);
}

async function checkPushStatus() {
    if (!pushSupported()) return;
    try {
        const reg = await swReady(6000);
        const sub = await reg.pushManager.getSubscription();
        const wantsPush = localStorage.getItem(pushPrefKey()) === 'on';

        if (sub) {
            document.getElementById('pushToggle').checked = true;
        } else if (wantsPush && Notification.permission === 'granted') {
            // L'usuari volia notificacions i ja té permís → re-subscriure silenciosament
            await subscribePushSilent();
        } else {
            document.getElementById('pushToggle').checked = false;
        }
    } catch (e) {
        // Si el SW no està llest, deixem el toggle reflectint la preferència guardada
        document.getElementById('pushToggle').checked =
            localStorage.getItem(pushPrefKey()) === 'on' && Notification.permission === 'granted';
    }
}

async function togglePushNotifications() {
    const enabled = document.getElementById('pushToggle').checked;
    if (enabled) await subscribePush();
    else await unsubscribePush();
}

// IMPORTANT iOS: subscribePush() ha de demanar el permís com a PRIMERA acció,
// abans de qualsevol await, o iOS no mostra el diàleg de permís.
async function subscribePush() {
    if (!pushSupported()) {
        showToast('Aquest navegador no suporta push. A iPhone has d\'instal·lar l\'app a la pantalla d\'inici.');
        document.getElementById('pushToggle').checked = false;
        return;
    }

    // 1) PERMÍS PRIMER (dins del gest de l'usuari, sense awaits previs)
    let permission = Notification.permission;
    if (permission === 'default') {
        try {
            permission = await Notification.requestPermission();
        } catch (e) {
            // Safari antic amb callback
            permission = await new Promise(function(res){ Notification.requestPermission(res); });
        }
    }
    if (permission !== 'granted') {
        showToast(permission === 'denied'
            ? 'Permís bloquejat. Activa\'l a Ajustos del telèfon.'
            : 'No s\'ha concedit el permís');
        document.getElementById('pushToggle').checked = false;
        localStorage.removeItem(pushPrefKey());
        return;
    }

    // 2) Ara ja podem fer els awaits
    try {
        const ok = await registerSubscription();
        document.getElementById('pushToggle').checked = ok;
        if (ok) showToast('🔔 Notificacions activades!');
    } catch (e) {
        console.error(e);
        showToast(e.message === 'SW_TIMEOUT'
            ? 'El service worker no respon. Tanca i reobre l\'app.'
            : 'Error activant notificacions: ' + (e.message || 'desconegut'));
        document.getElementById('pushToggle').checked = false;
    }
}

// Crea la subscripció i la desa al backend (assumeix permís ja concedit)
async function registerSubscription() {
    if (!VAPID_PUBLIC_KEY) {
        await initPushKey();
        if (!VAPID_PUBLIC_KEY) throw new Error('Sense clau VAPID');
    }
    const reg = await swReady(8000);

    // Reutilitza la subscripció existent si en té (evita duplicats a la BD).
    // Només en crea una de nova si no n'hi ha cap.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
    }
    const res = await fetch(API + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUser.id, subscription: sub }),
    });
    if (!res.ok) throw new Error('El servidor no ha desat la subscripció');
    localStorage.setItem(pushPrefKey(), 'on');
    return true;
}

async function subscribePushSilent() {
    try {
        if (Notification.permission !== 'granted') {
            document.getElementById('pushToggle').checked = false;
            return;
        }
        const ok = await registerSubscription();
        document.getElementById('pushToggle').checked = ok;
    } catch (e) {
        document.getElementById('pushToggle').checked = false;
    }
}

async function sendTestPush() {
    if (!currentUser) return;
    const btn = document.getElementById('btnTestPush');

    if (!pushSupported()) {
        showToast('A iPhone: instal·la l\'app a la pantalla d\'inici primer.');
        return;
    }
    if (Notification.permission !== 'granted') {
        showToast('Activa primer el permís de notificacions.');
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Enviant...'; }
    try {
        // Assegura que hi ha subscripció activa i desada
        await registerSubscription();

        const res = await fetch(API + '/push/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id }),
        });
        const data = await res.json();
        if (data.ok) showToast('📨 Enviada! Hauria d\'arribar en uns segons');
        else if (data.error === 'no_subscription') showToast('No hi ha subscripció guardada.');
        else showToast('No s\'ha pogut enviar (subscripció caducada)');
    } catch (e) {
        showToast(e.message === 'SW_TIMEOUT'
            ? 'El service worker no respon. Tanca i reobre l\'app.'
            : 'Error: ' + (e.message || 'prova fallida'));
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '🔔 Provar notificació ara'; }
    }
}

async function unsubscribePush() {
    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await fetch(API + '/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.id, endpoint: sub.endpoint }),
            });
            await sub.unsubscribe();
        }
        localStorage.removeItem(pushPrefKey());
        showToast('Notificacions desactivades');
    } catch {
        showToast('Error desactivant notificacions');
    }
}

/* ══════════════════════════════════════════════
   PULL TO REFRESH
══════════════════════════════════════════════ */
function initPullToRefresh() {
    var startY = 0;
    var pulling = false;
    const indicator = document.getElementById('pullIndicator');
    const THRESHOLD = 80;

    document.addEventListener('touchstart', function(e) {
        if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true; }
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        if (!pulling) return;
        if (e.touches[0].clientY - startY > 20) indicator.classList.add('visible');
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
        if (!pulling) return;
        pulling = false;
        const dy = e.changedTouches[0].clientY - startY;
        indicator.classList.remove('visible');
        if (dy > THRESHOLD) { showToast('Actualitzant...'); loadHabits(); }
    });
}

/* ══════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════ */
function showToast(msg, withUndo) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    if (toastTimer) clearTimeout(toastTimer);

    toastMsg.textContent = msg;
    const old = toast.querySelector('.toast-undo-btn');
    if (old) old.remove();

    if (withUndo) {
        const btn = document.createElement('button');
        btn.className = 'toast-undo-btn';
        btn.textContent = 'Desfe\'s';
        btn.onclick = undoDelete;
        toast.appendChild(btn);
    }

    toast.classList.add('show');
    toastTimer = setTimeout(hideToast, withUndo ? 5000 : 2500);
}

function hideToast() {
    document.getElementById('toast').classList.remove('show');
    const btn = document.getElementById('toast').querySelector('.toast-undo-btn');
    if (btn) btn.remove();
}

/* ══════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════ */
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Data LOCAL en format YYYY-MM-DD (no UTC com toISOString)
function ymdLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}
