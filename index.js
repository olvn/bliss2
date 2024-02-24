const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("better-sqlite3-session-store")(session);
const betterSqlite3 = require("better-sqlite3");
const cheerio = require("cheerio");
const { Eta } = require("eta");
const bcrypt = require("bcrypt");
const app = express();
const bodyParser = require("body-parser");
const PORT = 3000;

let viewpath = path.join(__dirname, "views");
let eta = new Eta({ views: viewpath, cache: false, autoEscape: false });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

const db = betterSqlite3("prime.db");
db.pragma("journal_mode = WAL");

app.use(
  session({
    store: new SQLiteStore({ client: db, expired: { clear: true } }),
    secret: "your secret key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

function applyMigrations() {
  db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

  const migrationsDir = path.join(__dirname, "/migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"));

  migrationFiles.forEach((file) => {
    const isApplied = db
      .prepare("SELECT filename FROM migrations WHERE filename = ?")
      .get(file);

    if (!isApplied) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      db.exec(sql);
      db.prepare("INSERT INTO migrations (filename) VALUES (?)").run(file);
      console.log(`Migration applied: ${file}`);
    }
  });
}

applyMigrations();

// __   __  _______  _______  ______
// |  | |  ||       ||       ||    _ |
// |  | |  ||  _____||    ___||   | ||
// |  |_|  || |_____ |   |___ |   |_||_
// |       ||_____  ||    ___||    __  |
// |       | _____| ||   |___ |   |  | |
// |_______||_______||_______||___|  |_|

function createUser(db, username, hashedPassword) {
  return db
    .prepare("INSERT INTO users (username, password) VALUES (?, ?)")
    .run(username, hashedPassword).lastInsertRowId;
}

function getUser(db, username) {
  return db.prepare("SELECT * from users where username = ?").get(username);
}

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10); // 10 is the saltRounds
    createUser(db, username, hashedPassword);
    res.redirect("/workshop");
  } catch (e) {
    res.render("auth/register.html", { error: e });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = getUser(db, username);

  if (user && (await bcrypt.compare(password, user.password))) {
    req.session.userId = user.id;
    return res.redirect("/");
  }

  return res.send(
    eta.render("auth/login", {
      error: "are you sure you entered that right?",
    })
  );
});

app.get("/register", async (req, res) => {
  if (req.session.userId) {
    return res.redirect("/");
  }
  return res.render("auth/register", { error: null });
});

app.get("/login", async (req, res) => {
  console.log(req.session.userId);
  if (req.session.userId) {
    return res.redirect("/");
  }
  return res.send(eta.render("auth/login", { error: null }));
});

app.all("/logout", async (req, res) => {
  return req.session.destroy(() => {
    res.redirect("/");
  });
});

// _     _  _______  ______    ___   _  _______  __   __  _______  _______
// | | _ | ||       ||    _ |  |   | | ||       ||  | |  ||       ||       |
// | || || ||   _   ||   | ||  |   |_| ||  _____||  |_|  ||   _   ||    _  |
// |       ||  | |  ||   |_||_ |      _|| |_____ |       ||  | |  ||   |_| |
// |       ||  |_|  ||    __  ||     |_ |_____  ||       ||  |_|  ||    ___|
// |   _   ||       ||   |  | ||    _  | _____| ||   _   ||       ||   |
// |__| |__||_______||___|  |_||___| |_||_______||__| |__||_______||___|

function getStructures(db) {
  return db.prepare("SELECT * from structures").all();
}

function getStructure(db, id) {
  return db.prepare("SELECT * from structures where ID = ?").run(id);
}

function createStructure(db, name, userId) {
  const stmt = db.prepare(
    "INSERT INTO structures (name, user_id) VALUES (?, ?)"
  );
  const info = stmt.run(name, userId);
  return info.lastInsertRowid; // Returns the structure_id of the newly created structure
}

function createRoute(db, verb, path, structureId, userId, handler) {
  const stmt = db.prepare(
    "INSERT INTO routes (verb, path, structure_id, user_id, handler) VALUES (?, ?, ?, ?, ?)"
  );
  const info = stmt.run(verb, path, structureId, userId, handler);
  return info.lastInsertRowid; // Returns the route_id of the newly created route
}

function getTemplateString(db, templateAlias, structId) {
  const stmt = db.prepare(`
    SELECT t.path
    FROM templates AS t
    JOIN structure_templates AS st ON t.id = st.template_id
    WHERE st.structure_id = ? AND st.alias = ?
  `);

  const path = stmt.get(structId, templateAlias);
  return fs.readFileSync(path).toString();
}

const { LRUCache } = require("lru-cache");
// we'll figure out max size later
const cache = new LRUCache({ max: 10000 });

function getTemplater(structId) {
  let etaInstance = cache.get(structId);

  if (!etaInstance) {
    etaInstance = new Eta({});
    etaInstance.resolvePath = function (path, _) {
      return path;
    };
    etaInstance.readFile = function (templateAlias) {
      return getTemplateString(db, templateAlias, structId);
    };
    cache.set(structId, etaInstance);
  }

  return etaInstance;
}

function bootstrapTemplateWithHTMXetc(htmlString) {
  const $ = cheerio.load(htmlString);

  if ($("html").length > 0) {
    console.log("waddup");
    let head = $("head");

    // If <head> does not exist, prepend it to <html>
    if (head.length === 0) {
      $("html").prepend("<head></head>");
      head = $("head");
    }

    head.append(`
        <script src="https://unpkg.com/htmx.org"></script>
        <script src="https://unpkg.com/hyperscript.org"></script>
        <script src="https://cdn.tailwindcss.com"></script>
    `);
  }

  return $.html();
}

app.post("/workshop", (req, res) => {
  let structId = createStructure(db, req.body.name);
  return res.redirect("/workshop/" + structId);
});

app.get("/workshop", (req, res) => {
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/index", {
        structures: getStructures(db),
      })
    )
  );
});

app.get("/workshop/:structure_id", (req, res) => {
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/editor", {
        structure: getStructure(db, req.params.structure_id),
      })
    )
  );
});

app.all("*", (req, res) => {
  const path = req.path;
  const verb = req.method;

  try {
    const stmt = db.prepare("SELECT * FROM routes WHERE path = ? AND verb = ?");
    const route = stmt.get(path, verb);

    if (route) {
      return res.send(
        eval(route.handler)({ ...this, ...handlerContext(req, res) })
      );
    } else {
      res.status(404).json({ success: false, message: "Path not found" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
