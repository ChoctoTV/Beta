#!/usr/bin/env node
/**
 * updatescopes — forces a fresh Twitch OAuth via Device Code flow.
 * Deletes the stored token so OAuthManager runs the full auth flow,
 * then opens twitch.tv/activate in the default browser.
 * Run via: ./start.sh updatescopes
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VAULT = path.join(process.cwd(), 'vault', 'data', 'oauth.json');

// Clear stored token so OAuthManager does a fresh flow
if (fs.existsSync(VAULT)) {
  fs.unlinkSync(VAULT);
  console.log('[updatescopes] Cleared stored OAuth token — requesting fresh authorization');
}

// Load client ID from .env / Secret file
require('../services/OAuthManager');  // ensure module is available
const clientId = process.env.TWITCH_CLIENT_ID;
if (!clientId) {
  console.error('[updatescopes] TWITCH_CLIENT_ID not set — run ./start.sh verifyenv first');
  process.exit(1);
}

// Try to open browser to twitch.tv/activate (works on desktop/local)
try {
  execSync('xdg-open https://www.twitch.tv/activate 2>/dev/null || open https://www.twitch.tv/activate 2>/dev/null || true', { stdio:'ignore' });
} catch {}

// Run device code OAuth flow
const OAuthManager = require('../services/OAuthManager');
OAuthManager.ensureToken(clientId, true)  // true = allow device code flow
  .then(() => {
    console.log('[updatescopes] New token saved to vault/data/oauth.json');
    console.log('[updatescopes] Restart ChoctoTV to use the new token.');
    process.exit(0);
  })
  .catch(e => {
    console.error('[updatescopes] Authorization failed:', e.message);
    process.exit(1);
  });
