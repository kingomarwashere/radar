/* ═══════════════════════════════════════════════
   MAP SETUP
═══════════════════════════════════════════════ */
const map = L.map('map', { center: [-27.5, 133.5], zoom: 5, zoomControl: false });

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '©OpenStreetMap ©CartoDB', subdomains: 'abcd', maxZoom: 20,
}).addTo(map);

L.control.zoom({ position: 'bottomleft' }).addTo(map);
map.locate({ setView: true, maxZoom: 14, timeout: 8000 });

/* ═══════════════════════════════════════════════
   LAYER GROUPS
═══════════════════════════════════════════════ */
const reportCluster = L.markerClusterGroup({ maxClusterRadius: 40, disableClusteringAtZoom: 15 });
const cameraCluster = L.markerClusterGroup({ maxClusterRadius: 60, disableClusteringAtZoom: 14 });
map.addLayer(reportCluster);
map.addLayer(cameraCluster);

/* ═══════════════════════════════════════════════
   ICONS
═══════════════════════════════════════════════ */
function makeIcon(emoji, color = '#ff4545') {
  return L.divIcon({
    html: `<div style="background:${color};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.2)">${emoji}</div>`,
    className: '', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -20],
  });
}
const ICONS = {
  police:     makeIcon('🚔', '#ff4545'),
  speed_trap: makeIcon('📸', '#ff8c00'),
  accident:   makeIcon('⚠️', '#ffcc00'),
  hazard:     makeIcon('🚧', '#ff8c00'),
  speed:      makeIcon('📷', '#3b82f6'),
  red_light:  makeIcon('🔴', '#ef4444'),
  average_speed: makeIcon('📡', '#8b5cf6'),
};

