'use strict';

// Create an admin user.
//   Interactive:      npm run create-admin
//   Non-interactive:  ADMIN_NAME=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin

const readline = require('node:readline/promises');
const { loadDotEnv } = require('../src/env');
const { parseDatabaseUrl } = require('../src/config');
const { openDatabase } = require('../src/db');
const { validateNewUser } = require('../src/validation');
const { createUser } = require('../src/routes/users');

function askHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    let inEscape = false;
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };
    function onData(chunk) {
      for (const ch of chunk) {
        if (inEscape) {
          if (/[@-~]/.test(ch) && ch !== '[') inEscape = false;
          continue;
        }
        if (ch === '\u001b') {
          inEscape = true;
        } else if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          cleanup();
          resolve(value);
          return;
        } else if (ch === '\u0003') {
          cleanup();
          process.exit(130);
        } else if (ch === '\u007f' || ch === '\b') {
          value = [...value].slice(0, -1).join('');
        } else if (ch >= ' ') {
          value += ch;
        }
      }
    }
    stdin.on('data', onData);
  });
}

async function promptInteractive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const name = (await rl.question('Name: ')).trim();
  const email = (await rl.question('Email: ')).trim();
  rl.close();
  const password = await askHidden('Password (min 10 characters, not shown): ');
  const confirm = await askHidden('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match.');
  return { name, email, password };
}

async function main() {
  loadDotEnv();
  const env = process.env;
  let input;
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    input = { name: env.ADMIN_NAME || 'Admin', email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD };
  } else if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    console.log('Create the first Sloka dashboard admin.');
    input = await promptInteractive();
  } else {
    throw new Error(
      'No interactive terminal detected (e.g. Git Bash/mintty). Run from PowerShell/cmd, or set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD.',
    );
  }

  const { values, errors } = validateNewUser({ ...input, role: 'admin' });
  if (Object.keys(errors).length) {
    throw new Error(Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join('\n'));
  }

  const settings = parseDatabaseUrl(env.DATABASE_URL);
  const db = await openDatabase(settings);
  try {
    if (await db.get('SELECT id FROM users WHERE email = ?', [values.email])) {
      throw new Error(`A user with email ${values.email} already exists.`);
    }
    const id = await createUser(db, values, 12);
    console.log(`Admin "${values.name}" <${values.email}> created (id ${id}) in ${settings.host}/${settings.database}.`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(`create-admin failed: ${err.message}`);
  process.exit(1);
});
