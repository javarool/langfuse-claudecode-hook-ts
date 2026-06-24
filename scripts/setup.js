#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt, defaultVal) {
  const label = defaultVal ? `${prompt} [${defaultVal}]: ` : `${prompt}: `;
  return new Promise((resolve) => {
    rl.question(label, (ans) => resolve(ans.trim() || defaultVal || ''));
  });
}

async function main() {
  console.log('Configure Langfuse credentials for this project:\n');

  const pk  = await ask('Public key (pk-lf-...)');
  const sk  = await ask('Secret key (sk-lf-...)');
  const url = await ask('Base URL', 'https://cloud.langfuse.com');
  const uid = await ask('User ID (email, optional)');
  const env = await ask('Environment name (optional)');

  rl.close();

  if (!pk || !sk) {
    console.error('Public key and secret key are required.');
    process.exit(1);
  }

  const settingsPath = '.claude/settings.local.json';
  const settings = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    : {};

  settings.env = settings.env || {};
  settings.env.TRACE_TO_LANGFUSE    = 'true';
  settings.env.LANGFUSE_PUBLIC_KEY  = pk;
  settings.env.LANGFUSE_SECRET_KEY  = sk;
  settings.env.LANGFUSE_BASE_URL    = url;
  if (uid) settings.env.CC_LANGFUSE_USER_ID     = uid;
  if (env) settings.env.CC_LANGFUSE_ENVIRONMENT = env;

  fs.mkdirSync('.claude', { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(`\nCredentials saved to ${settingsPath}`);
  console.log('Make sure .claude/settings.local.json is in your .gitignore.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
