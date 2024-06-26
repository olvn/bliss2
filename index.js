const fs = require("fs");
const vm = require("node:vm");
const path = require("path");
const express = require("express");
const session = require("express-session");
const fileUpload = require("express-fileupload");
const SQLiteStore = require("better-sqlite3-session-store")(session);
const betterSqlite3 = require("better-sqlite3");
const { Eta } = require("eta");
const { match } = require("path-to-regexp");
const { LRUCache } = require("lru-cache");
const bcrypt = require("bcrypt");
const cheerio = require("cheerio");
const app = express();
const _expressWs = require("express-ws")(app);
const bodyParser = require("body-parser");
const PORT = 3000;

let viewpath = path.join(__dirname, "views");
let eta = new Eta({ views: viewpath, cache: false, autoEscape: true });

let routes = { GET: [], POST: [], PUT: [], DELETE: [] };

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(fileUpload());

const db = betterSqlite3("./dbs/0.sqlite");

db.pragma("journal_mode = WAL");

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

function getAllRoutes(db) {
  return db
    .prepare(
      `
    SELECT routes.*, structures.route_prefix 
    FROM routes 
    JOIN structures ON routes.structure_id = structures.id 
    ORDER BY routes.updated_at DESC;
  `
    )
    .all();
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

function bootstrapContext(db, structureId, initContext) {
  const allDbInstances = {};
  function getDb(alias) {
    return allDbInstances[alias];
  }

  // todo wrap template in data-bliss-edit-template thing since ws can't take us to the editor on a component basis?? maybe...
  // for now just designing with component approach
  const eta = getTemplater(structureId);

  const libs = { eta, db: getDb };

  let dbs = getDbsForStructure(db, structureId);
  let context = vm.createContext({
    ...initContext,
    require: function (str) {
      return libs[str];
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

  return context;
}

function routeWithPrefix(route) {
  const prefix = route.route_prefix;
  return prefix ? path.join(prefix, route.path) : route.path;
}

function bootstrapWebsocketHandler(route) {
  // todo only expose app when running the handler, should not be available to the handler itself
  // need to move to runscript or whatever
  try {
    const context = bootstrapContext(db, route.structure_id, { app });
    let result = vm.runInContext(
      route.handler + `\n\napp.ws("${routeWithPrefix(route)}", handler)`,
      context
    );
    updateRoute(db, { ...route, error: null });
    return result;
  } catch (e) {
    updateRoute(db, { ...route, error: e.stack });
  }
}

function buildRoutes() {
  let newRoutes = {
    GET: [],
    POST: [],
    PUT: [],
    DELETE: [],
  };

  for (let route of getAllRoutes(db)) {
    const p = routeWithPrefix(route);
    if (route.verb == "WS") {
      bootstrapWebsocketHandler(route);
    } else {
      newRoutes[route.verb].push({
        matcher: match(p, { decode: decodeURIComponent }),
        id: route.id,
        path: route.path,
      });
    }
  }
  routes = newRoutes;
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
  path = encodeURI(path)
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
  const fields = [
    "verb",
    "path",
    "structure_id",
    "handler",
    "updated_at",
    "error",
  ];
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

function updateStruct(db, struct) {
  const fields = ["name", "route_prefix", "head_injection"];
  const values = fields.map((field) => struct[field]);
  const placeholders = fields.map((field) => `${field} = ?`).join(", ");

  const sql = `UPDATE structures SET ${placeholders} WHERE id = ?`;
  values.push(struct.id); // Add routeId to the end for the WHERE clause
  db.prepare(sql).run(...values);
}

function updateTemplate(db, template) {
  const fields = ["content", "name", "test_object"];
  const values = fields.map((field) => template[field]);
  const placeholders = fields.map((field) => `${field} = ?`).join(", ");

  const sql = `UPDATE templates SET ${placeholders} WHERE id = ?`;
  values.push(template.id);
  db.prepare(sql).run(...values);
}

function getTemplates(db, structureId) {
  return db
    .prepare("SELECT * from templates where structure_id = ?")
    .all(structureId);
}

function getTemplate(db, templateId) {
  return db.prepare("SELECT * from templates where id = ?").get(templateId);
}

function getTemplateContentByName(db, structId, name) {
  return db
    .prepare(
      "SELECT content from templates where structure_id = ? AND name = ?"
    )
    .get(structId, name);
}

function createTemplate(db, structureId, name, content, testObjectString) {
  return db
    .prepare(
      "INSERT INTO templates (structure_id, name, content, test_object) VALUES (?, ?, ?, ?)"
    )
    .run(structureId, name, content, testObjectString).lastInsertRowid;
}

function getDbsForStructure(db, structureId) {
  return db
    .prepare(
      `SELECT
          *,
          CASE 
            WHEN structure_dbs.structure_id != dbs.structure_id THEN 1
            ELSE 0
          END AS is_aliased,
          structure_dbs.structure_id as alias_struct_id,
          dbs.structure_id as db_struct_id
       FROM structure_dbs 
       INNER JOIN dbs ON structure_dbs.db_id = dbs.id 
       WHERE structure_dbs.structure_id = ?
       ORDER BY structure_dbs.created_at, is_aliased ASC;
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

    const newDbPath = path.join("dbs", `${dbId}.sqlite`);
    const newDb = betterSqlite3(newDbPath);
    newDb.close();

    return dbId;
  });

  return transaction();
}

function attachDb(db, structId, dbId, alias) {
  const insertStructureDbStmt = db.prepare(`
    INSERT INTO structure_dbs (db_id, structure_id, alias)
    VALUES (?, ?, ?)
  `);
  insertStructureDbStmt.run(dbId, structId, alias);
}

function getFilesForStruct(db, structureId) {
  let test = db
    .prepare("SELECT * FROM files WHERE structure_id = ? ORDER BY id DESC")
    .all(structureId);

  return test;
}

function getFile(db, fileId) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(fileId);
}

function createFile(db, structure_id, name, filePath, mime_type, mime_subtype) {
  return db
    .prepare(
      "INSERT INTO files (structure_id, name, path, mime_type, mime_subtype) VALUES (?, ?, ?, ?, ?)"
    )
    .run(structure_id, name, filePath, mime_type, mime_subtype).lastInsertRowid;
}

const templateCache = new LRUCache({ max: 100 });

function getTemplater(structId) {
  let etaInstance = templateCache.get(structId);

  if (!etaInstance) {
    etaInstance = new Eta({});
    etaInstance.resolvePath = function (path, _) {
      return path;
    };
    etaInstance.readFile = function (templateAlias) {
      return getTemplateContentByName(db, structId, templateAlias).content;
    };
    templateCache.set(structId, etaInstance);
  }

  return etaInstance;
}

function cloneStructure(
  structId,
  newStructureName,
  userId,
  routePrefix = "",
  cloneDbs = []
) {
  const transaction = db.transaction(() => {
    const cloneStructure = db.prepare(`
            INSERT INTO structures (name, user_id, route_prefix, cloned_from)
            VALUES (?, ?, ?, ?);
        `);

    const newStructId = cloneStructure.run(
      newStructureName,
      userId,
      routePrefix,
      structId
    ).lastInsertRowid;

    const dbIds = db
      .prepare(`select db_id from structure_dbs where structure_id = ?;`)
      .all(structId);

    const toClone = new Set(cloneDbs);
    const toAlias = new Set();

    for (let { db_id } of dbIds) {
      if (!toClone.has(db_id.toString())) {
        toAlias.add(db_id.toString());
      }
    }

    for (let db_id of toClone) {
      const newDb = db
        .prepare(
          `
            INSERT INTO dbs (name, structure_id, library)
            SELECT name, ?, library FROM dbs WHERE id = ?;
            `
        )
        .run(newStructId, db_id).lastInsertRowid;

      db.prepare(
        `
            INSERT INTO structure_dbs (db_id, structure_id, alias)
            SELECT ?, ?, alias FROM structure_dbs WHERE db_id = ? AND structure_id = ?;
            `
      ).run(newDb, newStructId, db_id, structId);

      db.prepare(`select id from dbs where structure_id = ?`)
        .all(newStructId)
        .map((new_db) => {
          const srcPath = path.join(__dirname, "dbs", `${db_id}.sqlite`);
          const destPath = path.join(__dirname, "dbs", `${new_db.id}.sqlite`);
          fs.copyFileSync(srcPath, destPath);
          fs.copyFileSync(srcPath + "-shm", destPath + "-shm");
          fs.copyFileSync(srcPath + "-wal", destPath + "-wal");
        });
    }
    for (let db_id of toAlias) {
      db.prepare(
        `
        INSERT INTO structure_dbs (db_id, structure_id, alias)
        SELECT db_id, ?, alias FROM structure_dbs WHERE structure_id = ? AND db_id = ?;
        `
      ).run(newStructId, structId, db_id);
    }

    const cloneTemplates = db.prepare(`
            INSERT INTO templates (name, content, structure_id, test_object, engine)
            SELECT name, content, ?, test_object, engine FROM templates WHERE structure_id = ?;
        `);
    cloneTemplates.run(newStructId, structId);

    const cloneRoutes = db.prepare(`
            INSERT INTO routes (verb, path, structure_id, handler)
            SELECT verb, path, ?, handler FROM routes WHERE structure_id = ?;
        `);
    cloneRoutes.run(newStructId, structId);

    return newStructId;
  });

  return transaction();
}

function bootstrapTemplateWithHTMXetc(
  htmlString,
  blissRoute,
  blissClone,
  blissCopy,
  headInjection,
  htmxRequest = false
) {
  if (
    htmlString.toLowerCase().startsWith("<html>") ||
    htmlString.toLowerCase().startsWith("<!doctype") ||
    !htmxRequest
  ) {
    const $ = cheerio.load(htmlString);
    let head = $("head");

    if (head.length === 0) {
      $("html").prepend("<head></head>");
      head = $("head");
    }

    head.attr("id", "head");

    head.append(`
        <script src="/js/hyperscript.js"></script>
        <script src="/js/tailwind.js"></script>
        <script src="/js/htmx.js"></script>
        <script src="https://unpkg.com/htmx.org@1.9.12/dist/ext/ws.js"></script>
        <script src="/js/bliss_inspector.js"></script>
        ${headInjection || ""}
    `);

    if (blissRoute) {
      $("body").attr("data-bliss-route", blissRoute);
      $("body").attr("data-bliss-clone", blissClone);
      if (blissCopy) $("body").attr("data-bliss-copy", blissCopy);
    }

    htmlString = $.html();
  } else if (htmxRequest && blissRoute) {
    const $ = cheerio.load(htmlString, null, false);
    $.root().children().attr("data-bliss-route", blissRoute);
    $.root().children().attr("data-bliss-clone", blissClone);
    if (blissCopy) $.root().children().attr("data-bliss-copy", blissCopy);
    htmlString = $.html();

    if (htmxRequest) {
      htmlString += `<div id="head" hx-oob-swap="before_end">${headInjection}</div>`;
    }
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

app.post("/workshop/:structure_id/clone", (req, res) => {
  let routePrefix = req.body.route_prefix;
  routePrefix = routePrefix[0] == "/" ? routePrefix : "/" + routePrefix;
  let newStructureId;
  try {
    newStructureId = cloneStructure(
      req.params.structure_id,
      req.body.name,
      1,
      // req.session.userId,
      routePrefix,
      req.body.clone_dbs
    );
    buildRoutes();
  } catch (e) {
    return res.send(e.stack);
  }
  return smartRedirect(req, res, `/workshop/${newStructureId}`);
});

app.post("/workshop/:structure_id/db", (req, res) => {
  const dbId = createDb(db, req.params.structure_id, req.body.name);
  const redirectUrl = `/workshop/${req.params.structure_id}/db/${dbId}`;
  return smartRedirect(req, res, redirectUrl);
});

app.post("/workshop/:structure_id/db/attach", (req, res) => {
  attachDb(db, req.params.structure_id, req.body.db_id, req.body.alias);
  const redirectUrl = `/workshop/${req.params.structure_id}/db/${req.body.db_id}`;
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
  let p = req.body.path;

  let dummyHandler =
    "// put your handler code here\n\nfunction handler(req, res) {\n  res.send('henlo world') \n}";

  if (req.body.verb == "WS") {
    dummyHandler = `// put your websocket handler code here\n\nfunction handler(ws, req) {\n  ws.on('message', function(msg) {\n    ws.send(msg);\n  })\n}`;
  }

  if (p[0] == "/") {
    p = p.substring(1);
  }
  if (p[p.length - 1] == "/") {
    p = p.substring(0, p.length - 1);
  }
  const route = createRoute(
    db,
    req.body.verb,
    p[0] == "/" ? p.substring(1) : "/" + p,
    req.params.structure_id,
    dummyHandler
  );
  // todo optimize by only adding new, don't just rebuild all
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

app.post("/workshop/:structure_id/template", (req, res) => {
  let name = req.body.name;

  const template = createTemplate(
    db,
    req.params.structure_id,
    name,
    "<div>henlo <%= it.name %></div>",
    "it = { name: 'templates!' };"
  );

  return smartRedirect(
    req,
    res,
    `/workshop/${req.params.structure_id}/template/${template}`
  );
});

app.put("/workshop/:structure_id/template/:template_id", (req, res) => {
  let id = req.params.template_id;
  let content = req.body.content;
  let test_object = req.body.test_object;

  updateTemplate(db, { ...getTemplate(db, id), content, test_object });

  return res.send("good");
});

app.get("/workshop/:structure_id/template/:template_id", (req, res) => {
  const template = getTemplate(db, req.params.template_id);

  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/template", {
        template: template,
        ...sidebarStuff(db, req.params.structure_id),
      })
    )
  );
});

app.get("/workshop/:structure_id/template/:template_id/preview", (req, res) => {
  const template = getTemplate(db, req.params.template_id);
  const struct = getStructure(db, req.params.structure_id);
  const eta = getTemplater(req.params.structure_id);

  const context = vm.createContext({ it: null });
  vm.runInContext(template.test_object, context);

  context.it.route = function (url) {
    return struct.route_prefix ? path.join(struct.route_prefix, url) : url;
  };

  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render(template.name, context.it),
      null,
      null,
      null,
      struct.head_injection,
      false
    )
  );
});

