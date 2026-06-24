#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const HOOK_DIR = process.argv[2] || path.join(os.homedir(), '.claude', 'hooks', 'langfuse-claudecode-ts');
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_COMMAND = `node ${HOOK_DIR}/dist/index.js`;

if (fs.existsSync(SETTINGS)) {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  if (settings.hooks && settings.hooks.Stop) {
    settings.hooks.Stop = settings.hooks.Stop.filter(
      (g) => !(g.hooks || []).some((h) => h.command === HOOK_COMMAND),
    );
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`Hook removed from ${SETTINGS}`);
} else {
  console.log('No settings file found, skipping.');
}

if (fs.existsSync(HOOK_DIR)) {
  execSync(`rm -rf "${HOOK_DIR}"`);
  console.log(`Removed ${HOOK_DIR}`);
}
