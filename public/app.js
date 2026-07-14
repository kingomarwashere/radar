/* ═══════════════════════════════════════════════
   MAP TILES
═══════════════════════════════════════════════ */
const TILES = {
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',      sub: 'abcd', attr: '©OpenStreetMap ©CartoDB' },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',     sub: 'abcd', attr: '©OpenStreetMap ©CartoDB' },
  voyager:   { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', sub: 'abcd', attr: '©OpenStreetMap ©CartoDB' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', sub: '', attr: '©Esri' },
  terrain:   { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', sub: 'abc', attr: '©OpenStreetMap ©OpenTopoMap' },
};

let currentStyle = 'dark';
let tileLayer = null;

const map = L.map('map', { center: [-27.5, 133.5], zoom: 5, zoomControl: false });
L.control.zoom({ position: 'bottomleft' }).addTo(map);
map.locate({ setView: true, maxZoom: 14, timeout: 8000 });

function setTile(style) {
  const t = TILES[style];
  if (!t) return;
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(t.url, {
    attribution: t.attr,
    subdomains: t.sub,
    maxZoom: 20,
  }).addTo(map);
  currentStyle = style;
}
setTile('dark');

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
  police:        makeIcon('🚔', '#ff4545'),
  speed_trap:    makeIcon('📸', '#ff8c00'),
  accident:      makeIcon('⚠️', '#ffcc00'),
  hazard:        makeIcon('🚧', '#ff8c00'),
  speed:         makeIcon('📷', '#3b82f6'),
  red_light:     makeIcon('🔴', '#ef4444'),
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
  const y = Math.sin((lon2-lon1)*r)*Math.cos(lat2*r);
  const x = Math.cos(lat1*r)*Math.sin(lat2*r)-Math.sin(lat1*r)*Math.cos(lat2*r)*Math.cos((lon2-lon1)*r);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function fmtDist(m) { return m < 1000 ? `${Math.round(m/10)*10}m` : `${(m/1000).toFixed(1)}km`; }
