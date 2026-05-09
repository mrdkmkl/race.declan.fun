// ═══════════════════════════════════════════════════
//  hill rider — game.js
// ═══════════════════════════════════════════════════
'use strict';

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', () => { resize(); if (!gameRunning) buildTerrain(); });
resize();

// ══════════════════════════════════════════════════
//  PERSISTENT STORE
// ══════════════════════════════════════════════════
const STORE_KEY = 'hillrider_v5';
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
function saveStore(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch(e){ console.warn('save failed',e); } }

let store = loadStore();
store.lifetime      = Number(store.lifetime)   || 0;
store.ownedPowerups = store.ownedPowerups       || [];
store.powerupCounts = store.powerupCounts       || {};
store.boostCounts   = store.boostCounts         || {};
store.soundEnabled  = store.soundEnabled  !== false;  // default true
store.musicEnabled  = store.musicEnabled  !== false;  // default true
store.diffModifier  = store.diffModifier  || 'normal'; // 'easy' | 'normal' | 'hard'
saveStore(store);

// ══════════════════════════════════════════════════
//  AUDIO SYSTEM (Web Audio API)
// ══════════════════════════════════════════════════
let audioCtx = null;
let engineOsc = null, engineGain = null;
let musicInterval = null;
const MUSIC_NOTES = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 261.63, 293.66];

function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e) { console.warn('Web Audio not available', e); }
}

function startEngine() {
  if (!audioCtx || !store.soundEnabled || engineOsc) return;
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;
  engineGain.connect(audioCtx.destination);
  const distortion = audioCtx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = (i * 2) / 256 - 1; curve[i] = x * 0.4; }
  distortion.curve = curve;
  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 80;
  engineOsc.connect(distortion);
  distortion.connect(engineGain);
  engineOsc.start();
}

function stopEngine() {
  try { if (engineOsc) { engineOsc.stop(); engineOsc = null; } } catch(e) {}
  try { if (engineGain) { engineGain.disconnect(); engineGain = null; } } catch(e) {}
}

function updateEngineSound(speed) {
  if (!audioCtx || !store.soundEnabled) { stopEngine(); return; }
  if (!engineOsc) startEngine();
  if (!engineOsc) return;
  const targetVol = Math.min(speed / 500 * 0.07 + 0.005, 0.08);
  const targetFreq = 70 + speed * 1.1 + (state.boostActive ? 120 : 0);
  engineGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.06);
  engineOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.04);
}

function playSound(type) {
  if (!audioCtx || !store.soundEnabled) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  if (type === 'boost') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.22);
    gain.gain.setValueAtTime(0.10, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.start(now); osc.stop(now + 0.32);
  } else if (type === 'coin') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.09);
    gain.gain.setValueAtTime(0.09, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.start(now); osc.stop(now + 0.13);
  } else if (type === 'crash') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.55);
    gain.gain.setValueAtTime(0.18, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc.start(now); osc.stop(now + 0.65);
    // add noise layer
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.14, now); ng.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    src.connect(ng); ng.connect(audioCtx.destination);
    src.start(now);
  } else if (type === 'nitro') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(700, now + 0.28);
    gain.gain.setValueAtTime(0.09, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.start(now); osc.stop(now + 0.38);
  } else if (type === 'zone_enter') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now); osc.frequency.setValueAtTime(330, now + 0.08);
    gain.gain.setValueAtTime(0.07, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'overspeed') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  }
}

let _musicNoteIdx = 0;
function startMusic() {
  if (!audioCtx || !store.musicEnabled || musicInterval) return;
  function playNote() {
    if (!store.musicEnabled || !audioCtx) { stopMusic(); return; }
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now  = audioCtx.currentTime;
    const freq = MUSIC_NOTES[_musicNoteIdx % MUSIC_NOTES.length] * 0.5;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(now); osc.stop(now + 0.5);
    // bass note every 4 beats
    if (_musicNoteIdx % 4 === 0) {
      const b = audioCtx.createOscillator(), bg = audioCtx.createGain();
      b.type = 'sine'; b.frequency.value = freq * 0.5;
      bg.gain.setValueAtTime(0.04, now); bg.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      b.connect(bg); bg.connect(audioCtx.destination);
      b.start(now); b.stop(now + 0.85);
    }
    _musicNoteIdx++;
  }
  playNote();
  musicInterval = setInterval(playNote, 480);
}

function stopMusic() {
  if (musicInterval) { clearInterval(musicInterval); musicInterval = null; }
}

// ══════════════════════════════════════════════════
//  MODE CONFIG
// ══════════════════════════════════════════════════
const MODES = {
  easy:    { label:'easy',      hillAmp:[65,26,9],   zoneInterval:1800, zoneBase:[70,90,110], obsInterval:950,    waterFreq:0,    scoreMult:1.0,  noZones:false, noObs:false, noWater:false, noScore:false },
  medium:  { label:'medium',    hillAmp:[100,40,15],  zoneInterval:1200, zoneBase:[50,65,80],  obsInterval:600,    waterFreq:0.22, scoreMult:1.3,  noZones:false, noObs:false, noWater:false, noScore:false },
  hard:    { label:'hard',      hillAmp:[135,55,20],  zoneInterval:800,  zoneBase:[38,52,65],  obsInterval:400,    waterFreq:0.42, scoreMult:1.8,  noZones:false, noObs:false, noWater:false, noScore:false },
  water:   { label:'all water', hillAmp:[0,0,0],      zoneInterval:2500, zoneBase:[130,150,170,200], obsInterval:9999, waterFreq:0, scoreMult:1.5,  noZones:false, noObs:true,  noWater:true,  noScore:false },
  freerun: { label:'free run',  hillAmp:[18,5,2],     zoneInterval:9999, zoneBase:[],          obsInterval:9999,   waterFreq:0,    scoreMult:0.0,  noZones:true,  noObs:true,  noWater:true,  noScore:true  },
};
let currentMode = 'easy';

// ══════════════════════════════════════════════════
//  POWER-UP CATALOGUE
// ══════════════════════════════════════════════════
const POWERUP_DEFS = [
  { id:'no_zones',      name:'zone free',      desc:'no speed limit zones this run',              icon:'🚫', baseCost:6000 },
  { id:'no_obstacles',  name:'clear road',     desc:'no obstacles or water hazards this run',     icon:'🛤', baseCost:5000 },
  { id:'double_score',  name:'2× score',       desc:'all points doubled this run',                icon:'✕2', baseCost:1200 },
  { id:'triple_score',  name:'3× score',       desc:'all points tripled this run',                icon:'✕3', baseCost:3000 },
  { id:'slow_zones',    name:'lenient limits', desc:'speed limits +60% higher this run',          icon:'🛡', baseCost:900  },
  { id:'score_saver',   name:'score saver',    desc:'bank 100% of score on death (default: 60%)',      icon:'🪙', baseCost:1500 },
  { id:'turbo_start',   name:'turbo start',    desc:'begin at 80 mph with active boost',          icon:'⚡', baseCost:700  },
  { id:'nitro_reserve', name:'nitro reserve',  desc:'start with 3 nitro charges',                 icon:'🔋', baseCost:1000 },
  { id:'ghost',         name:'ghost mode',     desc:'pass through obstacles safely',              icon:'👻', baseCost:2000 },
  { id:'water_walk',    name:'water walk',     desc:'drive over water without sinking',           icon:'🌊', baseCost:1800 },
  { id:'magnet',        name:'coin magnet',    desc:'score coins pulled in from far away',        icon:'🧲', baseCost:800  },
  { id:'kamikaze',      name:'kamikaze',       desc:'explode on purpose: +1000 pts, skip ahead',  icon:'💣', baseCost:2500 },
  { id:'speed_floor',   name:'speed floor',   desc:'speed never drops below 40 mph this run',    icon:'⬇️', baseCost:1100 },
  { id:'shield',        name:'crash shield',  desc:'survive one fatal crash — keep going',        icon:'🛡️', baseCost:4000 },
  { id:'overclock',     name:'overclock',     desc:'max speed raised to 700 mph this run',       icon:'🔴', baseCost:3500 },
  { id:'slow_motion',   name:'bullet time',   desc:'difficulty scaling frozen for this run',     icon:'⏸️', baseCost:3500 },
  { id:'cruise_control', name:'cruise control', desc:'lock speed constant · 3 min active · 30s cooldown · press C', icon:'🚗', baseCost:2800 },
];

// ══════════════════════════════════════════════════
//  BOOST CATALOGUE
// ══════════════════════════════════════════════════
const BOOST_DEFS = [
  { id:'speed_burst', name:'speed burst',  desc:'+25 mph instantly',             icon:'💨', baseCost:100,
    apply: s => { s.speed = Math.min(s.speed + 25, s.maxSpeed); } },
  { id:'turbo_5s',    name:'5s turbo',     desc:'full turbo for 5 seconds',      icon:'🚀', baseCost:180,
    apply: s => { s.boostActive = true; s.boostTimer = Math.max(s.boostTimer, 5); } },
  { id:'slow_time',   name:'zone shield',  desc:'zone enforcement off for 8s',   icon:'⏱', baseCost:260,
    apply: s => { s.zoneImmune = true; s.zoneImmuneTimer = Math.max(s.zoneImmuneTimer, 8); } },
  { id:'repair',      name:'clear path',   desc:'remove nearby obstacles/water', icon:'🔧', baseCost:140,
    apply: s => {
      const carWX = s.worldX + s.carX;
      s.obstacles = s.obstacles.filter(o => Math.abs(o.wx - carWX) > 300);
      s.waterSegs = s.waterSegs.filter(w => !(carWX >= w.wx - 50 && carWX <= w.wx + w.len + 50));
    }
  },
  { id:'frenzy',      name:'score frenzy', desc:'3× score for 6 seconds',        icon:'🔥', baseCost:300,
    apply: s => { s.frenzyTimer = Math.max(s.frenzyTimer, 6); } },
];

// ══════════════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════════════
let activePowerups = new Set();
let gameRunning    = false;
let loopStarted    = false;
let boostMenuOpen  = false;
let selectedMode   = 'easy';
let state          = {};
let gameDt         = 0;       // set each frame, used by alert overlay
let dieTimeoutId   = null;    // clearable death delay

function initState() {
  return {
    speed: 0, maxSpeed: 500,
    distance: 0, score: 0, worldX: 0,
    boostActive: false, boostTimer: 0,
    zoneImmune: false, zoneImmuneTimer: 0,
    frenzyTimer: 0, nitroCharges: 0,
    overSpeedTimer: 0, overSpeedActive: false,
    dead: false, dying: false, deathReason: '',
    kamikazeUsed: false,
    terrainSeed: Math.random() * 10000,
    terrain: [], waterSegs: [],
    zones: [], roadBoosts: [], obstacles: [], scorePickups: [],
    floatLabels: [], particles: [],
    carX: 200, carY: 300, carAngle: 0, carVY: 0, onGround: true,
    inWater: false,
    depthM: 0, sinkVY: 0, surfaceScreenY: 0,
    lastMathDepthTrigger: 0, mathActive: false, mathPaused: false,
    mathQuestion: '', mathAnswer: 0, mathInput: '', mathWrong: 0, mathPenaltyPending: 0,
    oceanObstacles: [],
    cruiseActive: false, cruiseSpeed: 0, cruiseTimer: 0, cruiseCooldown: 0,
  };
}

// smooth display values (interpolated, never jumpy)
let _displayScore = 0;
let _displaySpd   = 0;

// ══════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════
const KEYS = {};
window.addEventListener('keydown', e => {
  KEYS[e.key] = true;
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
  if (e.key === 'Tab') { e.preventDefault(); toggleBoostMenu(); }
  if (e.key === 'Escape') exitToMenu();
});
window.addEventListener('keyup', e => { KEYS[e.key] = false; });

function exitToMenu() {
  if (!gameRunning && document.getElementById('welcome-screen').style.display !== 'none') return;
  document.getElementById('death-screen').classList.add('hidden');
  document.getElementById('boost-menu').classList.add('hidden');
  gameRunning = false;
  boostMenuOpen = false;
  clearTimeout(dieTimeoutId);
  hideSpeedWarning();
  alertOverlay.hideAll();
  dismissMathUI();
  stopEngine();
  stopMusic();
  const w = document.getElementById('welcome-screen');
  w.style.display = ''; w.classList.remove('fade-out');
  refreshAllLifetimeDisplays();
  updateModifierBanner();
}

