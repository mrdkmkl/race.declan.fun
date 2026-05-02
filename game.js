// ═══════════════════════════════════════════════════
//  hill rider — game.js
// ═══════════════════════════════════════════════════

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', () => { resize(); if (!gameRunning) buildTerrain(); });
resize();

// ── Persistent store ──────────────────────────────
const STORE_KEY = 'hillrider_v3';
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function saveStore(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch {} }

let store = loadStore();
store.lifetime     = store.lifetime     || 0;
store.ownedPowerups= store.ownedPowerups|| [];
store.boostCounts  = store.boostCounts  || {}; // how many times each boost bought
saveStore(store);

// ── Mode config ───────────────────────────────────
const MODES = {
  easy:   { label:'easy',       hillAmp:[70,28,10], zoneInterval:1600, zoneBase:[60,80,100], obsInterval:900,  obsSpeed:80,  scoreMult:1.0, waterFreq:0 },
  medium: { label:'medium',     hillAmp:[105,42,16],zoneInterval:1100, zoneBase:[45,65,80],  obsInterval:580,  obsSpeed:60,  scoreMult:1.3, waterFreq:0.18 },
  hard:   { label:'hard',       hillAmp:[140,60,22],zoneInterval:750,  zoneBase:[35,50,65],  obsInterval:380,  obsSpeed:45,  scoreMult:1.8, waterFreq:0.38 },
  water:  { label:'all water',  hillAmp:[90,35,12], zoneInterval:1400, zoneBase:[55,75,90],  obsInterval:700,  obsSpeed:70,  scoreMult:1.5, waterFreq:1.0 },
};
let currentMode = 'easy';

// ── Power-up catalogue ────────────────────────────
const POWERUP_DEFS = [
  // existing (repriced higher)
  { id:'no_zones',     name:'zone free',      desc:'no speed limit zones this run',              icon:'🚫', baseCost:800  },
  { id:'double_score', name:'2× score',       desc:'all points doubled this run',                icon:'✕2', baseCost:650  },
  { id:'slow_zones',   name:'lenient limits', desc:'speed limits +60% higher this run',          icon:'🛡', baseCost:500  },
  { id:'no_obstacles', name:'clear road',     desc:'no obstacles or water this run',             icon:'🛤', baseCost:600  },
  { id:'turbo_start',  name:'turbo start',    desc:'begin at 80 mph with active boost',          icon:'⚡', baseCost:350  },
  { id:'score_saver',  name:'score saver',    desc:'keep 60% of score on explosion',             icon:'🪙', baseCost:700  },
  // new
  { id:'magnet',       name:'coin magnet',    desc:'score coins pulled in from far away',        icon:'🧲', baseCost:450  },
  { id:'nitro_reserve',name:'nitro reserve',  desc:'start with 3 boosts already charged',       icon:'🔋', baseCost:550  },
  { id:'ghost',        name:'ghost mode',     desc:'drive through obstacles safely this run',    icon:'👻', baseCost:900  },
  { id:'water_walk',   name:'water walk',     desc:'drive over water without sinking this run',  icon:'🌊', baseCost:750  },
  { id:'triple_score', name:'3× score',       desc:'all points tripled — stacks with 2×',        icon:'✕3', baseCost:1200 },
];

// ── Boosts catalogue (separate from shop power-ups) ──
// Boosts are bought in-game with lifetime pts; price rises each purchase
const BOOST_DEFS = [
  { id:'speed_burst',  name:'speed burst',   desc:'+30 mph instantly',         icon:'💨', baseCost:120,  apply: s => { s.speed = Math.min(s.speed + 30, s.maxSpeed); } },
  { id:'turbo_5s',     name:'5s turbo',      desc:'full turbo for 5 seconds',  icon:'🚀', baseCost:200,  apply: s => { s.boostActive=true; s.boostTimer=Math.max(s.boostTimer,5); } },
  { id:'slow_time',    name:'slow time',     desc:'zone enforcement off 8s',   icon:'⏱', baseCost:280,  apply: s => { s.zoneImmune=true; s.zoneImmuneTimer=8; } },
  { id:'repair',       name:'repair',        desc:'clear nearest obstacle',    icon:'🔧', baseCost:160,  apply: s => {
      const carWX = s.worldX + s.carX;
      s.obstacles = s.obstacles.filter(o => Math.abs(o.wx - carWX) > 200);
    }
  },
  { id:'score_x3_5s',  name:'score frenzy',  desc:'3× score for 5 seconds',    icon:'🔥', baseCost:350,  apply: s => { s.frenzyTimer=5; } },
];

// ── Active powerups & state ───────────────────────
let activePowerups = new Set();
let gameRunning    = false;
let loopStarted    = false;
let boostMenuOpen  = false;
let state = {};

function initState() {
  const m = MODES[currentMode];
  return {
    speed: 0, maxSpeed: 200,
    distance: 0, score: 0, worldX: 0,
    boostActive: false, boostTimer: 0,
    zoneImmune: false, zoneImmuneTimer: 0,
    frenzyTimer: 0,
    nitroCharges: 0,
    dead: false, deathReason: '',
    terrainSeed: Math.random() * 10000,
    terrain: [], waterSegs: [],
    zones: [], boosts: [], obstacles: [], scorePickups: [],
    floatLabels: [],   // {x,y,text,life,vy}
    particles: [],
    carX: 200, carY: 300, carAngle: 0, carVY: 0, onGround: true,
    inWater: false,
    mode: currentMode,
  };
}