app.get("/workshop/:structure_id/route/:id", (req, res) => {
  const route = getRoute(db, req.params.id);
  let routePrefix = getStructure(db, req.params.structure_id).route_prefix;
  let previewUrl = routePrefix
    ? path.join(routePrefix || "", route.path)
    : route.path;

  console.log(previewUrl, "baba");
  // let previewUrl = prefixUrlWithHost(
  //   req,
  //   routePrefix ? path.join(routePrefix.substring(1), route.path) : route.path
  // );

  console.log(previewUrl);
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/route", {
        route: route,
        previewUrl:
          route["verb"] == "GET" ? previewUrl : "/workshop/do-something-here",
        ...sidebarStuff(db, req.params.structure_id),
      })
    )
  );
});

// POST route to handle file upload
app.post("/workshop/:structure_id/files", (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send("failed to upload that file");
  }

  const { structure_id } = req.params;
  const file = req.files.file;
  const name = file.name;
  const [mime_type, mime_subtype] = file.mimetype.split("/");
  const uploadPath = path.join(__dirname, "public", structure_id);
  const storedPath = path.join(structure_id, file.name);

  fs.mkdirSync(uploadPath, { recursive: true });

  file.mv(path.join(uploadPath, name), (err) => {
    try {
      if (err) {
        return res.status(500).send(err);
      }

      let id = createFile(
        db,
        structure_id,
        name,
        storedPath,
        mime_type,
        mime_subtype
      );

      let file = getFile(db, id);
      file.url = prefixUrlWithHost(req, file.path);

      return res.send(eta.render("workshop/file_detail", { file: file }));
    } catch (e) {
      res.status(500);
      return res.send(e);
    }
  });
});

