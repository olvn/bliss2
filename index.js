const fs = require("fs");
const vm = require("node:vm");
const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("better-sqlite3-session-store")(session);
const betterSqlite3 = require("better-sqlite3");
const { Eta } = require("eta");
const { match } = require("path-to-regexp");
const bcrypt = require("bcrypt");
const cheerio = require("cheerio");
const app = express();
const bodyParser = require("body-parser");
const PORT = 3000;

let viewpath = path.join(__dirname, "views");
let eta = new Eta({ views: viewpath, cache: false, autoEscape: true });

const routes = { GET: [], POST: [], PUT: [], DELETE: [] };

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

const db = betterSqlite3("./prime.db");

db.pragma("journal_mode = WAL");

function getAllRoutes(db) {
  return db.prepare("SELECT * from routes ORDER BY id ASC;").all();
}

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

function buildRoutes() {
  for (let route of getAllRoutes(db)) {
    routes[route.verb].push({
      matcher: match(route.path, { decode: decodeURIComponent }),
      id: route.id,
      path: route.path,
    });
  }
}

applyMigrations();
buildRoutes();

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
    .run(username, hashedPassword).lastInsertRowid;
}

function getUser(db, username) {
  return db.prepare("SELECT * from users where username = ?").get(username);
}

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10); // 10 is the saltRounds
    userId = createUser(db, username, hashedPassword);
    req.session.userId = userId;
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
  return res.send(eta.render("auth/register", { error: null }));
});