// ── Input ─────────────────────────────────────────
const KEYS = {};
window.addEventListener('keydown', e => {
  KEYS[e.key] = true;
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
  if (e.key === 'Tab') { e.preventDefault(); toggleBoostMenu(); }
});
window.addEventListener('keyup', e => { KEYS[e.key] = false; });

// ── Terrain ───────────────────────────────────────
const TERRAIN_STEP = 36;
const BASE_Y_RATIO = 0.60;

function terrainYAt(worldPx) {
  const m  = MODES[currentMode];
  const a  = m.hillAmp;
  const sd = state.terrainSeed || 0;
  return canvas.height * BASE_Y_RATIO
    + Math.sin(worldPx/1300 * 2.0 + sd)        * a[0]
    + Math.sin(worldPx/420  * 3.5 + sd * 1.2)  * a[1]
    + Math.sin(worldPx/190  * 5.3 + sd * 0.8)  * a[2];
}

function buildTerrain() {
  state.terrain = [];
  const count = Math.ceil(canvas.width / TERRAIN_STEP) + 8;
  for (let i = 0; i < count; i++) {
    const wx = (state.worldX || 0) - TERRAIN_STEP + i * TERRAIN_STEP;
    state.terrain.push({ x: wx, y: terrainYAt(wx) });
  }
}

function extendTerrain() {
  const right = state.worldX + canvas.width + TERRAIN_STEP * 5;
  while (!state.terrain.length || state.terrain[state.terrain.length-1].x < right) {
    const last = state.terrain[state.terrain.length-1];
    const wx = last ? last.x + TERRAIN_STEP : state.worldX;
    state.terrain.push({ x: wx, y: terrainYAt(wx) });
  }
  while (state.terrain.length > 2 && state.terrain[1].x < state.worldX - TERRAIN_STEP*2)
    state.terrain.shift();
}

function groundYAtWorldX(wx) {
  for (let i = 0; i < state.terrain.length-1; i++) {
    const a = state.terrain[i], b = state.terrain[i+1];
    if (wx >= a.x && wx <= b.x) {
      return a.y + (b.y - a.y) * ((wx-a.x)/(b.x-a.x));
    }
  }
  return terrainYAt(wx);
}

function groundAngleAtWorldX(wx) {
  return Math.atan2(terrainYAt(wx+6)-terrainYAt(wx-6), 12);
}

function worldToScreenX(wx) { return wx - state.worldX; }

// ── Water segments ────────────────────────────────
// waterSegs: [{wx, len}] stored in state
let nextWaterAt = 0;

function maybeSpawnWater() {
  const m = MODES[currentMode];
  if (m.waterFreq === 0) return;
  const ahead = state.worldX + canvas.width;
  if (ahead < nextWaterAt) return;
  if (Math.random() < m.waterFreq || currentMode === 'water') {
    const len = 180 + Math.random() * 320;
    state.waterSegs.push({ wx: nextWaterAt, len });
  }
  nextWaterAt += 500 + Math.random() * 600;
  if (currentMode === 'water') nextWaterAt = state.worldX + canvas.width + 80 + Math.random()*120;
}

function isInWaterAt(wx) {
  for (const w of state.waterSegs) if (wx >= w.wx && wx <= w.wx + w.len) return true;
  return false;
}

// ── Entity spawning ───────────────────────────────
let nextZoneAt, nextBoostAt, nextObsAt, nextScoreAt;

function resetSpawnCounters() {
  nextZoneAt  = 1400;
  nextBoostAt = 500;
  nextObsAt   = 700;
  nextScoreAt = 400;
  nextWaterAt = 900;
}

function maybeSpawnEntities() {
  const m = MODES[currentMode];
  const ahead = state.worldX + canvas.width;

  if (!activePowerups.has('no_zones') && ahead > nextZoneAt) {
    const pool  = m.zoneBase;
    const base  = pool[Math.floor(Math.random()*pool.length)];
    const limit = activePowerups.has('slow_zones') ? Math.round(base * 1.6) : base;
    state.zones.push({ wx: nextZoneAt, len: 380 + Math.random()*500, limit });
    nextZoneAt += m.zoneInterval * (0.8 + Math.random()*0.4);
  }

  if (ahead > nextBoostAt) {
    state.boosts.push({ wx: nextBoostAt + canvas.width*0.8, collected:false, pulse:0 });
    nextBoostAt += 600 + Math.random()*350;
  }

  if (!activePowerups.has('no_obstacles') && ahead > nextObsAt) {
    const type = Math.random() < 0.5 ? 'rock' : 'log';
    state.obstacles.push({ wx: nextObsAt + canvas.width*0.9, type, hit:false });
    nextObsAt += m.obsInterval * (0.8 + Math.random()*0.4);
  }

  if (ahead > nextScoreAt) {
    const val = 20 + Math.floor(Math.random()*9)*10;
    const magnetRange = activePowerups.has('magnet') ? 120 : 36;
    state.scorePickups.push({ wx: nextScoreAt + canvas.width*0.6, value:val, collected:false, pulse:0, range:magnetRange });
    nextScoreAt += 280 + Math.random()*280;
  }

  maybeSpawnWater();

  // cull
  const left = state.worldX - 200;
  state.zones       = state.zones.filter(z => z.wx+z.len > left);
  state.boosts      = state.boosts.filter(b => !b.collected && b.wx > left);
  state.obstacles   = state.obstacles.filter(o => !o.hit && o.wx > left);
  state.scorePickups= state.scorePickups.filter(s => !s.collected && s.wx > left);
  state.waterSegs   = state.waterSegs.filter(w => w.wx+w.len > left);
}

