/* ═══════════════════════════════════════════════
   PWA — register service worker
═══════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

/* ═══════════════════════════════════════════════
   SETTINGS — persisted to localStorage
═══════════════════════════════════════════════ */
const PREF_KEY = 'radar_prefs';
const DEFAULT_PREFS = { voice:true, cameraAlerts:true, policeAlerts:true, haptic:true, unit:'kmh', mapStyle:'dark' };
const prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
const savePrefs = () => localStorage.setItem(PREF_KEY, JSON.stringify(prefs));

/* ═══════════════════════════════════════════════
   STORAGE — recent searches & favourites
═══════════════════════════════════════════════ */
const RECENT_KEY = 'radar_recent', FAVS_KEY = 'radar_favs';
const getRecent = () => JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
const getFavs   = () => JSON.parse(localStorage.getItem(FAVS_KEY)   ?? '[]');
function addRecent(p) {
  const r = getRecent().filter(x => x.name !== p.name);
  r.unshift(p); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 8)));
}
function toggleFav(p) {
  const favs = getFavs();
  const idx  = favs.findIndex(f => f.name === p.name);
  if (idx >= 0) favs.splice(idx, 1); else favs.unshift({ ...p, saved: Date.now() });
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs.slice(0, 20)));
  return idx < 0; // true = now saved
}
const isFav = name => getFavs().some(f => f.name === name);