function fmtTime(sec) {
  const min = Math.round(sec/60);
  return min < 60 ? `${min} min` : `${Math.floor(min/60)}h ${min%60}m`;
}
function fmtETA(sec) {
  return new Date(Date.now()+sec*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function decodePolyline6(str) {
  let idx=0, lat=0, lng=0; const out=[];
  while(idx<str.length){
    let b,shift=0,res=0;
    do{b=str.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);
    lat+=(res&1)?~(res>>1):res>>1; shift=res=0;
    do{b=str.charCodeAt(idx++)-63;res|=(b&0x1f)<<shift;shift+=5;}while(b>=0x20);
    lng+=(res&1)?~(res>>1):res>>1;
    out.push([lat/1e6,lng/1e6]);
  }
  return out;
}
function nearestOnRoute(pts, lat, lng) {
  let minD=Infinity, minI=0;
  for(let i=0;i<pts.length;i++){
    const d=haversine(pts[i][0],pts[i][1],lat,lng);
    if(d<minD){minD=d;minI=i;}
  }
  return {idx:minI,dist:minD};
}

const MANEUVER_ARROW = {
  1:'↑',2:'↑',3:'↑', 4:'🏁',5:'🏁',6:'🏁',
  7:'↑',8:'↑',9:'↗',10:'→',11:'↪',
  12:'↩',13:'↩',14:'↩',15:'←',16:'↖',
  17:'↑',18:'↗',19:'↖',22:'↗',23:'↖',24:'⇒',
  25:'↻',26:'↑',28:'⛴',
};

/* ═══════════════════════════════════════════════
   GEOCODING — place type detection
═══════════════════════════════════════════════ */
function placeEmoji(r) {
  const cat = r.category ?? r.class, type = r.type;
  if (cat === 'railway') return type === 'tram_stop' ? '🚋' : '🚆';
  if (cat === 'public_transport') return type === 'stop_area' ? '🚉' : '🚌';
  if (cat === 'aeroway') return '✈️';
  if (cat === 'amenity') {
    const m={hospital:'🏥',clinic:'🏥',pharmacy:'💊',fuel:'⛽',
             restaurant:'🍽️',cafe:'☕',fast_food:'🍔',bar:'🍺',
             bank:'🏦',atm:'💳',school:'🏫',university:'🎓',
             library:'📚',police:'👮',fire_station:'🚒',post_office:'📮',
             cinema:'🎬',theatre:'🎭',place_of_worship:'⛪'};
    return m[type]||'📍';
  }
  if (cat === 'tourism') {
    const m={hotel:'🏨',motel:'🏨',museum:'🏛️',attraction:'⭐',
             viewpoint:'🔭',beach:'🏖️',zoo:'🦁',theme_park:'🎡'};
    return m[type]||'⭐';
  }
  if (cat === 'shop') return '🛍️';
  if (cat === 'leisure') {
    const m={park:'🌳',sports_centre:'🏋️',stadium:'🏟️',golf_course:'⛳',
             swimming_pool:'🏊',marina:'⚓'};
    return m[type]||'🌿';
  }
  if (cat === 'natural') return type==='beach'?'🏖️':'🌿';
  if (type==='city'||type==='town') return '🏙️';
  if (type==='suburb'||type==='neighbourhood'||type==='quarter') return '🏘️';
  if (type==='road'||type==='residential'||type==='street'||type==='motorway') return '🛣️';
  return '📍';
}

function placeTypeLabel(r) {
  const cat = r.category ?? r.class, type = r.type;
  if (cat==='railway'&&type==='station') return 'Train Station';
  if (cat==='railway'&&type==='halt') return 'Train Halt';
  if (cat==='railway'&&type==='tram_stop') return 'Tram Stop';
  if (cat==='public_transport'&&type==='stop_area') return 'Transit Hub';
  if (cat==='aeroway'&&type==='aerodrome') return 'Airport';
  if (cat==='amenity'&&type==='hospital') return 'Hospital';
  if (cat==='amenity'&&type==='university') return 'University';
  if (type==='city') return 'City';
  if (type==='town') return 'Town';
  if (type==='suburb') return 'Suburb';
  return null;
}

function placeName(r) {
  const nd = r.namedetails ?? {};
  return nd.name || nd['name:en'] || r.display_name.split(',')[0].trim();
}
function placeSubtitle(r) {
  return r.display_name.split(',').slice(1,3).map(s=>s.trim()).filter(Boolean).join(', ');
}

async function geocodeSearch(q) {
  const b = map.getBounds();
  // viewbox: west,north,east,south
  const viewbox = `${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
  const params = new URLSearchParams({
    q, format:'jsonv2', addressdetails:'1',
    extratags:'1', namedetails:'1',
    limit:'8', viewbox, bounded:'0',
  });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`,
      { headers:{'Accept-Language':'en-AU, en'} });
    return await res.json();
  } catch { return []; }
}

/* ═══════════════════════════════════════════════
   REPORTS
═══════════════════════════════════════════════ */
let visibleLayers = { police:true, speed:true, red_light:true };
let fetchTimeout = null;

async function loadReports() {
  if (map.getZoom()<10) return;
  const b = map.getBounds();
  const p = new URLSearchParams({swlat:b.getSouth(),swlng:b.getWest(),nelat:b.getNorth(),nelng:b.getEast()});
  try {
    const data = await fetch(`/api/reports?${p}`).then(r=>r.json());
    reportCluster.clearLayers();
    for (const r of data) {
      if (!visibleLayers.police) continue;
      const icon = ICONS[r.type]??ICONS.police;
      const age = Math.round((Date.now()-r.created_at)/60000);
      const label={police:'🚔 Police',speed_trap:'📸 Speed trap',accident:'⚠️ Accident',hazard:'🚧 Hazard'}[r.type]??r.type;
      const ageStr = age<60?`${age}m ago`:`${Math.round(age/60)}h ago`;
      const popup=`<strong>${label}</strong>${r.description?`<p>${escHtml(r.description)}</p>`:''}<p>${ageStr} · ✅ ${r.confirms} 👎 ${r.denies}</p><div class="popup-actions"><button class="popup-confirm" onclick="vote('${r.id}','confirm')">✅ Still there</button><button class="popup-deny" onclick="vote('${r.id}','deny')">👎 Gone</button></div>`;
      reportCluster.addLayer(L.marker([r.lat,r.lng],{icon}).bindPopup(popup));
    }
  } catch {}
}
window.vote = async (id,action)=>{
  try{await fetch(`/api/reports/${id}/${action}`,{method:'POST'});loadReports();}catch{}
};

