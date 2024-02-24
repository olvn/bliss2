CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    UNIQUE(username)
);

CREATE TABLE structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(name, user_id)
);

CREATE TABLE dbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    belongs_to_struct INTEGER,
    FOREIGN KEY(belongs_to_struct) REFERENCES structures(id),
    UNIQUE(name, belongs_to_struct)
);

CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    user_id INTEGER,
    belongs_to_struct INTEGER,
    engine TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(belongs_to_struct) REFERENCES structures(id),
    UNIQUE(name, belongs_to_struct)
);

CREATE TABLE routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verb TEXT CHECK(verb IN ('POST', 'GET', 'PUT', 'DELETE')),
    path TEXT NOT NULL,
    structure_id INTEGER,
    user_id INTEGER,
    handler TEXT NOT NULL,
    language TEXT NOT NULL,
    FOREIGN KEY(structure_id) REFERENCES structures(id),
    FOREIGN KEY(user_id) REFERENCES users(id) UNIQUE(verb, path)
);

CREATE TABLE structure_dbs (
    db_id INTEGER,
    structure_id INTEGER,
    PRIMARY KEY(db_id, structure_id),
    FOREIGN KEY(db_id) REFERENCES dbs(id),
    FOREIGN KEY(structure_id) REFERENCES structures(id)
);

CREATE TABLE structure_templates (
    template_id INTEGER,
    structure_id INTEGER,
    alias TEXT NOT NULL,
    PRIMARY KEY(template_id, structure_id),
    FOREIGN KEY(template_id) REFERENCES templates(id),
    FOREIGN KEY(structure_id) REFERENCES structures(id),
    UNIQUE(structure_id, alias)
);