/* ═══════════════════════════════════════════════
   MAP TILES
═══════════════════════════════════════════════ */
const TILES = {
  dark:      { url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',             sub:'abcd', attr:'©OpenStreetMap ©CartoDB' },
  light:     { url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',            sub:'abcd', attr:'©OpenStreetMap ©CartoDB' },
  voyager:   { url:'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',  sub:'abcd', attr:'©OpenStreetMap ©CartoDB' },
  satellite: { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', sub:'', attr:'©Esri' },
  terrain:   { url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                          sub:'abc',  attr:'©OpenStreetMap ©OpenTopoMap' },
};

const map = L.map('map', { center:[-27.5,133.5], zoom:5, zoomControl:false });
L.control.zoom({ position:'bottomleft' }).addTo(map);
map.locate({ setView:true, maxZoom:14, timeout:8000 });

let tileLayer = null;
function setTile(style) {
  const t = TILES[style]; if (!t) return;
  if (tileLayer) map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(t.url, { attribution:t.attr, subdomains:t.sub, maxZoom:20 }).addTo(map);
  prefs.mapStyle = style; savePrefs();
  document.querySelectorAll('.style-btn').forEach(b => b.classList.toggle('active', b.dataset.style === style));
}
setTile(prefs.mapStyle);

/* ═══════════════════════════════════════════════
   LAYER GROUPS
═══════════════════════════════════════════════ */
const reportCluster = L.markerClusterGroup({ maxClusterRadius:40, disableClusteringAtZoom:15 });
const cameraCluster = L.markerClusterGroup({ maxClusterRadius:60, disableClusteringAtZoom:14 });
map.addLayer(reportCluster);
map.addLayer(cameraCluster);

/* ═══════════════════════════════════════════════
   ICONS
═══════════════════════════════════════════════ */
function makeIcon(emoji, color='#ff4545') {
  return L.divIcon({
    html:`<div style="background:${color};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.2)">${emoji}</div>`,
    className:'', iconSize:[34,34], iconAnchor:[17,17], popupAnchor:[0,-20],
  });
}
const ICONS = {
  police:makeIcon('🚔','#ff4545'), speed_trap:makeIcon('📸','#ff8c00'),
  accident:makeIcon('⚠️','#ffcc00'), hazard:makeIcon('🚧','#ff8c00'),
  speed:makeIcon('📷','#3b82f6'), red_light:makeIcon('🔴','#ef4444'),
  average_speed:makeIcon('📡','#8b5cf6'),
};

/* ═══════════════════════════════════════════════
   AUDIO — Web Audio API chimes (no files needed)
═══════════════════════════════════════════════ */
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freq, dur=0.25, vol=0.28, type='sine') {
  try {
    const ctx=getAudio(), osc=ctx.createOscillator(), g=ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type=type; osc.frequency.value=freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+dur);
    osc.start(); osc.stop(ctx.currentTime+dur);
  } catch {}
}
const cameraChime = () => { playTone(1047,.18); setTimeout(()=>playTone(1319,.28), 180); };
const policeChime = () => { playTone(440,.22); setTimeout(()=>playTone(554,.18),150); setTimeout(()=>playTone(440,.3),300); };
const dingChime   = () => playTone(880,.3,.2);

/* ═══════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════ */
function haversine(lat1,lon1,lat2,lon2){
  const R=6371000,r=Math.PI/180;
  const dL=(lat2-lat1)*r, dO=(lon2-lon1)*r;
  const a=Math.sin(dL/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dO/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function bearing(lat1,lon1,lat2,lon2){
  const r=Math.PI/180;
  return (Math.atan2(Math.sin((lon2-lon1)*r)*Math.cos(lat2*r),Math.cos(lat1*r)*Math.sin(lat2*r)-Math.sin(lat1*r)*Math.cos(lat2*r)*Math.cos((lon2-lon1)*r))*180/Math.PI+360)%360;
}
const toKmh = ms => Math.round(ms * 3.6);
const toMph = ms => Math.round(ms * 2.237);
function fmtSpeed(ms) {
  const v = prefs.unit==='mph' ? toMph(ms) : toKmh(ms);
  return `${v} <small>${prefs.unit==='mph'?'mph':'km/h'}</small>`;
}
function fmtDist(m) { return m<1000?`${Math.round(m/10)*10}m`:`${(m/1000).toFixed(1)}km`; }
function fmtTime(s) { const m=Math.round(s/60); return m<60?`${m} min`:`${Math.floor(m/60)}h ${m%60}m`; }
function fmtETA(s)  { return new Date(Date.now()+s*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function decodePolyline6(str){
  let idx=0,lat=0,lng=0; const out=[];
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
function nearestOnRoute(pts,lat,lng){
  let minD=Infinity,minI=0;
  for(let i=0;i<pts.length;i++){const d=haversine(pts[i][0],pts[i][1],lat,lng);if(d<minD){minD=d;minI=i;}}
  return {idx:minI,dist:minD};
}

const ARROW = {1:'↑',2:'↑',3:'↑',4:'🏁',5:'🏁',6:'🏁',7:'↑',8:'↑',9:'↗',10:'→',11:'↪',12:'↩',13:'↩',14:'↩',15:'←',16:'↖',17:'↑',18:'↗',19:'↖',22:'↗',23:'↖',24:'⇒',25:'↻',26:'↑',28:'⛴'};

/* ═══════════════════════════════════════════════
   GEOCODING helpers
═══════════════════════════════════════════════ */
function placeEmoji(r){
  const c=r.category??r.class,t=r.type;
  if(c==='railway') return t==='tram_stop'?'🚋':'🚆';
  if(c==='public_transport') return t==='stop_area'?'🚉':'🚌';
  if(c==='aeroway') return '✈️';
  if(c==='amenity'){const m={hospital:'🏥',clinic:'🏥',pharmacy:'💊',fuel:'⛽',restaurant:'🍽️',cafe:'☕',fast_food:'🍔',bar:'🍺',bank:'🏦',school:'🏫',university:'🎓',library:'📚',police:'👮',fire_station:'🚒',post_office:'📮',cinema:'🎬',theatre:'🎭',place_of_worship:'⛪'};return m[t]||'📍';}
  if(c==='tourism'){const m={hotel:'🏨',motel:'🏨',museum:'🏛️',attraction:'⭐',viewpoint:'🔭',beach:'🏖️',zoo:'🦁',theme_park:'🎡'};return m[t]||'⭐';}
  if(c==='shop') return '🛍️';
  if(c==='leisure'){const m={park:'🌳',sports_centre:'🏋️',stadium:'🏟️',golf_course:'⛳',swimming_pool:'🏊'};return m[t]||'🌿';}
  if(c==='natural') return t==='beach'?'🏖️':'🌿';
  if(t==='city'||t==='town') return '🏙️';
  if(t==='suburb'||t==='neighbourhood'||t==='quarter') return '🏘️';
  if(t==='road'||t==='residential'||t==='street') return '🛣️';
  return '📍';
}
function placeLabel(r){
  const c=r.category??r.class,t=r.type;
  if(c==='railway'&&t==='station') return 'Train Station';
  if(c==='railway'&&t==='halt') return 'Train Halt';
  if(c==='railway'&&t==='tram_stop') return 'Tram Stop';
  if(c==='public_transport'&&t==='stop_area') return 'Transit Hub';
  if(c==='aeroway'&&t==='aerodrome') return 'Airport';
  if(c==='amenity'&&t==='hospital') return 'Hospital';
  if(c==='amenity'&&t==='university') return 'University';
  if(t==='city') return 'City'; if(t==='town') return 'Town'; if(t==='suburb') return 'Suburb';
  return null;
}
function placeName(r){ const nd=r.namedetails??{}; return nd.name||nd['name:en']||r.display_name.split(',')[0].trim(); }
function placeSub(r)  { return r.display_name.split(',').slice(1,3).map(s=>s.trim()).filter(Boolean).join(', '); }

async function geocode(q){
  const b=map.getBounds();
  const params=new URLSearchParams({q,format:'jsonv2',addressdetails:'1',extratags:'1',namedetails:'1',limit:'8',viewbox:`${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`,bounded:'0'});
  try{ return await fetch(`https://nominatim.openstreetmap.org/search?${params}`,{headers:{'Accept-Language':'en-AU, en'}}).then(r=>r.json()); }
  catch{ return []; }
}

/* ═══════════════════════════════════════════════
   REPORTS + CAMERAS
═══════════════════════════════════════════════ */
let visibleLayers={police:true,speed:true,red_light:true}, fetchTmr=null;

async function loadReports(){
  if(map.getZoom()<10) return;
  const b=map.getBounds();
  const p=new URLSearchParams({swlat:b.getSouth(),swlng:b.getWest(),nelat:b.getNorth(),nelng:b.getEast()});
  try{
    const data=await fetch(`/api/reports?${p}`).then(r=>r.json());
    reportCluster.clearLayers();
    for(const r of data){
      if(!visibleLayers.police) continue;
      const icon=ICONS[r.type]??ICONS.police;
      const age=Math.round((Date.now()-r.created_at)/60000);
      const label={police:'🚔 Police',speed_trap:'📸 Speed trap',accident:'⚠️ Accident',hazard:'🚧 Hazard'}[r.type]??r.type;
      const ageStr=age<60?`${age}m ago`:`${Math.round(age/60)}h ago`;
      const popup=`<strong>${label}</strong>${r.description?`<p>${escHtml(r.description)}</p>`:''}<p>${ageStr} · ✅ ${r.confirms} 👎 ${r.denies}</p><div class="popup-actions"><button class="popup-confirm" onclick="vote('${r.id}','confirm')">✅ Still there</button><button class="popup-deny" onclick="vote('${r.id}','deny')">👎 Gone</button></div>`;
      reportCluster.addLayer(L.marker([r.lat,r.lng],{icon}).bindPopup(popup));
    }
  }catch{}
}
window.vote=async(id,action)=>{try{await fetch(`/api/reports/${id}/${action}`,{method:'POST'});loadReports();}catch{}};

async function loadCameras(){
  if(map.getZoom()<11){cameraCluster.clearLayers();return;}
  const b=map.getBounds();
  const p=new URLSearchParams({swlat:b.getSouth(),swlng:b.getWest(),nelat:b.getNorth(),nelng:b.getEast()});
  try{
    const data=await fetch(`/api/cameras?${p}`).then(r=>r.json());
    cameraCluster.clearLayers();
    for(const cam of data){
      if(cam.type==='speed'&&!visibleLayers.speed) continue;
      if((cam.type==='red_light'||cam.type==='average_speed')&&!visibleLayers.red_light) continue;
      const icon=ICONS[cam.type]??ICONS.speed;
      const label={speed:'📷 Speed camera',red_light:'🔴 Red light camera',average_speed:'📡 Avg speed'}[cam.type]??cam.type;
      const popup=`<strong>${label}</strong>${cam.road?`<p>📍 ${escHtml(cam.road)}</p>`:''} ${cam.speed_limit?`<p>⚡ ${cam.speed_limit} km/h zone</p>`:''} ${cam.state?`<p>📌 ${cam.state}</p>`:''}<p style="color:#555;font-size:.7rem">Source: ${cam.source.toUpperCase()}</p>`;
      cameraCluster.addLayer(L.marker([cam.lat,cam.lng],{icon}).bindPopup(popup));
    }
  }catch{}
}

function scheduleFetch(){clearTimeout(fetchTmr);fetchTmr=setTimeout(()=>{loadReports();loadCameras();},300);}
map.on('moveend',scheduleFetch);map.on('zoomend',scheduleFetch);scheduleFetch();
setInterval(loadReports,90_000);

document.querySelectorAll('.filter-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const l=btn.dataset.layer; visibleLayers[l]=!visibleLayers[l];
    btn.classList.toggle('active',visibleLayers[l]);loadReports();loadCameras();
  });
});

/* ═══════════════════════════════════════════════
   REPORT FLOW
═══════════════════════════════════════════════ */
let pendingLat=null,pendingLng=null,selType='police';
const reportBtn=$$('report-btn'),modalOverlay=$$('modal-overlay'),
      cancelBtn=$$('cancel-btn'),submitBtn=$$('submit-btn'),
      modalCoords=$$('modal-coords'),descInput=$$('desc-input');

function $$(id){return document.getElementById(id);}

reportBtn.addEventListener('click',()=>{
  const c=map.getCenter();pendingLat=c.lat;pendingLng=c.lng;
  modalCoords.textContent=`📍 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  descInput.value='';
  document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="police"]').classList.add('active');
  selType='police';modalOverlay.classList.remove('hidden');
});
map.on('click',e=>{if(!modalOverlay.classList.contains('hidden')){pendingLat=e.latlng.lat;pendingLng=e.latlng.lng;modalCoords.textContent=`📍 ${pendingLat.toFixed(5)}, ${pendingLng.toFixed(5)}`;} });
document.querySelectorAll('.type-btn').forEach(btn=>{ btn.addEventListener('click',()=>{ document.querySelectorAll('.type-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');selType=btn.dataset.type; }); });
cancelBtn.addEventListener('click',()=>modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click',e=>{if(e.target===modalOverlay)modalOverlay.classList.add('hidden');});
submitBtn.addEventListener('click',async()=>{
  if(pendingLat==null)return; submitBtn.disabled=true;submitBtn.textContent='Submitting…';
  try{
    const res=await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:pendingLat,lng:pendingLng,type:selType,description:descInput.value.trim()||undefined})});
    if(res.ok){modalOverlay.classList.add('hidden');map.setView([pendingLat,pendingLng],Math.max(map.getZoom(),14));loadReports();}
    else{const e=await res.json();alert(e.error??'Failed');}
  }catch{alert('Network error');}
  finally{submitBtn.disabled=false;submitBtn.textContent='Submit';}
});

/* ═══════════════════════════════════════════════
   SETTINGS PANEL
═══════════════════════════════════════════════ */
const stylePanel=$$('style-panel'), styleBg=$$('style-panel-bg'), styleClose=$$('style-close');
$$('style-toggle').addEventListener('click',()=>stylePanel.classList.remove('hidden'));
styleClose.addEventListener('click',()=>stylePanel.classList.add('hidden'));
styleBg.addEventListener('click',()=>stylePanel.classList.add('hidden'));

document.querySelectorAll('.style-btn').forEach(btn=>{ btn.addEventListener('click',()=>{ setTile(btn.dataset.style);stylePanel.classList.add('hidden'); }); });

// Restore toggles from prefs
const toggleMap = { 's-voice':'voice','s-camera':'cameraAlerts','s-police':'policeAlerts','s-haptic':'haptic' };
Object.entries(toggleMap).forEach(([id,key])=>{
  const el=document.getElementById(id); if(!el)return;
  el.checked=prefs[key];
  el.addEventListener('change',()=>{prefs[key]=el.checked;savePrefs();});
});

// Unit toggle
document.querySelectorAll('.unit-btn').forEach(btn=>{
  btn.classList.toggle('active',btn.dataset.unit===prefs.unit);
  btn.addEventListener('click',()=>{
    prefs.unit=btn.dataset.unit; savePrefs();
    document.querySelectorAll('.unit-btn').forEach(b=>b.classList.toggle('active',b.dataset.unit===prefs.unit));
  });
});

/* ═══════════════════════════════════════════════
   PWA — install prompt
═══════════════════════════════════════════════ */
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault(); deferredInstall=e;
  setTimeout(()=>$$('install-toast').classList.remove('hidden'), 3000);
  $$('install-btn').classList.remove('hidden');
});
async function triggerInstall(){
  if(!deferredInstall)return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall=null;
  $$('install-toast').classList.add('hidden');
  $$('install-btn').classList.add('hidden');
}
$$('install-toast-btn').addEventListener('click',triggerInstall);
$$('install-btn').addEventListener('click',triggerInstall);
$$('install-toast-close').addEventListener('click',()=>$$('install-toast').classList.add('hidden'));

/* ═══════════════════════════════════════════════
   ROUTE PLANNER
═══════════════════════════════════════════════ */
const topbar=$$('topbar'), planner=$$('route-planner'), plannerBack=$$('planner-back'),
      fromInput=$$('from-input'), toInput=$$('to-input'),
      fromClear=$$('from-clear'), toClear=$$('to-clear'),
      swapBtn=$$('swap-btn'), searchResultsEl=$$('search-results'),
      previewBar=$$('preview-bar'), previewDist=$$('preview-dist'),
      previewTime=$$('preview-time'), previewETA=$$('preview-eta'),
      directionsList=$$('directions-list'),
      startNavBtn=$$('start-nav-btn'), cancelRoute=$$('cancel-route-btn'),
      navInst=$$('nav-instruction'), navIconEl=$$('nav-icon'),
      navDistEl=$$('nav-dist'), navStreetEl=$$('nav-street'),
      navSpeedBadge=$$('nav-speed-badge'), navSpeedVal=$$('nav-speed-val'),
      navNextWrap=$$('nav-next-wrap'), navNextIcon=$$('nav-next-icon'), navNextLabel=$$('nav-next-label'),
      alertBar=$$('alert-bar'), alertIcon=$$('alert-icon'), alertText=$$('alert-text'), alertDist=$$('alert-dist'),
      navFooter=$$('nav-footer'), navETA=$$('nav-eta'), navRemaining=$$('nav-remaining'),
      speedLimitSign=$$('speed-limit-sign'), speedLimitVal=$$('speed-limit-val'),
      currentSpeedEl=$$('current-speed'), endNavBtn=$$('end-nav-btn'),
      arrivalOverlay=$$('arrival-overlay'), arrivalDest=$$('arrival-dest'), arrivalDone=$$('arrival-done');

let fromPlace=null, toPlace=null, activeField='to';
let navState='idle';
let routeData=null, routePoints=[], maneuvers=[];
let routeLine=null, traveledLine=null, destMarker=null, userMarker=null;
let watchId=null, currentMidx=0, offCount=0, prevPos=null;
let lastVoice=-1, remainingSec=0;
let nearCameras=[], nearReports=[], alertedIds=new Set();
let alertHideTimer=null;

/* ── Open / close planner ──────────────────────── */
$$('search-toggle').addEventListener('click', openPlanner);
plannerBack.addEventListener('click', closePlanner);

function openPlanner(){
  topbar.classList.add('hidden');
  planner.classList.remove('hidden');
  navState='searching';
  fromInput.placeholder = userMarker ? '📍 My location' : 'Choose start…';
  setActiveField('to');
  toInput.focus();
  showSuggestions(); // show recents + favs
}
function closePlanner(){
  topbar.classList.remove('hidden');
  planner.classList.add('hidden');
  searchResultsEl.innerHTML='';
  if(navState==='searching') navState=toPlace?'preview':'idle';
}
function setActiveField(f){
  activeField=f;
  $$('from-row').classList.toggle('active',f==='from');
  $$('to-row').classList.toggle('active',f==='to');
}

/* ── Suggestions (recents + favs when empty) ─── */
function showSuggestions(){
  const favs=getFavs(), recents=getRecent();
  if(!favs.length&&!recents.length){searchResultsEl.innerHTML='';return;}
  let html='';
  if(favs.length){
    html+=`<div class="results-section-label">⭐ Saved</div>`;
    favs.slice(0,4).forEach(p=>{html+=resultRow(p,true,false);});
  }
  if(recents.length){
    html+=`<div class="results-section-label">🕐 Recent</div>`;
    recents.slice(0,5).forEach(p=>{html+=resultRow(p,isFav(p.name),false);});
  }
  searchResultsEl.innerHTML=html;
  bindResultClicks();
}

/* ── Live search ────────────────────────────────── */
let srchDebounce=null;
function wireInput(input, field){
  input.addEventListener('focus',()=>{
    setActiveField(field);
    if(input.value.trim().length>=2) doSearch(input.value.trim());
    else showSuggestions();
  });
  input.addEventListener('input',()=>{
    const q=input.value.trim();
    (field==='from'?fromClear:toClear).classList.toggle('hidden',!q);
    clearTimeout(srchDebounce);
    if(q.length<2){showSuggestions();return;}
    srchDebounce=setTimeout(()=>doSearch(q),350);
  });
}
wireInput(fromInput,'from');
wireInput(toInput,'to');

fromClear.addEventListener('click',()=>{fromInput.value='';fromPlace=null;fromClear.classList.add('hidden');fromInput.focus();showSuggestions();});
toClear.addEventListener('click',  ()=>{toInput.value='';  toPlace=null;  toClear.classList.add('hidden');  toInput.focus();  showSuggestions();});
swapBtn.addEventListener('click',()=>{
  [fromPlace,toPlace]=[toPlace,fromPlace];
  fromInput.value=fromPlace?.name??''; toInput.value=toPlace?.name??'';
  fromClear.classList.toggle('hidden',!fromInput.value);
  toClear.classList.toggle('hidden',!toInput.value);
  fromInput.placeholder=fromPlace?'':'📍 My location';
  if(fromPlace&&toPlace)tryRoute();
});

async function doSearch(q){
  searchResultsEl.innerHTML=`<div class="no-results">Searching…</div>`;
  const results=await geocode(q);
  if(!results.length){searchResultsEl.innerHTML=`<div class="no-results">No places found</div>`;return;}
  searchResultsEl.innerHTML=results.map(r=>resultRow(
    {lat:parseFloat(r.lat),lng:parseFloat(r.lon),name:placeName(r),sub:placeSub(r)},
    isFav(placeName(r)), true, placeEmoji(r), placeLabel(r)
  )).join('');
  bindResultClicks();
}

function resultRow(p, faved, showFav=true, emoji='📍', label=null){
  return `<div class="search-result" data-lat="${p.lat}" data-lng="${p.lng}" data-name="${escHtml(p.name)}" data-sub="${escHtml(p.sub??'')}">
    <span class="result-emoji">${emoji}</span>
    <span class="result-body">
      <strong>${escHtml(p.name)}</strong>
      ${label?`<em>${escHtml(label)}</em>`:''}
      <span>${escHtml(p.sub??'')}</span>
    </span>
    ${showFav?`<button class="result-fav-btn${faved?' saved':''}" title="${faved?'Remove':'Save'}">${faved?'⭐':'☆'}</button>`:''}
  </div>`;
}

function bindResultClicks(){
  document.querySelectorAll('.search-result').forEach(el=>{
    el.addEventListener('click',e=>{
      if(e.target.classList.contains('result-fav-btn')) return; // handled separately
      const p={lat:parseFloat(el.dataset.lat),lng:parseFloat(el.dataset.lng),name:el.dataset.name,sub:el.dataset.sub};
      selectPlace(p);
    });
  });
  document.querySelectorAll('.result-fav-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const el=btn.closest('.search-result');
      const p={lat:parseFloat(el.dataset.lat),lng:parseFloat(el.dataset.lng),name:el.dataset.name,sub:el.dataset.sub};
      const saved=toggleFav(p);
      btn.textContent=saved?'⭐':'☆';
      btn.classList.toggle('saved',saved);
    });
  });
}

function selectPlace(p){
  addRecent(p);
  if(activeField==='from'){
    fromPlace=p; fromInput.value=p.name; fromClear.classList.remove('hidden');
    searchResultsEl.innerHTML=''; setActiveField('to'); toInput.focus();
    if(toPlace)tryRoute();
  } else {
    toPlace=p; toInput.value=p.name; toClear.classList.remove('hidden');
    tryRoute();
  }
}

function tryRoute(){
  if(!toPlace)return;
  const gps=userMarker?userMarker.getLatLng():null;
  const from=fromPlace??(gps?{lat:gps.lat,lng:gps.lng}:{lat:map.getCenter().lat,lng:map.getCenter().lng});
  closePlanner();
  calcRoute(from.lat,from.lng,toPlace.lat,toPlace.lng);
}

/* ═══════════════════════════════════════════════
   ROUTING
═══════════════════════════════════════════════ */
async function calcRoute(fromLat,fromLng,toLat,toLng){
  previewBar.classList.add('hidden');
  [routeLine,traveledLine].forEach(l=>{if(l)map.removeLayer(l);});
  routeLine=traveledLine=null;
  if(destMarker){map.removeLayer(destMarker);destMarker=null;}
  destMarker=L.marker([toLat,toLng],{icon:L.divIcon({html:'<span class="dest-pin">📍</span>',className:'',iconSize:[32,40],iconAnchor:[16,40]})}).addTo(map);

  try{
    const resp=await fetch('/api/route',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({locations:[{lon:fromLng,lat:fromLat},{lon:toLng,lat:toLat}],costing:'auto',directions_options:{units:'kilometers',language:'en-US'}})});
    if(!resp.ok){alert('Could not find a route.');return;}
    const data=await resp.json();
    routeData=data.trip; maneuvers=routeData.legs[0].maneuvers;
    routePoints=decodePolyline6(routeData.legs[0].shape);

    routeLine=L.polyline(routePoints,{color:'#3b82f6',weight:6,opacity:.9}).addTo(map);
    map.fitBounds(routeLine.getBounds(),{padding:[60,80]});

    const td=routeData.summary.length, tt=routeData.summary.time;
    previewDist.textContent=fmtDist(td*1000);
    previewTime.textContent=fmtTime(tt);
    previewETA.textContent=`ETA ${fmtETA(tt)}`;
    renderDirections();
    previewBar.classList.remove('hidden');
    navState='preview';

  }catch(e){alert('Routing error: '+e.message);}
}

function renderDirections(){
  let cumDist=0;
  directionsList.innerHTML=maneuvers.map((m,i)=>{
    const d=cumDist; cumDist+=(m.length??0)*1000;
    const streets=(m.street_names??[]).join(' / ')||m.instruction?.split('.')[0]||'—';
    const speedStr=(m.speed_limit&&m.speed_limit<200)?`${m.speed_limit}`:'';
    const isLast=m.type>=4&&m.type<=6;
    return `<div class="dir-step${isLast?' dir-arrive':''}">
      <span class="dir-arrow">${ARROW[m.type]??'↑'}</span>
      <span class="dir-info"><span class="dir-street">${escHtml(streets)}</span><span class="dir-instr">${escHtml(m.instruction??'')}</span></span>
      ${speedStr?`<span class="dir-speed">${speedStr}</span>`:''}
      <span class="dir-dist">${i===0?'Start':fmtDist(d)}</span>
    </div>`;
  }).join('');
}

cancelRoute.addEventListener('click',clearRoute);
function clearRoute(){
  [routeLine,traveledLine].forEach(l=>{if(l)map.removeLayer(l);});
  if(destMarker){map.removeLayer(destMarker);destMarker=null;}
  routeLine=traveledLine=null;
  previewBar.classList.add('hidden');
  navState='idle'; routeData=null; routePoints=[]; maneuvers=[];
  fromPlace=null; toPlace=null;
  fromInput.value=''; toInput.value='';
  fromClear.classList.add('hidden'); toClear.classList.add('hidden');
}

/* ═══════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════ */
startNavBtn.addEventListener('click',startNav);
endNavBtn.addEventListener('click',endNav);
arrivalDone.addEventListener('click',()=>{arrivalOverlay.classList.add('hidden');endNav();});

function startNav(){
  previewBar.classList.add('hidden');
  topbar.classList.add('hidden');
  reportBtn.classList.add('hidden');
  navInst.classList.remove('hidden');
  navFooter.classList.remove('hidden');
  navState='navigating';
  currentMidx=0; lastVoice=-1; offCount=0; alertedIds.clear();
  remainingSec=routeData.summary.time;

  // Pre-load cameras near route for proximity alerts
  loadNearCameras();
  loadNearReports();

  if(watchId!=null) navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(onGPS,gpsErr,{enableHighAccuracy:true,maximumAge:1000,timeout:10000});
  updateNavPanel();
  dingChime();
}

function endNav(){
  navState='idle';
  if(watchId!=null){navigator.geolocation.clearWatch(watchId);watchId=null;}
  [navInst,navFooter,alertBar,arrivalOverlay].forEach(el=>el.classList.add('hidden'));
  topbar.classList.remove('hidden'); reportBtn.classList.remove('hidden');
  clearRoute();
  if(userMarker){map.removeLayer(userMarker);userMarker=null;}
  prevPos=null;
  currentSpeedEl.innerHTML='– <small>km/h</small>';
  speedLimitSign.classList.add('hidden');
}

function gpsErr(e){console.warn('GPS',e.code,e.message);}

function makeUserMarker(lat,lng,hdg=0){
  return L.marker([lat,lng],{
    icon:L.divIcon({html:`<span class="user-arrow" style="transform:rotate(${hdg}deg)">▲</span>`,className:'',iconSize:[32,32],iconAnchor:[16,16]}),
    zIndexOffset:1000,
  });
}

/* ── GPS handler ────────────────────────────────── */
function onGPS(pos){
  const {latitude:lat,longitude:lng,speed:rawSpd,heading}=pos.coords;
  const hdg=(heading!=null&&!isNaN(heading))?heading:(prevPos?bearing(prevPos.lat,prevPos.lng,lat,lng):0);

  if(userMarker)map.removeLayer(userMarker);
  userMarker=makeUserMarker(lat,lng,hdg).addTo(map);

  if(navState==='navigating'){
    map.setView([lat,lng],Math.max(map.getZoom(),15),{animate:true,duration:0.8});
  }

  // Speed
  let rawMs=rawSpd;
  if((rawMs==null||isNaN(rawMs))&&prevPos){
    const dt=(pos.timestamp-prevPos.ts)/1000;
    if(dt>0) rawMs=haversine(prevPos.lat,prevPos.lng,lat,lng)/dt;
  }
  const speedMs=rawMs??0;

  if(navState==='navigating'){
    currentSpeedEl.innerHTML=fmtSpeed(speedMs);
    const lim=getSpeedLimit();
    const dispLim=lim?(prefs.unit==='mph'?Math.round(lim*0.621):lim):null;
    const over=dispLim&&(prefs.unit==='mph'?toMph(speedMs):toKmh(speedMs))>dispLim;
    currentSpeedEl.classList.toggle('over-limit',over);
    speedLimitSign.classList.toggle('over-limit',over);
    navSpeedBadge.classList.toggle('over',over);
    if(over&&prefs.haptic&&navigator.vibrate) navigator.vibrate([100,50,100]);
    // Sync speed badge in nav instruction
    if(dispLim){
      navSpeedBadge.classList.remove('hidden');
      navSpeedVal.textContent=dispLim;
    } else navSpeedBadge.classList.add('hidden');
  }

  prevPos={lat,lng,ts:pos.timestamp};
  if(navState!=='navigating'||!routePoints.length)return;

  const {idx,dist}=nearestOnRoute(routePoints,lat,lng);

  // Update traveled/remaining route styling
  updateRouteStyling(idx);

  // Off-route
  if(dist>60){
    offCount++;
    if(offCount>=3){
      offCount=0;
      const destPt=routePoints[routePoints.length-1];
      calcRoute(lat,lng,destPt[0],destPt[1]).then(()=>{if(navState==='preview')startNav();});
      return;
    }
  } else offCount=0;

  // Current maneuver
  for(let i=maneuvers.length-1;i>=0;i--){if(idx>=maneuvers[i].begin_shape_index){currentMidx=i;break;}}

  const nextM=maneuvers[currentMidx+1]??maneuvers[currentMidx];
  const nextPt=routePoints[nextM.begin_shape_index]??routePoints[routePoints.length-1];
  const distToTurn=haversine(lat,lng,nextPt[0],nextPt[1]);
  remainingSec=Math.round(routeData.summary.time*(1-Math.min(idx/routePoints.length,1)));

  updateNavPanel(distToTurn);
  checkVoice(currentMidx,distToTurn);
  checkProximityAlerts(lat,lng);

  // Arrival
  if((nextM.type>=4&&nextM.type<=6)&&distToTurn<25){
    triggerArrival();
  }
}

function updateRouteStyling(idx){
  if(traveledLine)map.removeLayer(traveledLine);
  if(idx>1){
    traveledLine=L.polyline(routePoints.slice(0,idx+1),{color:'#3d3d5c',weight:5,opacity:.65}).addTo(map);
    if(routeLine)routeLine.setLatLngs(routePoints.slice(idx));
  }
}

function updateNavPanel(distToTurn){
  if(!maneuvers.length)return;
  const nextM=maneuvers[currentMidx+1]??maneuvers[currentMidx];
  navIconEl.textContent=ARROW[nextM.type]??'↑';
  navDistEl.textContent=distToTurn!=null?fmtDist(distToTurn):'';
  navStreetEl.textContent=(nextM.street_names??[]).join(' / ')||nextM.instruction||'';

  // Next-next maneuver
  const nnM=maneuvers[currentMidx+2];
  if(nnM){
    navNextWrap.classList.remove('hidden');
    navNextIcon.textContent=ARROW[nnM.type]??'↑';
    navNextLabel.textContent=`Then: ${(nnM.street_names??[]).join(' / ')||nnM.instruction||''}`;
  } else navNextWrap.classList.add('hidden');

  navETA.textContent=fmtETA(remainingSec);
  const remDist=remainingSec*(routeData.summary.length*1000/routeData.summary.time);
  navRemaining.textContent=`${fmtDist(remDist)} · ${fmtTime(remainingSec)}`;

  const lim=getSpeedLimit();
  if(lim){speedLimitSign.classList.remove('hidden');speedLimitVal.textContent=prefs.unit==='mph'?Math.round(lim*0.621):lim;}
  else speedLimitSign.classList.add('hidden');
}

function getSpeedLimit(){ const m=maneuvers[currentMidx]; return(m?.speed_limit&&m.speed_limit<200)?m.speed_limit:null; }

/* ── Proximity alerts (cameras + police) ──────── */
async function loadNearCameras(){
  const b=map.getBounds().pad(0.3);
  const p=new URLSearchParams({swlat:b.getSouth(),swlng:b.getWest(),nelat:b.getNorth(),nelng:b.getEast()});
  try{nearCameras=await fetch(`/api/cameras?${p}`).then(r=>r.json());}catch{}
}
async function loadNearReports(){
  const b=map.getBounds().pad(0.3);
  const p=new URLSearchParams({swlat:b.getSouth(),swlng:b.getWest(),nelat:b.getNorth(),nelng:b.getEast()});
  try{nearReports=await fetch(`/api/reports?${p}`).then(r=>r.json());}catch{}
}

function checkProximityAlerts(lat,lng){
  if(prefs.cameraAlerts){
    for(const cam of nearCameras){
      const d=haversine(lat,lng,cam.lat,cam.lng);
      const key=`c-${cam.id}-${d<180?'near':'far'}`;
      if(d<350&&d>0&&!alertedIds.has(key)){
        alertedIds.add(key);
        const label={speed:'Speed camera',red_light:'Red light camera',average_speed:'Avg speed camera'}[cam.type]??'Camera';
        const limitStr=cam.speed_limit?` · ${cam.speed_limit} km/h`:'';
        showAlert('📷',`${label}${limitStr}`,fmtDist(d),false);
        cameraChime();
        if(prefs.haptic&&navigator.vibrate) navigator.vibrate(200);
      }
      if(d>500){alertedIds.delete(`c-${cam.id}-near`);alertedIds.delete(`c-${cam.id}-far`);}
    }
  }
  if(prefs.policeAlerts){
    for(const r of nearReports){
      if(r.type!=='police'&&r.type!=='speed_trap') continue;
      const d=haversine(lat,lng,r.lat,r.lng);
      const key=`r-${r.id}`;
      if(d<300&&!alertedIds.has(key)){
        alertedIds.add(key);
        const label=r.type==='police'?'Police reported ahead':'Speed trap reported';
        showAlert('🚔',label,fmtDist(d),true);
        policeChime();
        if(prefs.haptic&&navigator.vibrate) navigator.vibrate([200,100,200]);
      }
      if(d>600)alertedIds.delete(key);
    }
  }
}

function showAlert(icon,text,dist,isPolice){
  alertIcon.textContent=icon;
  alertText.textContent=text;
  alertDist.textContent=dist;
  alertBar.classList.toggle('police-alert',isPolice);
  // Position below nav-instruction
  const instH=navInst.offsetHeight;
  alertBar.style.top=(instH+8)+'px';
  alertBar.classList.remove('hidden');
  clearTimeout(alertHideTimer);
  alertHideTimer=setTimeout(()=>alertBar.classList.add('hidden'),5000);
}

/* ── Voice guidance ─────────────────────────────── */
const synth=window.speechSynthesis;
function speak(text){
  if(!prefs.voice||!synth)return;
  synth.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang='en-AU';u.rate=1.05;u.volume=0.9;
  synth.speak(u);
}
function checkVoice(mIdx,dist){
  const nextM=maneuvers[mIdx+1]; if(!nextM)return;
  const instr=nextM.verbal_pre_transition_instruction??nextM.instruction??'';
  const key=(d)=>`${mIdx}-${d}`;
  if(dist<=220&&dist>140&&lastVoice!==key('c')){speak(nextM.verbal_transition_alert_instruction??instr);lastVoice=key('c');}
  else if(dist<=550&&dist>440&&lastVoice!==key('b')){speak(`In ${fmtDist(dist)}, ${instr}`);lastVoice=key('b');}
  else if(dist<=1050&&dist>940&&lastVoice!==key('a')){speak(`In 1 kilometre, ${instr}`);lastVoice=key('a');}
}

/* ── Arrival ──────────────────────────────────── */
let arrivedFlag=false;
function triggerArrival(){
  if(arrivedFlag)return; arrivedFlag=true;
  speak('You have arrived at your destination.');
  dingChime(); setTimeout(dingChime,600); setTimeout(dingChime,1200);
  if(prefs.haptic&&navigator.vibrate)navigator.vibrate([300,100,300,100,300]);
  arrivalDest.textContent=toPlace?.name??'your destination';
  arrivalOverlay.classList.remove('hidden');
  [navInst,navFooter,alertBar].forEach(el=>el.classList.add('hidden'));
}