// ── Speedo ────────────────────────────────────────
const speedoCanvas = document.getElementById('speedo-canvas');
const sCtx = speedoCanvas.getContext('2d');
let smoothSpd = 0;

function drawSpeedo(spd, limit) {
  smoothSpd += (spd - smoothSpd) * 0.15;
  const W=speedoCanvas.width, H=speedoCanvas.height, cx=W/2, cy=H/2+6, r=42;
  sCtx.clearRect(0,0,W,H);

  sCtx.beginPath(); sCtx.arc(cx,cy,r,Math.PI*0.75,Math.PI*2.25);
  sCtx.strokeStyle='#ebebeb'; sCtx.lineWidth=7; sCtx.stroke();

  const frac  = Math.min(smoothSpd/200,1);
  const startA= Math.PI*0.75;
  const overL = limit && smoothSpd > limit;
  const col   = overL ? '#e63946' : (smoothSpd>130?'#f4a261':'#2ec4b6');

  sCtx.beginPath(); sCtx.arc(cx,cy,r,startA,startA+frac*Math.PI*1.5);
  sCtx.strokeStyle=col; sCtx.lineWidth=7; sCtx.lineCap='round'; sCtx.stroke();

  const na = startA+frac*Math.PI*1.5;
  sCtx.beginPath(); sCtx.moveTo(cx,cy);
  sCtx.lineTo(cx+Math.cos(na)*(r-12), cy+Math.sin(na)*(r-12));
  sCtx.strokeStyle='#111'; sCtx.lineWidth=1.5; sCtx.lineCap='round'; sCtx.stroke();

  sCtx.beginPath(); sCtx.arc(cx,cy,3.5,0,Math.PI*2);
  sCtx.fillStyle='#111'; sCtx.fill();
}

// ── Float labels ──────────────────────────────────
function spawnLabel(sx, sy, text) {
  state.floatLabels.push({ x:sx, y:sy, text, life:1, decay:0.022, vy:-1.1 });
}

// ── Explosion particles ───────────────────────────
function spawnExplosion(sx, sy) {
  const cols = ['#e63946','#f4a261','#ffd166','#111','#fff'];
  for (let i=0;i<72;i++) {
    const a = Math.random()*Math.PI*2, sp = 1.5+Math.random()*9;
    state.particles.push({
      x:sx,y:sy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-4.5,
      life:1,decay:0.017+Math.random()*0.026,r:2+Math.random()*8,
      color:cols[Math.floor(Math.random()*cols.length)]
    });
  }
}

// ── Draw car ──────────────────────────────────────
function drawCar(sx, sy, angle) {
  ctx.save();
  ctx.translate(sx,sy); ctx.rotate(angle);

  // shadow
  ctx.save(); ctx.translate(2,13); ctx.scale(1,0.22);
  ctx.beginPath(); ctx.ellipse(0,0,34,14,0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.09)'; ctx.fill(); ctx.restore();

  // ghost shimmer
  if (activePowerups.has('ghost')) {
    ctx.globalAlpha = 0.5 + Math.abs(Math.sin(Date.now()/250))*0.2;
  }

  ctx.fillStyle='#111';
  ctx.beginPath(); ctx.roundRect(-36,-12,72,16,5); ctx.fill();

  ctx.fillStyle='#2a2a2a';
  ctx.beginPath(); ctx.roundRect(-16,-26,38,16,[7,7,0,0]); ctx.fill();

  ctx.fillStyle='rgba(140,200,255,0.35)';
  ctx.beginPath(); ctx.roundRect(-13,-24,32,13,[5,5,0,0]); ctx.fill();

  ctx.globalAlpha=1;

  const dw = (wx,wy) => {
    ctx.beginPath(); ctx.arc(wx,wy,10,0,Math.PI*2);
    ctx.fillStyle='#1a1a1a'; ctx.fill();
    ctx.beginPath(); ctx.arc(wx,wy,5.5,0,Math.PI*2);
    ctx.fillStyle='#e0e0e0'; ctx.fill();
    ctx.beginPath(); ctx.arc(wx,wy,2,0,Math.PI*2);
    ctx.fillStyle='#111'; ctx.fill();
  };
  dw(-22,6); dw(22,6);

  // nitro charges indicator
  if (state.nitroCharges > 0) {
    for (let i=0; i<state.nitroCharges; i++) {
      ctx.beginPath(); ctx.arc(-30+i*10, -32, 4, 0, Math.PI*2);
      ctx.fillStyle='#f4a261'; ctx.fill();
    }
  }

  if (state.boostActive) {
    const t=Date.now()/80;
    for (let i=0;i<4;i++) {
      ctx.beginPath();
      ctx.arc(-38-i*9+Math.sin(t+i)*2, Math.sin(t*1.3+i)*4,
              Math.max(0.5,4-i*0.8),0,Math.PI*2);
      ctx.fillStyle=`rgba(80,200,255,${0.65-i*0.15})`; ctx.fill();
    }
  }
  // frenzy
  if (state.frenzyTimer>0) {
    ctx.globalAlpha=0.2+Math.abs(Math.sin(Date.now()/150))*0.15;
    ctx.fillStyle='#e63946';
    ctx.beginPath(); ctx.roundRect(-36,-26,72,45,5); ctx.fill();
    ctx.globalAlpha=1;
  }
  ctx.restore();
}

