// database.js — MySQL connection pool
// El host és "database" (nom del servei docker-compose), MAI localhost

const mysql = require('mysql2/promise');

let pool;

if (process.env.DB_CLIENT === 'sqlite') {
    console.log("🛠  Utilitzant SQLite en mode local");
    pool = require('./database-sqlite');
} else {
    pool = mysql.createPool({
        host: process.env.DB_HOST || 'database',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'habitforge',
        password: process.env.DB_PASSWORD || 'changeme',
        database: process.env.DB_NAME || 'habitforge',
        // Retorna DATE/DATETIME com a text 'YYYY-MM-DD' — evita desplaçaments de zona horària
        dateStrings: true,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    });

    // Initialize MySQL Schema (aligned with init.sql)
    pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id       INT AUTO_INCREMENT PRIMARY KEY,
            nom      VARCHAR(120) NOT NULL,
            rol      ENUM('user','admin') DEFAULT 'user',
            creat_el TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `).then(() => {
        return pool.query(`
            CREATE TABLE IF NOT EXISTS habits (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                user_id    INT          NOT NULL,
                nom        VARCHAR(120) NOT NULL,
                descripcio VARCHAR(255) DEFAULT '',
                icona      VARCHAR(10)  DEFAULT '⭐',
                color      VARCHAR(20)  DEFAULT '#8b5cf6',
                frequencia ENUM('daily','custom') DEFAULT 'daily',
                dies       VARCHAR(7)   DEFAULT '1234567',
                creat_el   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
    }).then(() => {
        return pool.query(`
            CREATE TABLE IF NOT EXISTS registres (
                id       INT  AUTO_INCREMENT PRIMARY KEY,
                habit_id INT  NOT NULL,
                data     DATE NOT NULL,
                UNIQUE KEY uniqu_day (habit_id, data),
                FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
            )
        `);
    }).then(() => {
        return pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                user_id    INT          NOT NULL,
                endpoint   VARCHAR(500) NOT NULL UNIQUE,
                p256dh     VARCHAR(255) NOT NULL,
                auth       VARCHAR(255) NOT NULL,
                created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
    }).then(() => {
        console.log('✅ Base de dades MySQL inicialitzada correctament.');
    }).catch(err => {
        console.error('❌ Error inicialitzant la base de dades MySQL a database.js:', err);
    });
}

module.exports = pool;