/* ═══════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════ */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2-lon1)*r) * Math.cos(lat2*r);
  const x = Math.cos(lat1*r)*Math.sin(lat2*r) - Math.sin(lat1*r)*Math.cos(lat2*r)*Math.cos((lon2-lon1)*r);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m/1000).toFixed(1)}km`;
}
function fmtTime(sec) {
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min/60)}h ${min % 60}m`;
}
function fmtETA(sec) {
  return new Date(Date.now() + sec*1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Valhalla polyline-6 decoder
function decodePolyline6(str) {
  let idx = 0, lat = 0, lng = 0;
  const out = [];
  while (idx < str.length) {
    let b, shift = 0, res = 0;
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (res & 1) ? ~(res >> 1) : res >> 1;
    shift = res = 0;
    do { b = str.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (res & 1) ? ~(res >> 1) : res >> 1;
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}

// Find nearest point index on route
function nearestOnRoute(pts, lat, lng) {
  let minD = Infinity, minI = 0;
  for (let i = 0; i < pts.length; i++) {
    const d = haversine(pts[i][0], pts[i][1], lat, lng);
    if (d < minD) { minD = d; minI = i; }
  }
  return { idx: minI, dist: minD };
}

// Valhalla maneuver type → arrow
const MANEUVER_ARROW = {
  1:'↑',2:'↑',3:'↑',    // start
  4:'🏁',5:'🏁',6:'🏁', // arrive
  7:'↑',8:'↑',          // continue/becomes
  9:'↗',18:'↗',22:'↗',  // slight right / ramp right / stay right
  10:'→',               // right
  11:'↪',               // sharp right
  12:'↩',13:'↩',        // u-turn
  14:'↩',               // sharp left
  15:'←',               // left
  16:'↖',19:'↖',23:'↖', // slight left / ramp left / stay left
  24:'⇒',               // merge
  25:'↻',26:'↑',        // roundabout
  17:'↑',               // ramp straight
  28:'⛴',               // ferry exit
};

/* ═══════════════════════════════════════════════
   REPORTS
═══════════════════════════════════════════════ */
let visibleLayers = { police: true, speed: true, red_light: true };
let fetchTimeout = null;

async function loadReports() {
  if (map.getZoom() < 10) return;
  const b = map.getBounds();
  const p = new URLSearchParams({
    swlat: b.getSouth(), swlng: b.getWest(),
    nelat: b.getNorth(), nelng: b.getEast(),
  });
  try {
    const data = await fetch(`/api/reports?${p}`).then(r => r.json());
    reportCluster.clearLayers();
    for (const r of data) {
      if (!visibleLayers.police) continue;
      const icon = ICONS[r.type] ?? ICONS.police;
      const age = Math.round((Date.now() - r.created_at) / 60000);
      const label = { police:'🚔 Police', speed_trap:'📸 Speed trap', accident:'⚠️ Accident', hazard:'🚧 Hazard' }[r.type] ?? r.type;
      const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age/60)}h ago`;
      const popup = `<strong>${label}</strong>${r.description?`<p>${escHtml(r.description)}</p>`:''}<p>${ageStr} · ✅ ${r.confirms} 👎 ${r.denies}</p><div class="popup-actions"><button class="popup-confirm" onclick="vote('${r.id}','confirm')">✅ Still there</button><button class="popup-deny" onclick="vote('${r.id}','deny')">👎 Gone</button></div>`;
      reportCluster.addLayer(L.marker([r.lat, r.lng], { icon }).bindPopup(popup));
    }
  } catch {}
}

window.vote = async (id, action) => {
  try { await fetch(`/api/reports/${id}/${action}`, { method: 'POST' }); loadReports(); } catch {}
};

async function loadCameras() {
  if (map.getZoom() < 11) { cameraCluster.clearLayers(); return; }
  const b = map.getBounds();
  const p = new URLSearchParams({
    swlat: b.getSouth(), swlng: b.getWest(),
    nelat: b.getNorth(), nelng: b.getEast(),
  });
  try {
    const data = await fetch(`/api/cameras?${p}`).then(r => r.json());
    cameraCluster.clearLayers();
    for (const cam of data) {
      if (cam.type === 'speed' && !visibleLayers.speed) continue;
      if ((cam.type === 'red_light' || cam.type === 'average_speed') && !visibleLayers.red_light) continue;
      const icon = ICONS[cam.type] ?? ICONS.speed;
      const label = { speed:'📷 Speed camera', red_light:'🔴 Red light camera', average_speed:'📡 Avg speed' }[cam.type] ?? cam.type;
      const popup = `<strong>${label}</strong>${cam.road?`<p>📍 ${escHtml(cam.road)}</p>`:''} ${cam.speed_limit?`<p>⚡ ${cam.speed_limit} km/h zone</p>`:''} ${cam.state?`<p>📌 ${cam.state}</p>`:''}<p style="color:#555;font-size:.7rem">Source: ${cam.source.toUpperCase()}</p>`;
      cameraCluster.addLayer(L.marker([cam.lat, cam.lng], { icon }).bindPopup(popup));
    }
  } catch {}
}

function scheduleFetch() {
  clearTimeout(fetchTimeout);
  fetchTimeout = setTimeout(() => { loadReports(); loadCameras(); }, 300);
}

map.on('moveend', scheduleFetch);
map.on('zoomend', scheduleFetch);
scheduleFetch();
setInterval(loadReports, 90_000);

/* ═══════════════════════════════════════════════
   FILTER BUTTONS
═══════════════════════════════════════════════ */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const layer = btn.dataset.layer;
    visibleLayers[layer] = !visibleLayers[layer];
    btn.classList.toggle('active', visibleLayers[layer]);
    loadReports(); loadCameras();
  });
});

/* ═══════════════════════════════════════════════
   REPORT FLOW
═══════════════════════════════════════════════ */
let pendingLat = null, pendingLng = null, selectedType = 'police';
const reportBtn    = document.getElementById('report-btn');
const modalOverlay = document.getElementById('modal-overlay');
const cancelBtn    = document.getElementById('cancel-btn');
const submitBtn    = document.getElementById('submit-btn');
const modalCoords  = document.getElementById('modal-coords');
const descInput    = document.getElementById('desc-input');

reportBtn.addEventListener('click', () => {
  const c = map.getCenter();
  pendingLat = c.lat; pendingLng = c.lng;
  modalCoords.textContent = `📍 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  descInput.value = '';
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="police"]').classList.add('active');
  selectedType = 'police';
  modalOverlay.classList.remove('hidden');
});

map.on('click', e => {
  if (!modalOverlay.classList.contains('hidden')) {
    pendingLat = e.latlng.lat; pendingLng = e.latlng.lng;
    modalCoords.textContent = `📍 ${pendingLat.toFixed(5)}, ${pendingLng.toFixed(5)}`;
  }
});

document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); selectedType = btn.dataset.type;
  });
});

cancelBtn.addEventListener('click', () => modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.add('hidden'); });