app.get("/login", async (req, res) => {
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
  return db.prepare("SELECT * from structures where ID = ?").get(id);
}

function createStructure(db, name, userId) {
  const stmt = db.prepare(
    "INSERT INTO structures (name, user_id) VALUES (?, ?)"
  );
  const info = stmt.run(name, userId);
  return info.lastInsertRowid; // Returns the structure_id of the newly created structure
}

function createRoute(db, verb, path, structureId, handler) {
  // add default handler here
  const stmt = db.prepare(
    "INSERT INTO routes (verb, path, structure_id, handler) VALUES (?, ?, ?, ?)"
  );
  const info = stmt.run(verb, path, structureId, handler);
  return info.lastInsertRowid; // Returns the route_id of the newly created route
}

function getRoutes(db, structureId) {
  return db
    .prepare("SELECT * from routes where structure_id = ?")
    .all(structureId);
}

function getRoute(db, routeId) {
  return db.prepare("SELECT * from routes where id = ?").get(routeId);
}

function updateRoute(db, route) {
  const fields = ["verb", "path", "structure_id", "handler", "updated_at"];
  const values = fields.map((field) => route[field]);
  const placeholders = fields.map((field) => `${field} = ?`).join(", ");

  const sql = `UPDATE routes SET ${placeholders} WHERE id = ?`;
  values.push(route.id); // Add routeId to the end for the WHERE clause
  db.prepare(sql).run(...values);
}

function updateDb(db, appDb) {
  const fields = ["name", "library"];
  const values = fields.map((field) => appDb[field]);
  const placeholders = fields.map((field) => `${field} = ?`).join(", ");

  const sql = `UPDATE dbs SET ${placeholders} WHERE id = ?`;
  values.push(appDb.id); // Add routeId to the end for the WHERE clause
  db.prepare(sql).run(...values);
}

function getTemplates(db, structureId) {
  return db
    .prepare("SELECT * from templates where structure_id = ?")
    .all(structureId);
}

function getDbsForStructure(db, structureId) {
  return db
    .prepare(
      `SELECT * 
       FROM structure_dbs 
       INNER JOIN dbs ON structure_dbs.db_id = dbs.id 
       WHERE structure_dbs.structure_id = ?;
      `
    )
    .all(structureId);
}

function getDb(db, dbId) {
  return db
    .prepare(
      `SELECT * 
       FROM dbs 
       WHERE id = ?;
      `
    )
    .get(dbId);
}

function getDbForStructure(db, structureId, dbId) {
  return db
    .prepare(
      `SELECT * 
      FROM structure_dbs 
      INNER JOIN dbs ON structure_dbs.db_id = dbs.id 
      WHERE structure_dbs.structure_id = ?
      AND structure_dbs.db_id = ?;
      `
    )
    .get(structureId, dbId);
}

function createDb(db, structId, name) {
  console.log(name, structId);
  const transaction = db.transaction(() => {
    const insertDbStmt = db.prepare(`
            INSERT INTO dbs (name, structure_id)
            VALUES (?, ?)
        `);
    const result = insertDbStmt.run(name, structId);
    const dbId = result.lastInsertRowid;
    const insertStructureDbStmt = db.prepare(`
            INSERT INTO structure_dbs (db_id, structure_id, alias)
            VALUES (?, ?, ?)
        `);
    insertStructureDbStmt.run(dbId, structId, name);

    const dbDir = path.join("dbs", dbId.toString());
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const newDbPath = path.join(dbDir, `${name}.sqlite`);
    const newDb = betterSqlite3(newDbPath);
    newDb.close();

    return dbId;
  });

  return transaction();
}

const { LRUCache } = require("lru-cache");
const { templateSettings } = require("dot");
// we'll figure out max size later
const templateCache = new LRUCache({ max: 100 });

function getTemplater(structId) {
  let etaInstance = templateCache.get(structId);

  if (!etaInstance) {
    etaInstance = new Eta({});
    etaInstance.resolvePath = function (path, _) {
      return path;
    };
    etaInstance.readFile = function (templateAlias) {
      return getTemplateString(db, templateAlias, structId);
    };
    templateCache.set(structId, etaInstance);
  }

  return etaInstance;
}

const dbCache = new LRUCache({ max: 25 });

function getDbInstance(dbId) {
  let dbInstance = dbCache.get(dbId);

  if (!dbInstance) {
    dbInstance = betterSqlite3(`dbs/${dbId}.sqlite`);
    dbInstance.pragma("journal_mode = WAL");
    dbCache.set(dbId, dbInstance);
  }

  return dbInstance;
}

function bootstrapTemplateWithHTMXetc(htmlString, blissRoute) {
  if (htmlString.startsWith("<html>")) {
    const $ = cheerio.load(htmlString);
    let head = $("head");

    // If <head> does not exist, prepend it to <html>
    if (head.length === 0) {
      $("html").prepend("<head></head>");
      head = $("head");
    }

    head.append(`
        <script src="/js/hyperscript.js"></script>
        <script src="/js/tailwind.js"></script>
        <script src="/js/htmx.js"></script>
        <script src="/js/bliss_inspector.js"></script>
    `);

    if (blissRoute) {
      $.root().children().attr("data-bliss-route", blissRoute);
    }

    htmlString = $.html();
  } else if (blissRoute) {
    const $ = cheerio.load(htmlString, null, false);
    $.root().children().attr("data-bliss-route", blissRoute);
    htmlString = $.html();
  }

  return htmlString;
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

function smartRedirect(req, res, redirectUrl) {
  if (req.headers["hx-request"]) {
    res.set("HX-Redirect", redirectUrl);
    res.send();
  } else {
    res.redirect(redirectUrl);
  }
}

function sidebarStuff(db, structId) {
  return {
    structure: getStructure(db, structId),
    routes: getRoutes(db, structId),
    templates: getTemplates(db, structId),
    dbs: getDbsForStructure(db, structId),
  };
}

app.get("/workshop/:structure_id", (req, res) => {
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/editor", sidebarStuff(db, req.params.structure_id))
    )
  );
});

app.post("/workshop/:structure_id/db", (req, res) => {
  console.log(req.session);
  const dbId = createDb(db, req.params.structure_id, req.body.name);
  const redirectUrl = `/workshop/${req.params.structure_id}/db/${dbId}`;
  return smartRedirect(req, res, redirectUrl);
});

app.get("/workshop/:structure_id/db/:db_id", (req, res) => {
  const structdb = getDbForStructure(
    db,
    req.params.structure_id,
    req.params.db_id
  );
  if (!structdb) {
    return res.send("uh oh");
  }
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/db_garden", {
        db: structdb,
        ...sidebarStuff(db, req.params.structure_id),
      })
    )
  );
});

app.post("/workshop/:structure_id/route", (req, res) => {
  const route = createRoute(
    db,
    req.body.verb,
    req.body.path,
    req.params.structure_id,
    "// put your handler code here"
  );
  buildRoutes();
  return smartRedirect(
    req,
    res,
    `/workshop/${req.params.structure_id}/route/${route}`
  );
});

