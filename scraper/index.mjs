/**
 * Waze live-map scraper — runs on your Mac via PM2
 *
 * Loads saved Waze session cookies (from setup.mjs), opens a headless
 * Chromium, fires tile fetches from *inside* the page (same-origin cookies
 * = no 403), and POSTs results to Radar every 5 minutes.
 *
 * If cookies expire (403), logs a warning and exits so PM2 restarts;
 * re-run setup.mjs to refresh them.
 */

import { chromium }  from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const DIR          = dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = join(DIR, 'waze-cookies.json');
const RADAR_INGEST = 'https://radar.theradicalparty.com/api/admin/waze-ingest';
const ADMIN_KEY    = 'boob';
const SCRAPE_MS    = 5 * 60 * 1000;  // scrape every 5 min
const REFRESH_MS   = 20 * 60 * 1000; // reload page every 20 min

const NSW  = { n: -28.15, s: -37.51, w: 140.99, e: 153.64 };
const ROWS = 3;
const COLS = 4;

// ─── Cookie check ────────────────────────────────────────────────────────────

if (!existsSync(COOKIES_FILE)) {
  console.error('No waze-cookies.json found. Run: node setup.mjs');
  process.exit(1);
}

const savedCookies = JSON.parse(readFileSync(COOKIES_FILE, 'utf8'));
console.log(`Loaded ${savedCookies.length} cookies from ${COOKIES_FILE}`);

// ─── Alert type mapping ───────────────────────────────────────────────────────

function mapAlert(type, sub = '') {
  switch (type) {
    case 'POLICE':
      if (sub === 'POLICE_HIDING')      return { type: 'police',  label: 'Hidden police' };
      if (sub === 'POLICE_CAR_STOPPED') return { type: 'police',  label: 'Police stopped' };
      return                                   { type: 'police',  label: 'Police' };
    case 'ACCIDENT':
      return { type: 'accident', label: sub === 'ACCIDENT_MAJOR' ? 'Major accident' : 'Accident' };
    case 'HAZARD':
      if (sub.includes('WEATHER_FOG'))    return { type: 'weather',      label: 'Fog' };
      if (sub.includes('WEATHER_RAIN'))   return { type: 'weather',      label: 'Heavy rain' };
      if (sub.includes('WEATHER_FLOOD'))  return { type: 'weather',      label: 'Flooding' };
      if (sub.includes('WEATHER_HAIL'))   return { type: 'weather',      label: 'Hail' };
      if (sub.includes('WEATHER'))        return { type: 'weather',      label: 'Weather hazard' };
      if (sub.includes('CONSTRUCTION') || sub.includes('ROAD_WORK'))
                                          return { type: 'roadwork',     label: 'Road works' };
      if (sub === 'HAZARD_ON_ROAD_LANE_CLOSED')         return { type: 'blocked_lane', label: 'Lane closed' };
      if (sub === 'HAZARD_ON_ROAD_OBJECT')              return { type: 'hazard',       label: 'Object on road' };
      if (sub === 'HAZARD_ON_ROAD_POT_HOLE')            return { type: 'hazard',       label: 'Pothole' };
      if (sub === 'HAZARD_ON_ROAD_TRAFFIC_LIGHT_FAULT') return { type: 'hazard',       label: 'Traffic light fault' };
      if (sub === 'HAZARD_ON_ROAD_CAR_STOPPED')         return { type: 'hazard',       label: 'Broken down vehicle' };
      if (sub === 'HAZARD_ON_SHOULDER_ANIMALS')         return { type: 'hazard',       label: 'Animals on road' };
      if (sub === 'HAZARD_ON_ROAD_ICE')                 return { type: 'weather',      label: 'Ice on road' };
      return                                            { type: 'hazard',       label: 'Road hazard' };
    case 'ROAD_CLOSED':
      return { type: sub === 'ROAD_CLOSED_CONSTRUCTION' ? 'roadwork' : 'closure', label: 'Road closed' };
    default:
      return null;
  }
}

// ─── Tile fetch (runs inside the browser page — same-origin cookies auto-sent)

async function fetchTile(page, left, bottom, right, top) {
  const url = `https://www.waze.com/live-map/api/georss?top=${top}&bottom=${bottom}&left=${left}&right=${right}&env=row&types=alerts,traffic&ma=500&mj=300`;
  try {
    return await page.evaluate(async (fetchUrl) => {
      try {
        const res = await fetch(fetchUrl, {
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
        });
        return res.ok ? await res.json() : { _status: res.status };
      } catch (e) { return { _err: String(e) }; }
    }, url);
  } catch (e) {
    return { _err: e.message };
  }
}

// ─── Scrape NSW ───────────────────────────────────────────────────────────────