async function loadCameras() {
  if (map.getZoom()<11){cameraCluster.clearLayers();return;}
  const b=map.getBounds();
  const p=new URLSearchParams({swlat:b.getSouth(),swlng:b.getWest(),nelat:b.getNorth(),nelng:b.getEast()});
  try {
    const data=await fetch(`/api/cameras?${p}`).then(r=>r.json());
    cameraCluster.clearLayers();
    for (const cam of data) {
      if(cam.type==='speed'&&!visibleLayers.speed) continue;
      if((cam.type==='red_light'||cam.type==='average_speed')&&!visibleLayers.red_light) continue;
      const icon=ICONS[cam.type]??ICONS.speed;
      const label={speed:'📷 Speed camera',red_light:'🔴 Red light camera',average_speed:'📡 Avg speed'}[cam.type]??cam.type;
      const popup=`<strong>${label}</strong>${cam.road?`<p>📍 ${escHtml(cam.road)}</p>`:''} ${cam.speed_limit?`<p>⚡ ${cam.speed_limit} km/h zone</p>`:''} ${cam.state?`<p>📌 ${cam.state}</p>`:''}<p style="color:#555;font-size:.7rem">Source: ${cam.source.toUpperCase()}</p>`;
      cameraCluster.addLayer(L.marker([cam.lat,cam.lng],{icon}).bindPopup(popup));
    }
  } catch {}
}

function scheduleFetch(){clearTimeout(fetchTimeout);fetchTimeout=setTimeout(()=>{loadReports();loadCameras();},300);}
map.on('moveend',scheduleFetch);map.on('zoomend',scheduleFetch);
scheduleFetch();setInterval(loadReports,90_000);

/* ═══════════════════════════════════════════════
   FILTER BUTTONS
═══════════════════════════════════════════════ */
document.querySelectorAll('.filter-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const l=btn.dataset.layer; visibleLayers[l]=!visibleLayers[l];
    btn.classList.toggle('active',visibleLayers[l]);
    loadReports();loadCameras();
  });
});

/* ═══════════════════════════════════════════════
   REPORT FLOW
═══════════════════════════════════════════════ */
let pendingLat=null,pendingLng=null,selectedType='police';
const reportBtn=document.getElementById('report-btn');
const modalOverlay=document.getElementById('modal-overlay');
const cancelBtn=document.getElementById('cancel-btn');
const submitBtn=document.getElementById('submit-btn');
const modalCoords=document.getElementById('modal-coords');
const descInput=document.getElementById('desc-input');

