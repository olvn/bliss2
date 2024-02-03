const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('better-sqlite3-session-store')(session);
const betterSqlite3 = require('better-sqlite3');
const app = express();
const PORT = 3000;

const db = betterSqlite3('prime.db');

app.use(session({
    store: new SQLiteStore({ client: db, expired: { clear: true } }),
    secret: 'your secret key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));


function applyMigrations() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const migrationsDir = path.join(__dirname, '/migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql'));

    migrationFiles.forEach(file => {
        const isApplied = db.prepare('SELECT filename FROM migrations WHERE filename = ?').get(file);
        if (!isApplied) {
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
            db.exec(sql);
            db.prepare('INSERT INTO migrations (filename) VALUES (?)').run(file);
            console.log(`Migration applied: ${file}`);
        }
    });
}

applyMigrations();

app.get('*', (req, res) => {
    const path = req.path;

    try {
        const stmt = db.prepare('SELECT * FROM routes WHERE path = ?');
        const route = stmt.get(path);

        if (route) {
            res.json({ success: true, message: 'Path found', data: route });
        } else {
            res.status(404).json({ success: false, message: 'Path not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
