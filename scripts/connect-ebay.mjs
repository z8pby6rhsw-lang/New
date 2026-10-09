// One-time helper for linking the dashboard to an eBay seller account.
//
// Step 1 (no input): prints the eBay sign-in link.
// Step 2 (input = the address of the page eBay sent you to after you agreed):
//   swaps it for a long-lived "refresh token", encrypts that with
//   DASHBOARD_PASSWORD and prints the result to paste into the EBAY_REFRESH_TOKEN secret.
import { appendFileSync } from 'node:fs';
import { encryptString } from './crypto.mjs';

const env = (name) => (process.env[name] ?? '').trim();
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
];

function summary(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
}

function fail(message) {
  summary(`### Could not connect eBay\n\n${message}`);
  process.exit(1);
}

const clientId = env('EBAY_CLIENT_ID');
const clientSecret = env('EBAY_CLIENT_SECRET');
const ruName = env('EBAY_RUNAME');
const password = env('DASHBOARD_PASSWORD');
const input = env('EBAY_RETURN_ADDRESS');

const missing = [
  ['EBAY_CLIENT_ID', clientId],
  ['EBAY_CLIENT_SECRET', clientSecret],
  ['EBAY_RUNAME', ruName],
  ['DASHBOARD_PASSWORD', password],
].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) fail(`These secrets are missing: ${missing.join(', ')}. Add them under Settings → Secrets and variables → Actions, then run this again.`);

if (!input) {
  const url = new URL('https://auth.ebay.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: ruName, scope: SCOPES.join(' ') }).toString();
  summary(`### Step 1 of 2: sign in to eBay

1. Open this link and sign in with your **eBay seller account**, then click **Agree**:

   ${url}

2. eBay will show a page saying you're signed in. Copy the **whole address** from your browser's address bar.
3. Within 5 minutes, run **Connect eBay** again and paste that address into the box.`);
  process.exit(0);
}

let code = input;
try {
  const u = new URL(input);
  code = u.searchParams.get('code') || '';
} catch {
  // Not a URL: treat the input as the code itself.
}
if (!code) fail('That address has no sign-in code in it. Make sure you copied it from the page eBay showed after you clicked Agree.');

const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
  },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ruName }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok || !json.refresh_token) {
  fail(`eBay said: ${json.error_description || json.error || res.status}. The sign-in code only lasts 5 minutes and works once. Run Connect eBay with no address to get a fresh link, then try again.`);
}

const sealed = await encryptString(json.refresh_token, password);
const days = Math.round((json.refresh_token_expires_in || 0) / 86400);
summary(`### Step 2 of 2: save your eBay key

eBay is connected. Copy the long line below and save it as a new secret named **EBAY_REFRESH_TOKEN**
(Settings → Secrets and variables → Actions → New repository secret).

It's locked with your dashboard password, so it's safe to see here.

\`\`\`
${sealed}
\`\`\`

This key lasts about ${days || 540} days. eBay will need you to repeat these two steps after that.`);
