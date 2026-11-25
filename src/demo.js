'use strict';
// Local test on any OS (Windows included): npm run demo
// Uses the embedded database in ./data/pglite (created on first run).
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || 'false'; // plain http on localhost
process.env.DEMO_LOGIN = process.env.DEMO_LOGIN || 'true';
require('./server');