// ══════════════════════════════════════════════════
//  TERRAIN
// ══════════════════════════════════════════════════
const TERRAIN_STEP = 36;
const BASE_Y_RATIO = 0.60;

function terrainYAt(worldPx) {
  if (currentMode === 'water') return canvas.height * 0.52;
  const a  = MODES[currentMode].hillAmp;
  const sd = state.terrainSeed || 0;
  return canvas.height * BASE_Y_RATIO
    + Math.sin(worldPx / 1300 * 2.0 + sd) * a[0]
    + Math.sin(worldPx / 420  * 3.5 + sd * 1.2) * a[1]
    + Math.sin(worldPx / 190  * 5.3 + sd * 0.8) * a[2];
}

function buildTerrain() {
  state.terrain = [];
  const count = Math.ceil(canvas.width / TERRAIN_STEP) + 10;
  for (let i = 0; i < count; i++) {
    const wx = (state.worldX || 0) - TERRAIN_STEP + i * TERRAIN_STEP;
    state.terrain.push({ x: wx, y: terrainYAt(wx) });
  }
}

function extendTerrain() {
  const right = state.worldX + canvas.width + TERRAIN_STEP * 6;
  while (!state.terrain.length || state.terrain[state.terrain.length - 1].x < right) {
    const last = state.terrain[state.terrain.length - 1];
    const wx = last ? last.x + TERRAIN_STEP : state.worldX;
    state.terrain.push({ x: wx, y: terrainYAt(wx) });
  }
  while (state.terrain.length > 2 && state.terrain[1].x < state.worldX - TERRAIN_STEP * 2)
    state.terrain.shift();
}

function groundYAtWorldX(wx) {
  for (let i = 0; i < state.terrain.length - 1; i++) {
    const a = state.terrain[i], b = state.terrain[i + 1];
    if (wx >= a.x && wx <= b.x)
      return a.y + (b.y - a.y) * ((wx - a.x) / (b.x - a.x));
  }
  return terrainYAt(wx);
}

function groundAngleAtWorldX(wx) {
  return Math.atan2(terrainYAt(wx + 6) - terrainYAt(wx - 6), 12);
}

function worldToScreenX(wx) { return wx - state.worldX; }

// ══════════════════════════════════════════════════
//  WATER SEGMENTS
// ══════════════════════════════════════════════════
let nextWaterAt = 0;

function maybeSpawnWater() {
  const m = MODES[currentMode];
  if (m.noWater || m.waterFreq === 0) return;
  const ahead = state.worldX + canvas.width;
  if (ahead < nextWaterAt) return;
  if (currentMode === 'water' || Math.random() < m.waterFreq) {
    const len = currentMode === 'water' ? canvas.width * 1.5 : 200 + Math.random() * 340;
    state.waterSegs.push({ wx: nextWaterAt, len });
  }
  nextWaterAt += currentMode === 'water'
    ? 60 + Math.random() * 80
    : 550 + Math.random() * 600;
}

function isInWaterAt(wx) {
  for (const w of state.waterSegs)
    if (wx >= w.wx && wx <= w.wx + w.len) return true;
  return false;
}

// ══════════════════════════════════════════════════
//  ENTITY SPAWNING
// ══════════════════════════════════════════════════
let nextZoneAt, nextBoostAt, nextObsAt, nextScoreAt;

function resetSpawnCounters() {
  nextZoneAt     = 1500;
  nextBoostAt    = 550;
  nextObsAt      = 800;
  nextScoreAt    = 420;
  nextWaterAt    = 950;
  nextOceanObsAt = 0;
}

function diffScale() {
  if (activePowerups.has('slow_motion') || currentMode === 'freerun') return 1.0;
  return Math.min(1.0 + (state.worldX / 20000) * 2.0, 3.0);
}

function maybeSpawnEntities() {
  const m    = MODES[currentMode];
  const ahead = state.worldX + canvas.width;
  const diff  = diffScale();

  // zones
  if (!m.noZones && !activePowerups.has('no_zones') && ahead > nextZoneAt) {
    const bases = m.zoneBase.map(b => Math.max(28, Math.round(b / (1 + (diff - 1) * 0.55))));
    const base  = bases[Math.floor(Math.random() * bases.length)];
    let limit = activePowerups.has('slow_zones') ? Math.round(base * 1.6) : base;
    // difficulty modifier tweaks
    if (store.diffModifier === 'easy') limit = Math.round(limit * 1.5);
    if (store.diffModifier === 'hard') limit = Math.round(limit * 0.5);
    const len   = Math.max(250, (400 + Math.random() * 500) * (1 + (diff - 1) * 0.4));
    state.zones.push({ wx: nextZoneAt, len, limit });
    nextZoneAt += (m.zoneInterval / diff) * (0.8 + Math.random() * 0.4);
  }

  // road boosts
  if (ahead > nextBoostAt) {
    state.roadBoosts.push({ wx: nextBoostAt + canvas.width * 0.8, collected: false, pulse: 0 });
    nextBoostAt += (620 + Math.random() * 380) / Math.sqrt(diff);
  }

  // obstacles
  const skipObs = m.noObs || activePowerups.has('no_obstacles') || store.diffModifier === 'easy';
  if (!skipObs && ahead > nextObsAt) {
    const type = Math.random() < 0.5 ? 'rock' : 'log';
    state.obstacles.push({ wx: nextObsAt + canvas.width * 0.9, type, hit: false });
    // hard modifier: 3× obstacles (spawn 2 extra)
    const extraObs = store.diffModifier === 'hard' ? 2 : 0;
    for (let ei = 0; ei < extraObs; ei++) {
      state.obstacles.push({ wx: nextObsAt + canvas.width * 0.9 + (ei + 1) * (140 + Math.random() * 80),
        type: Math.random() < 0.5 ? 'rock' : 'log', hit: false });
    }
    if (diff > 1.8 && Math.random() < 0.35) {
      state.obstacles.push({ wx: nextObsAt + canvas.width * 0.9 + 180 + Math.random() * 120,
        type: Math.random() < 0.5 ? 'rock' : 'log', hit: false });
    }
    // hard modifier: also tighten interval ÷3
    const obsIntervalMod = store.diffModifier === 'hard' ? 3 : 1;
    nextObsAt += (m.obsInterval / diff / obsIntervalMod) * (0.75 + Math.random() * 0.5);
  } else if (skipObs && ahead > nextObsAt) {
    nextObsAt += (m.obsInterval / diff) * (0.75 + Math.random() * 0.5); // keep advancing even when skipped
  }

  // coins
  if (ahead > nextScoreAt) {
    const vals = diff > 1.5 ? [50,60,80,80,100,120] : [20,30,40,50,60,80];
    const val  = vals[Math.floor(Math.random() * vals.length)];
    state.scorePickups.push({ wx: nextScoreAt + canvas.width * 0.65, value: val, collected: false, pulse: 0 });
    nextScoreAt += (280 + Math.random() * 260) / Math.sqrt(diff);
  }

  maybeSpawnWater();

  // cull old entities
  const left = state.worldX - 300;
  state.zones        = state.zones.filter(z => z.wx + z.len > left);
  state.roadBoosts   = state.roadBoosts.filter(b => !b.collected && b.wx > left);
  state.obstacles    = state.obstacles.filter(o => !o.hit && o.wx > left);
  state.scorePickups = state.scorePickups.filter(s => !s.collected && s.wx > left);
  state.waterSegs    = state.waterSegs.filter(w => w.wx + w.len > left);
}

// ══════════════════════════════════════════════════
//  SPEEDOMETER
// ══════════════════════════════════════════════════
const speedoCanvas = document.getElementById('speedo-canvas');
const sCtx = speedoCanvas.getContext('2d');
let _smoothSpd = 0;

function drawSpeedo(spd, limit) {
  _smoothSpd += (spd - _smoothSpd) * 0.12;
  const W = speedoCanvas.width, H = speedoCanvas.height, cx = W / 2, cy = H / 2 + 6, r = 42;
  sCtx.clearRect(0, 0, W, H);

  // background arc
  sCtx.beginPath(); sCtx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
  sCtx.strokeStyle = '#ebebeb'; sCtx.lineWidth = 7; sCtx.lineCap = 'round'; sCtx.stroke();

  // speed arc
  const frac   = Math.min(_smoothSpd / (state.maxSpeed || 500), 1);
  const startA = Math.PI * 0.75;
  const overL  = limit != null && _smoothSpd > limit;
  const col    = overL ? '#e63946' : (_smoothSpd > 200 ? '#f4a261' : '#2ec4b6');
  if (frac > 0.001) {
    sCtx.beginPath(); sCtx.arc(cx, cy, r, startA, startA + frac * Math.PI * 1.5);
    sCtx.strokeStyle = col; sCtx.lineWidth = 7; sCtx.lineCap = 'round'; sCtx.stroke();
  }

  // needle
  const na = startA + frac * Math.PI * 1.5;
  sCtx.beginPath(); sCtx.moveTo(cx, cy);
  sCtx.lineTo(cx + Math.cos(na) * (r - 10), cy + Math.sin(na) * (r - 10));
  sCtx.strokeStyle = '#111'; sCtx.lineWidth = 1.5; sCtx.lineCap = 'round'; sCtx.stroke();

  // center dot
  sCtx.beginPath(); sCtx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  sCtx.fillStyle = '#111'; sCtx.fill();
}

// ══════════════════════════════════════════════════
//  FLOAT LABELS
// ══════════════════════════════════════════════════
function spawnLabel(sx, sy, text, color) {
  // deduplicate same text at same position within 200ms
  state.floatLabels.push({ x: sx, y: sy, text, color: color || '#f9c74f', life: 1, decay: 0.018, vy: -0.95 });
}

// ══════════════════════════════════════════════════
//  PARTICLES
// ══════════════════════════════════════════════════
function spawnExplosion(sx, sy) {
  const cols = ['#e63946','#f4a261','#ffd166','#111','#fff','#ff8800'];
  for (let i = 0; i < 88; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 11;
    state.particles.push({
      x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 5,
      life: 1, decay: 0.012 + Math.random() * 0.022, r: 2 + Math.random() * 9,
      color: cols[Math.floor(Math.random() * cols.length)], type: 'dot'
    });
  }
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, sp = 8 + Math.random() * 18;
    state.particles.push({
      x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
      life: 1, decay: 0.03 + Math.random() * 0.03, r: 1, color: '#fff', type: 'spark'
    });
  }
  state.particles.push({ x: sx, y: sy, vx:0, vy:0, life:1, decay:0.05, r:4, color:'ring', type:'ring' });
}

function spawnSpeedTrail(sx, sy) {
  if (state.speed < 60) return;
  const intensity = Math.min((state.speed - 60) / 300, 1);
  if (Math.random() > intensity * 0.5) return;
  const col = state.boostActive ? 'rgba(80,200,255,0.45)' : 'rgba(180,180,180,0.25)';
  state.particles.push({
    x: sx - 38, y: sy + (Math.random() - 0.5) * 10,
    vx: -1.5 - Math.random() * 2, vy: (Math.random() - 0.5) * 0.7,
    life: 0.65 + Math.random() * 0.3, decay: 0.04 + Math.random() * 0.04,
    r: 2 + Math.random() * 3, color: col, type: 'dot'
  });
}

// ══════════════════════════════════════════════════
//  DRAW FUNCTIONS
// ══════════════════════════════════════════════════

const cloudDefs = [
  {ox:150,oy:68,w:110,sp:0.12},{ox:490,oy:54,w:85,sp:0.08},
  {ox:800,oy:86,w:140,sp:0.16},{ox:1070,oy:63,w:95,sp:0.11},
  {ox:1320,oy:76,w:120,sp:0.14},{ox:1620,oy:58,w:100,sp:0.10},
];