reportBtn.addEventListener('click',()=>{
  const c=map.getCenter(); pendingLat=c.lat; pendingLng=c.lng;
  modalCoords.textContent=`📍 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  descInput.value='';
  document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="police"]').classList.add('active');
  selectedType='police'; modalOverlay.classList.remove('hidden');
});
map.on('click',e=>{
  if(!modalOverlay.classList.contains('hidden')){
    pendingLat=e.latlng.lat;pendingLng=e.latlng.lng;
    modalCoords.textContent=`📍 ${pendingLat.toFixed(5)}, ${pendingLng.toFixed(5)}`;
  }
});
document.querySelectorAll('.type-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');selectedType=btn.dataset.type;
  });
});
cancelBtn.addEventListener('click',()=>modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click',e=>{if(e.target===modalOverlay)modalOverlay.classList.add('hidden');});
submitBtn.addEventListener('click',async()=>{
  if(pendingLat==null)return;
  submitBtn.disabled=true;submitBtn.textContent='Submitting…';
  try{
    const res=await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({lat:pendingLat,lng:pendingLng,type:selectedType,description:descInput.value.trim()||undefined})});
    if(res.ok){modalOverlay.classList.add('hidden');map.setView([pendingLat,pendingLng],Math.max(map.getZoom(),14));loadReports();}
    else{const e=await res.json();alert(e.error??'Failed');}
  }catch{alert('Network error');}
  finally{submitBtn.disabled=false;submitBtn.textContent='Submit';}
});

/* ═══════════════════════════════════════════════
   MAP STYLE PANEL
═══════════════════════════════════════════════ */
const styleToggle = document.getElementById('style-toggle');
const stylePanel  = document.getElementById('style-panel');
const styleBg     = document.getElementById('style-panel-bg');
const styleClose  = document.getElementById('style-close');

styleToggle.addEventListener('click',()=>stylePanel.classList.remove('hidden'));
styleClose.addEventListener('click',()=>stylePanel.classList.add('hidden'));
styleBg.addEventListener('click',()=>stylePanel.classList.add('hidden'));

document.querySelectorAll('.style-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.style-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    setTile(btn.dataset.style);
    stylePanel.classList.add('hidden');
  });
});

/* ═══════════════════════════════════════════════
   ROUTE PLANNER
═══════════════════════════════════════════════ */
const topbar      = document.getElementById('topbar');
const planner     = document.getElementById('route-planner');
const plannerBack = document.getElementById('planner-back');
const fromInput   = document.getElementById('from-input');
const toInput     = document.getElementById('to-input');
const fromClear   = document.getElementById('from-clear');
const toClear     = document.getElementById('to-clear');
const swapBtn     = document.getElementById('swap-btn');
const searchResultsEl = document.getElementById('search-results');
const previewBar  = document.getElementById('preview-bar');
const previewDist = document.getElementById('preview-dist');
const previewTime = document.getElementById('preview-time');
const previewETA  = document.getElementById('preview-eta');
const directionsList = document.getElementById('directions-list');
const startNavBtn = document.getElementById('start-nav-btn');
const cancelRoute = document.getElementById('cancel-route-btn');
const navInst     = document.getElementById('nav-instruction');
const navIcon     = document.getElementById('nav-icon');
const navDist     = document.getElementById('nav-dist');
const navStreet   = document.getElementById('nav-street');
const navFooter   = document.getElementById('nav-footer');
const navETA      = document.getElementById('nav-eta');
const navRemaining = document.getElementById('nav-remaining');
const speedLimitSign = document.getElementById('speed-limit-sign');
const speedLimitVal  = document.getElementById('speed-limit-val');
const currentSpeedEl = document.getElementById('current-speed');
const endNavBtn   = document.getElementById('end-nav-btn');

// Planner state
let fromPlace = null;   // null = use GPS; or {lat,lng,name}
let toPlace   = null;   // {lat,lng,name}
let activeField = 'to'; // which input is live-searching

// Nav state
let navState = 'idle';
let routeData = null, routePoints = [], maneuvers = [];
let routeLine = null, destMarker = null, originMarker = null, userMarker = null;
let watchId = null, currentManeuverIdx = 0, offRouteCount = 0;
let lastSpokenManeuver = -1, remainingSec = 0, prevPos = null;

/* ── Open / close planner ──────────────────────── */
document.getElementById('search-toggle').addEventListener('click', openPlanner);
plannerBack.addEventListener('click', closePlanner);

function openPlanner() {
  topbar.classList.add('hidden');
  planner.classList.remove('hidden');
  navState = 'searching';
  // If GPS known, pre-fill FROM
  if (userMarker) {
    const ll = userMarker.getLatLng();
    if (!fromPlace) {
      fromInput.value = '';
      fromInput.placeholder = '📍 My location';
    }
  }
  setActiveField('to');
  toInput.focus();
}

function closePlanner() {
  topbar.classList.remove('hidden');
  planner.classList.add('hidden');
  searchResultsEl.innerHTML = '';
  if (navState === 'searching') navState = toPlace ? 'preview' : 'idle';
}

function setActiveField(field) {
  activeField = field;
  document.getElementById('from-row').classList.toggle('active', field === 'from');
  document.getElementById('to-row').classList.toggle('active', field === 'to');
}

/* ── Input events ──────────────────────────────── */
let searchDebounce = null;

function wireInput(input, field) {
  input.addEventListener('focus', () => {
    setActiveField(field);
    if (input.value.trim().length >= 2) triggerSearch(input.value.trim());
  });
  input.addEventListener('input', () => {
    const q = input.value.trim();
    const clearBtn = field === 'from' ? fromClear : toClear;
    clearBtn.classList.toggle('hidden', !q);
    clearTimeout(searchDebounce);
    if (q.length < 2) { searchResultsEl.innerHTML = ''; return; }
    searchDebounce = setTimeout(() => triggerSearch(q), 350);
  });
}
wireInput(fromInput, 'from');
wireInput(toInput,   'to');

fromClear.addEventListener('click', () => { fromInput.value=''; fromPlace=null; fromClear.classList.add('hidden'); fromInput.focus(); searchResultsEl.innerHTML=''; });
toClear.addEventListener('click',   () => { toInput.value='';   toPlace=null;   toClear.classList.add('hidden');   toInput.focus();   searchResultsEl.innerHTML=''; });

swapBtn.addEventListener('click', () => {
  [fromPlace, toPlace] = [toPlace, fromPlace];
  fromInput.value = fromPlace?.name ?? '';
  toInput.value   = toPlace?.name   ?? '';
  fromClear.classList.toggle('hidden', !fromInput.value);
  toClear.classList.toggle('hidden',   !toInput.value);
  fromInput.placeholder = fromPlace ? '' : '📍 My location';
  if (fromPlace && toPlace) tryRoute();
});

async function triggerSearch(q) {
  searchResultsEl.innerHTML = '<div class="no-results">Searching…</div>';
  const results = await geocodeSearch(q);
  renderResults(results);
}

function renderResults(results) {
  searchResultsEl.innerHTML = '';
  if (!results.length) {
    searchResultsEl.innerHTML = '<div class="no-results">No places found</div>';
    return;
  }
  results.forEach(r => {
    const el = document.createElement('div');
    el.className = 'search-result';
    const emoji   = placeEmoji(r);
    const name    = placeName(r);
    const label   = placeTypeLabel(r);
    const sub     = placeSubtitle(r);
    el.innerHTML  = `
      <span class="result-emoji">${emoji}</span>
      <span class="result-body">
        <strong>${escHtml(name)}</strong>
        ${label ? `<em>${escHtml(label)}</em>` : ''}
        <span>${escHtml(sub)}</span>
      </span>`;
    el.addEventListener('click', () => selectPlace(r));
    searchResultsEl.appendChild(el);
  });
}

function selectPlace(r) {
  const place = { lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: placeName(r) };
  if (activeField === 'from') {
    fromPlace = place;
    fromInput.value = place.name;
    fromClear.classList.remove('hidden');
    searchResultsEl.innerHTML = '';
    setActiveField('to');
    toInput.focus();
    if (toPlace) tryRoute();
  } else {
    toPlace = place;
    toInput.value = place.name;
    toClear.classList.remove('hidden');
    searchResultsEl.innerHTML = '';
    tryRoute();
  }
}

function tryRoute() {
  if (!toPlace) return;
  const gps = userMarker ? userMarker.getLatLng() : null;
  const from = fromPlace ?? (gps ? { lat: gps.lat, lng: gps.lng } : { lat: map.getCenter().lat, lng: map.getCenter().lng });
  closePlanner();
  calcRoute(from.lat, from.lng, toPlace.lat, toPlace.lng);
}

/* ═══════════════════════════════════════════════
   ROUTING
═══════════════════════════════════════════════ */
async function calcRoute(fromLat, fromLng, toLat, toLng) {
  previewBar.classList.add('hidden');
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }

  // Destination pin
  destMarker = L.marker([toLat, toLng], {
    icon: L.divIcon({ html:'<span class="dest-pin">📍</span>', className:'', iconSize:[32,40], iconAnchor:[16,40] })
  }).addTo(map);

  try {
    const resp = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [{ lon: fromLng, lat: fromLat }, { lon: toLng, lat: toLat }],
        costing: 'auto',
        directions_options: { units: 'kilometers', language: 'en-US' },
      }),
    });
    if (!resp.ok) { alert('Could not find a route.'); return; }
    const data = await resp.json();

    routeData   = data.trip;
    maneuvers   = routeData.legs[0].maneuvers;
    routePoints = decodePolyline6(routeData.legs[0].shape);

    routeLine = L.polyline(routePoints, { color: '#3b82f6', weight: 6, opacity: 0.9 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [60, 80] });

    const totalDist = routeData.summary.length;
    const totalTime = routeData.summary.time;
    previewDist.textContent = fmtDist(totalDist * 1000);
    previewTime.textContent = fmtTime(totalTime);
    previewETA.textContent  = `ETA ${fmtETA(totalTime)}`;

    renderDirectionsList();
    previewBar.classList.remove('hidden');
    navState = 'preview';

  } catch (e) { alert('Routing error: ' + e.message); }
}

function renderDirectionsList() {
  let cumDist = 0;
  directionsList.innerHTML = maneuvers.map((m, i) => {
    const dist = cumDist;
    cumDist += (m.length ?? 0) * 1000;
    const arrow   = MANEUVER_ARROW[m.type] ?? '↑';
    const streets = (m.street_names ?? []).join(' / ');
    const instr   = m.instruction ?? '';
    const primary = streets || instr.replace(/\.$/, '');
    const isArrive = m.type >= 4 && m.type <= 6;
    const speedStr = (m.speed_limit && m.speed_limit < 200) ? `${m.speed_limit}` : '';
    return `<div class="dir-step${isArrive ? ' dir-arrive' : ''}">
      <span class="dir-arrow">${arrow}</span>
      <span class="dir-text">${escHtml(primary)}<span class="dir-sub">${escHtml(instr)}</span></span>
      ${speedStr ? `<span class="dir-speed">${speedStr}</span>` : ''}
      <span class="dir-dist">${i===0?'Start':fmtDist(dist)}</span>
    </div>`;
  }).join('');
}

cancelRoute.addEventListener('click', clearRoute);
function clearRoute() {
  if (routeLine)   { map.removeLayer(routeLine);  routeLine = null; }
  if (destMarker)  { map.removeLayer(destMarker); destMarker = null; }
  previewBar.classList.add('hidden');
  navState = 'idle';
  routeData = null; routePoints = []; maneuvers = [];
  fromPlace = null; toPlace = null;
  fromInput.value = ''; toInput.value = '';
  fromClear.classList.add('hidden'); toClear.classList.add('hidden');
}

/* ═══════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════ */
startNavBtn.addEventListener('click', startNavigation);
endNavBtn.addEventListener('click', endNavigation);

function startNavigation() {
  previewBar.classList.add('hidden');
  topbar.classList.add('hidden');
  reportBtn.classList.add('hidden');
  navInst.classList.remove('hidden');
  navFooter.classList.remove('hidden');
  navState = 'navigating';
  currentManeuverIdx = 0; lastSpokenManeuver = -1; offRouteCount = 0;
  remainingSec = routeData.summary.time;

  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onGPS, gpsErr, {
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
  currentSpeedEl.innerHTML = '– <small>km/h</small>';
  speedLimitSign.classList.add('hidden');
}

function gpsErr(e) { console.warn('GPS', e.code, e.message); }

function makeUserMarker(lat, lng, hdg = 0) {
  return L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<span class="user-arrow" style="transform:rotate(${hdg}deg)">▲</span>`,
      className: '', iconSize: [32,32], iconAnchor: [16,16],
    }),
    zIndexOffset: 1000,
  });
}

