CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username)
);

CREATE TABLE structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(name, user_id)
);

CREATE TABLE dbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    structure_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    library TEXT NOT NULL DEFAULT "",
    FOREIGN KEY(structure_id) REFERENCES structures(id),
    UNIQUE(name, structure_id)
);

CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT,
    structure_id INTEGER,
    test_object TEXT DEFAULT "it = {}",
    engine TEXT NOT NULL DEFAULT "eta",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(structure_id) REFERENCES structures(id) UNIQUE(name, structure_id)
);

CREATE TABLE routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verb TEXT CHECK(verb IN ('POST', 'GET', 'PUT', 'DELETE')) NOT NULL,
    path TEXT NOT NULL,
    structure_id INTEGER,
    handler TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(structure_id) REFERENCES structures(id),
    UNIQUE(verb, path, structure_id)
);

CREATE TABLE structure_dbs (
    db_id INTEGER,
    structure_id INTEGER,
    alias TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(db_id, structure_id),
    FOREIGN KEY(db_id) REFERENCES dbs(id),
    FOREIGN KEY(structure_id) REFERENCES structures(id)
);

CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    structure_id INTEGER,
    name TEXT,
    path TEXT,
    mime_type TEXT,
    mime_subtype TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (structure_id) REFERENCES structures(id),
    UNIQUE(path, structure_id)
);

-- ===========================
--         TRIGGERS
-- ===========================
CREATE TRIGGER update_users_updated_at
AFTER
UPDATE
    ON users FOR EACH ROW BEGIN
UPDATE
    users
SET
    updated_at = CURRENT_TIMESTAMP
WHERE
    id = OLD.id;

END;

CREATE TRIGGER update_structures_updated_at
AFTER
UPDATE
    ON structures FOR EACH ROW BEGIN
UPDATE
    structures
SET
    updated_at = CURRENT_TIMESTAMP
WHERE
    id = OLD.id;

END;

CREATE TRIGGER update_dbs_updated_at
AFTER
UPDATE
    ON dbs FOR EACH ROW BEGIN
UPDATE
    dbs
SET
    updated_at = CURRENT_TIMESTAMP
WHERE
    id = OLD.id;

END;

CREATE TRIGGER update_templates_updated_at
AFTER
UPDATE
    ON templates FOR EACH ROW BEGIN
UPDATE
    templates
SET
    updated_at = CURRENT_TIMESTAMP
WHERE
    id = OLD.id;

END;

CREATE TRIGGER update_routes_updated_at
AFTER
UPDATE
    ON routes FOR EACH ROW BEGIN
UPDATE
    routes
SET
    updated_at = CURRENT_TIMESTAMP
WHERE
    id = OLD.id;

END;