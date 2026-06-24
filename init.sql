-- Inicialització de la base de dades HabitForge

USE habitforge;

-- ── Taula d'usuaris ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    nom        VARCHAR(120) NOT NULL,
    rol        ENUM('user','admin') DEFAULT 'user',
    creat_el   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Taula d'hàbits ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS habits (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT          NOT NULL,
    nom         VARCHAR(120) NOT NULL,
    descripcio  VARCHAR(255) DEFAULT '',
    icona       VARCHAR(10)  DEFAULT '⭐',
    color       VARCHAR(20)  DEFAULT '#8b5cf6',
    -- Freqüència: daily=cada dia, custom=dies concrets de la setmana
    frequencia  ENUM('daily','custom') DEFAULT 'daily',
    -- Dies de la setmana actius: '1234567' = tots (1=Dilluns..7=Diumenge)
    dies        VARCHAR(7)   DEFAULT '1234567',
    creat_el    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Taula de registres diaris ────────────────────────────────────
CREATE TABLE IF NOT EXISTS registres (
    id       INT  AUTO_INCREMENT PRIMARY KEY,
    habit_id INT  NOT NULL,
    data     DATE NOT NULL,
    UNIQUE KEY uniqu_day (habit_id, data),
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
);

-- ── Taula de subscripcions push ─────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    endpoint   VARCHAR(500) NOT NULL UNIQUE,
    p256dh     VARCHAR(255) NOT NULL,
    auth       VARCHAR(255) NOT NULL,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Usuari admin per defecte ──────────────────────────────────────
INSERT IGNORE INTO users (id, nom, rol) VALUES (1, 'Admin', 'admin');