/* ── GPS handler ────────────────────────────────── */
function onGPS(pos) {
  const { latitude:lat, longitude:lng, speed:rawSpeed, heading } = pos.coords;
  const hdg = (heading!=null&&!isNaN(heading)) ? heading
    : (prevPos ? bearing(prevPos.lat,prevPos.lng,lat,lng) : 0);

  if (userMarker) map.removeLayer(userMarker);
  userMarker = makeUserMarker(lat, lng, hdg).addTo(map);

  if (navState === 'navigating') {
    map.setView([lat,lng], Math.max(map.getZoom(),15), { animate:true, duration:0.8 });
  }

  // Speed
  let kmh = null;
  if (rawSpeed!=null&&!isNaN(rawSpeed)) { kmh = Math.round(rawSpeed*3.6); }
  else if (prevPos) {
    const dt = (pos.timestamp-prevPos.ts)/1000;
    if (dt>0) kmh = Math.round((haversine(prevPos.lat,prevPos.lng,lat,lng)/dt)*3.6);
  }

  if (navState==='navigating'&&kmh!=null) {
    currentSpeedEl.innerHTML = `${kmh} <small>km/h</small>`;
    const lim = getSpeedLimit();
    const over = lim && kmh > lim;
    currentSpeedEl.classList.toggle('over-limit', over);
    speedLimitSign.classList.toggle('over-limit', over);
  }

  prevPos = { lat, lng, ts: pos.timestamp };
  if (navState!=='navigating'||!routePoints.length) return;

  const { idx, dist } = nearestOnRoute(routePoints, lat, lng);

  if (dist > 60) {
    offRouteCount++;
    if (offRouteCount >= 3) {
      offRouteCount = 0;
      const destPt = routePoints[routePoints.length-1];
      calcRoute(lat,lng,destPt[0],destPt[1]).then(()=>{ if(navState==='preview') startNavigation(); });
      return;
    }
  } else { offRouteCount = 0; }

  for (let i=maneuvers.length-1;i>=0;i--) {
    if (idx >= maneuvers[i].begin_shape_index) { currentManeuverIdx = i; break; }
  }

  const nextM = maneuvers[currentManeuverIdx+1] ?? maneuvers[currentManeuverIdx];
  const nextPt = routePoints[nextM.begin_shape_index] ?? routePoints[routePoints.length-1];
  const distToTurn = haversine(lat,lng,nextPt[0],nextPt[1]);
  remainingSec = Math.round(routeData.summary.time*(1-Math.min(idx/routePoints.length,1)));

  updateNavPanel(distToTurn);
  checkVoice(currentManeuverIdx, distToTurn);
}

