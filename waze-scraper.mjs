#!/usr/bin/env node
/**
 * Waze scraper — runs on Mac (residential IP) to bypass Waze's CF-IP block.
 * Strategy: navigate to waze.com/live-map for each NSW city, intercept the
 * georss API responses that Waze's own JS fires, collect & deduplicate reports,
 * then POST to the Radar Worker's /api/admin/waze-ingest endpoint.
 *
 * Usage:  node waze-scraper.mjs          (run once)
 *         node waze-scraper.mjs --loop   (run every 5 min forever)
 */

import pkg from '/Users/maverick/.claude/mcp-servers/browser-gui/node_modules/playwright/index.js';
const { chromium } = pkg;

const WORKER_INGEST = 'https://radar.theradicalparty.com/api/admin/waze-ingest';
const ADMIN_KEY     = 'boob';

// Cities spread across NSW — each page load fetches surrounding tiles
const NSW_LOCATIONS = [
  [-33.870, 151.210, 'Sydney'],
  [-33.720, 150.310, 'Blue Mtns / W Sydney'],
  [-34.430, 150.890, 'Wollongong'],
  [-32.930, 151.780, 'Newcastle'],
  [-35.280, 149.130, 'Canberra area'],
  [-31.090, 150.960, 'Tamworth'],
  [-29.680, 148.110, 'NW NSW'],
];

function mapWazeAlert(type, sub = '') {
  switch (type) {
    case 'POLICE':
      return { type: 'police', label: sub === 'POLICE_HIDING' ? 'Hidden police' : sub === 'POLICE_CAR_STOPPED' ? 'Police stopped' : 'Police' };
    case 'ACCIDENT':
      return { type: 'accident', label: sub === 'ACCIDENT_MAJOR' ? 'Major accident' : 'Accident' };
    case 'HAZARD':
      if (sub.includes('WEATHER_FOG'))    return { type: 'weather',      label: 'Fog' };
      if (sub.includes('WEATHER_RAIN'))   return { type: 'weather',      label: 'Heavy rain' };
      if (sub.includes('WEATHER_FLOOD'))  return { type: 'weather',      label: 'Flooding' };
      if (sub.includes('WEATHER_HAIL'))   return { type: 'weather',      label: 'Hail' };
      if (sub.includes('WEATHER'))        return { type: 'weather',      label: 'Weather hazard' };
      if (sub.includes('CONSTRUCTION') || sub.includes('ROAD_WORK')) return { type: 'roadwork', label: 'Road works' };
      if (sub === 'HAZARD_ON_ROAD_LANE_CLOSED')         return { type: 'blocked_lane', label: 'Lane closed' };
      if (sub === 'HAZARD_ON_ROAD_OBJECT')              return { type: 'hazard',       label: 'Object on road' };
      if (sub === 'HAZARD_ON_ROAD_POT_HOLE')            return { type: 'hazard',       label: 'Pothole' };
      if (sub === 'HAZARD_ON_ROAD_TRAFFIC_LIGHT_FAULT') return { type: 'hazard',       label: 'Traffic light fault' };
      if (sub === 'HAZARD_ON_ROAD_CAR_STOPPED')         return { type: 'hazard',       label: 'Broken down vehicle' };
      if (sub === 'HAZARD_ON_SHOULDER_ANIMALS')         return { type: 'hazard',       label: 'Animals on road' };
      if (sub === 'HAZARD_ON_ROAD_ICE')                 return { type: 'weather',      label: 'Ice on road' };
      return { type: 'hazard', label: 'Road hazard' };
    case 'ROAD_CLOSED':
      return { type: sub === 'ROAD_CLOSED_CONSTRUCTION' ? 'roadwork' : 'closure', label: 'Road closed' };
    default: return null;
  }
}

function processResponse(data, seen) {
  for (const alert of data.alerts ?? []) {
    if (seen.has(alert.uuid)) continue;
    const mapped = mapWazeAlert(alert.type, alert.subtype ?? '');
    if (!mapped) continue;
    const street = alert.street ? ` on ${alert.street}` : '';
    const city   = alert.city   ? `, ${alert.city}`    : '';
    seen.set(alert.uuid, {
      uuid: alert.uuid,
      lat:  alert.location.y,
      lng:  alert.location.x,
      type: mapped.type,
      description: `${mapped.label}${street}${city}`,
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
      uuid: jam.uuid,
      lat:  mid.y,
      lng:  mid.x,
      type: 'traffic',
      description: `${sev}${spd}${street}`,
    });
  }
}

async function scrape() {
  // Use Brave (real browser) — headless Chromium gets 403 from Waze bot detection
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const seen = new Map();
  let tileCount = 0;

  // Intercept georss responses BEFORE any navigation
  page.on('response', async (response) => {
    if (!response.url().includes('georss')) return;
    try {
      const data = await response.json();
      processResponse(data, seen);
      tileCount++;
    } catch {}
  });

  try {
    for (const [lat, lng, label] of NSW_LOCATIONS) {
      const url = `https://www.waze.com/en-GB/live-map?ll=${lat},${lng}&zoom=11`;
      process.stdout.write(`  ${label}… `);
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
      } catch {
        // networkidle timeout is fine — we just want the initial tile burst
      }
      process.stdout.write(`${seen.size} reports so far\n`);
    }

    const reports = [...seen.values()];
    console.log(`Total: ${reports.length} unique reports from ${tileCount} tiles`);

    if (!reports.length) {
      console.log('Nothing to ingest — Waze may still be blocking.');
      return;
    }

    const res = await fetch(WORKER_INGEST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
      body: JSON.stringify({ reports }),
    });
    const result = await res.json();
    console.log(`Ingested: ${result.upserted} (${new Date().toLocaleTimeString('en-AU')})`);

  } finally {
    await browser.close();
  }
}

const loop = process.argv.includes('--loop');

async function run() {
  console.log(`[${new Date().toLocaleTimeString('en-AU')}] Scraping Waze…`);
  try {
    await scrape();
  } catch (e) {
    console.error('Scrape failed:', e.message);
  }
  if (loop) {
    console.log('Sleeping 5 min…\n');
    setTimeout(run, 5 * 60 * 1000);
  }
}

run();