// ── Draw terrain ──────────────────────────────────
function drawTerrain() {
  if (state.terrain.length<2) return;
  const pts=state.terrain;

  ctx.beginPath();
  ctx.moveTo(worldToScreenX(pts[0].x),pts[0].y);
  for (let i=1;i<pts.length;i++) ctx.lineTo(worldToScreenX(pts[i].x),pts[i].y);
  ctx.lineTo(worldToScreenX(pts[pts.length-1].x),canvas.height+10);
  ctx.lineTo(worldToScreenX(pts[0].x),canvas.height+10);
  ctx.closePath();

  const grd=ctx.createLinearGradient(0,canvas.height*0.55,0,canvas.height);
  grd.addColorStop(0,'#eaeaea'); grd.addColorStop(0.4,'#d8d8d8'); grd.addColorStop(1,'#c5c5c5');
  ctx.fillStyle=grd; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(worldToScreenX(pts[0].x),pts[0].y);
  for (let i=1;i<pts.length;i++) ctx.lineTo(worldToScreenX(pts[i].x),pts[i].y);
  ctx.strokeStyle='#111'; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.stroke();

  // dashed center
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(worldToScreenX(pts[0].x),pts[0].y+10);
  for (let i=1;i<pts.length;i++) ctx.lineTo(worldToScreenX(pts[i].x),pts[i].y+10);
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2; ctx.setLineDash([20,20]); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();
}

// ── Draw water ────────────────────────────────────
function drawWater(ts) {
  state.waterSegs.forEach(w => {
    const sx = worldToScreenX(w.wx);
    const ex = worldToScreenX(w.wx + w.len);
    if (ex < 0 || sx > canvas.width) return;

    const topY = groundYAtWorldX(w.wx + w.len/2) + 4; // water surface ≈ ground level

    // water body fill
    ctx.save();
    const waterGrd = ctx.createLinearGradient(0, topY, 0, canvas.height);
    waterGrd.addColorStop(0,'rgba(74,158,221,0.85)');
    waterGrd.addColorStop(0.5,'rgba(40,120,190,0.75)');
    waterGrd.addColorStop(1,'rgba(20,80,150,0.6)');
    ctx.fillStyle = waterGrd;
    ctx.fillRect(sx, topY, ex-sx, canvas.height - topY);

    // wave shimmer
    const t = (ts||0)/800;
    ctx.beginPath();
    ctx.moveTo(sx, topY);
    for (let x=sx; x<=ex; x+=8) {
      const worldX2 = x + state.worldX;
      ctx.lineTo(x, topY - 3 + Math.sin(worldX2/30 + t)*3 + Math.sin(worldX2/15 + t*1.7)*1.5);
    }
    ctx.lineTo(ex, topY);
    ctx.closePath();
    ctx.fillStyle='rgba(140,210,255,0.45)';
    ctx.fill();

    // top edge line
    ctx.beginPath();
    ctx.moveTo(sx, topY);
    for (let x=sx; x<=ex; x+=8) {
      const worldX2 = x + state.worldX;
      ctx.lineTo(x, topY - 3 + Math.sin(worldX2/30 + t)*3 + Math.sin(worldX2/15 + t*1.7)*1.5);
    }
    ctx.strokeStyle='rgba(100,180,240,0.9)'; ctx.lineWidth=2.5; ctx.stroke();

    // depth dots
    ctx.restore();
  });
}

// ── Draw background ───────────────────────────────
function drawBackground() {
  const sky = ctx.createLinearGradient(0,0,0,canvas.height*BASE_Y_RATIO);
  sky.addColorStop(0,'#f6f6f6'); sky.addColorStop(1,'#eeeeee');
  ctx.fillStyle=sky; ctx.fillRect(0,0,canvas.width,canvas.height);

  // distant hills
  ctx.save(); ctx.globalAlpha=0.08; ctx.fillStyle='#888';
  ctx.beginPath(); ctx.moveTo(0,canvas.height*BASE_Y_RATIO);
  for (let x=0;x<=canvas.width;x+=16) {
    const wx=x+state.worldX*0.26;
    ctx.lineTo(x, canvas.height*BASE_Y_RATIO - 55 - Math.sin(wx/280)*38 - Math.sin(wx/110)*16);
  }
  ctx.lineTo(canvas.width,canvas.height*BASE_Y_RATIO); ctx.closePath(); ctx.fill(); ctx.restore();

  drawClouds();
}