submitBtn.addEventListener('click', async () => {
  if (pendingLat == null) return;
  submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
  try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: pendingLat, lng: pendingLng, type: selectedType, description: descInput.value.trim() || undefined }),
    });
    if (res.ok) {
      modalOverlay.classList.add('hidden');
      map.setView([pendingLat, pendingLng], Math.max(map.getZoom(), 14));
      loadReports();
    } else { const e = await res.json(); alert(e.error ?? 'Failed'); }
  } catch { alert('Network error'); }
  finally { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
});

/* ═══════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════ */
const topbar       = document.getElementById('topbar');
const searchBar    = document.getElementById('search-bar');
const searchInput  = document.getElementById('search-input');
const searchResults= document.getElementById('search-results');
const searchClose  = document.getElementById('search-close');
const searchToggle = document.getElementById('search-toggle');
const previewBar   = document.getElementById('preview-bar');
const previewDist  = document.getElementById('preview-dist');
const previewTime  = document.getElementById('preview-time');
const previewETA   = document.getElementById('preview-eta');
const startNavBtn  = document.getElementById('start-nav-btn');
const cancelRoute  = document.getElementById('cancel-route-btn');
const navInst      = document.getElementById('nav-instruction');
const navIcon      = document.getElementById('nav-icon');
const navDist      = document.getElementById('nav-dist');
const navStreet    = document.getElementById('nav-street');
const navFooter    = document.getElementById('nav-footer');
const navETA       = document.getElementById('nav-eta');
const navRemaining = document.getElementById('nav-remaining');
const speedLimitSign = document.getElementById('speed-limit-sign');
const speedLimitVal  = document.getElementById('speed-limit-val');
const currentSpeed   = document.getElementById('current-speed');
const endNavBtn    = document.getElementById('end-nav-btn');

// Navigation state
let navState = 'idle'; // idle | searching | preview | navigating
let routeData = null;  // Valhalla trip object
let routePoints = [];  // [lat, lng][]
let maneuvers = [];    // Valhalla maneuver[]
let routeLine = null;
let destMarker = null;
let userMarker = null;
let watchId = null;
let currentManeuverIdx = 0;
let offRouteCount = 0;
let lastSpokenManeuver = -1;
let remainingSec = 0;
let prevPos = null;

// User position marker
function makeUserMarker(lat, lng, hdg = 0) {
  const icon = L.divIcon({
    html: `<span class="user-arrow" style="transform:rotate(${hdg}deg)">▲</span>`,
    className: '', iconSize: [32, 32], iconAnchor: [16, 16],
  });
  return L.marker([lat, lng], { icon, zIndexOffset: 1000 });
}

/* ── Search ─────────────────────────────────────── */
searchToggle.addEventListener('click', () => openSearch());
searchClose.addEventListener('click', () => closeSearch());

function openSearch() {
  topbar.classList.add('hidden');
  searchBar.classList.remove('hidden');
  searchInput.focus();
  navState = 'searching';
}
function closeSearch() {
  topbar.classList.remove('hidden');
  searchBar.classList.add('hidden');
  searchResults.innerHTML = '';
  searchInput.value = '';
  if (navState === 'searching') navState = 'idle';
}

let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 3) { searchResults.innerHTML = ''; return; }
  searchDebounce = setTimeout(() => geocodeSearch(q), 400);
});

