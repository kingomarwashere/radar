/**
 * One-time setup: opens a real Chromium window so you can log into Waze,
 * then saves the session cookies to waze-cookies.json for the headless scraper.
 *
 * Run: node /Users/maverick/radar/scraper/setup.mjs
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DIR         = dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = join(DIR, 'waze-cookies.json');

async function testAuth(page) {
  const status = await page.evaluate(async () => {
    try {
      const r = await fetch('https://www.waze.com/live-map/api/georss?top=-33.5&bottom=-34.2&left=150.5&right=151.5&env=row&types=alerts&ma=1', {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
      });
      return r.status;
    } catch { return 0; }
  });
  return status === 200;
}

console.log('\n══════════════════════════════════════════════════');
console.log('  RADAR — Waze one-time login setup');
console.log('══════════════════════════════════════════════════\n');
console.log('A browser window will open. Log in to Waze (via Google');
console.log('or your Waze account), then come back here.\n');

const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});

const context = await browser.newContext({
  userAgent:   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport:    { width: 1280, height: 800 },
  locale:      'en-AU',
  timezoneId:  'Australia/Sydney',
  geolocation: { latitude: -33.8688, longitude: 151.2093 },
  permissions: ['geolocation'],
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = { runtime: {} };
});

const page = await context.newPage();
await page.goto('https://www.waze.com/en-GB/live-map', { waitUntil: 'domcontentloaded', timeout: 60_000 });

console.log('Browser open — log in to Waze now.');
console.log('Checking every 5 seconds...\n');

let attempts = 0;
let loggedIn = false;

while (attempts < 60) { // wait up to 5 minutes
  await new Promise(r => setTimeout(r, 5_000));
  attempts++;

  loggedIn = await testAuth(page);
  if (loggedIn) break;

  if (attempts % 6 === 0) {
    process.stdout.write(`Still waiting for login... (${attempts * 5}s)\n`);
  }
}

if (!loggedIn) {
  console.error('\nTimed out waiting for login. Try again.');
  await browser.close();
  process.exit(1);
}

console.log('\n✓ Login detected! Saving cookies...');
const cookies = await context.cookies();
writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
console.log(`✓ Saved ${cookies.length} cookies to ${COOKIES_FILE}`);
console.log('\nNow start the scraper:');
console.log('  pm2 start /Users/maverick/radar/scraper/ecosystem.config.cjs\n');

await browser.close();
process.exit(0);