const cloudDefs=[
  {ox:150,oy:68,w:110,sp:0.12},{ox:480,oy:54,w:85,sp:0.08},
  {ox:790,oy:86,w:140,sp:0.16},{ox:1060,oy:63,w:95,sp:0.11},
  {ox:1310,oy:76,w:120,sp:0.14},{ox:1600,oy:58,w:100,sp:0.10},
];
function drawClouds() {
  cloudDefs.forEach(c=>{
    const raw=c.ox-state.worldX*c.sp;
    const sx=((raw%(canvas.width+360))+canvas.width+360)%(canvas.width+360)-180;
    const h=c.w*0.35;
    ctx.fillStyle='rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.ellipse(sx,c.oy,c.w*0.48,h*0.58,0,0,Math.PI*2);
    ctx.ellipse(sx-c.w*0.28,c.oy+h*0.12,c.w*0.28,h*0.48,0,0,Math.PI*2);
    ctx.ellipse(sx+c.w*0.26,c.oy+h*0.12,c.w*0.26,h*0.44,0,0,Math.PI*2);
    ctx.fill();
  });
}

// ── Draw zones ────────────────────────────────────
function drawZones() {
  state.zones.forEach(z=>{
    const sx=worldToScreenX(z.wx), ex=worldToScreenX(z.wx+z.len);
    if (ex<0||sx>canvas.width) return;

    ctx.save(); ctx.globalAlpha=0.05; ctx.fillStyle='#e63946';
    ctx.fillRect(sx,0,ex-sx,canvas.height); ctx.restore();

    if (sx>-20&&sx<canvas.width+20) drawSpeedSign(sx, groundYAtWorldX(z.wx)-64, z.limit);
    if (ex>-20&&ex<canvas.width+20) drawEndSign(ex, groundYAtWorldX(z.wx+z.len)-58);

    ctx.save(); ctx.fillStyle='rgba(230,57,70,0.2)';
    for (let x=Math.max(sx,0);x<Math.min(ex,canvas.width);x+=60)
      ctx.fillRect(x, groundYAtWorldX(x+state.worldX)+5, 28, 4);
    ctx.restore();
  });
}