async function geocodeSearch(q) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`;
    const results = await fetch(url, { headers: { 'Accept-Language': 'en' } }).then(r => r.json());
    searchResults.innerHTML = '';
    if (!results.length) {
      searchResults.innerHTML = '<div class="search-result" style="color:#666">No results</div>';
      return;
    }
    results.forEach(r => {
      const el = document.createElement('div');
      el.className = 'search-result';
      const parts = r.display_name.split(',');
      const name = parts[0].trim();
      const addr = parts.slice(1, 3).join(',').trim();
      el.innerHTML = `<strong>${escHtml(name)}</strong>${escHtml(addr)}`;
      el.addEventListener('click', () => selectDestination(r));
      searchResults.appendChild(el);
    });
  } catch {}
}

async function selectDestination(result) {
  closeSearch();
  const destLat = parseFloat(result.lat);
  const destLng = parseFloat(result.lon);

  // Place destination marker
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([destLat, destLng], {
    icon: L.divIcon({ html: '<span class="dest-pin">📍</span>', className: '', iconSize: [32, 40], iconAnchor: [16, 40] })
  }).addTo(map);

  // Calculate route from current user position or map center
  const origin = userMarker ? userMarker.getLatLng() : map.getCenter();
  await calcRoute(origin.lat, origin.lng, destLat, destLng);
}

/* ── Routing ─────────────────────────────────────── */
async function calcRoute(fromLat, fromLng, toLat, toLng) {
  previewBar.classList.add('hidden');
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

  try {
    const body = {
      locations: [
        { lon: fromLng, lat: fromLat },
        { lon: toLng,   lat: toLat   },
      ],
      costing: 'auto',
      directions_options: { units: 'kilometers', language: 'en-US' },
    };

    const resp = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) { alert('Could not find a route.'); return; }
    const data = await resp.json();

    routeData = data.trip;
    maneuvers = routeData.legs[0].maneuvers;
    routePoints = decodePolyline6(routeData.legs[0].shape);

    // Draw route
    routeLine = L.polyline(routePoints, { color: '#3b82f6', weight: 6, opacity: 0.9 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });

    const totalDist = routeData.summary.length; // km
    const totalTime = routeData.summary.time;   // sec

    previewDist.textContent = fmtDist(totalDist * 1000);
    previewTime.textContent = fmtTime(totalTime);
    previewETA.textContent  = `ETA ${fmtETA(totalTime)}`;
    previewBar.classList.remove('hidden');
    navState = 'preview';

  } catch (e) {
    alert('Routing error: ' + e.message);
  }
}

cancelRoute.addEventListener('click', clearRoute);

function clearRoute() {
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  previewBar.classList.add('hidden');
  navState = 'idle';
  routeData = null; routePoints = []; maneuvers = [];
}

/* ── Start / End navigation ─────────────────────── */
startNavBtn.addEventListener('click', startNavigation);
endNavBtn.addEventListener('click', endNavigation);

function startNavigation() {
  previewBar.classList.add('hidden');
  topbar.classList.add('hidden');
  reportBtn.classList.add('hidden');
  navInst.classList.remove('hidden');
  navFooter.classList.remove('hidden');
  navState = 'navigating';
  currentManeuverIdx = 0;
  lastSpokenManeuver = -1;
  offRouteCount = 0;
  remainingSec = routeData.summary.time;

  // Start GPS tracking
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onGPS, gpsError, {
    enableHighAccuracy: true, maximumAge: 1000, timeout: 10000,
  });

  updateNavPanel();
}

function endNavigation() {
  navState = 'idle';
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  navInst.classList.add('hidden');
  navFooter.classList.add('hidden');
  topbar.classList.remove('hidden');
  reportBtn.classList.remove('hidden');
  clearRoute();
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
  prevPos = null;
  currentSpeed.textContent = '– ';
  currentSpeed.innerHTML = '– <small>km/h</small>';
  speedLimitSign.classList.add('hidden');
}

function gpsError(e) { console.warn('GPS error', e.code, e.message); }

/* ── GPS handler ─────────────────────────────────── */
function onGPS(pos) {
  const { latitude: lat, longitude: lng, speed: rawSpeed, heading } = pos.coords;

  // Update or create user marker
  const hdg = (heading != null && !isNaN(heading)) ? heading
    : (prevPos ? bearing(prevPos.lat, prevPos.lng, lat, lng) : 0);

  if (userMarker) map.removeLayer(userMarker);
  userMarker = makeUserMarker(lat, lng, hdg).addTo(map);

  // Smooth-follow during navigation
  if (navState === 'navigating') {
    map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true, duration: 0.8 });
  } else {
    if (userMarker) {} // already updated
  }

  // Current speed display
  let kmh = null;
  if (rawSpeed != null && !isNaN(rawSpeed)) {
    kmh = Math.round(rawSpeed * 3.6);
  } else if (prevPos) {
    const dt = (pos.timestamp - prevPos.ts) / 1000;
    if (dt > 0) {
      const d = haversine(prevPos.lat, prevPos.lng, lat, lng);
      kmh = Math.round((d / dt) * 3.6);
    }
  }

  if (navState === 'navigating' && kmh != null) {
    currentSpeed.innerHTML = `${kmh} <small>km/h</small>`;
    const limit = getCurrentSpeedLimit();
    if (limit && kmh > limit) {
      currentSpeed.classList.add('over-limit');
      speedLimitSign.classList.add('over-limit');
    } else {
      currentSpeed.classList.remove('over-limit');
      speedLimitSign.classList.remove('over-limit');
    }
  }

  prevPos = { lat, lng, ts: pos.timestamp };

  if (navState !== 'navigating' || !routePoints.length) return;

  // Find where we are on the route
  const { idx, dist } = nearestOnRoute(routePoints, lat, lng);

  // Off-route detection (>60m from route)
  if (dist > 60) {
    offRouteCount++;
    if (offRouteCount >= 3) {
      offRouteCount = 0;
      const dest = maneuvers[maneuvers.length - 1];
      const destPt = routePoints[routePoints.length - 1];
      calcRoute(lat, lng, destPt[0], destPt[1]).then(() => {
        if (navState === 'preview') startNavigation();
      });
      return;
    }
  } else {
    offRouteCount = 0;
  }

  // Update current maneuver
  for (let i = maneuvers.length - 1; i >= 0; i--) {
    if (idx >= maneuvers[i].begin_shape_index) {
      currentManeuverIdx = i;
      break;
    }
  }

  // Distance to NEXT maneuver
  const nextM = maneuvers[currentManeuverIdx + 1] ?? maneuvers[currentManeuverIdx];
  const nextPt = routePoints[nextM.begin_shape_index] ?? routePoints[routePoints.length - 1];
  const distToTurn = haversine(lat, lng, nextPt[0], nextPt[1]);

  // Remaining time estimate (linear progress)
  const totalPts = routePoints.length;
  const progressFraction = Math.min(idx / totalPts, 1);
  remainingSec = Math.round(routeData.summary.time * (1 - progressFraction));

  updateNavPanel(distToTurn);
  checkVoice(currentManeuverIdx, distToTurn);
}

/* ── Nav panel ───────────────────────────────────── */
function updateNavPanel(distToTurn) {
  if (!maneuvers.length) return;
  const nextM = maneuvers[currentManeuverIdx + 1] ?? maneuvers[currentManeuverIdx];
  navIcon.textContent = MANEUVER_ARROW[nextM.type] ?? '↑';
  navDist.textContent = distToTurn != null ? fmtDist(distToTurn) : '';
  navStreet.textContent = (nextM.street_names ?? []).join(' / ') || nextM.instruction || '';

  navETA.textContent = fmtETA(remainingSec);
  navRemaining.textContent = fmtDist(remainingSec * (routeData.summary.length * 1000 / routeData.summary.time)) + ' · ' + fmtTime(remainingSec);

  // Speed limit for current maneuver
  const curM = maneuvers[currentManeuverIdx];
  const limit = curM?.speed_limit;
  if (limit && limit > 0 && limit < 200) {
    speedLimitSign.classList.remove('hidden');
    speedLimitVal.textContent = limit;
  } else {
    speedLimitSign.classList.add('hidden');
  }
}

function getCurrentSpeedLimit() {
  if (!maneuvers.length) return null;
  const m = maneuvers[currentManeuverIdx];
  return (m?.speed_limit && m.speed_limit < 200) ? m.speed_limit : null;
}

/* ── Voice guidance ──────────────────────────────── */
const synth = window.speechSynthesis;

function speak(text) {
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-AU';
  u.rate = 1.05;
  u.volume = 0.9;
  synth.speak(u);
}

function checkVoice(mIdx, dist) {
  if (mIdx === lastSpokenManeuver) return; // already handled this maneuver's full sequence

  const nextM = maneuvers[mIdx + 1];
  if (!nextM) return;

  // Announce at ~1km, ~500m, ~200m before the turn
  const instr = nextM.verbal_pre_transition_instruction ?? nextM.instruction ?? '';

  if (dist <= 220 && dist > 150) {
    speak(nextM.verbal_transition_alert_instruction ?? instr);
    if (dist <= 220) lastSpokenManeuver = mIdx; // mark as spoken
  } else if (dist <= 550 && dist > 450) {
    speak(`In ${fmtDist(dist)}, ${instr}`);
  } else if (dist <= 1050 && dist > 950) {
    speak(`In 1 kilometre, ${instr}`);
  }

  // Arrival
  if (nextM.type === 4 || nextM.type === 5 || nextM.type === 6) {
    if (dist < 30) {
      speak('You have arrived at your destination.');
      lastSpokenManeuver = mIdx;
      setTimeout(endNavigation, 4000);
    }
  }
}