app.put("/workshop/:structure_id/route/:route_id", (req, res) => {
  const route = getRoute(db, req.params.route_id);
  updateRoute(db, { ...route, ...req.body });
  return res.send("good");
});

app.put("/workshop/:structure_id/db/:db_id/library", (req, res) => {
  try {
    let dbId = req.params.db_id;
    let appDb = getDb(db, dbId);
    updateDb(db, { ...appDb, library: req.body.library });
    appDb = getDb(db, dbId);

    let dbInstance = getDbInstance(dbId);
    let capturedOutput = [];
    let context = vm.createContext({
      module: { exports: null },
      sql: dbInstance,
      console: {
        log: (...args) => capturedOutput.push(args.join(" ")),
      },
    });
    let evaledCode = vm.runInContext(appDb.library, context);
    let stdout = capturedOutput.join("\n");
    return res.send(`${stdout}\n\n> ${evaledCode}`.trim());
  } catch (e) {
    return res.send(`${e}\n\n${e.stack}`);
  }
});

app.post("/workshop/:structure_id/db/:db_id/repl", (req, res) => {
  try {
    let dbId = req.params.db_id;
    let appDb = getDb(db, dbId);
    let dbInstance = getDbInstance(dbId);
    let capturedOutput = [];
    let context = vm.createContext({
      module: { exports: null },
      sql: dbInstance,
      console: {
        log: (...args) => capturedOutput.push(args.join(" ")),
      },
    });
    const libraryScript = new vm.Script(appDb.library);
    libraryScript.runInContext(context);
    context.library = context.module.exports;
    const replScript = new vm.Script(req.body.code);
    let evaledCode = replScript.runInContext(context);
    let stdout = capturedOutput.join("\n");
    return res.send(`${stdout}\n\n> ${evaledCode}`.trim());
  } catch (e) {
    return res.send(`${e}\n\n${e.stack}`);
  }
});

app.get("/workshop/:structure_id/route/:id", (req, res) => {
  const route = getRoute(db, req.params.id);
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/route", {
        route: route,
        previewUrl: route["verb"] == "GET" ? route.path : "/workshop/tip",
        ...sidebarStuff(db, req.params.structure_id),
      })
    )
  );
});

app.get("/workshop/tip", (req, res) => {
  res.send("try entering something in the url field above");
});

app.get("/workshop/:structure_id/new_template_modal", (req, res) => {
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/new_template_modal", {
        structure: getStructure(db, req.params.structure_id),
      })
    )
  );
});

app.get("/workshop/:structure_id/new_route_modal", (req, res) => {
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/new_route_modal", {
        structure: getStructure(db, req.params.structure_id),
      })
    )
  );
});

app.get("/workshop/:structure_id/new_db_modal", (req, res) => {
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/new_db_modal", {
        structure: getStructure(db, req.params.structure_id),
      })
    )
  );
});

app.all("*", (req, res) => {
  const path = req.path;
  const verb = req.method;

  try {
    let routeMatch = null;

    for (let { matcher, id } of routes[verb]) {
      let matchFromRoute = matcher(path);
      if (matchFromRoute) {
        routeMatch = { params: matchFromRoute.params, id: id };
      }
    }

    if (routeMatch) {
      req.params = routeMatch.params;
      const route = db
        .prepare("SELECT * FROM routes WHERE id = ?")
        .get(routeMatch.id);

      let dbs = getDbsForStructure(db, route.structure_id);

      const allDbInstances = {};

      try {
        let context = vm.createContext({
          req,
          res,
          getDb: function (alias) {
            return allDbInstances[alias];
          },
          module: { exports: null },
        });

        for (let appDb of dbs) {
          let dbInstance = getDbInstance(appDb.id);
          context.sql = dbInstance;
          vm.runInContext(appDb.library, context);
          allDbInstances[appDb.alias] = {
            library: context.module.exports,
            sql: dbInstance,
          };
          context.module.exports = null;
        }

        res.rawSend = res.send
        res.render = (...args) => {
          bootstrapTemplateWithHTMXetc(
            res.rawSend(...args),
            `/workshop/${route.structure_id}/route/${route.id}`
          );
        };
        return vm.runInContext(
          (route.handler += `\n\nhandler(req, res)`),
          context
        );
      } catch (e) {
        return res.send(`${e}\n\n${e.stack}`);
      }
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
