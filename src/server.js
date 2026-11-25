'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const db = require('./db');
const auth = require('./auth');
const { router } = require('./routes');
const { seed } = require('./seed');

async function main() {
  const info = await db.init();
  console.log(`DB: ${info.kind}${info.fresh ? ' (new)' : ''}`);
  // Demo data only for the demo (npm run demo / start.bat) or when asked. A real install starts empty and asks for the first admin.
  const demo = process.env.DEMO_LOGIN === 'true' || process.env.SEED_DEMO === 'true';
  // Also seeds a database that exists but has no accounts yet (created empty at build time by src/prepare-db.js)
  const empty = !info.fresh && Number((await db.query('select count(*)::int as n from users')).rows[0].n) === 0;
  if ((info.fresh || empty) && demo && process.env.SEED_DEMO !== 'false') await seed();

  const app = express();
  app.disable('x-powered-by');
  // Use the real client IP behind the NAS tunnel (Tailscale/Cloudflare)
  // A number (e.g. TRUST_PROXY=1 on Render) means "trust that many proxy hops". Express reads the string "1" as an
  // IP address instead, which trusts nothing, so convert it here.
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp == null || tp === '' ? 'loopback' : /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"], objectSrc: ["'none'"],
        baseUri: ["'none'"],
        // Plain-http test on the office network (start-shared.bat): don't force https, or other PCs get a blank page
        upgradeInsecureRequests: process.env.COOKIE_SECURE === 'false' ? null : [],
      },
    },
    strictTransportSecurity: process.env.COOKIE_SECURE === 'false' ? false : { maxAge: 31536000 },
  }));
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  // Demo only: shows demo-account buttons on the sign-in page. Never enable in production
  if (process.env.DEMO_LOGIN === 'true') {
    const { USERS, DEMO_PASSWORD } = require('./seed');
    const L = require('../shared/logic');
    // Buttons come from the demo accounts that really exist in this database (names as the admin set them), one per account
    app.get('/demo-accounts', async (req, res, next) => {
      try {
        const { rows } = await db.query(`select u.username, u.name, coalesce(array_agg(r.role) filter (where r.role is not null), '{}') as roles
          from users u left join user_roles r on r.user_id = u.id where u.active and u.username = any($1) group by u.id order by u.id`, [USERS.map((x) => x[0])]);
        res.set('Cache-Control', 'no-store');
        res.json({ password: DEMO_PASSWORD, users: rows.map((x) => [x.username, `${Object.keys(L.ROLES).filter((k) => x.roles.includes(k)).map((k) => L.ROLES[k]).join(', ')} - ${x.name}`]) });
      } catch (e) { next(e); }
    });
  }
  app.post('/api/login', (req, res, next) => auth.login(req, res).catch(next));
  app.get('/api/setup', (req, res, next) => auth.setupNeeded().then((needed) => res.json({ needed })).catch(next));
  app.post('/api/setup', (req, res, next) => auth.setup(req, res).catch(next));
  app.get('/api/push/key', (req, res, next) => require('./notify').publicKey().then((key) => res.json({ key })).catch(next));
  app.use('/api', auth.authenticate);
  app.post('/api/logout', (req, res, next) => auth.logout(req, res).catch(next));
  app.use('/api', router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Service worker and manifest must always be fresh so phones pick up new versions
  app.get(['/sw.js', '/manifest.webmanifest'], (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  // Error responses never include internals (stack traces, SQL)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.expose) return res.status(err.status || 400).json({ ...(err.extra || {}), error: err.message });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again shortly.' });
  });

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => console.log(`http://${host}:${port}`));
  require('./notify').startWatcher();
}

main().catch((e) => { console.error(e); process.exit(1); });