function drawSpeedSign(sx,sy,limit){
  ctx.save();
  ctx.fillStyle='#777'; ctx.fillRect(sx-1.5,sy+30,3,32);
  ctx.beginPath(); ctx.arc(sx,sy+20,20,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
  ctx.strokeStyle='#e63946'; ctx.lineWidth=3.5; ctx.stroke();
  ctx.fillStyle='#111'; ctx.font='600 13px DM Sans,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(limit,sx,sy+20); ctx.restore();
}

function drawEndSign(ex,ey){
  ctx.save();
  ctx.fillStyle='#777'; ctx.fillRect(ex-1.5,ey+30,3,26);
  ctx.beginPath(); ctx.arc(ex,ey+20,16,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill(); ctx.strokeStyle='#333'; ctx.lineWidth=2.5; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ex-9,ey+30); ctx.lineTo(ex+9,ey+10);
  ctx.strokeStyle='#e63946'; ctx.lineWidth=2.5; ctx.stroke(); ctx.restore();
}

// ── Draw boosts (road) ───────────────────────────
function drawRoadBoosts() {
  state.boosts.forEach(b=>{
    if (b.collected) return;
    const sx=worldToScreenX(b.wx);
    if (sx<-60||sx>canvas.width+60) return;
    const gy=groundYAtWorldX(b.wx)-32;
    b.pulse=(b.pulse||0)+0.06;

    const g=ctx.createRadialGradient(sx,gy,2,sx,gy,20);
    g.addColorStop(0,'rgba(46,196,182,0.45)'); g.addColorStop(1,'rgba(46,196,182,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,gy,20,0,Math.PI*2); ctx.fill();

    const bob=Math.sin(b.pulse)*3;
    ctx.save(); ctx.translate(sx,gy+bob);
    ctx.fillStyle='#2ec4b6'; ctx.strokeStyle='#fff'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(4,-13);ctx.lineTo(-4,-1);ctx.lineTo(2,-1);
    ctx.lineTo(-4,13);ctx.lineTo(4,1);ctx.lineTo(-2,1);
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  });
}

// ── Draw score coins ─────────────────────────────
function drawScorePickups() {
  state.scorePickups.forEach(s=>{
    if (s.collected) return;
    const sx=worldToScreenX(s.wx);
    if (sx<-60||sx>canvas.width+60) return;
    const gy=groundYAtWorldX(s.wx)-38;
    s.pulse=(s.pulse||0)+0.07;
    const bob=Math.sin(s.pulse)*4;

    ctx.save(); ctx.translate(sx,gy+bob);
    ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2);
    ctx.fillStyle='#f9c74f'; ctx.fill();
    ctx.strokeStyle='#e8b32a'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#7a5c00'; ctx.font='600 9px DM Mono,monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('+'+s.value,0,0); ctx.restore();
  });
}

// ── Draw obstacles ────────────────────────────────
function drawObstacles() {
  state.obstacles.forEach(o=>{
    if (o.hit) return;
    const sx=worldToScreenX(o.wx);
    if (sx<-60||sx>canvas.width+60) return;
    const gy=groundYAtWorldX(o.wx);

    if (o.type==='rock') {
      ctx.save(); ctx.translate(sx,gy-4);
      ctx.fillStyle='#909090'; ctx.beginPath(); ctx.ellipse(0,0,21,14,-0.1,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#b4b4b4'; ctx.beginPath(); ctx.ellipse(-5,-5,9,6,0.3,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#606060'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.ellipse(0,0,21,14,-0.1,0,Math.PI*2); ctx.stroke();
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(sx,gy-8);
      ctx.fillStyle='#9B6B42'; ctx.beginPath(); ctx.roundRect(-26,-7,52,14,4); ctx.fill();
      ctx.strokeStyle='#6b3f1e'; ctx.lineWidth=1.5; ctx.stroke();
      for (let i=-18;i<=18;i+=9){
        ctx.beginPath(); ctx.ellipse(i,0,3.5,6.5,0,0,Math.PI*2);
        ctx.strokeStyle='rgba(80,40,10,0.4)'; ctx.lineWidth=1; ctx.stroke();
      }
      ctx.restore();
    }
  });
}

// ── Draw float labels & particles ────────────────
function drawFloatLabels() {
  state.floatLabels.forEach(f=>{
    ctx.save();
    ctx.globalAlpha = f.life;
    ctx.fillStyle = '#f9c74f';
    ctx.font = '600 13px DM Mono,monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  });
}

function drawParticles() {
  state.particles.forEach(p=>{
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*p.life,0,Math.PI*2);
    ctx.fillStyle=p.color; ctx.globalAlpha=p.life; ctx.fill();
    ctx.globalAlpha=1;
  });
}

// ── Active zone check ─────────────────────────────
function getActiveZone() {
  const carWX = state.worldX + state.carX;
  for (const z of state.zones) if (carWX>=z.wx && carWX<=z.wx+z.len) return z;
  return null;
}

// ── HUD update ────────────────────────────────────
function updateHUD() {
  const spd  = Math.round(state.speed);
  const zone = getActiveZone();
  document.getElementById('speed-digits').textContent = spd;
  document.getElementById('score').textContent = Math.floor(state.score);
  document.getElementById('total-score').textContent = Math.floor(store.lifetime + state.score);

  const lc = document.getElementById('limit-chip');
  if (zone && !state.zoneImmune) {
    lc.classList.remove('hidden');
    document.getElementById('limit-val').textContent = zone.limit;
  } else {
    lc.classList.add('hidden');
  }
  drawSpeedo(spd, zone && !state.zoneImmune ? zone.limit : null);
}

// ── Powerup badge bar ─────────────────────────────
function drawActivePowerupBadges() {
  const bar = document.getElementById('active-powerups');
  const ids = [...activePowerups];
  if (!ids.length) { bar.innerHTML=''; return; }
  bar.innerHTML = ids.map(id=>{
    const d = POWERUP_DEFS.find(p=>p.id===id);
    return `<div class="ap-badge">${d.icon} ${d.name}</div>`;
  }).join('');
}

// ── Toast ─────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.remove('show'), 2200);
}

// ── Boost menu ────────────────────────────────────
function boostCost(def) {
  const count = store.boostCounts[def.id] || 0;
  return Math.round(def.baseCost * Math.pow(1.6, count));
}

function toggleBoostMenu() {
  if (!gameRunning || state.dead) return;
  boostMenuOpen = !boostMenuOpen;
  const menu = document.getElementById('boost-menu');
  if (boostMenuOpen) {
    buildBoostMenu();
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}

function buildBoostMenu() {
  const grid = document.getElementById('boost-menu-grid');
  grid.innerHTML = '';
  BOOST_DEFS.forEach(def => {
    const cost = boostCost(def);
    const canAfford = store.lifetime >= cost;
    const card = document.createElement('div');
    card.className = 'shop-card boost-card' + (!canAfford ? ' disabled' : '');
    card.innerHTML = `
      <div class="shop-card-icon">${def.icon}</div>
      <div class="shop-card-name">${def.name}</div>
      <div class="shop-card-desc">${def.desc}</div>
      <div class="shop-card-cost">${cost} pts${!canAfford?'':' <span class="cost-rising">↑each use</span>'}</div>
    `;
    if (canAfford) {
      card.addEventListener('click', () => {
        store.lifetime -= cost;
        store.boostCounts[def.id] = (store.boostCounts[def.id]||0)+1;
        saveStore(store);
        def.apply(state);
        spawnLabel(state.carX, state.carY - 40, def.icon + ' ' + def.name + '!');
        showToast(`${def.icon} ${def.name} activated!`);
        // close menu
        boostMenuOpen = false;
        document.getElementById('boost-menu').classList.add('hidden');
        // refresh total display
        document.getElementById('total-score').textContent = Math.floor(store.lifetime + state.score);
      });
    }
    grid.appendChild(card);
  });
}

// ── Physics ───────────────────────────────────────
const ACCEL=110, BRAKE_S=165, BRAKE_H=280, FRICTION=36, BOOST_MULT=2.1, BOOST_DUR=4, GRAVITY=1100;
let lastTime=null;

function update(ts) {
  if (!gameRunning) return;
  if (lastTime===null) lastTime=ts;
  const dt=Math.min((ts-lastTime)/1000,0.05);
  lastTime=ts;

  // update float labels
  state.floatLabels.forEach(f=>{
    f.y += f.vy;
    f.life -= f.decay;
  });
  state.floatLabels = state.floatLabels.filter(f=>f.life>0);

  if (state.dead) {
    state.particles.forEach(p=>{
      p.x+=p.vx*2; p.y+=p.vy*2; p.vy+=0.18; p.life-=p.decay;
    });
    state.particles=state.particles.filter(p=>p.life>0);
    return;
  }

  // timers
  if (state.zoneImmune) { state.zoneImmuneTimer-=dt; if (state.zoneImmuneTimer<=0) state.zoneImmune=false; }
  if (state.frenzyTimer>0) state.frenzyTimer-=dt;

  // input
  let accel=0;
  if (KEYS['ArrowRight']) accel=1;
  if (KEYS['ArrowLeft'])  accel=-0.45;
  if (KEYS['ArrowDown'])  accel=-1;

  // nitro on key press if charges available
  if (KEYS['ArrowUp'] && state.nitroCharges>0 && !state.boostActive) {
    state.nitroCharges--;
    state.boostActive=true;
    state.boostTimer=BOOST_DUR;
    spawnLabel(state.carX, state.carY-40, '⚡ nitro!');
  }

  const bf=state.boostActive?BOOST_MULT:1;
  if (accel>0)      state.speed+=ACCEL*bf*dt;
  else if (accel<0) state.speed-=(KEYS['ArrowDown']?BRAKE_H:BRAKE_S)*dt;
  else              state.speed-=FRICTION*dt;

  if (KEYS['ArrowUp']&&state.boostActive) state.speed+=ACCEL*0.6*dt;

  // water drag
  if (state.inWater && !activePowerups.has('water_walk') && !activePowerups.has('no_obstacles')) {
    state.speed-=80*dt; // heavy drag
  }

  state.speed=Math.max(0,Math.min(state.maxSpeed,state.speed));
  if (state.boostActive){state.boostTimer-=dt;if(state.boostTimer<=0)state.boostActive=false;}

  const pps=state.speed*(canvas.width/380);
  state.worldX+=pps*dt;
  state.distance=state.worldX/10;

  const m=MODES[currentMode];
  const sm=(activePowerups.has('triple_score')?3:1)*(activePowerups.has('double_score')?2:1)*
           (state.frenzyTimer>0?3:1)*m.scoreMult;
  state.score+=state.speed*dt*0.1*sm;

  extendTerrain();
  maybeSpawnEntities();

  // car Y
  const carWX=state.worldX+state.carX;
  const groundY=groundYAtWorldX(carWX)-17;
  if (state.carY<groundY){
    state.carVY+=GRAVITY*dt; state.carY+=state.carVY*dt; state.onGround=false;
  } else {
    state.carY=groundY; state.carVY=0; state.onGround=true;
  }
  state.carAngle=groundAngleAtWorldX(carWX);

  // water check
  state.inWater = isInWaterAt(carWX);
  if (state.inWater && !activePowerups.has('water_walk') && !activePowerups.has('no_obstacles')) {
    if (state.speed < 10) { die('sank in the water'); return; }
  }

  // obstacles
  for (const o of state.obstacles) {
    if (o.hit) continue;
    if (Math.abs(carWX-o.wx)<38 && state.onGround) {
      if (activePowerups.has('ghost')) { o.hit=true; continue; }
      if (state.speed>m.obsSpeed){ die('crashed into an obstacle'); return; }
      else { o.hit=true; state.speed=0; }
    }
  }

  // road boosts (speed boosts on road)
  for (const b of state.boosts) {
    if (b.collected) continue;
    if (Math.abs(carWX-b.wx)<40) {
      b.collected=true; state.boostActive=true; state.boostTimer=BOOST_DUR;
      spawnLabel(state.carX, state.carY-38, '⚡ boost!');
    }
  }

  // score coins
  for (const s of state.scorePickups) {
    if (s.collected) continue;
    const dist = activePowerups.has('magnet') ? s.range : 36;
    if (Math.abs(carWX-s.wx)<dist) {
      s.collected=true;
      const gain=Math.round(s.value*sm);
      state.score+=gain;
      spawnLabel(state.carX, state.carY-40, `+${gain}`);
    }
  }

  // zone enforcement
  const zone=getActiveZone();
  if (zone && !state.zoneImmune && state.speed>zone.limit*1.06) {
    die(`speed limit ${zone.limit} mph exceeded`);
  }
}

function die(reason) {
  state.dead=true; state.deathReason=reason;
  spawnExplosion(state.carX,state.carY);

  let saved=state.score;
  if (activePowerups.has('score_saver')) saved=state.score*0.6;
  store.lifetime=Math.floor((store.lifetime||0)+saved);
  saveStore(store);
  refreshLifetimeDisplay();

  setTimeout(showDeathScreen, 750);
}

function showDeathScreen() {
  document.getElementById('death-reason').textContent=state.deathReason;
  document.getElementById('final-score').textContent=Math.floor(state.score);
  document.getElementById('lifetime-total').textContent=store.lifetime;
  buildShop('shop-grid');
  document.getElementById('death-screen').classList.remove('hidden');
}

// ── Shop ──────────────────────────────────────────
function powerupCost(def) {
  // power-ups don't escalate (only boosts do), price is fixed baseCost
  return def.baseCost;
}

function buildShop(gridId) {
  const grid = document.getElementById(gridId);
  grid.innerHTML='';
  POWERUP_DEFS.forEach(def=>{
    const inQueue=store.ownedPowerups.includes(def.id);
    const cost=powerupCost(def);
    const canAfford=store.lifetime>=cost;
    const card=document.createElement('div');
    card.className='shop-card'+(inQueue?' owned':'')+(!canAfford&&!inQueue?' disabled':'');
    card.innerHTML=`
      <div class="shop-card-icon">${def.icon}</div>
      <div class="shop-card-name">${def.name}</div>
      <div class="shop-card-desc">${def.desc}</div>
      <div class="shop-card-cost">${inQueue?'✓ queued':`${cost} pts`}</div>
    `;
    if (!inQueue&&canAfford) {
      card.addEventListener('click',()=>{
        store.lifetime-=cost;
        store.ownedPowerups.push(def.id);
        saveStore(store);
        refreshLifetimeDisplay();
        // update both grids if visible
        const lt=document.getElementById('lifetime-total');
        if (lt) lt.textContent=store.lifetime;
        const sl=document.getElementById('shop-lifetime');
        if (sl) sl.textContent=store.lifetime;
        buildShop(gridId);
        showToast(`${def.icon} ${def.name} queued!`);
      });
    }
    grid.appendChild(card);
  });
}

function refreshLifetimeDisplay() {
  const el=document.getElementById('lifetime-display');
  if (el) el.textContent=store.lifetime;
}

// ── Draw main ─────────────────────────────────────
let drawTs=0;
function draw(ts) {
  drawTs=ts||drawTs;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawBackground();
  drawZones();
  drawWater(ts);
  drawTerrain();
  drawRoadBoosts();
  drawScorePickups();
  drawObstacles();
  if (!state.dead) drawCar(state.carX,state.carY,state.carAngle);
  drawFloatLabels();
  drawParticles();
}

// ── Main loop ─────────────────────────────────────
function loop(ts) {
  update(ts);
  draw(ts);
  updateHUD();
  drawActivePowerupBadges();
  requestAnimationFrame(loop);
}

// ── Start game ────────────────────────────────────
function startGame() {
  currentMode=selectedMode;
  state=initState();
  resetSpawnCounters();
  lastTime=null;
  boostMenuOpen=false;
  document.getElementById('boost-menu').classList.add('hidden');

  activePowerups=new Set(store.ownedPowerups);
  store.ownedPowerups=[];
  saveStore(store);

  buildTerrain();
  state.carY=groundYAtWorldX(state.carX)-17;

  if (activePowerups.has('turbo_start')) {
    state.boostActive=true; state.boostTimer=BOOST_DUR; state.speed=80;
  }
  if (activePowerups.has('nitro_reserve')) {
    state.nitroCharges=3;
  }

  document.getElementById('mode-badge').textContent=MODES[currentMode].label;
  gameRunning=true;
  refreshLifetimeDisplay();
  drawActivePowerupBadges();
}

// ── Mode selection ────────────────────────────────
let selectedMode='easy';
document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode=btn.dataset.mode;
    // rebuild idle terrain for preview
    currentMode=selectedMode;
    state.terrainSeed=Math.random()*10000;
    buildTerrain();
    state.carY=groundYAtWorldX(state.carX)-17;
  });
});