function prefixUrlWithHost(req, path) {
  return req.protocol + "://" + req.get("host") + "/" + path;
}

// POST route to handle file upload
app.get("/workshop/:structure_id/files", (req, res) => {
  const { structure_id } = req.params;

  const files = getFilesForStruct(db, structure_id);
  files.map((it) => {
    it.url = prefixUrlWithHost(req, it.path);
  });

  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/files", {
        files,
        ...sidebarStuff(db, structure_id),
      })
    )
  );
});

app.get("/workshop/:structure_id/settings", (req, res) => {
  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/settings", {
        ...sidebarStuff(db, req.params.structure_id),
      })
    )
  );
});

app.put("/workshop/:structure_id/settings", (req, res) => {
  let structId = req.params.structure_id;
  let struct = getStructure(db, structId);
  let routePrefix = req.body.route_prefix;

  if (routePrefix[0] != "/") {
    routePrefix = "/" + routePrefix;
  }
  if (routePrefix[routePrefix.length - 1] == "/") {
    routePrefix = routePrefix.substring(0, routePrefix.length - 1);
  }

  updateStruct(db, {
    ...struct,
    route_prefix: routePrefix,
    head_injection: req.body.head_injection,
  });
  struct = getStructure(db, structId);

  res.send("success!");
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

app.get("/workshop/:structure_id/clone_modal", (req, res) => {
  const structure = getStructure(db, req.params.structure_id);
  const dbs = getDbsForStructure(db, req.params.structure_id);

  return res.send(
    bootstrapTemplateWithHTMXetc(
      eta.render("workshop/clone_structure_modal", {
        structure,
        dbs,
        defaultRoutePrefix: path.join(structure.route_prefix || "", "clone"),
      })
    )
  );
});

function embedHTML(url) {
  return `<div hx-get="${url}" hx-trigger="load"></div>`;
}

app.all("*", (req, res) => {
  const req_path = req.path;
  const verb = req.method;

  try {
    let routeMatch = null;

    for (let { matcher, id } of routes[verb]) {
      let matchFromRoute = matcher(req_path);
      if (matchFromRoute) {
        routeMatch = { params: matchFromRoute.params, id: id };
      }
    }

    if (routeMatch) {
      req.params = routeMatch.params;
      const route = db
        .prepare("SELECT * FROM routes WHERE id = ?")
        .get(routeMatch.id);

      const structure = getStructure(db, route.structure_id);
      const __urlPrefix = structure.route_prefix;

      try {
        // todo: only add req res to contexst when running the handler()
        // which means moving to runscript instead of runincontext for that
        let context = bootstrapContext(db, route.structure_id, {
          req,
          res,
          eta,
        });

        res.render = (template, context) => {
          context = context || {};
          context.route = function (url) {
            return __urlPrefix ? path.join(__urlPrefix, url) : url;
          };
          const eta = getTemplater(route.structure_id);
          res.send(
            bootstrapTemplateWithHTMXetc(
              eta.render(template, context),
              `/workshop/${route.structure_id}/route/${route.id}`,
              `/workshop/${route.structure_id}/clone_modal/`,
              verb == "GET" ? embedHTML(req.originalUrl) : null,
              structure.head_injection,
              req.headers["hx-request"]
            )
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
