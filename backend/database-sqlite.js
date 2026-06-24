const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'habitforge-local.db');
const db = new sqlite3.Database(dbPath);

// Initialize SQLite schema
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom VARCHAR(100) NOT NULL,
        avatar VARCHAR(10) DEFAULT '👤',
        role VARCHAR(20) DEFAULT 'user',
        creat_el DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        nom VARCHAR(100) NOT NULL,
        icona VARCHAR(10) DEFAULT '✨',
        color VARCHAR(20) DEFAULT '#8b5cf6',
        frequencia VARCHAR(20) DEFAULT 'daily',
        dies VARCHAR(50) DEFAULT NULL,
        creat_el DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS registres (
        habit_id INTEGER NOT NULL,
        data DATE NOT NULL,
        creat_el DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (habit_id, data),
        FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
});

// Polyfill for mysql2/promise `pool.query`
const pool = {
    query: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            // Convert MySQL ? to SQLite ? 
            // Better yet, sqlite3 supports ? out of the box.

            // If the query is an INSERT, UPDATE, or DELETE, use db.run
            if (sql.trim().toUpperCase().startsWith('SELECT')) {
                db.all(sql, params, (err, rows) => {
                    if (err) return reject(err);
                    // sqlite returns array of objects. mysql2 returns [rows, fields]
                    resolve([rows]);
                });
            } else {
                db.run(sql, params, function (err) {
                    if (err) return reject(err);
                    // Mock mysql insertId
                    resolve([{ insertId: this.lastID, affectedRows: this.changes }]);
                });
            }
        });
    }
};

module.exports = pool;