function updateNavPanel(distToTurn) {
  if (!maneuvers.length) return;
  const nextM = maneuvers[currentManeuverIdx+1] ?? maneuvers[currentManeuverIdx];
  navIcon.textContent   = MANEUVER_ARROW[nextM.type] ?? '↑';
  navDist.textContent   = distToTurn!=null ? fmtDist(distToTurn) : '';
  navStreet.textContent = (nextM.street_names??[]).join(' / ') || nextM.instruction || '';
  navETA.textContent    = fmtETA(remainingSec);
  navRemaining.textContent = fmtDist(remainingSec*(routeData.summary.length*1000/routeData.summary.time)) + ' · ' + fmtTime(remainingSec);

  const lim = getSpeedLimit();
  if (lim) { speedLimitSign.classList.remove('hidden'); speedLimitVal.textContent = lim; }
  else       speedLimitSign.classList.add('hidden');
}

function getSpeedLimit() {
  const m = maneuvers[currentManeuverIdx];
  return (m?.speed_limit && m.speed_limit < 200) ? m.speed_limit : null;
}

/* ── Voice ──────────────────────────────────────── */
const synth = window.speechSynthesis;
function speak(text) {
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang='en-AU'; u.rate=1.05; u.volume=0.9;
  synth.speak(u);
}
function checkVoice(mIdx, dist) {
  const nextM = maneuvers[mIdx+1];
  if (!nextM) return;
  const instr = nextM.verbal_pre_transition_instruction ?? nextM.instruction ?? '';
  if (dist<=220&&dist>150&&lastSpokenManeuver!==mIdx+'c') { speak(nextM.verbal_transition_alert_instruction??instr); lastSpokenManeuver=mIdx+'c'; }
  else if (dist<=550&&dist>450&&lastSpokenManeuver!==mIdx+'b') { speak(`In ${fmtDist(dist)}, ${instr}`); lastSpokenManeuver=mIdx+'b'; }
  else if (dist<=1050&&dist>950&&lastSpokenManeuver!==mIdx+'a') { speak(`In 1 kilometre, ${instr}`); lastSpokenManeuver=mIdx+'a'; }
  if ((nextM.type>=4&&nextM.type<=6)&&dist<30) {
    speak('You have arrived at your destination.');
    setTimeout(endNavigation, 4000);
  }
}
