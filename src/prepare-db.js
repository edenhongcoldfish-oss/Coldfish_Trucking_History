'use strict';
// Build step for small hosts (Render free plan, 512 MB): creating a brand-new embedded database is the most
// memory-hungry moment (Postgres initdb). Doing it during the build means the running app only opens an existing,
// empty database and loads the demo data into it, which needs far less memory.
//   render.yaml buildCommand: npm ci --omit=dev && node src/prepare-db.js
const db = require('./db');
db.init().then((info) => { console.log(`Database ready (${info.kind}${info.fresh ? ', new' : ''})`); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
