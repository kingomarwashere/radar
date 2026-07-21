/* ═══════════════════════════════════════════════════════════════════════════
   GHOST — game systems (classic script, loaded after app.js)
   • Drive recording  : records the map + your 3D car to a WebM clip (MediaRecorder
                         on the map canvas), stored in IndexedDB as a "Replay".
   • Daily challenges  : 3 rotating goals per day + a day streak, fed by event
                         hooks from app.js (speed, evades, reports, distance…).
   Exposes window.Game. app.js calls Game.onX(...) hooks at runtime.
═══════════════════════════════════════════════════════════════════════════ */
(() => {
  const $ = (id) => document.getElementById(id);
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const yesterdayKey = () => { const d = new Date(Date.now()-864e5); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  // ── Toast ──────────────────────────────────────────────────────────────────
  let _toastTimer = null;
  function toast(html, ms = 3200) {
    let t = $('game-toast');
    if (!t) { t = document.createElement('div'); t.id = 'game-toast'; document.body.appendChild(t); }
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), ms);
    if (window.prefs?.haptic && navigator.vibrate) navigator.vibrate(30);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DAILY CHALLENGES + STREAK
  // ═══════════════════════════════════════════════════════════════════════════
  const POOL = [
    { id:'speed150', emoji:'🏎️', label:'Hit 150 km/h',          stat:'maxSpeed',   target:150,   coins:100 },
    { id:'speed200', emoji:'🚀', label:'Break 200 km/h',         stat:'maxSpeed',   target:200,   coins:220 },
    { id:'evade3',   emoji:'👮', label:'Evade the cops 3×',      stat:'evades',     target:3,     coins:160 },
    { id:'report5',  emoji:'⚠️', label:'Report 5 hazards',       stat:'reports',    target:5,     coins:120 },
    { id:'drive20',  emoji:'🛣️', label:'Drive 20 km',           stat:'distanceKm', target:20,    coins:120 },
    { id:'drive50',  emoji:'🗺️', label:'Drive 50 km',           stat:'distanceKm', target:50,    coins:260 },
    { id:'stars5',   emoji:'⭐', label:'Reach 5 wanted stars',   stat:'maxStars',   target:5,     coins:180 },
    { id:'score10k', emoji:'🏆', label:'Score 10K in one drive', stat:'bestScore',  target:10000, coins:150 },
    { id:'drives3',  emoji:'🧭', label:'Complete 3 drives',      stat:'drives',     target:3,     coins:110 },
  ];
  const STAT_FMT = { maxSpeed:(v)=>`${Math.round(v)} km/h`, distanceKm:(v)=>`${v.toFixed(1)} km`, bestScore:(v)=>Math.round(v).toLocaleString(), default:(v)=>Math.round(v) };
  const fmtStat = (stat,v)=> (STAT_FMT[stat]||STAT_FMT.default)(v);

  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function seedFromDate(key){ let h=2166136261; for(let i=0;i<key.length;i++){ h^=key.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function pickChallenges(key){
    const rng = mulberry32(seedFromDate(key));
    const idx = POOL.map((_,i)=>i).sort(()=> rng()-0.5);
    // ensure variety: at most one pure top-speed goal
    const chosen=[]; let speedCount=0;
    for(const i of idx){ const c=POOL[i]; if(c.stat==='maxSpeed'){ if(speedCount>=1) continue; speedCount++; } chosen.push(c.id); if(chosen.length===3) break; }
    while(chosen.length<3){ for(const i of idx){ if(!chosen.includes(POOL[i].id)){ chosen.push(POOL[i].id); break; } } }
    return chosen;
  }

  const DKEY = 'ghost_daily_v1';
  function loadDaily(){
    let s = null;
    try { s = JSON.parse(localStorage.getItem(DKEY) || 'null'); } catch {}
    const today = todayKey();
    if (!s || typeof s !== 'object') s = { date:null, stats:{}, ids:[], claimed:false, streak:0, lastClear:null, coins:0 };
    if (s.date !== today) {
      // New day: reset today's stats/challenges, keep streak+coins.
      // Break the streak if the last cleared day wasn't yesterday or today.
      if (s.lastClear !== today && s.lastClear !== yesterdayKey()) s.streak = 0;
      s.date = today;
      s.stats = {};
      s.ids = pickChallenges(today);
      s.claimed = false;
      save(s);
    }
    if (!s.ids || s.ids.length !== 3) { s.ids = pickChallenges(today); save(s); }
    return s;
  }
  function save(s){ try { localStorage.setItem(DKEY, JSON.stringify(s)); } catch {} }

  function challengeState(s){
    return s.ids.map(id => {
      const c = POOL.find(p=>p.id===id) || POOL[0];
      const v = s.stats[c.stat] || 0;
      const pct = Math.max(0, Math.min(1, v / c.target));
      return { ...c, value:v, pct, done: v >= c.target };
    });
  }

  // Update a stat and detect newly-completed challenges + streak clears.
  function bumpStat(stat, value, mode = 'max') {
    const s = loadDaily();
    const before = challengeState(s);
    const cur = s.stats[stat] || 0;
    if (mode === 'add') s.stats[stat] = cur + value;
    else if (mode === 'set') s.stats[stat] = value;
    else s.stats[stat] = Math.max(cur, value); // 'max'
    const after = challengeState(s);

    let newlyDone = 0;
    after.forEach((c, i) => {
      if (c.done && !before[i].done) {
        newlyDone++;
        s.coins = (s.coins || 0) + c.coins;
        toast(`✅ <b>Challenge done</b> — ${c.emoji} ${c.label} <span class="toast-coin">+${c.coins}🪙</span>`);
      }
    });

    // Full clear → advance streak once per day
    const allDone = after.every(c => c.done);
    if (allDone && s.lastClear !== s.date) {
      s.streak = (s.lastClear === yesterdayKey()) ? (s.streak || 0) + 1 : 1;
      s.lastClear = s.date;
      s.coins = (s.coins || 0) + 200; // full-clear bonus
      save(s);
      setTimeout(() => {
        toast(`🔥 <b>Daily complete!</b> ${s.streak}-day streak <span class="toast-coin">+200🪙</span>`, 4200);
        if (window.prefs?.haptic && navigator.vibrate) navigator.vibrate([60,40,60,40,120]);
      }, newlyDone ? 900 : 0);
    } else {
      save(s);
    }
    if (newlyDone && !$('daily-modal')?.classList.contains('hidden')) renderDaily();
    updateDailyBadge();
  }

  function effectiveStreak(s){
    return (s.lastClear === s.date || s.lastClear === yesterdayKey()) ? (s.streak || 0) : 0;
  }

  function updateDailyBadge(){
    const s = loadDaily();
    const cs = challengeState(s);
    const done = cs.filter(c=>c.done).length;
    const badge = $('daily-badge');
    if (badge){ badge.textContent = `${done}/3`; badge.classList.toggle('complete', done===3); }
    const strk = $('daily-streak-chip');
    if (strk){ const st = effectiveStreak(s); strk.textContent = `🔥 ${st}`; strk.classList.toggle('hidden', st<1); }
  }

  function renderDaily(){
    const s = loadDaily();
    const cs = challengeState(s);
    const st = effectiveStreak(s);
    const body = $('daily-body');
    if (!body) return;
    body.innerHTML =
      `<div class="daily-top">
         <div class="daily-streak"><span class="ds-flame">🔥</span><span class="ds-num">${st}</span><span class="ds-lbl">day streak</span></div>
         <div class="daily-coins">🪙 ${(s.coins||0).toLocaleString()}</div>
       </div>
       <div class="daily-sub">Clear all 3 to extend your streak. Resets at midnight.</div>` +
      cs.map(c => `
         <div class="chal-row ${c.done?'done':''}">
           <div class="chal-emoji">${c.done?'✅':c.emoji}</div>
           <div class="chal-main">
             <div class="chal-label">${c.label}</div>
             <div class="chal-bar"><span style="width:${Math.round(c.pct*100)}%"></span></div>
           </div>
           <div class="chal-val">${c.done?`+${c.coins}🪙`:`${fmtStat(c.stat,c.value)} / ${fmtStat(c.stat,c.target)}`}</div>
         </div>`).join('');
  }

  function openDaily(){ renderDaily(); $('daily-modal')?.classList.remove('hidden'); }
  function closeDaily(){ $('daily-modal')?.classList.add('hidden'); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DRIVE RECORDING  (MediaRecorder on the map canvas → IndexedDB replays)
  // ═══════════════════════════════════════════════════════════════════════════
  const recSupported = () =>
    typeof MediaRecorder !== 'undefined' &&
    !!window.ghostMap?.getCanvas &&
    typeof window.ghostMap.getCanvas().captureStream === 'function';

  let rec = null, recChunks = [], recStats = null, recTimer = null, recStartMs = 0;

  function pickMime(){
    const opts = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
    for (const m of opts) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {} }
    return '';
  }

  function startRec(){
    if (rec || !recSupported()) { if(!recSupported()) toast('⚠️ Recording not supported on this browser'); return; }
    let stream;
    try { stream = window.ghostMap.getCanvas().captureStream(30); }
    catch (e) { toast('⚠️ Could not start recording'); return; }
    const mime = pickMime();
    try { rec = new MediaRecorder(stream, mime ? { mimeType:mime, videoBitsPerSecond:6_000_000 } : undefined); }
    catch (e) { toast('⚠️ Recorder init failed'); rec=null; return; }
    recChunks = [];
    recStats = { topSpeed:0, maxStars:0, dist:0, car: localStorage.getItem('selectedCar')||'', mime };
    recStartMs = Date.now();
    rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    rec.onstop = finalizeRec;
    rec.start(1000);
    document.body.classList.add('recording');
    $('rec-time') && ($('rec-time').textContent = '0:00');
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now()-recStartMs)/1000);
      if ($('rec-time')) $('rec-time').textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    }, 500);
    toast('⏺️ <b>Recording</b> your drive');
  }

  function stopRec(){
    if (!rec) return;
    try { rec.stop(); } catch {}
    rec = null;
    clearInterval(recTimer); recTimer = null;
    document.body.classList.remove('recording');
  }

  async function finalizeRec(){
    const dur = Math.round((Date.now()-recStartMs)/1000);
    const blob = new Blob(recChunks, { type: recChunks[0]?.type || 'video/webm' });
    recChunks = [];
    if (!blob.size || dur < 1) { toast('Recording too short'); return; }
    let thumb = '';
    try { thumb = window.ghostMap.getCanvas().toDataURL('image/jpeg', 0.5); } catch {}
    const meta = { topSpeed:Math.round(recStats?.topSpeed||0), maxStars:recStats?.maxStars||0,
                   dist:+(recStats?.dist||0).toFixed(1), car:recStats?.car||'', dur };
    const clip = { id:'clip_'+Date.now(), ts:Date.now(), blob, thumb, meta };
    try { await idbPut(clip); toast(`🎬 <b>Replay saved</b> — ${fmtDur(dur)} · top ${meta.topSpeed} km/h`); }
    catch (e) { toast('⚠️ Could not save replay'); return; }
    if (!$('replays-modal')?.classList.contains('hidden')) renderReplays();
  }

  function toggleRec(){ rec ? stopRec() : startRec(); }
  const fmtDur = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  // ── IndexedDB ───────────────────────────────────────────────────────────────
  let _db = null;
  function idb(){
    return new Promise((res, rej) => {
      if (_db) return res(_db);
      const r = indexedDB.open('ghost-replays', 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath:'id' }); };
      r.onsuccess = () => { _db = r.result; res(_db); };
      r.onerror = () => rej(r.error);
    });
  }
  async function idbPut(clip){ const db = await idb(); return new Promise((res,rej)=>{ const tx=db.transaction('clips','readwrite'); tx.objectStore('clips').put(clip); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }
  async function idbAll(){ const db = await idb(); return new Promise((res,rej)=>{ const tx=db.transaction('clips','readonly'); const rq=tx.objectStore('clips').getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); }); }
  async function idbGet(id){ const db = await idb(); return new Promise((res,rej)=>{ const tx=db.transaction('clips','readonly'); const rq=tx.objectStore('clips').get(id); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }
  async function idbDel(id){ const db = await idb(); return new Promise((res,rej)=>{ const tx=db.transaction('clips','readwrite'); tx.objectStore('clips').delete(id); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }

  // ── Replays UI ───────────────────────────────────────────────────────────────
  const CAR_NAME = (id) => (window.CARS?.find?.(c=>c.id===id)?.name) || 'Ghost';
  async function renderReplays(){
    const list = $('replays-list'); if (!list) return;
    let clips = [];
    try { clips = await idbAll(); } catch {}
    clips.sort((a,b)=>b.ts-a.ts);
    if (!clips.length) { list.innerHTML = `<div class="replays-empty">No replays yet.<br>Tap ⏺️ while driving to record your run.</div>`; return; }
    list.innerHTML = clips.map(c => `
      <div class="replay-card" data-id="${c.id}">
        <div class="replay-thumb" style="background-image:url('${c.thumb||''}')">
          <span class="replay-dur">${fmtDur(c.meta?.dur||0)}</span>
          <span class="replay-play">▶</span>
        </div>
        <div class="replay-info">
          <div class="replay-title">${'★'.repeat(c.meta?.maxStars||0)||'🏁'} ${CAR_NAME(c.meta?.car)}</div>
          <div class="replay-meta">${new Date(c.ts).toLocaleDateString([], {month:'short',day:'numeric'})} · ${c.meta?.topSpeed||0} km/h · ${c.meta?.dist||0} km</div>
        </div>
        <div class="replay-actions">
          <button class="rep-share" data-id="${c.id}" title="Share">📤</button>
          <button class="rep-dl" data-id="${c.id}" title="Download">⬇️</button>
          <button class="rep-del" data-id="${c.id}" title="Delete">🗑️</button>
        </div>
      </div>`).join('');
  }

  async function playReplay(id){
    const c = await idbGet(id); if (!c) return;
    const url = URL.createObjectURL(c.blob);
    const v = $('video-player'); const modal = $('video-modal');
    if (!v || !modal) return;
    v.src = url; modal.classList.remove('hidden');
    v.play?.().catch(()=>{});
    modal._url && URL.revokeObjectURL(modal._url); modal._url = url;
  }
  function closeVideo(){ const v=$('video-player'), m=$('video-modal'); if(v){ v.pause?.(); v.removeAttribute('src'); v.load?.(); } m?.classList.add('hidden'); if(m?._url){ URL.revokeObjectURL(m._url); m._url=null; } }

  async function shareReplay(id){
    const c = await idbGet(id); if (!c) return;
    const ext = (c.blob.type.includes('mp4')) ? 'mp4' : 'webm';
    const file = new File([c.blob], `ghost-replay.${ext}`, { type:c.blob.type });
    if (navigator.canShare?.({ files:[file] })) {
      try { await navigator.share({ files:[file], title:'GHOST replay', text:`My GHOST run — ${c.meta?.topSpeed||0} km/h 🏎️` }); return; } catch {}
    }
    downloadReplay(id, c); // fallback
  }
  async function downloadReplay(id, pre){
    const c = pre || await idbGet(id); if (!c) return;
    const ext = (c.blob.type.includes('mp4')) ? 'mp4' : 'webm';
    const url = URL.createObjectURL(c.blob);
    const a = document.createElement('a'); a.href=url; a.download=`ghost-replay-${new Date(c.ts).toISOString().slice(0,10)}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }
  async function delReplay(id){ try { await idbDel(id); } catch {} renderReplays(); }

  async function openReplays(){ await renderReplays(); $('replays-modal')?.classList.remove('hidden'); }
  function closeReplays(){ $('replays-modal')?.classList.add('hidden'); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  WIRING
  // ═══════════════════════════════════════════════════════════════════════════
  function wire(){
    $('rec-fab')?.addEventListener('click', toggleRec);
    $('open-daily-btn')?.addEventListener('click', openDaily);
    $('daily-close')?.addEventListener('click', closeDaily);
    $('daily-modal')?.addEventListener('click', (e)=>{ if(e.target.id==='daily-modal') closeDaily(); });
    $('open-replays-btn')?.addEventListener('click', openReplays);
    $('replays-close')?.addEventListener('click', closeReplays);
    $('replays-modal')?.addEventListener('click', (e)=>{ if(e.target.id==='replays-modal') closeReplays(); });
    $('video-close')?.addEventListener('click', closeVideo);
    $('video-modal')?.addEventListener('click', (e)=>{ if(e.target.id==='video-modal') closeVideo(); });
    // Replay card actions (delegated)
    $('replays-list')?.addEventListener('click', (e)=>{
      const t = e.target.closest('button, .replay-thumb'); if(!t) return;
      const card = e.target.closest('.replay-card'); const id = t.dataset.id || card?.dataset.id; if(!id) return;
      if (t.classList.contains('rep-share')) shareReplay(id);
      else if (t.classList.contains('rep-dl')) downloadReplay(id);
      else if (t.classList.contains('rep-del')) delReplay(id);
      else if (t.classList.contains('replay-thumb')) playReplay(id);
    });
    // Hide record button entirely if unsupported
    if (!recSupported()) $('rec-fab')?.classList.add('rec-unsupported');
    updateDailyBadge();
  }

  // ── Public API (hooks called by app.js) ──────────────────────────────────────
  window.Game = {
    // daily hooks
    onSpeed(kmh){ if(recStats && kmh>recStats.topSpeed) recStats.topSpeed=kmh; if(kmh>1) bumpStat('maxSpeed', kmh, 'max'); },
    onStars(n){ if(recStats && n>recStats.maxStars) recStats.maxStars=n; if(n>0) bumpStat('maxStars', n, 'max'); },
    onEvade(){ bumpStat('evades', 1, 'add'); },
    onReport(){ bumpStat('reports', 1, 'add'); },
    onDistance(km){ if(recStats) recStats.dist += km; bumpStat('distanceKm', km, 'add'); },
    onDriveEnd(score){ bumpStat('drives', 1, 'add'); if(score>0) bumpStat('bestScore', score, 'max'); if(rec) stopRec(); },
    // recording
    startRec, stopRec, toggleRec, isRecording: () => !!rec,
    // ui
    openDaily, openReplays,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