async function scrapeNSW(page) {
  const latStep = (NSW.n - NSW.s) / ROWS;
  const lngStep = (NSW.e - NSW.w) / COLS;

  const seen   = new Map();
  let tilesOk  = 0;
  let tilesErr = 0;
  let auth403  = 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const bottom = NSW.s + r * latStep;
      const top    = bottom + latStep;
      const left   = NSW.w + c * lngStep;
      const right  = left + lngStep;

      const data = await fetchTile(page, left, bottom, right, top);

      if (data._status === 403) { auth403++; continue; }
      if (data._err || data._status) { tilesErr++; continue; }
      tilesOk++;

      for (const alert of data.alerts ?? []) {
        if (seen.has(alert.uuid)) continue;
        const mapped = mapAlert(alert.type, alert.subtype ?? '');
        if (!mapped) continue;
        const street = alert.street ? ` on ${alert.street}` : '';
        const city   = alert.city   ? `, ${alert.city}`     : '';
        seen.set(alert.uuid, {
          uuid: alert.uuid, lat: alert.location.y, lng: alert.location.x,
          type: mapped.type, description: `${mapped.label}${street}${city}`,
        });
      }

      for (const jam of data.jams ?? []) {
        if (seen.has(jam.uuid)) continue;
        if ((jam.level ?? 0) < 3 || !jam.line?.length) continue;
        const mid    = jam.line[Math.floor(jam.line.length / 2)];
        const street = jam.street ? ` on ${jam.street}` : '';
        const sev    = jam.level >= 5 ? 'Road blocked' : jam.level === 4 ? 'Standstill' : 'Heavy traffic';
        const spd    = jam.speedKMH != null ? ` (${Math.round(jam.speedKMH)} km/h)` : '';
        seen.set(jam.uuid, {
          uuid: jam.uuid, lat: mid.y, lng: mid.x,
          type: 'traffic', description: `${sev}${spd}${street}`,
        });
      }
    }
  }

  return { reports: [...seen.values()], tilesOk, tilesErr, auth403 };
}

// ─── POST to Radar ────────────────────────────────────────────────────────────

async function ingest(reports) {
  if (!reports.length) return 0;
  try {
    const res = await fetch(RADAR_INGEST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ reports }),
    });
    const d = await res.json();
    return d.upserted ?? 0;
  } catch (e) {
    console.error('Ingest error:', e.message);
    return 0;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Starting Waze scraper (headless)...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent:   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:    { width: 1440, height: 900 },
    locale:      'en-AU',
    timezoneId:  'Australia/Sydney',
    geolocation: { latitude: -33.8688, longitude: 151.2093 },
    permissions: ['geolocation'],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // Inject saved cookies
  await context.addCookies(savedCookies);

  const page = await context.newPage();

  const loadPage = async () => {
    console.log('Loading waze.com/live-map...');
    await page.goto('https://www.waze.com/en-GB/live-map', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await new Promise(r => setTimeout(r, 6_000));
    console.log('Page ready.');
  };

  await loadPage();
  let lastRefresh = Date.now();
  let consecAuthFails = 0;

  const tick = async () => {
    // Periodic page refresh to keep session alive
    if (Date.now() - lastRefresh > REFRESH_MS) {
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await new Promise(r => setTimeout(r, 4_000));
        lastRefresh = Date.now();
      } catch {
        await loadPage();
        lastRefresh = Date.now();
      }
    }

    try {
      const { reports, tilesOk, tilesErr, auth403 } = await scrapeNSW(page);

      if (auth403 > 6) {
        consecAuthFails++;
        console.warn(`⚠ Session may have expired (${auth403}/12 tiles → 403). Attempt ${consecAuthFails}/3.`);
        if (consecAuthFails >= 3) {
          // Auto-reconnect: spawn setup.mjs which pops a browser window on the Mac
          try {
            await runSetup();
            // Reload fresh cookies
            const newCookies = JSON.parse(readFileSync(COOKIES_FILE, 'utf8'));
            // Restart browser context with new cookies
            await browser.close();
            // Re-create browser + context — restart main loop via process exit + PM2 restart
            console.log('✓ Re-authenticated — restarting scraper...');
            process.exit(0); // PM2 auto-restarts, picks up new cookie file
          } catch (e) {
            console.error('Auto-reconnect failed:', e.message, '— will retry next cycle');
            consecAuthFails = 0; // reset so we try again next time
          }
        }
        return;
      }

      consecAuthFails = 0;
      const upserted     = await ingest(reports);
      const policeCount  = reports.filter(r => r.type === 'police').length;
      const now          = new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney' });
      console.log(`[${now}] ✓ tiles ${tilesOk}ok/${tilesErr}err — ${reports.length} alerts (${policeCount} 🚔) — ${upserted} saved`);
    } catch (e) {
      console.error('Scrape error:', e.message);
      lastRefresh = 0; // force page reload next tick
    }
  };

  await tick();
  setInterval(tick, SCRAPE_MS);
}

// ─── Auto-reconnect ───────────────────────────────────────────────────────────

async function runSetup() {
  return new Promise((resolve, reject) => {
    console.log('🔓 Launching setup.mjs — a browser window will open on your screen...');
    const child = spawn(process.execPath, [join(DIR, 'setup.mjs')], {
      stdio: 'inherit', // show prompts in PM2 logs
    });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`setup.mjs exited ${code}`)));
    child.on('error', reject);
  });
}

main().catch(async err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
