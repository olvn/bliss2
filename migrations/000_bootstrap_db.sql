CREATE TABLE users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL
);

CREATE TABLE structures (
    structure_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);

CREATE TABLE dbs (
    db_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    belongs_to_struct INTEGER,
    FOREIGN KEY(belongs_to_struct) REFERENCES structures(structure_id)
);

CREATE TABLE templates (
    template_id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    user_id INTEGER,
    belongs_to_struct INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(user_id),
    FOREIGN KEY(belongs_to_struct) REFERENCES structures(structure_id)
);
CREATE TABLE routes (
    route_id INTEGER PRIMARY KEY AUTOINCREMENT,
    verb TEXT CHECK(verb IN ('POST', 'GET', 'PUT', 'DELETE')),
    path TEXT NOT NULL,
    structure_id INTEGER,
    user_id INTEGER,
    handler TEXT NOT NULL,
    FOREIGN KEY(structure_id) REFERENCES structures(structure_id),
    FOREIGN KEY(user_id) REFERENCES users(user_id)
);
CREATE TABLE migrations (
    migration_id INTEGER PRIMARY KEY AUTOINCREMENT,
    db_id INTEGER,
    sql_content TEXT NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY(db_id) REFERENCES dbs(db_id)
);
CREATE TABLE structure_dbs (
    db_id INTEGER,
    structure_id INTEGER,
    PRIMARY KEY(db_id, structure_id),
    FOREIGN KEY(db_id) REFERENCES dbs(db_id),
    FOREIGN KEY(structure_id) REFERENCES structures(structure_id)
);
CREATE TABLE structure_templates (
    template_id INTEGER,
    structure_id INTEGER,
    PRIMARY KEY(template_id, structure_id),
    FOREIGN KEY(template_id) REFERENCES templates(template_id),
    FOREIGN KEY(structure_id) REFERENCES structures(structure_id)
);
a