function drawBackground(ts) {
  if (currentMode === 'water') return; // drawOceanMode handles everything
  const sky = ctx.createLinearGradient(0,0,0,canvas.height * BASE_Y_RATIO);
  sky.addColorStop(0,'#f5f5f5'); sky.addColorStop(1,'#eeeeee');
  ctx.fillStyle = sky; ctx.fillRect(0,0,canvas.width,canvas.height);

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

function drawClouds() {
  cloudDefs.forEach(c => {
    const raw = c.ox - state.worldX * c.sp;
    const sx  = ((raw % (canvas.width+360)) + canvas.width+360) % (canvas.width+360) - 180;
    const h   = c.w * 0.35;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.ellipse(sx,          c.oy,          c.w*0.48, h*0.58, 0,0,Math.PI*2);
    ctx.ellipse(sx-c.w*0.28, c.oy+h*0.12,  c.w*0.28, h*0.48, 0,0,Math.PI*2);
    ctx.ellipse(sx+c.w*0.26, c.oy+h*0.12,  c.w*0.26, h*0.44, 0,0,Math.PI*2);
    ctx.fill();
  });
}

function drawWater(ts) {
  if (currentMode === 'water') { drawOceanMode(ts); return; }
  state.waterSegs.forEach(w => drawRiverSegment(w, ts));
}

function drawOceanMode(ts) {
  const t = (ts || 0) / 700;
  const depthM = state.depthM || 0;
  const MAX_DEPTH = 200;
  // surfaceScreenY is set by physics (camera tracking). Fallback for idle preview.
  const surfaceScreenY = gameRunning
    ? (state.surfaceScreenY || canvas.height * 0.35)
    : canvas.height * 0.35;
  const darkT = Math.min(depthM / MAX_DEPTH, 1);

  // Sky
  const skyGrd = ctx.createLinearGradient(0,0,0,surfaceScreenY);
  skyGrd.addColorStop(0,'#c8e6f5'); skyGrd.addColorStop(1,'#8ec8ef');
  ctx.fillStyle=skyGrd; ctx.fillRect(0,0,canvas.width,surfaceScreenY);
  drawClouds();

  // Water — darkens with depth
  const wr=Math.round(74+(5-74)*darkT), wg2=Math.round(158+(15-158)*darkT), wb=Math.round(221+(40-221)*darkT);
  const waterGrd=ctx.createLinearGradient(0,surfaceScreenY,0,canvas.height);
  waterGrd.addColorStop(0,`rgba(${wr},${wg2},${wb},0.98)`);
  waterGrd.addColorStop(1,`rgba(${Math.max(5,wr-20)},${Math.max(5,wg2-20)},${Math.max(15,wb-20)},1)`);
  ctx.fillStyle=waterGrd; ctx.fillRect(0,surfaceScreenY,canvas.width,canvas.height-surfaceScreenY);

  // Animated surface waves
  ctx.beginPath(); ctx.moveTo(0,surfaceScreenY);
  for (let x=0;x<=canvas.width;x+=6) {
    const wx2=x+state.worldX;
    ctx.lineTo(x, surfaceScreenY+Math.sin(wx2/40+t)*5+Math.sin(wx2/18+t*1.8)*2.5);
  }
  ctx.lineTo(canvas.width,surfaceScreenY+20); ctx.lineTo(0,surfaceScreenY+20); ctx.closePath();
  ctx.fillStyle='rgba(160,220,255,0.35)'; ctx.fill();

  // Foam
  ctx.beginPath(); ctx.moveTo(0,surfaceScreenY);
  for (let x=0;x<=canvas.width;x+=6) {
    const wx2=x+state.worldX;
    ctx.lineTo(x, surfaceScreenY+Math.sin(wx2/40+t)*5+Math.sin(wx2/18+t*1.8)*2.5);
  }
  ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=2.2; ctx.stroke();

  // Caustics (fade with depth)
  if (darkT<0.85) {
    ctx.save(); ctx.globalAlpha=(1-darkT)*0.07;
    for (let i=0;i<8;i++) {
      const rx=((i*137+state.worldX*0.3)%canvas.width+canvas.width)%canvas.width;
      const ry=surfaceScreenY+30+(i*83)%Math.max(1,canvas.height-surfaceScreenY-60);
      ctx.beginPath(); ctx.ellipse(rx,ry,40+Math.sin(t+i)*15,12+Math.sin(t*1.3+i)*5,0,0,Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
    }
    ctx.restore();
  }

  // Depth ruler
  drawDepthRuler(surfaceScreenY, depthM, MAX_DEPTH);

  // Darkness vignette
  if (darkT>0.05) {
    ctx.save();
    const vig=ctx.createRadialGradient(canvas.width/2,canvas.height/2,canvas.height*0.18,canvas.width/2,canvas.height/2,canvas.height*0.82);
    vig.addColorStop(0,`rgba(0,5,20,0)`);
    vig.addColorStop(1,`rgba(0,5,20,${Math.min(darkT*0.9,0.9)})`);
    ctx.fillStyle=vig; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.restore();
  }
}

function drawDepthRuler(surfaceY, depthM, maxDepth) {
  const PX_PER_M=8, rx=canvas.width-28;
  const col='rgba(120,180,255,0.6)';
  ctx.save(); ctx.globalAlpha=0.7;
  for (let dm=0;dm<=maxDepth;dm+=20) {
    const sy=surfaceY+dm*PX_PER_M;
    if (sy<0||sy>canvas.height) continue;
    ctx.strokeStyle=col; ctx.lineWidth=dm%100===0?2:1;
    ctx.beginPath(); ctx.moveTo(rx,sy); ctx.lineTo(rx+8,sy); ctx.stroke();
    if (dm%40===0) {
      ctx.fillStyle=col; ctx.font='8px DM Mono,monospace';
      ctx.textAlign='right'; ctx.textBaseline='middle';
      ctx.fillText(dm+'m',rx-3,sy);
    }
  }
  // car indicator
  const carRY=surfaceY+depthM*PX_PER_M;
  if (carRY>=surfaceY&&carRY<=canvas.height) {
    ctx.strokeStyle='#e63946'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(rx-8,carRY); ctx.lineTo(rx+10,carRY); ctx.stroke();
  }
  ctx.restore();
}

function drawRiverSegment(w, ts) {
  const sx=worldToScreenX(w.wx), ex=worldToScreenX(w.wx+w.len);
  if (ex<0||sx>canvas.width) return;
  const t=(ts||0)/700;
  // use average of entry/exit ground y for flat water surface
  const gyEntry = groundYAtWorldX(w.wx);
  const gyExit  = groundYAtWorldX(w.wx + w.len);
  const topY    = Math.min(gyEntry, gyExit) - 2;

  const wg=ctx.createLinearGradient(0,topY,0,canvas.height);
  wg.addColorStop(0,'rgba(74,158,221,0.88)'); wg.addColorStop(0.5,'rgba(35,110,185,0.8)'); wg.addColorStop(1,'rgba(15,65,140,0.7)');
  ctx.fillStyle=wg; ctx.fillRect(sx,topY,ex-sx,canvas.height-topY);

  // animated waves
  ctx.beginPath(); ctx.moveTo(sx,topY);
  for (let x=sx;x<=ex;x+=7) {
    const wx2=x+state.worldX;
    ctx.lineTo(x, topY + Math.sin(wx2/32+t)*3.5 + Math.sin(wx2/14+t*1.9)*1.8);
  }
  ctx.lineTo(ex,topY); ctx.closePath();
  ctx.fillStyle='rgba(140,215,255,0.5)'; ctx.fill();

  // surface line
  ctx.beginPath(); ctx.moveTo(sx,topY);
  for (let x=sx;x<=ex;x+=7) {
    const wx2=x+state.worldX;
    ctx.lineTo(x, topY + Math.sin(wx2/32+t)*3.5 + Math.sin(wx2/14+t*1.9)*1.8);
  }
  ctx.strokeStyle='rgba(100,190,245,0.95)'; ctx.lineWidth=2.5; ctx.stroke();

  // shimmer
  ctx.save(); ctx.globalAlpha=0.12;
  for (let i=0;i<4;i++) {
    const rx=sx+(i*w.len*0.22+Math.sin(t+i*0.8)*20);
    const ry=topY+12+Math.sin(t*1.2+i)*6;
    if (rx>sx && rx<ex) {
      ctx.beginPath(); ctx.ellipse(rx,ry,22,5,0,0,Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
    }
  }
  ctx.restore();
}

function drawOceanFloor() {
  // Ocean floor at 200m depth
  const PX_PER_M = 8;
  const surfaceY = state.surfaceScreenY > 10 ? state.surfaceScreenY : canvas.height * (1 - OCEAN_CAR_SCREEN_Y_RATIO);
  const floorScreenY = surfaceY + 200 * PX_PER_M;
  if (floorScreenY > canvas.height + 20) return; // off screen

  // Sandy ocean floor
  const grd = ctx.createLinearGradient(0, floorScreenY, 0, canvas.height + 20);
  grd.addColorStop(0, '#4a3820');
  grd.addColorStop(0.3, '#3a2c18');
  grd.addColorStop(1, '#1a1208');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(0, floorScreenY);
  // bumpy floor
  for (let x = 0; x <= canvas.width; x += 12) {
    const wx = x + state.worldX;
    ctx.lineTo(x, floorScreenY + Math.sin(wx / 80) * 6 + Math.sin(wx / 30) * 3);
  }
  ctx.lineTo(canvas.width, canvas.height + 20);
  ctx.lineTo(0, canvas.height + 20);
  ctx.closePath();
  ctx.fill();

  // floor edge line
  ctx.beginPath();
  ctx.moveTo(0, floorScreenY);
  for (let x = 0; x <= canvas.width; x += 12) {
    const wx = x + state.worldX;
    ctx.lineTo(x, floorScreenY + Math.sin(wx / 80) * 6 + Math.sin(wx / 30) * 3);
  }
  ctx.strokeStyle = 'rgba(80,60,30,0.8)'; ctx.lineWidth = 2; ctx.stroke();
}

function drawTerrain() {
  // Water mode: draw ocean floor at 200m depth, not terrain
  if (currentMode === 'water') {
    drawOceanFloor();
    return;
  }
  if (state.terrain.length < 2) return;
  const pts = state.terrain;

  ctx.beginPath();
  ctx.moveTo(worldToScreenX(pts[0].x), pts[0].y);
  for (let i=1;i<pts.length;i++) ctx.lineTo(worldToScreenX(pts[i].x), pts[i].y);
  ctx.lineTo(worldToScreenX(pts[pts.length-1].x), canvas.height+10);
  ctx.lineTo(worldToScreenX(pts[0].x), canvas.height+10);
  ctx.closePath();

  if (currentMode === 'water') {
    const grd=ctx.createLinearGradient(0,canvas.height*0.5,0,canvas.height);
    grd.addColorStop(0,'#8B7355'); grd.addColorStop(1,'#6B5335');
    ctx.fillStyle=grd;
  } else {
    const grd=ctx.createLinearGradient(0,canvas.height*0.55,0,canvas.height);
    grd.addColorStop(0,'#eaeaea'); grd.addColorStop(0.4,'#d8d8d8'); grd.addColorStop(1,'#c5c5c5');
    ctx.fillStyle=grd;
  }
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(worldToScreenX(pts[0].x), pts[0].y);
  for (let i=1;i<pts.length;i++) ctx.lineTo(worldToScreenX(pts[i].x), pts[i].y);
  ctx.strokeStyle = currentMode==='water' ? '#6B5335' : '#111';
  ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.stroke();

  if (currentMode !== 'water') {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(worldToScreenX(pts[0].x), pts[0].y+10);
    for (let i=1;i<pts.length;i++) ctx.lineTo(worldToScreenX(pts[i].x), pts[i].y+10);
    ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2; ctx.setLineDash([20,20]); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }
}

// ── Ground-anchored speed sign (post bottom = groundY) ──
function drawSpeedSign(screenX, groundY, limit) {
  const POST_H = 52, R = 20;
  const cx = screenX;
  const postTop = groundY - POST_H;
  const circCY  = postTop - R;
  ctx.save();
  // post
  ctx.fillStyle='#888';
  ctx.fillRect(cx-1.5, postTop, 3, POST_H);
  // circle
  ctx.beginPath(); ctx.arc(cx, circCY, R, 0, Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
  ctx.strokeStyle='#e63946'; ctx.lineWidth=3.5; ctx.stroke();
  // number
  ctx.fillStyle='#111'; ctx.font='600 13px DM Sans,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(limit, cx, circCY);
  ctx.restore();
}

// ── Ground-anchored end sign ──
function drawEndSign(screenX, groundY) {
  const POST_H=42, R=16;
  const cx=screenX, postTop=groundY-POST_H, circCY=postTop-R;
  ctx.save();
  ctx.fillStyle='#888'; ctx.fillRect(cx-1.5,postTop,3,POST_H);
  ctx.beginPath(); ctx.arc(cx,circCY,R,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill(); ctx.strokeStyle='#333'; ctx.lineWidth=2.5; ctx.stroke();
  // crossed line
  ctx.beginPath(); ctx.moveTo(cx-10,circCY+8); ctx.lineTo(cx+10,circCY-8);
  ctx.strokeStyle='#e63946'; ctx.lineWidth=2.5; ctx.stroke();
  ctx.restore();
}

function drawZones() {
  const ocean = currentMode === 'water';
  state.zones.forEach(z => {
    const sx=worldToScreenX(z.wx), ex=worldToScreenX(z.wx+z.len);
    if (ex<0||sx>canvas.width) return;

    // subtle tint
    ctx.save(); ctx.globalAlpha = ocean ? 0.08 : 0.05; ctx.fillStyle='#e63946';
    ctx.fillRect(sx,0,ex-sx,canvas.height); ctx.restore();

    if (!ocean) {
      // road hash marks
      ctx.save(); ctx.fillStyle='rgba(230,57,70,0.15)';
      for (let x=Math.max(sx,0);x<Math.min(ex,canvas.width);x+=62)
        ctx.fillRect(x, groundYAtWorldX(x+state.worldX)+5, 28, 4);
      ctx.restore();
      // ground-anchored signs
      if (sx >= -5 && sx <= canvas.width+5)
        drawSpeedSign(sx, groundYAtWorldX(z.wx), z.limit);
      if (ex >= -5 && ex <= canvas.width+5)
        drawEndSign(ex, groundYAtWorldX(z.wx+z.len));
    } else {
      // Ocean: draw limit as floating text banner at surface level
      if (sx >= -5 && sx <= canvas.width+5) {
        const by = (state.surfaceScreenY || canvas.height*0.35) - 50;
        ctx.save();
        ctx.fillStyle='rgba(230,57,70,0.85)';
        ctx.beginPath(); ctx.roundRect(sx-30, by-14, 62, 28, 8); ctx.fill();
        ctx.fillStyle='#fff'; ctx.font='600 12px DM Sans,sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('≤'+z.limit+' mph', sx+1, by);
        ctx.restore();
      }
    }
  });
}

function drawRoadBoosts() {
  state.roadBoosts.forEach(b => {
    if (b.collected) return;
    const sx=worldToScreenX(b.wx);
    if (sx<-60||sx>canvas.width+60) return;
    const gy=groundYAtWorldX(b.wx)-34;
    b.pulse=(b.pulse||0)+0.06;

    const g=ctx.createRadialGradient(sx,gy,2,sx,gy,22);
    g.addColorStop(0,'rgba(46,196,182,0.45)'); g.addColorStop(1,'rgba(46,196,182,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,gy,22,0,Math.PI*2); ctx.fill();

    const bob=Math.sin(b.pulse)*3;
    ctx.save(); ctx.translate(sx,gy+bob);
    ctx.fillStyle='#2ec4b6'; ctx.strokeStyle='#fff'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(4,-13); ctx.lineTo(-4,-1); ctx.lineTo(2,-1);
    ctx.lineTo(-4,13); ctx.lineTo(4,1);   ctx.lineTo(-2,1);
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  });
}

function drawScorePickups() {
  state.scorePickups.forEach(s => {
    if (s.collected) return;
    const sx=worldToScreenX(s.wx);
    if (sx<-60||sx>canvas.width+60) return;
    const gy=groundYAtWorldX(s.wx)-40;
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

function drawObstacles() {
  state.obstacles.forEach(o => {
    if (o.hit) return;
    const sx=worldToScreenX(o.wx);
    if (sx<-60||sx>canvas.width+60) return;
    const gy=groundYAtWorldX(o.wx);

    if (o.type==='rock') {
      ctx.save(); ctx.translate(sx,gy-4);
      ctx.fillStyle='#909090'; ctx.beginPath(); ctx.ellipse(0,0,22,15,-0.1,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#b4b4b4'; ctx.beginPath(); ctx.ellipse(-5,-5,9,6,0.3,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#606060'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.ellipse(0,0,22,15,-0.1,0,Math.PI*2); ctx.stroke();
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(sx,gy-8);
      ctx.fillStyle='#9B6B42'; ctx.beginPath(); ctx.roundRect(-27,-7,54,15,4); ctx.fill();
      ctx.strokeStyle='#6b3f1e'; ctx.lineWidth=1.5; ctx.stroke();
      for (let i=-18;i<=18;i+=9) {
        ctx.beginPath(); ctx.ellipse(i,0,3.5,6.5,0,0,Math.PI*2);
        ctx.strokeStyle='rgba(80,40,10,0.4)'; ctx.lineWidth=1; ctx.stroke();
      }
      ctx.restore();
    }
  });
}

function drawCar(sx, sy, angle) {
  ctx.save(); ctx.translate(sx,sy); ctx.rotate(angle);

  // shadow
  ctx.save(); ctx.translate(2,13); ctx.scale(1,0.22);
  ctx.beginPath(); ctx.ellipse(0,0,34,14,0,0,Math.PI*2);
  ctx.fillStyle='rgba(0,0,0,0.09)'; ctx.fill(); ctx.restore();

  if (activePowerups.has('ghost')) ctx.globalAlpha=0.5+Math.abs(Math.sin(Date.now()/250))*0.22;

  ctx.fillStyle='#111'; ctx.beginPath(); ctx.roundRect(-36,-12,72,16,5); ctx.fill();
  ctx.fillStyle='#2a2a2a'; ctx.beginPath(); ctx.roundRect(-16,-26,38,16,[7,7,0,0]); ctx.fill();
  ctx.fillStyle='rgba(140,200,255,0.35)'; ctx.beginPath(); ctx.roundRect(-13,-24,32,13,[5,5,0,0]); ctx.fill();
  ctx.globalAlpha=1;

  const dw=(wx,wy)=>{
    ctx.beginPath(); ctx.arc(wx,wy,10,0,Math.PI*2); ctx.fillStyle='#1a1a1a'; ctx.fill();
    ctx.beginPath(); ctx.arc(wx,wy,5.5,0,Math.PI*2); ctx.fillStyle='#e0e0e0'; ctx.fill();
    ctx.beginPath(); ctx.arc(wx,wy,2,0,Math.PI*2); ctx.fillStyle='#111'; ctx.fill();
  };
  dw(-22,6); dw(22,6);

  // nitro indicators
  for (let i=0;i<state.nitroCharges;i++) {
    ctx.beginPath(); ctx.arc(-28+i*11,-32,4,0,Math.PI*2);
    ctx.fillStyle='#f4a261'; ctx.fill();
  }

  if (state.boostActive) {
    const t=Date.now()/80;
    for (let i=0;i<4;i++) {
      ctx.beginPath();
      ctx.arc(-38-i*9+Math.sin(t+i)*2, Math.sin(t*1.3+i)*4, Math.max(0.5,4-i*0.8),0,Math.PI*2);
      ctx.fillStyle=`rgba(80,200,255,${0.65-i*0.15})`; ctx.fill();
    }
  }
  if (state.frenzyTimer>0) {
    ctx.globalAlpha=0.16+Math.abs(Math.sin(Date.now()/140))*0.12;
    ctx.fillStyle='#e63946'; ctx.beginPath(); ctx.roundRect(-36,-26,72,45,5); ctx.fill();
    ctx.globalAlpha=1;
  }
  ctx.restore();
}

function drawFloatLabels() {
  state.floatLabels.forEach(f => {
    ctx.save();
    const scale = f.life > 0.85 ? 0.8 + (1-f.life) * 1.4 : 1;
    ctx.globalAlpha = Math.min(f.life * 1.6, 1);
    ctx.translate(f.x, f.y); ctx.scale(scale,scale);
    ctx.font='600 14px DM Mono,monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=3; ctx.strokeText(f.text,0,0);
    ctx.fillStyle=f.color; ctx.fillText(f.text,0,0);
    ctx.restore();
  });
}

function drawParticles() {
  state.particles.forEach(p => {
    ctx.save();
    if (p.type==='ring') {
      const radius=(1-p.life)*80+10;
      ctx.beginPath(); ctx.arc(p.x,p.y,radius,0,Math.PI*2);
      ctx.strokeStyle=`rgba(255,120,40,${p.life*0.55})`; ctx.lineWidth=3*p.life; ctx.stroke();
    } else if (p.type==='bubble') {
      ctx.globalAlpha=p.life*0.75;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.strokeStyle='rgba(180,230,255,0.9)'; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle='rgba(220,245,255,0.15)'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(p.type==='spark'?1:p.life),0,Math.PI*2);
      ctx.fillStyle=p.color; ctx.globalAlpha=p.life*(p.type==='spark'?0.8:1); ctx.fill();
    }
    ctx.restore();
  });
}

// ══════════════════════════════════════════════════
//  SPEED WARNING
// ══════════════════════════════════════════════════
const swEl    = document.getElementById('speed-warning');
const swText  = document.getElementById('sw-text');
const swTimer = document.getElementById('sw-timer');

function showSpeedWarning(timerSec) {
  swEl.classList.remove('sw-hidden');
  requestAnimationFrame(() => swEl.classList.add('sw-active'));
  const ms     = Math.max(0, Math.round(timerSec * 1000));
  const secs   = Math.floor(ms / 1000);
  const millis = String(ms % 1000).padStart(3,'0');
  swTimer.textContent = `${secs}:${millis}`;
}

function hideSpeedWarning() {
  swEl.classList.remove('sw-active');
  // after transition, fully hide
  setTimeout(() => {
    if (!state.overSpeedActive) swEl.classList.add('sw-hidden');
  }, 220);
}

function updateSpeedWarning() {
  if (state.overSpeedActive && !state.dead && !state.dying) {
    showSpeedWarning(state.overSpeedTimer);
  } else {
    if (!swEl.classList.contains('sw-hidden')) {
      swEl.classList.remove('sw-active');
      setTimeout(() => swEl.classList.add('sw-hidden'), 220);
    }
  }
}

// ══════════════════════════════════════════════════
//  PROXIMITY ALERTS (DOM overlay)
// ══════════════════════════════════════════════════
const alertOverlay = (() => {
  const container = document.getElementById('proximity-alerts');
  const alerts    = {};

  function ensure(id, cls) {
    if (!alerts[id]) {
      const el = document.createElement('div');
      el.className = 'prox-alert ' + cls;
      container.appendChild(el);
      alerts[id] = { el, visible:false, hideTimer:null, cls };
    }
    return alerts[id];
  }

  function show(id, cls, html) {
    const a = ensure(id, cls);
    // update class if changed
    if (a.cls !== cls) { a.el.className = 'prox-alert ' + cls; a.cls = cls; }
    a.el.innerHTML = html;
    clearTimeout(a.hideTimer);
    if (!a.visible) {
      a.el.classList.add('prox-visible');
      a.visible = true;
    }
  }

  function hide(id, delay=0) {
    const a = alerts[id];
    if (!a || !a.visible) return;
    clearTimeout(a.hideTimer);
    a.hideTimer = setTimeout(() => {
      a.el.classList.remove('prox-visible');
      a.visible = false;
    }, delay);
  }

  function hideAll() {
    Object.keys(alerts).forEach(id => hide(id, 0));
  }

  return { show, hide, hideAll };
})();

// Alert thresholds (world px, then ÷10 for display meters)
const ZONE_ALERT_PX  = 1200;
const OBS_ALERT_PX   = 800;
const WATER_ALERT_PX = 900;

let _zoneWasIn = false;
let _zoneFreshTimer = 0;

function updateProximityAlerts() {
  if (!gameRunning || state.dead || state.dying) { alertOverlay.hideAll(); return; }
  const m     = MODES[currentMode];
  const carWX = state.worldX + state.carX;

  // ── ZONE ALERT ──
  if (!m.noZones && !activePowerups.has('no_zones')) {
    const zone = getActiveZone();
    if (zone && !state.zoneImmune) {
      // entering zone
      if (!_zoneWasIn) { _zoneFreshTimer = 2.2; _zoneWasIn = true; playSound('zone_enter'); }
      if (_zoneFreshTimer > 0) {
        _zoneFreshTimer -= gameDt;
        alertOverlay.show('zone','prox-zone',
          `<span class="pa-icon">🚫</span><span class="pa-body"><span class="pa-title">speed limit zone</span><span class="pa-sub">max <strong>${zone.limit}</strong> mph</span></span>`);
      } else {
        alertOverlay.hide('zone', 100);
      }
    } else {
      _zoneWasIn = false;
      // check approaching
      let minDist = ZONE_ALERT_PX, upcoming = null;
      for (const z of state.zones) {
        const d = z.wx - carWX;
        if (d > 0 && d < minDist) { minDist = d; upcoming = z; }
      }
      if (upcoming) {
        const dm = Math.round(minDist / 10);
        alertOverlay.show('zone','prox-zone',
          `<span class="pa-icon">🚫</span><span class="pa-body"><span class="pa-title">limit zone ahead</span><span class="pa-sub">max <strong>${upcoming.limit}</strong> mph · <span class="pa-dist">${dm}m</span></span></span>`);
      } else {
        alertOverlay.hide('zone', 250);
      }
    }
  } else {
    alertOverlay.hide('zone', 0);
  }

  // ── OBSTACLE ALERTS — one per visible obstacle ──
  // collect all upcoming obstacles within range, sorted by distance
  const obsAlertActive = new Set();
  if (!m.noObs && !activePowerups.has('no_obstacles') && !activePowerups.has('ghost')) {
    const nearby = state.obstacles
      .filter(o => !o.hit && o.wx - carWX > 0 && o.wx - carWX < OBS_ALERT_PX)
      .sort((a,b) => (a.wx - carWX) - (b.wx - carWX));

    nearby.forEach((o, idx) => {
      const id     = 'obs_' + idx;
      const dist   = o.wx - carWX;
      const dm     = Math.round(dist / 10);
      const emoji  = o.type === 'rock' ? '🪨' : '🪵';
      const urgent = dist < 200 ? ' pa-urgent' : '';
      obsAlertActive.add(id);
      alertOverlay.show(id, 'prox-obs' + urgent,
        `<span class="pa-icon">${emoji}</span><span class="pa-body"><span class="pa-title">${o.type} in <span class="pa-dist">${dm}m</span></span><span class="pa-sub">slow to &lt;100 mph</span></span>`);
    });

    // hide slots that have no obstacle
    for (let i = nearby.length; i < 3; i++) {
      alertOverlay.hide('obs_' + i, 0);
    }
  } else {
    alertOverlay.hide('obs_0', 0);
    alertOverlay.hide('obs_1', 0);
    alertOverlay.hide('obs_2', 0);
  }

  // ── OCEAN OBSTACLE ALERTS ──
  if (currentMode === 'water' && !activePowerups.has('ghost')) {
    const carWX2 = state.worldX + state.carX;
    const nearOcean = state.oceanObstacles
      .filter(o => !o.hit && o.wx - carWX2 > 0 && o.wx - carWX2 < 900)
      .sort((a,b) => (a.wx - carWX2) - (b.wx - carWX2));
    nearOcean.forEach((o, idx) => {
      const id   = 'oobs_' + idx;
      const dist = o.wx - carWX2;
      const dm   = Math.round(dist / 10);
      const emo  = o.type==='submarine' ? '🚢' : o.type==='fish' ? '🐟' : '🪼';
      const cls  = dist < 300 ? 'prox-obs pa-urgent' : 'prox-obs';
      alertOverlay.show(id, cls,
        `<span class="pa-icon">${emo}</span><span class="pa-body"><span class="pa-title">${o.type} in <span class="pa-dist">${dm}m</span></span><span class="pa-sub">at ${Math.round(o.depthM)}m depth</span></span>`);
    });
    for (let i = nearOcean.length; i < 3; i++) alertOverlay.hide('oobs_'+i, 0);
  } else {
    for (let i = 0; i < 3; i++) alertOverlay.hide('oobs_'+i, 0);
  }

  // ── DEPTH WARNING ALERT in ocean ──
  if (currentMode === 'water') {
    const dm = state.depthM || 0;
    if (dm > 10) {
      const pct = dm / 200;
      const cls = pct > 0.85 ? 'prox-water prox-water-active' : 'prox-water';
      alertOverlay.show('depth_warn', cls,
        `<span class="pa-icon">${pct>0.85?'💀':'⬇️'}</span><span class="pa-body"><span class="pa-title">${Math.round(dm)}m deep</span><span class="pa-sub">${Math.round(200-dm)}m to pressure death</span></span>`);
    } else {
      alertOverlay.hide('depth_warn', 300);
    }
  } else {
    alertOverlay.hide('depth_warn', 0);
  }

  // ── WATER ALERT ──
  if (!m.noWater && !activePowerups.has('water_walk') && !activePowerups.has('no_obstacles')) {
    if (state.inWater) {
      alertOverlay.show('water','prox-water prox-water-active',
        `<span class="pa-icon">🌊</span><span class="pa-body"><span class="pa-title">in water!</span><span class="pa-sub">keep above 20 mph</span></span>`);
    } else {
      let minWD = WATER_ALERT_PX;
      for (const w of state.waterSegs) {
        const d = w.wx - carWX;
        if (d > 0 && d < minWD) minWD = d;
      }
      if (minWD < WATER_ALERT_PX) {
        const dm = Math.round(minWD / 10);
        alertOverlay.show('water','prox-water',
          `<span class="pa-icon">🌊</span><span class="pa-body"><span class="pa-title">water ahead</span><span class="pa-sub">need 20+ mph · <span class="pa-dist">${dm}m</span></span></span>`);
      } else {
        alertOverlay.hide('water', 180);
      }
    }
  } else {
    alertOverlay.hide('water', 0);
  }
}

// ══════════════════════════════════════════════════
//  ACTIVE ZONE
// ══════════════════════════════════════════════════
function getActiveZone() {
  const carWX = state.worldX + state.carX;
  for (const z of state.zones) if (carWX >= z.wx && carWX <= z.wx+z.len) return z;
  return null;
}

// ══════════════════════════════════════════════════
//  HUD
// ══════════════════════════════════════════════════
const elScore     = document.getElementById('score');
const elTotal     = document.getElementById('total-score');
const elDist      = document.getElementById('dist-val');
const elDiff      = document.getElementById('diff-val');
const elSpeedDig  = document.getElementById('speed-digits');
const elZoneSign  = document.getElementById('zone-sign');
const elZsVal     = document.getElementById('zs-val');
const elFrBanner  = document.getElementById('freerun-banner');
const elScoreChip = document.getElementById('score-chip');

function updateHUD() {
  if (state.dead || state.dying) return; // freeze HUD on death

  // smooth speed display
  _displaySpd += (state.speed - _displaySpd) * 0.12;
  const spd = Math.round(_displaySpd);
  elSpeedDig.textContent = spd;
  elSpeedDig.classList.toggle('boosting', state.boostActive);

  // smooth score counter
  _displayScore += (state.score - _displayScore) * 0.1;
  elScore.textContent = Math.floor(_displayScore);
  elTotal.textContent = Math.floor(store.lifetime + _displayScore);

  // distance
  const dist = Math.floor(state.distance);
  elDist.textContent = dist >= 1000 ? (dist/1000).toFixed(1)+'km' : dist+'m';

  // difficulty
  const diff = diffScale();
  elDiff.textContent = diff.toFixed(1);
  const t = (diff-1)/2;
  elDiff.style.color = `rgb(${Math.round(17+t*210)},${Math.round(17+(1-t)*150)},${Math.round(17+(1-t)*80)})`;

  // zone limit chip — removed blink animation conflict by keeping display:flex always
  // and controlling opacity/transform via JS class
  const zone   = getActiveZone();
  const inZone = zone && !state.zoneImmune;

  // zone sign below speedometer
  if (inZone) {
    elZoneSign.classList.remove('zs-hidden');
    elZsVal.textContent = zone.limit;
  } else {
    elZoneSign.classList.add('zs-hidden');
  }

  // modifier hud badge
  const modBadge = document.getElementById('modifier-hud-badge');
  if (modBadge) {
    modBadge.className = '';
    if (store.diffModifier === 'easy') { modBadge.className = 'mod-easy'; modBadge.textContent = '🍃 easy mod'; }
    else if (store.diffModifier === 'hard') { modBadge.className = 'mod-hard'; modBadge.textContent = '💀 hard mod'; }
    else { modBadge.textContent = ''; }
  }

  // freerun banner
  const isFreerun = (currentMode === 'freerun');
  const isOcean   = (currentMode === 'water');
  elFrBanner.classList.toggle('fr-hidden', !isFreerun);
  elScoreChip && elScoreChip.classList.toggle('chip-hidden', isFreerun);

  // ocean depth HUD
  const depthHud = document.getElementById('depth-hud');
  if (depthHud) {
    if (isOcean) {
      depthHud.classList.add('visible');
      const depthM = Math.round(state.depthM || 0);
      const dvEl = document.getElementById('depth-val');
      if (dvEl) dvEl.textContent = depthM + 'm / 200m';
      const warnEl = document.getElementById('depth-chip-warn');
      if (warnEl) {
        const sinking = (state.sinkVY || 0) > 0.5 && state.speed < 40;
        warnEl.style.display = sinking ? 'flex' : 'none';
        const chipM = document.getElementById('depth-chip-m');
        if (chipM) chipM.classList.toggle('depth-danger', depthM > 150);
      }
    } else {
      depthHud.classList.remove('visible');
    }
  }

  // cruise control status chip
  const ccChip = document.getElementById('cruise-chip');
  if (ccChip) {
    if (activePowerups.has('cruise_control') && gameRunning) {
      ccChip.classList.remove('chip-hidden');
      const ccVal = document.getElementById('cruise-val');
      if (ccVal) {
        if (state.cruiseActive) {
          ccVal.textContent = `🚗 ${Math.ceil(state.cruiseTimer)}s`;
          ccChip.style.borderColor = 'rgba(123,104,238,0.5)';
        } else if (state.cruiseCooldown > 0) {
          ccVal.textContent = `🚗 cd ${Math.ceil(state.cruiseCooldown)}s`;
          ccChip.style.borderColor = 'var(--line)';
        } else {
          ccVal.textContent = '🚗 press C';
          ccChip.style.borderColor = 'rgba(123,104,238,0.3)';
        }
      }
    } else {
      ccChip.classList.add('chip-hidden');
    }
  }

  drawSpeedo(spd, inZone ? zone.limit : null);
}

function drawActivePowerupBadges() {
  const bar = document.getElementById('active-powerups');
  if (!bar) return;
  const ids = [...activePowerups];
  bar.innerHTML = ids.map(id => {
    const d = POWERUP_DEFS.find(p => p.id === id);
    return d ? `<div class="ap-badge">${d.icon} ${d.name}</div>` : '';
  }).join('');
}

// ══════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════
const toastEl = document.getElementById('toast');
let _toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// ══════════════════════════════════════════════════
//  BOOST MENU
// ══════════════════════════════════════════════════
function boostCost(def) {
  return Math.round(def.baseCost * Math.pow(1.65, store.boostCounts[def.id]||0));
}

function toggleBoostMenu() {
  if (!gameRunning || state.dead || state.dying) return;
  boostMenuOpen = !boostMenuOpen;
  const menu = document.getElementById('boost-menu');
  if (boostMenuOpen) { buildBoostMenu(); menu.classList.remove('hidden'); }
  else               { menu.classList.add('hidden'); }
}

function buildBoostMenu() {
  const grid = document.getElementById('boost-menu-grid');
  grid.innerHTML = '';
  BOOST_DEFS.forEach(def => {
    const cost = boostCost(def);
    const ok   = store.lifetime >= cost;
    const card = document.createElement('div');
    card.className = 'shop-card boost-card' + (!ok?' disabled':'');
    card.innerHTML = `<div class="shop-card-icon">${def.icon}</div>
      <div class="shop-card-name">${def.name}</div>
      <div class="shop-card-desc">${def.desc}</div>
      <div class="shop-card-cost">${cost} pts<span class="cost-rising"> ↑/use</span></div>`;
    if (ok) {
      card.addEventListener('click', () => {
        store.lifetime -= cost;
        store.boostCounts[def.id] = (store.boostCounts[def.id]||0)+1;
        saveStore(store);
        def.apply(state);
        spawnLabel(state.carX, state.carY-44, def.icon+' '+def.name+'!','#f4a261');
        showToast(`${def.icon} ${def.name} activated!`);
        boostMenuOpen=false; document.getElementById('boost-menu').classList.add('hidden');
        elTotal.textContent = Math.floor(store.lifetime + _displayScore);
      });
    }
    grid.appendChild(card);
  });
}

// ══════════════════════════════════════════════════
//  SHOP (power-ups)
// ══════════════════════════════════════════════════
function powerupCost(def) {
  return Math.round(def.baseCost * Math.pow(1.5, store.powerupCounts[def.id]||0));
}

function buildShop(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  POWERUP_DEFS.forEach(def => {
    const inQueue  = store.ownedPowerups.includes(def.id);
    const cost     = powerupCost(def);
    const ok       = store.lifetime >= cost;
    const card     = document.createElement('div');
    card.className = 'shop-card'+(inQueue?' owned':'')+((!ok&&!inQueue)?' disabled':'');
    card.innerHTML = `<div class="shop-card-icon">${def.icon}</div>
      <div class="shop-card-name">${def.name}</div>
      <div class="shop-card-desc">${def.desc}</div>
      <div class="shop-card-cost">${inQueue?'✓ queued':cost+' pts'}</div>`;
    if (!inQueue && ok) {
      card.addEventListener('click',()=>{
        store.lifetime -= cost;
        store.ownedPowerups.push(def.id);
        store.powerupCounts[def.id]=(store.powerupCounts[def.id]||0)+1;
        saveStore(store);
        refreshAllLifetimeDisplays();
        buildShop(gridId);
        showToast(`${def.icon} ${def.name} queued!`);
      });
    }
    grid.appendChild(card);
  });
}

function refreshAllLifetimeDisplays() {
  ['lifetime-display','lifetime-total','shop-lifetime'].forEach(id=>{
    const el=document.getElementById(id);
    if (el) el.textContent=store.lifetime;
  });
}

// ══════════════════════════════════════════════════
//  PHYSICS & UPDATE
// ══════════════════════════════════════════════════
const ACCEL=108, BRAKE_S=165, BRAKE_H=280, FRICTION=34, BOOST_MULT=2.1, BOOST_DUR=4, GRAVITY=1050;

// ══════════════════════════════════════════════════
//  OCEAN PHYSICS  (all-water mode)
// ══════════════════════════════════════════════════
const OCEAN_PX_PER_M  = 6;   // px per metre depth
const OCEAN_MAX_DEPTH = 200;  // m — pressure death
const OCEAN_SINK_ACCEL= 14;   // m/s² when below 40 mph
const OCEAN_RISE_ACCEL= 5;    // m/s² when above 40 mph
const OCEAN_CAR_SCREEN_Y_RATIO = 0.52; // car stays at this fraction of screen height

const MATH_EVERY_M    = 50;   // quiz every 50 m
const MATH_WRONG_SINK = 30;   // wrong answer → drop 30 m immediately

let _mathEl = null;

function getOrCreateMathEl() {
  if (_mathEl) return _mathEl;
  _mathEl = document.createElement('div');
  _mathEl.id = 'math-quiz';
  document.body.appendChild(_mathEl);
  return _mathEl;
}

function spawnMathQuestion() {
  if (state.mathActive) return;
  const ops = ['+','-','×','÷'];
  const op  = ops[Math.floor(Math.random()*ops.length)];
  let a, b, ans;
  if      (op==='+') { a=Math.floor(Math.random()*50)+5;  b=Math.floor(Math.random()*50)+5;  ans=a+b; }
  else if (op==='-') { a=Math.floor(Math.random()*80)+20; b=Math.floor(Math.random()*a)+1;    ans=a-b; }
  else if (op==='×') { a=Math.floor(Math.random()*12)+2;  b=Math.floor(Math.random()*12)+2;  ans=a*b; }
  else               { b=Math.floor(Math.random()*11)+2;  ans=Math.floor(Math.random()*11)+2; a=b*ans; }
  state.mathQuestion = `${a} ${op} ${b} = ?`;
  state.mathAnswer   = ans;
  state.mathInput    = '';
  state.mathWrong    = 0;
  state.mathActive   = true;
  state.mathPaused   = true;  // PAUSE game while question is shown
  renderMathUI();
}

function renderMathUI() {
  const el = getOrCreateMathEl();
  if (!state.mathActive) { el.style.display='none'; return; }
  const dm = Math.round(state.depthM);
  const wrongHtml = state.mathWrong > 0
    ? `<div class="mq-wrong">✗ wrong — dropped 30m! (attempt ${state.mathWrong})</div>` : '';
  el.innerHTML = `
    <div class="mq-title">⚠️ pressure check at ${dm}m depth</div>
    <div class="mq-q">${state.mathQuestion}</div>
    <div class="mq-input">${state.mathInput || '<span class="mq-cursor">|</span>'}</div>
    ${wrongHtml}
    <div class="mq-hint">type your answer and press Enter — get it right to continue</div>`;
  el.style.display='flex';
}

function dismissMathUI() {
  const el = getOrCreateMathEl();
  el.style.display='none';
  state.mathActive  = false;
  state.mathPaused  = false;
}

// Ocean obstacle spawning
let nextOceanObsAt = 0;
function maybeSpawnOceanObstacles() {
  if (currentMode !== 'water') return;
  if (state.depthM < 170) { nextOceanObsAt = state.worldX; return; }  // only below 170m
  const ahead = state.worldX + canvas.width * 1.5;
  if (ahead < nextOceanObsAt) return;
  const types = ['submarine','fish','fish','jellyfish'];
  const type  = types[Math.floor(Math.random()*types.length)];
  // depth offset from current depth (0 = same depth, + = deeper)
  const depthOffset = (Math.random() - 0.4) * 60; // can be above or below car
  state.oceanObstacles.push({
    wx: nextOceanObsAt + canvas.width * 0.9,
    depthM: Math.max(170, state.depthM + depthOffset),
    type, hit: false,
    animT: Math.random() * Math.PI * 2,
  });
  nextOceanObsAt += 400 + Math.random() * 500;
}

function drawOceanObstacles() {
  const carScreenY  = canvas.height * OCEAN_CAR_SCREEN_Y_RATIO;
  state.oceanObstacles.forEach(o => {
    if (o.hit) return;
    const sx  = worldToScreenX(o.wx);
    if (sx < -120 || sx > canvas.width + 120) return;
    // depth relative to car: positive = below car
    const relDepth = o.depthM - state.depthM;
    const sy = carScreenY + relDepth * OCEAN_PX_PER_M;
    if (sy < -60 || sy > canvas.height + 60) return;

    o.animT += 0.03;
    const bob = Math.sin(o.animT) * 5;

    ctx.save(); ctx.translate(sx, sy + bob);

    if (o.type === 'submarine') {
      // body
      ctx.fillStyle='#4a6a4a'; ctx.beginPath();
      ctx.ellipse(0,0,48,14,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#2a4a2a'; ctx.lineWidth=1.5; ctx.stroke();
      // conning tower
      ctx.fillStyle='#3a5a3a';
      ctx.beginPath(); ctx.roundRect(-6,-22,14,22,[4,4,0,0]); ctx.fill();
      // periscope
      ctx.strokeStyle='#2a4a2a'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(4,-22); ctx.lineTo(4,-34); ctx.lineTo(14,-34); ctx.stroke();
      // porthole
      ctx.beginPath(); ctx.arc(12,0,6,0,Math.PI*2);
      ctx.fillStyle='rgba(120,200,255,0.4)'; ctx.fill();
      ctx.strokeStyle='#2a4a2a'; ctx.lineWidth=1.5; ctx.stroke();
      // propeller
      ctx.strokeStyle='#6a8a6a'; ctx.lineWidth=2;
      for (let i=0;i<3;i++) {
        ctx.save(); ctx.rotate(i*Math.PI*2/3 + o.animT*2);
        ctx.beginPath(); ctx.moveTo(-44,0); ctx.lineTo(-44,-12); ctx.stroke();
        ctx.restore();
      }
    } else if (o.type === 'fish') {
      const dir = o.wx % 200 < 100 ? 1 : -1; // swim direction
      ctx.scale(dir, 1);
      // body
      ctx.fillStyle='#f4a261'; ctx.beginPath();
      ctx.ellipse(0,0,22,10,0,0,Math.PI*2); ctx.fill();
      // tail
      ctx.fillStyle='#e8813a'; ctx.beginPath();
      ctx.moveTo(-18,0); ctx.lineTo(-32,-10); ctx.lineTo(-32,10); ctx.closePath(); ctx.fill();
      // eye
      ctx.beginPath(); ctx.arc(14,0,4,0,Math.PI*2);
      ctx.fillStyle='#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(15,0,2,0,Math.PI*2);
      ctx.fillStyle='#111'; ctx.fill();
      // fin
      ctx.fillStyle='#e8813a'; ctx.beginPath();
      ctx.moveTo(0,-10); ctx.lineTo(8,-20); ctx.lineTo(-6,-10); ctx.closePath(); ctx.fill();
    } else { // jellyfish
      // bell
      const jAlpha = 0.7 + Math.sin(o.animT*2)*0.15;
      ctx.globalAlpha = jAlpha;
      const jg = ctx.createRadialGradient(0,-5,2,0,-5,24);
      jg.addColorStop(0,'rgba(200,140,255,0.9)');
      jg.addColorStop(1,'rgba(140,80,220,0.3)');
      ctx.fillStyle=jg;
      ctx.beginPath();
      ctx.arc(0,0,24,Math.PI,Math.PI*2); ctx.closePath(); ctx.fill();
      // tentacles
      ctx.globalAlpha=jAlpha*0.55;
      ctx.strokeStyle='rgba(190,120,255,0.8)'; ctx.lineWidth=1.5;
      for (let i=-3;i<=3;i++) {
        const tx=i*7, amp=8+Math.abs(i)*3;
        ctx.beginPath(); ctx.moveTo(tx,0);
        for (let y=0;y<=30;y+=5)
          ctx.lineTo(tx + Math.sin(o.animT*1.5 + y*0.4 + i)*amp*y/30, y);
        ctx.stroke();
      }
      ctx.globalAlpha=1;
    }
    ctx.restore();
  });
}

function updateOceanPhysics(dt) {
  if (activePowerups.has('water_walk')) {
    state.depthM=0; state.sinkVY=0; return;
  }

  // Camera: car is fixed at OCEAN_CAR_SCREEN_Y_RATIO of screen
  const carScreenY = canvas.height * OCEAN_CAR_SCREEN_Y_RATIO;
  state.carY         = carScreenY;
  state.carAngle     = 0;
  state.onGround     = false;
  // Surface screen Y shifts with depth
  state.surfaceScreenY = carScreenY - state.depthM * OCEAN_PX_PER_M;

  // Pause physics during quiz
  if (state.mathPaused) return;

  // ── Sinking / floating ──
  if (state.speed < 40) {
    state.sinkVY += OCEAN_SINK_ACCEL * dt;
  } else {
    // Above 40: slowly counteract sink
    state.sinkVY -= OCEAN_RISE_ACCEL * dt;
    if (state.depthM <= 0) state.sinkVY = Math.max(0, state.sinkVY);
  }
  state.sinkVY = Math.max(-8, Math.min(22, state.sinkVY));
  state.depthM += state.sinkVY * dt;
  state.depthM  = Math.max(0, state.depthM);

  // Trigger quiz every MATH_EVERY_M metres
  const quizFloor = Math.floor(state.depthM / MATH_EVERY_M) * MATH_EVERY_M;
  if (state.depthM >= MATH_EVERY_M && quizFloor > state.lastMathDepthTrigger) {
    state.lastMathDepthTrigger = quizFloor;
    spawnMathQuestion();
    return; // pause immediately
  }

  // Pressure death
  if (state.depthM >= OCEAN_MAX_DEPTH) {
    dismissMathUI();
    die('crushed by pressure at 200m — the ocean wins');
    return;
  }

  // Ocean obstacles (below 170m)
  maybeSpawnOceanObstacles();

  // Cull far ocean obstacles
  const left = state.worldX - 400;
  state.oceanObstacles = state.oceanObstacles.filter(o => !o.hit && o.wx > left);

  // Collision with ocean obstacles
  const carWX = state.worldX + state.carX;
  for (const o of state.oceanObstacles) {
    if (o.hit) continue;
    const dx = Math.abs(carWX - o.wx);
    const dy = Math.abs(state.depthM - o.depthM);
    const hx = o.type==='submarine' ? 50 : 26;
    const hy = o.type==='submarine' ? 16 : 14;
    if (dx < hx && dy * OCEAN_PX_PER_M < hy * 3) {
      if (activePowerups.has('ghost')) { o.hit=true; continue; }
      o.hit=true;
      spawnLabel(state.carX, state.carY-42,
        o.type==='submarine'?'🚢 collision!':'🐟 dodged!', '#f4a261');
      state.speed = Math.max(0, state.speed - 25);
      state.sinkVY += 4;
    }
  }

  state.inWater = true;
}

// Math quiz keyboard handler (capture phase — runs before game keys)
window.addEventListener('keydown', e => {
  if (!state.mathActive || !gameRunning) return;
  if (e.key==='Backspace') {
    state.mathInput=state.mathInput.slice(0,-1);
    renderMathUI(); e.preventDefault();
  } else if (e.key==='Enter') {
    const guess=parseInt(state.mathInput,10);
    if (!isNaN(guess) && guess===state.mathAnswer) {
      dismissMathUI();
      spawnLabel(state.carX, state.carY-50, '✓ correct! resuming', '#2ec4b6');
    } else {
      state.mathWrong++;
      state.mathInput='';
      // Immediately drop 30m deeper — penalty applied even while paused
      state.depthM = Math.min(OCEAN_MAX_DEPTH - 1, state.depthM + MATH_WRONG_SINK);
      // Update surfaceScreenY so depth ruler is correct mid-quiz
      const carAnchor2 = canvas.height * OCEAN_CAR_SCREEN_Y_RATIO;
      state.surfaceScreenY = carAnchor2 - state.depthM * OCEAN_PX_PER_M;
      renderMathUI();
    }
    e.preventDefault();
  } else if (/^[0-9-]$/.test(e.key) && state.mathInput.length<8) {
    if (e.key==='-' && state.mathInput.length>0) return;
    state.mathInput+=e.key;
    renderMathUI(); e.preventDefault();
  }
}, true);

// Cruise control key (C)
window.addEventListener('keydown', e => {
  if (e.key!=='c' && e.key!=='C') return;
  if (!gameRunning || state.dead || state.dying) return;
  if (!activePowerups.has('cruise_control')) return;
  if (state.cruiseActive) {
    // deactivate
    state.cruiseActive=false;
    state.cruiseCooldown=30;
    spawnLabel(state.carX, state.carY-44, '🚗 cruise off','#7b68ee');
    showToast('🚗 cruise control off — 30s cooldown');
  } else if (state.cruiseCooldown<=0) {
    // activate
    state.cruiseActive=true;
    state.cruiseSpeed=state.speed;
    state.cruiseTimer=180; // 3 minutes
    spawnLabel(state.carX, state.carY-44, `🚗 cruise @ ${Math.round(state.speed)} mph`,'#7b68ee');
    showToast(`🚗 cruise control on — ${Math.round(state.speed)} mph locked for 3 min`);
  } else {
    showToast(`🚗 cruise control cooling down — ${Math.ceil(state.cruiseCooldown)}s`);
  }
});

let lastTime = null;

function update(ts) {
  if (lastTime===null) lastTime=ts;
  const dt = Math.min((ts-lastTime)/1000, 0.05);
  lastTime = ts;
  gameDt   = dt;

  // always update particles & labels (even dead)
  state.particles.forEach(p => {
    p.x+=p.vx*2; p.y+=p.vy*2; p.vy+=0.18; p.life-=p.decay;
  });
  state.particles = state.particles.filter(p=>p.life>0);

  state.floatLabels.forEach(f=>{ f.y+=f.vy; f.life-=f.decay; });
  state.floatLabels=state.floatLabels.filter(f=>f.life>0);

  // stop all game logic when not running or dead/dying
  if (!gameRunning || state.dead || state.dying) return;

  // engine audio
  updateEngineSound(state.speed);

  // timers
  if (state.zoneImmune)    { state.zoneImmuneTimer-=dt; if(state.zoneImmuneTimer<=0) state.zoneImmune=false; }
  if (state.frenzyTimer>0)   state.frenzyTimer-=dt;

  // cruise control timers
  if (state.cruiseActive) {
    state.cruiseTimer -= dt;
    if (state.cruiseTimer <= 0) {
      state.cruiseActive=false; state.cruiseCooldown=30;
      spawnLabel(state.carX, state.carY-44,'🚗 cruise expired','#7b68ee');
      showToast('🚗 cruise control expired — 30s cooldown');
    }
  } else if (state.cruiseCooldown > 0) {
    state.cruiseCooldown -= dt;
    if (state.cruiseCooldown < 0) state.cruiseCooldown=0;
  }

  // input — suppressed during math quiz pause
  const paused = state.mathPaused;
  let accel=0;
  if (!paused) {
    if (KEYS['ArrowRight']) accel=1;
    if (KEYS['ArrowLeft'])  accel=-0.45;
    if (KEYS['ArrowDown'])  accel=-1;
  }

  // nitro single-press
  if (!paused && KEYS['ArrowUp'] && state.nitroCharges>0 && !state.boostActive) {
    state.nitroCharges--;
    state.boostActive=true; state.boostTimer=BOOST_DUR;
    spawnLabel(state.carX,state.carY-42,'⚡ nitro!','#f4a261');
    playSound('nitro');
    KEYS['ArrowUp']=false;
  }

  if (state.cruiseActive) {
    // Cruise control: lock speed, ignore input
    state.speed = state.cruiseSpeed;
  } else if (!paused) {
    const bf=state.boostActive?BOOST_MULT:1;
    if      (accel>0)  state.speed+=ACCEL*bf*dt;
    else if (accel<0)  state.speed-=(KEYS['ArrowDown']?BRAKE_H:BRAKE_S)*dt;
    else               state.speed-=FRICTION*dt;
    if (KEYS['ArrowUp']&&state.boostActive) state.speed+=ACCEL*0.55*dt;

    // water drag (river mode only — ocean has own sinking physics)
    if (currentMode !== 'water' && state.inWater && !activePowerups.has('water_walk') && !activePowerups.has('no_obstacles'))
      state.speed-=75*dt;
  }

  state.speed=Math.max(0, Math.min(state.maxSpeed, state.speed));
  if (activePowerups.has('speed_floor') && state.speed>0 && state.speed<40)
    state.speed=40;
  if (state.boostActive) { state.boostTimer-=dt; if(state.boostTimer<=0) state.boostActive=false; }

  // scroll world
  const pps = state.speed*(canvas.width/380);
  state.worldX  += pps*dt;
  state.distance = state.worldX/10;

  const m  = MODES[currentMode];
  // Free-run: 1 point per 100m driven
  if (currentMode === 'freerun') {
    const prevDist = state._lastScoredDist || 0;
    const curDist  = state.worldX / 10;
    const newHundreds = Math.floor(curDist / 100) - Math.floor(prevDist / 100);
    if (newHundreds > 0) {
      state.score += newHundreds;
      spawnLabel(state.carX, state.carY - 42, '+' + newHundreds + ' (100m)', '#7b68ee');
    }
    state._lastScoredDist = curDist;
  }
  const diffModMult = store.diffModifier === 'easy' ? 0.5 : store.diffModifier === 'hard' ? 2.0 : 1.0;
  const sm = (!m.noScore
    ? (activePowerups.has('triple_score')?3:1)*(activePowerups.has('double_score')?2:1)
      *(state.frenzyTimer>0?3:1)*m.scoreMult
    : 0) * diffModMult;
  if (currentMode !== 'freerun') state.score += state.speed*dt*0.1*sm;

  extendTerrain();
  maybeSpawnEntities();

  // ── OCEAN MODE: sinking physics ──
  const carWX = state.worldX + state.carX;
  if (currentMode === 'water') {
    updateOceanPhysics(dt);
    if (state.dead || state.dying) return;
  } else {
    // Normal terrain physics
    const groundY = groundYAtWorldX(carWX) - 17;
    if (state.carY < groundY) {
      state.carVY += GRAVITY * dt; state.carY += state.carVY * dt; state.onGround = false;
    } else {
      state.carY = groundY; state.carVY = 0; state.onGround = true;
    }
    state.carAngle = groundAngleAtWorldX(carWX);

    // river water — drag only; sinking death is exclusive to water mode
    state.inWater = isInWaterAt(carWX);
    if (state.inWater && !activePowerups.has('water_walk') && !activePowerups.has('no_obstacles')) {
      if (state.speed < 15 && state.speed > 0)
        spawnLabel(state.carX, state.carY - 38, '🌊 slow!', '#4a9edd');
    }
  }

  // obstacles
  for (const o of state.obstacles) {
    if (o.hit) continue;
    if (Math.abs(carWX-o.wx)<42 && state.onGround) {
      if (activePowerups.has('ghost')) { o.hit=true; continue; }
      if (state.speed>=100) { die('hit an obstacle too fast — need under 100 mph'); return; }
      else { o.hit=true; state.speed=Math.min(state.speed*0.3,20); spawnLabel(state.carX,state.carY-38,'bam!','#f4a261'); }
    }
  }

  // road boosts
  for (const b of state.roadBoosts) {
    if (b.collected) continue;
    if (Math.abs(carWX-b.wx)<44) {
      b.collected=true; state.boostActive=true; state.boostTimer=BOOST_DUR;
      spawnLabel(state.carX,state.carY-40,'⚡ boost!','#2ec4b6');
      playSound('boost');
    }
  }

  // coins
  const magnetDist=activePowerups.has('magnet')?120:40;
  for (const s of state.scorePickups) {
    if (s.collected) continue;
    if (Math.abs(carWX-s.wx)<magnetDist) {
      s.collected=true;
      const gain=Math.round(s.value*sm);
      state.score+=gain;
      if (gain>0) { spawnLabel(state.carX,state.carY-42,`+${gain}`,'#f9c74f'); playSound('coin'); }
    }
  }

  // kamikaze
  if (activePowerups.has('kamikaze') && !state.kamikazeUsed) {
    state.kamikazeUsed=true;
    activePowerups.delete('kamikaze');
    spawnExplosion(state.carX,state.carY);
    state.score+=1000; _displayScore=state.score;
    spawnLabel(state.carX,state.carY-50,'+1000 💣','#e63946');
    state.worldX+=3000;
    if (currentMode !== 'water') {
      extendTerrain();
      state.carY=groundYAtWorldX(state.worldX+state.carX)-17;
    }
    state.speed=Math.max(state.speed*0.5,30);
    showToast('💣 kamikaze! +1000 pts — skipped ahead!');
    return;
  }

  // speed zone — 0.3s grace window
  const zone=getActiveZone();
  if (zone && !state.zoneImmune && state.speed>zone.limit*1.04) {
    if (!state.overSpeedActive) {
      state.overSpeedActive=true;
      state.overSpeedTimer=0.3;
    } else {
      state.overSpeedTimer-=dt;
      if (state.overSpeedTimer<=0) {
        state.overSpeedActive=false;
        die(`speed limit ${zone.limit} mph exceeded`);
        return;
      }
    }
  } else {
    if (state.overSpeedActive) {
      state.overSpeedActive=false;
      state.overSpeedTimer=0;
    }
  }
}

// ══════════════════════════════════════════════════
//  DEATH
// ══════════════════════════════════════════════════
function die(reason) {
  if (state.dead || state.dying) return;

  // crash shield absorbs one fatal hit
  if (activePowerups.has('shield')) {
    activePowerups.delete('shield');
    state.speed=Math.max(20,state.speed*0.4);
    spawnLabel(state.carX,state.carY-52,'🛡️ shield!','#7b68ee');
    showToast('🛡️ crash shield saved you!');
    spawnExplosion(state.carX,state.carY);
    drawActivePowerupBadges();
    return;
  }

  state.dying=true;
  state.deathReason=reason;
  state.overSpeedActive=false;
  boostMenuOpen=false;
  document.getElementById('boost-menu').classList.add('hidden');
  spawnExplosion(state.carX,state.carY);
  dismissMathUI();
  playSound('crash');
  stopEngine();

  // save score — normally 60% saved; score_saver powerup keeps 100%
  const isFr = currentMode === 'freerun';
  const keepFrac = activePowerups.has('score_saver') ? 1.0 : 0.6;
  const saved = isFr ? 0 : Math.round(state.score * keepFrac);
  store.lifetime=Math.floor((store.lifetime||0)+saved);
  saveStore(store);
  refreshAllLifetimeDisplays();

  clearTimeout(dieTimeoutId);
  dieTimeoutId=setTimeout(()=>{
    if (!state.dying) return;
    state.dead=true; state.dying=false;
    hideSpeedWarning();
    alertOverlay.hideAll();
    showDeathScreen(reason);
  }, 850);
}

function showDeathScreen(reason) {
  document.getElementById('death-reason').textContent  = reason||state.deathReason;
  document.getElementById('final-score').textContent   = Math.floor(state.score);
  document.getElementById('lifetime-total').textContent= store.lifetime;
  document.getElementById('death-emoji').textContent   = currentMode==='freerun' ? '🏁' : currentMode==='water' ? '🌊' : '💥';
  document.getElementById('death-title').textContent   = currentMode==='freerun' ? 'run ended' : currentMode==='water' ? 'you sank' : 'you exploded';
  document.getElementById('death-screen').classList.remove('hidden');
}

// ══════════════════════════════════════════════════
//  DRAW MAIN
// ══════════════════════════════════════════════════
function draw(ts) {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const ocean = currentMode === 'water';
  drawBackground(ts);
  drawWater(ts);   // drawOceanMode or river segs
  drawTerrain();   // ocean: draws floor; else terrain
  if (ocean) {
    drawOceanObstacles();
    drawOceanPickups();
    // zones shown in ocean too (speed limits)
    drawZones();
  } else {
    drawZones();
    drawRoadBoosts();
    drawScorePickups();
    drawObstacles();
  }
  if (!state.dead && !state.dying) {
    drawCar(state.carX, state.carY, state.carAngle);
    if (!ocean) spawnSpeedTrail(state.carX, state.carY);
    else drawOceanBubbles(); // bubbles instead of speed trail
    if (state.cruiseActive) drawCruiseIndicator();
  }
  drawFloatLabels();
  drawParticles();
}

function drawCruiseIndicator() {
  // small "CC" badge near car
  const remaining = Math.ceil(state.cruiseTimer);
  ctx.save();
  ctx.fillStyle='rgba(123,104,238,0.85)';
  ctx.beginPath(); ctx.roundRect(state.carX+42, state.carY-22, 54, 18, 6); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='500 9px DM Mono,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(`🚗 ${remaining}s`, state.carX+69, state.carY-13);
  ctx.restore();
}

function drawOceanBubbles() {
  if (state.speed < 20) return;
  if (Math.random() > 0.35) return;
  state.particles.push({
    x: state.carX - 20 + (Math.random()-0.5)*12,
    y: state.carY - 6  + (Math.random()-0.5)*8,
    vx: (Math.random()-0.5)*0.4 - 0.5,
    vy: -0.6 - Math.random()*0.8,
    life: 0.8 + Math.random()*0.4, decay: 0.025 + Math.random()*0.02,
    r: 2 + Math.random()*3.5, color: 'rgba(180,230,255,0.6)', type:'bubble'
  });
}

function drawOceanPickups() {
  // Road boosts float at surface level
  const surfaceY = state.surfaceScreenY || canvas.height * 0.35;
  state.roadBoosts.forEach(b => {
    if (b.collected) return;
    const sx = worldToScreenX(b.wx);
    if (sx < -60 || sx > canvas.width + 60) return;
    const gy = surfaceY - 30;
    b.pulse = (b.pulse||0) + 0.06;
    const bob = Math.sin(b.pulse) * 4;
    ctx.save(); ctx.translate(sx, gy + bob);
    ctx.fillStyle='#2ec4b6'; ctx.strokeStyle='#fff'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(4,-13); ctx.lineTo(-4,-1); ctx.lineTo(2,-1);
    ctx.lineTo(-4,13); ctx.lineTo(4,1); ctx.lineTo(-2,1);
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  });
  // Coins float at mid-depth
  state.scorePickups.forEach(s => {
    if (s.collected) return;
    const sx = worldToScreenX(s.wx);
    if (sx < -60 || sx > canvas.width + 60) return;
    const gy = surfaceY + 60 + Math.sin((s.pulse||0)) * 10;
    s.pulse = (s.pulse||0) + 0.05;
    ctx.save(); ctx.translate(sx, gy);
    ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2);
    ctx.fillStyle='#f9c74f'; ctx.fill();
    ctx.strokeStyle='#e8b32a'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#7a5c00'; ctx.font='600 9px DM Mono,monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('+'+s.value,0,0); ctx.restore();
  });
}

// ══════════════════════════════════════════════════
//  MAIN LOOP
// ══════════════════════════════════════════════════
function loop(ts) {
  update(ts);
  draw(ts);
  if (gameRunning) {
    updateHUD();
    updateSpeedWarning();
    drawActivePowerupBadges();
    updateProximityAlerts();
  }
  requestAnimationFrame(loop);
}

// ══════════════════════════════════════════════════
//  START GAME
// ══════════════════════════════════════════════════
function startGame() {
  clearTimeout(dieTimeoutId);
  currentMode=selectedMode;
  state=initState();
  lastTime=null;
  boostMenuOpen=false;
  _displayScore=0;
  _displaySpd=0;
  _smoothSpd=0;
  _zoneWasIn=false;
  _zoneFreshTimer=0;
  gameDt=0;

  document.getElementById('boost-menu').classList.add('hidden');
  hideSpeedWarning();
  alertOverlay.hideAll();

  // init and start audio
  initAudio();
  stopEngine();
  stopMusic();
  setTimeout(() => { startEngine(); if (store.musicEnabled) startMusic(); }, 80);

  // consume queued power-ups
  activePowerups=new Set(store.ownedPowerups);
  store.ownedPowerups=[];
  saveStore(store);

  if (activePowerups.has('turbo_start'))   { state.boostActive=true; state.boostTimer=BOOST_DUR; state.speed=80; }
  if (activePowerups.has('nitro_reserve')) { state.nitroCharges=3; }
  if (activePowerups.has('overclock'))     { state.maxSpeed=700; }
  if (activePowerups.has('kamikaze'))      { state.kamikazeUsed=false; }

  // In ocean mode, start at surface (camera anchor = OCEAN_CAR_SCREEN_Y_RATIO)
  if (currentMode === 'water') {
    const carAnchor = canvas.height * OCEAN_CAR_SCREEN_Y_RATIO;
    state.surfaceScreenY = carAnchor;  // depth=0 so surface IS the car position
    state.carY = carAnchor;
    state.depthM = 0; state.sinkVY = 0;
  } else {
    buildTerrain();
    state.carY = groundYAtWorldX(state.carX) - 17;
  }
  resetSpawnCounters();

  // dismiss any lingering math quiz
  dismissMathUI();

  document.getElementById('mode-badge').textContent = MODES[currentMode].label;
  gameRunning = true;
  refreshAllLifetimeDisplays();
  drawActivePowerupBadges();
}

// ══════════════════════════════════════════════════
//  WIRING
// ══════════════════════════════════════════════════
document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selectedMode=btn.dataset.mode;
    currentMode=selectedMode;
    state.terrainSeed=Math.random()*10000;
    if (currentMode !== 'water') {
      buildTerrain();
      state.carY=groundYAtWorldX(state.carX)-17;
    } else {
      state.carY = canvas.height * 0.35;
    }
  });
});

document.getElementById('start-btn').addEventListener('click',()=>{
  initAudio();
  const w=document.getElementById('welcome-screen');
  w.classList.add('fade-out');
  setTimeout(()=>{ w.style.display='none'; startGame(); },320);
  if (!loopStarted){ loopStarted=true; requestAnimationFrame(loop); }
});

document.getElementById('restart-btn').addEventListener('click',()=>{
  document.getElementById('death-screen').classList.add('hidden');
  startGame();
});

document.getElementById('change-mode-btn').addEventListener('click',()=>{
  document.getElementById('death-screen').classList.add('hidden');
  exitToMenu();
});

document.getElementById('open-shop-welcome').addEventListener('click',()=>{
  refreshAllLifetimeDisplays();
  buildShop('shop-grid-welcome');
  document.getElementById('shop-screen').classList.remove('hidden');
});

document.getElementById('open-shop-death').addEventListener('click',()=>{
  refreshAllLifetimeDisplays();
  buildShop('shop-grid-welcome');
  document.getElementById('shop-screen').classList.remove('hidden');
});

document.getElementById('close-shop-btn').addEventListener('click',()=>{
  document.getElementById('shop-screen').classList.add('hidden');
  refreshAllLifetimeDisplays();
});

document.getElementById('reset-btn').addEventListener('click',()=>{
  if (confirm('reset lifetime score, all power-ups, and boost prices?')) {
    store={lifetime:0,ownedPowerups:[],powerupCounts:{},boostCounts:{},
           soundEnabled:true,musicEnabled:true,diffModifier:'normal'};
    saveStore(store);
    refreshAllLifetimeDisplays();
    updateModifierBanner();
  }
});

// ══════════════════════════════════════════════════
//  SETTINGS SCREEN
// ══════════════════════════════════════════════════
function updateModifierBanner() {
  const banner = document.getElementById('modifier-active-banner');
  if (!banner) return;
  banner.className = 'mod-active-banner';
  if (store.diffModifier === 'easy') {
    banner.textContent = '🍃 easy modifier active — ×0.5 pts, +50% limits, no obstacles';
    banner.classList.add('mod-easy');
  } else if (store.diffModifier === 'hard') {
    banner.textContent = '💀 hard modifier active — ×2 pts, −50% limits, ×3 obstacles';
    banner.classList.add('mod-hard');
  } else {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
}

function buildSettingsScreen() {
  // sync audio toggles
  const soundBtn = document.getElementById('sound-toggle');
  const musicBtn = document.getElementById('music-toggle');
  if (soundBtn) { soundBtn.textContent = store.soundEnabled ? 'on' : 'off'; soundBtn.classList.toggle('active', store.soundEnabled); }
  if (musicBtn) { musicBtn.textContent = store.musicEnabled ? 'on' : 'off'; musicBtn.classList.toggle('active', store.musicEnabled); }
  // sync modifier buttons
  document.querySelectorAll('.mod-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mod === store.diffModifier);
  });
}

document.getElementById('sound-toggle').addEventListener('click', () => {
  store.soundEnabled = !store.soundEnabled;
  saveStore(store);
  buildSettingsScreen();
  if (!store.soundEnabled) stopEngine();
  else if (gameRunning) { initAudio(); startEngine(); }
});

document.getElementById('music-toggle').addEventListener('click', () => {
  store.musicEnabled = !store.musicEnabled;
  saveStore(store);
  buildSettingsScreen();
  if (!store.musicEnabled) stopMusic();
  else if (gameRunning) { initAudio(); startMusic(); }
});

document.querySelectorAll('.mod-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    store.diffModifier = btn.dataset.mod;
    saveStore(store);
    buildSettingsScreen();
    updateModifierBanner();
  });
});

document.getElementById('open-settings-btn').addEventListener('click', () => {
  initAudio();
  buildSettingsScreen();
  document.getElementById('settings-screen').classList.remove('hidden');
});

document.getElementById('close-settings-btn').addEventListener('click', () => {
  document.getElementById('settings-screen').classList.add('hidden');
  updateModifierBanner();
});

// ══════════════════════════════════════════════════
//  IDLE PREVIEW (behind welcome screen)
// ══════════════════════════════════════════════════
state=initState();
buildTerrain();
state.carY=groundYAtWorldX(state.carX)-17;
refreshAllLifetimeDisplays();
updateModifierBanner();

(function idleLoop(ts) {
  if (loopStarted) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawBackground(ts);
  drawTerrain();
  drawCar(state.carX,state.carY,0);
  requestAnimationFrame(idleLoop);
})();
