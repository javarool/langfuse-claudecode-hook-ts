#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const HOOK_DIR = process.argv[2] || path.join(os.homedir(), '.claude', 'hooks', 'langfuse-claudecode-ts');
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_COMMAND = `node ${HOOK_DIR}/dist/index.js`;
const ROOT = path.join(__dirname, '..');

// 1. Copy source to hook dir
console.log(`Installing to ${HOOK_DIR} ...`);
fs.mkdirSync(HOOK_DIR, { recursive: true });

for (const entry of ['src', 'package.json', 'package-lock.json', 'tsconfig.json']) {
  const src = path.join(ROOT, entry);
  if (fs.existsSync(src)) {
    execSync(`cp -r "${src}" "${HOOK_DIR}/"`);
  }
}

// 2. Install deps and build inside hook dir
console.log('Building ...');
execSync(`npm install --prefix "${HOOK_DIR}" && npx --prefix "${HOOK_DIR}" tsc -p "${HOOK_DIR}/tsconfig.json"`, { stdio: 'inherit' });

// 3. Register Stop hook in ~/.claude/settings.json
fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
const settings = fs.existsSync(SETTINGS)
  ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
  : {};

settings.hooks = settings.hooks || {};
settings.hooks.Stop = settings.hooks.Stop || [];

const exists = settings.hooks.Stop.some(
  (g) => (g.hooks || []).some((h) => h.command === HOOK_COMMAND),
);

if (!exists) {
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`Hook registered in ${SETTINGS}`);
} else {
  console.log('Hook already registered.');
}

console.log('\nDone! Run `make setup` in your project directory to configure credentials.');
