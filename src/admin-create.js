'use strict';
// Create the first admin account:  node src/admin-create.js <username> <name>
// Generates a random temporary password and prints it once. Change it after signing in.
const crypto = require('crypto');
const db = require('./db');
const { hashPassword } = require('./auth');

(async () => {
  const [username, name] = process.argv.slice(2);
  if (!username || !name || !/^[a-z0-9._-]{3,40}$/.test(username)) {
    console.error('Usage: node src/admin-create.js <username (lowercase)> <name>');
    process.exit(1);
  }
  await db.init();
  const pw = crypto.randomBytes(12).toString('base64url');
  await db.tx(async (q) => {
    const { rows } = await q.query('select 1 from users where username = $1', [username]);
    if (rows.length) throw new Error('That username is already taken.');
    const { rows: [u] } = await q.query('insert into users(username, name, password_hash) values ($1,$2,$3) returning id', [username, name, await hashPassword(pw)]);
    await q.query(`insert into user_roles(user_id, role) values ($1, 'admin')`, [u.id]);
    await q.query(`insert into audit_log(user_id, action, entity, entity_id, detail) values ($1, 'user.create', 'user', $2, '{"via":"admin-create"}')`, [u.id, String(u.id)]);
  });
  console.log(`Admin account created. Username: ${username}  Temporary password: ${pw}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