// ── Button wiring ─────────────────────────────────
document.getElementById('start-btn').addEventListener('click',()=>{
  const w=document.getElementById('welcome-screen');
  w.classList.add('fade-out');
  setTimeout(()=>{ w.style.display='none'; startGame(); },360);
  if (!loopStarted){ loopStarted=true; requestAnimationFrame(loop); }
});

document.getElementById('restart-btn').addEventListener('click',()=>{
  document.getElementById('death-screen').classList.add('hidden');
  startGame();
});

document.getElementById('change-mode-btn').addEventListener('click',()=>{
  document.getElementById('death-screen').classList.add('hidden');
  gameRunning=false;
  const w=document.getElementById('welcome-screen');
  w.style.display='';
  w.classList.remove('fade-out');
  refreshLifetimeDisplay();
});

document.getElementById('reset-btn').addEventListener('click',()=>{
  if (confirm('reset lifetime score, all power-ups, and boost prices?')) {
    store={lifetime:0,ownedPowerups:[],boostCounts:{}};
    saveStore(store);
    refreshLifetimeDisplay();
    const lt=document.getElementById('lifetime-total');
    if (lt) lt.textContent=0;
    buildShop('shop-grid');
  }
});

document.getElementById('open-shop-welcome').addEventListener('click',()=>{
  document.getElementById('shop-lifetime').textContent=store.lifetime;
  buildShop('shop-grid-welcome');
  document.getElementById('shop-screen').classList.remove('hidden');
});

document.getElementById('close-shop-btn').addEventListener('click',()=>{
  document.getElementById('shop-screen').classList.add('hidden');
  refreshLifetimeDisplay();
});

// ── Idle preview ──────────────────────────────────
state=initState();
buildTerrain();
state.carY=groundYAtWorldX(state.carX)-17;
refreshLifetimeDisplay();

(function idleLoop(ts) {
  if (loopStarted) return;
  draw(ts);
  requestAnimationFrame(idleLoop);
})();
