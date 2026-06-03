(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const finalEl = document.getElementById('finalScore');

  const VW = 360, VH = 640;

  function resize() {
    const maxW = Math.min(window.innerWidth, 480);
    const maxH = window.innerHeight;
    const ratio = VW / VH;
    let w = maxW, h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = VW * dpr;
    canvas.height = VH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- World / camera ----
  // Lateral world X: -1 = left edge of track, +1 = right edge.
  // Forward world Z: 0 = at the player (near), 1 = at the horizon (far).
  const HORIZON_Y = VH * 0.32;
  const FAR_SCALE = 0.18;
  const TRACK_HALF_PX = 140; // half-width of the track at the near plane (Z=0)

  function projectY(z) {
    return HORIZON_Y + (VH - HORIZON_Y) * (1 - z);
  }
  function scaleAt(z) {
    return 1 + (FAR_SCALE - 1) * z; // 1 at near, FAR_SCALE at far
  }
  function projectX(worldX, z) {
    return VW / 2 + worldX * TRACK_HALF_PX * scaleAt(z);
  }

  // Player sits at this depth (red line on the screen). Obstacles collide here, not at z=0.
  const PLAYER_Z = 0.18;

  // ---- Biomes ----
  // Each biome defines a palette for sky/hills/ground + a weather type.
  // Item pools come from assets/items-manifest.json (biome key + "any" fallback).
  const BIOMES = {
    savannah: {
      name: 'Savannah Desert',
      skyTop: '#f4b56b', skyBot: '#ffe6bf',
      hill: '#d39a55', hill2: '#c4863f',
      groundTop: '#e7be73', groundBot: '#f1d49a',
      edge: 'rgba(120,85,35,0.35)', stripe: 'rgba(255,255,255,0.13)',
      weather: 'none',
    },
    forest: {
      name: 'Forest',
      skyTop: '#7fbef0', skyBot: '#cfeafb',
      hill: '#4f8f4a', hill2: '#3c7038',
      groundTop: '#79c06b', groundBot: '#8ed57c',
      edge: 'rgba(35,65,28,0.35)', stripe: 'rgba(255,255,255,0.18)',
      weather: 'rain',
    },
    arctic: {
      name: 'Arctic',
      skyTop: '#bfe0f5', skyBot: '#eef8ff',
      hill: '#cfe3ef', hill2: '#b4d2e4',
      groundTop: '#e9f3fb', groundBot: '#ffffff',
      edge: 'rgba(120,150,180,0.35)', stripe: 'rgba(170,205,235,0.45)',
      weather: 'snow',
    },
    mystic: {
      name: 'Mystic',
      skyTop: '#4d2384', skyBot: '#9a6fd4',
      hill: '#6e3aa0', hill2: '#552c84',
      groundTop: '#7b4bb0', groundBot: '#a279d8',
      edge: 'rgba(40,10,70,0.4)', stripe: 'rgba(225,190,255,0.22)',
      weather: 'motes', moteColor: '230,190,255',
    },
    genesis: {
      name: 'Genesis',
      skyTop: '#081636', skyBot: '#1d3a70',
      hill: '#142a54', hill2: '#0e1f40',
      groundTop: '#16356b', groundBot: '#2a5fa0',
      edge: 'rgba(5,15,40,0.5)', stripe: 'rgba(120,170,255,0.22)',
      weather: 'motes', moteColor: '150,190,255',
    },
    luna: {
      name: "Luna's Landing",
      skyTop: '#4f0b0b', skyBot: '#a82626',
      hill: '#7a1515', hill2: '#5c0f0f',
      groundTop: '#8a1c1c', groundBot: '#c64030',
      edge: 'rgba(40,5,5,0.5)', stripe: 'rgba(255,185,165,0.22)',
      weather: 'motes', moteColor: '255,160,140',
    },
  };
  const BIOME_KEYS = Object.keys(BIOMES);

  // Score-gated biome progression (the run advances through biomes as score climbs).
  function biomeKeyForScore(s) {
    if (s < 500)   return 'savannah';   // 1–500
    if (s < 1500)  return 'forest';     // 500–1500
    if (s < 3000)  return 'arctic';     // 1500–3000
    if (s < 5000)  return 'mystic';     // 3000–5000
    if (s < 10000) return 'genesis';    // 5000–10000
    return 'luna';                      // 10000+
  }
  let currentBiomeKey = 'savannah';

  // ---- Item assets ----
  let manifest = null;          // { savannah:[...], ..., any:[...] }
  const itemCache = new Map();  // filename -> Image
  function loadItem(fn) {
    let img = itemCache.get(fn);
    if (!img) {
      img = new Image();
      img.src = 'assets/items/' + encodeURIComponent(fn);
      itemCache.set(fn, img);
    }
    return img;
  }
  fetch('assets/items-manifest.json')
    .then(r => r.json())
    .then(m => { manifest = m; })
    .catch(() => { manifest = null; });

  // Pool of item filenames for the current run's biome (biome-specific + any).
  let biomePool = [];
  function buildBiomePool(biomeKey) {
    const specific = (manifest && manifest[biomeKey]) || [];
    const any = (manifest && manifest.any) || [];
    biomePool = specific.concat(any);
    // Warm a random subset so the first obstacles have art ready.
    const warm = biomePool.slice().sort(() => Math.random() - 0.5).slice(0, 24);
    for (const fn of warm) loadItem(fn);
  }

  // ---- Storage ----
  const STORAGE_KEY = 'endless-dodge-best';
  let best = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  bestEl.textContent = 'Best: ' + best;

  // ---- Sprites ----
  // Three sprites: rear (idle/straight), right (banking right), left (banking left).
  const mechRear  = new Image();
  const mechRight = new Image();
  const mechLeft  = new Image();
  let mechReady = 0; // bitmask: 1=rear, 2=right, 4=left
  mechRear.onload  = () => { mechReady |= 1; };
  mechRight.onload = () => { mechReady |= 2; };
  mechLeft.onload  = () => { mechReady |= 4; };
  mechRear.src  = 'assets/mech%20rear.png?v=2';
  mechRight.src = 'assets/mech%20right.png?v=1';
  mechLeft.src  = 'assets/mech%20left.png?v=1';

  // Per-sprite metadata: aspect (w/h) and thruster nozzle anchors as fractions of drawn (w, h).
  // Rear sprite was cropped to its content bounds so it draws at the same size as left/right.
  const SPRITES = {
    rear:  { img: mechRear,  bit: 1, aspect: 0.979, left: { x: 0.190, y: 0.605 }, right: { x: 0.769, y: 0.605 } },
    right: { img: mechRight, bit: 2, aspect: 1.13, left: { x: 0.128, y: 0.635 }, right: { x: 0.872, y: 0.635 } },
    left:  { img: mechLeft,  bit: 4, aspect: 1.13, left: { x: 0.128, y: 0.635 }, right: { x: 0.872, y: 0.635 } },
  };
  const STEER_BANK = 0.9; // |vx| above this → use banking (left/right) sprite

  function currentSprite() {
    if (player.vx >  STEER_BANK) return SPRITES.right;
    if (player.vx < -STEER_BANK) return SPRITES.left;
    return SPRITES.rear;
  }

  // ---- Player ----
  const player = {
    worldX: 0,   // lateral, -1..+1
    vx: 0,       // lateral velocity in worldX units / sec
    spriteH: 96, // on-screen sprite height in px at near plane
  };
  const PLAYER_LATERAL_SPEED = 2.6;   // worldX/sec
  const PLAYER_LATERAL_ACCEL = 18;
  const PLAYER_LATERAL_FRICTION = 16;
  const PLAYER_CLAMP = 0.92;

  // ---- Obstacles ----
  // Each obstacle has worldX in [-1,1] and z in [0,1] decreasing over time.
  // Visual: an item sprite (from the current biome pool) sitting on the ground.
  // Fallback box if an item image isn't ready yet.
  const FALLBACK = { color: '#b0a48c', dark: '#7a6e58' };

  let obstacles = [];
  let stripes = [];
  let particles = [];
  let smoke = [];
  let weather = [];
  let smokeTimer = 0;

  let currentBiome = BIOMES.forest;
  let bannerTimer = 0;

  // Ground motion stripes (lateral lines on the ground that scroll forward)
  function seedStripes() {
    stripes = [];
    for (let i = 0; i < 14; i++) stripes.push({ z: i / 14 });
  }
  seedStripes();

  function seedWeather() {
    weather = [];
    const w = currentBiome.weather;
    if (w === 'none') return;
    const count = w === 'rain' ? 90 : w === 'snow' ? 70 : 40;
    for (let i = 0; i < count; i++) {
      weather.push({
        x: Math.random() * VW,
        y: Math.random() * VH,
        spd: w === 'rain' ? 420 + Math.random() * 180
           : w === 'snow' ? 40 + Math.random() * 40
           : 12 + Math.random() * 20,
        drift: w === 'snow' ? (Math.random() - 0.5) * 25
             : w === 'motes' ? (Math.random() - 0.5) * 18 : 0,
        r: w === 'rain' ? 0 : 1 + Math.random() * 2,
        len: w === 'rain' ? 8 + Math.random() * 8 : 0,
        ph: Math.random() * Math.PI * 2,
      });
    }
  }

  let running = false;
  let score = 0;
  let elapsed = 0;
  let spawnTimer = 0;
  let forwardSpeed = 0.55; // world Z units / sec
  let input = { left: false, right: false };

  function reset() {
    obstacles = [];
    particles = [];
    smoke = [];
    smokeTimer = 0;
    player.worldX = 0;
    player.vx = 0;
    score = 0;
    elapsed = 0;
    spawnTimer = 0;
    forwardSpeed = 0.55;
    // Runs always begin in Savannah; biome advances with score (see update()).
    setBiome('savannah');
    seedStripes();
  }

  // Switch to a biome: swap palette, rebuild item pool, reseed weather, flash banner.
  function setBiome(key) {
    currentBiomeKey = key;
    currentBiome = BIOMES[key];
    buildBiomePool(key);
    seedWeather();
    bannerTimer = 2.6;
  }

  function start() {
    reset();
    running = true;
    overlay.classList.add('hidden');
    finalEl.style.display = 'none';
  }

  function gameOver() {
    running = false;
    if (score > best) {
      best = score;
      localStorage.setItem(STORAGE_KEY, String(best));
      bestEl.textContent = 'Best: ' + best;
    }
    finalEl.textContent = 'Score: ' + score + '   ·   Best: ' + best;
    finalEl.style.display = 'block';
    startBtn.textContent = 'Play again';
    overlay.classList.remove('hidden');
    const sx = projectX(player.worldX, PLAYER_Z);
    const sy = projectY(PLAYER_Z) - player.spriteH * 0.5;
    for (let i = 0; i < 28; i++) {
      particles.push({
        x: sx, y: sy,
        vx: (Math.random() - 0.5) * 420,
        vy: (Math.random() - 0.5) * 420 - 60,
        life: 0.9, max: 0.9,
        c: '#ff5d6c',
      });
    }
  }

  startBtn.addEventListener('click', start);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') input.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = true;
    if ((e.key === ' ' || e.key === 'Enter') && !running) start();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') input.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = false;
  });

  function pointerHandler(e, down) {
    if (!running) return;
    const rect = canvas.getBoundingClientRect();
    const touches = e.touches ? Array.from(e.touches) : [e];
    input.left = false;
    input.right = false;
    if (!down) return;
    for (const t of touches) {
      const x = t.clientX - rect.left;
      if (x < rect.width / 2) input.left = true;
      else input.right = true;
    }
  }
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); pointerHandler(e, true); }, { passive: false });
  canvas.addEventListener('touchmove',  (e) => { e.preventDefault(); pointerHandler(e, true); }, { passive: false });
  canvas.addEventListener('touchend',   (e) => { e.preventDefault(); pointerHandler(e, e.touches.length > 0); }, { passive: false });
  canvas.addEventListener('mousedown', (e) => pointerHandler(e, true));
  canvas.addEventListener('mousemove', (e) => { if (e.buttons) pointerHandler(e, true); });
  window.addEventListener('mouseup',   () => { input.left = false; input.right = false; });

  function spawnObstacle() {
    const worldX = (Math.random() * 2 - 1) * 0.78;
    let img = null;
    if (biomePool.length) {
      const fn = biomePool[Math.floor(Math.random() * biomePool.length)];
      img = loadItem(fn);
    }
    // Ground half-width in worldX units (collision + draw scale).
    const agW = 0.18 + Math.random() * 0.10;
    obstacles.push({ worldX, z: 1.0, img, agW });
  }

  function update(dt) {
    elapsed += dt;
    forwardSpeed = 0.55 + Math.min(elapsed * 0.025, 0.95);
    if (bannerTimer > 0) bannerTimer -= dt;

    // Steering
    let ax = 0;
    if (input.left)  ax -= PLAYER_LATERAL_ACCEL;
    if (input.right) ax += PLAYER_LATERAL_ACCEL;
    if (ax === 0) {
      const sign = Math.sign(player.vx);
      player.vx -= sign * PLAYER_LATERAL_FRICTION * dt;
      if (Math.sign(player.vx) !== sign) player.vx = 0;
    } else {
      player.vx += ax * dt;
    }
    player.vx = Math.max(-PLAYER_LATERAL_SPEED, Math.min(PLAYER_LATERAL_SPEED, player.vx));
    player.worldX += player.vx * dt;
    if (player.worldX < -PLAYER_CLAMP) { player.worldX = -PLAYER_CLAMP; player.vx = 0; }
    if (player.worldX >  PLAYER_CLAMP) { player.worldX =  PLAYER_CLAMP; player.vx = 0; }

    // Spawn obstacles
    spawnTimer -= dt;
    const spawnInterval = Math.max(0.30, 0.95 - elapsed * 0.014);
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = spawnInterval;
    }

    // Advance obstacles toward camera — keep them alive past the player so they fly off-screen.
    for (const o of obstacles) o.z -= forwardSpeed * dt;
    obstacles = obstacles.filter(o => o.z > -0.35);

    // Ground stripes scroll forward (toward camera)
    for (const s of stripes) {
      s.z -= forwardSpeed * dt;
      if (s.z < 0) s.z += 1;
    }

    // Weather motion
    updateWeather(dt);

    // Collision: when obstacle reaches the player's depth.
    for (const o of obstacles) {
      if (o.z < PLAYER_Z + 0.06 && o.z > PLAYER_Z - 0.06) {
        const dx = Math.abs(o.worldX - player.worldX);
        if (dx < o.agW + 0.10) {
          gameOver();
          return;
        }
      }
    }

    // Smoke from thrusters — emit from each nozzle anchor on the current sprite.
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = 0.022;
      const spr = currentSprite();
      const cx = projectX(player.worldX, PLAYER_Z);
      const cy = projectY(PLAYER_Z);
      const h  = player.spriteH;
      const w  = h * spr.aspect;
      const px = cx - w / 2;
      const py = cy - h * 0.85;
      const nozzles = [
        { x: px + w * spr.left.x,  y: py + h * spr.left.y  },
        { x: px + w * spr.right.x, y: py + h * spr.right.y },
      ];
      for (const n of nozzles) {
        smoke.push({
          x: n.x + (Math.random() - 0.5) * 4,
          y: n.y + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 24 - player.vx * 18,
          vy: 55 + Math.random() * 35,
          r: 4 + Math.random() * 3,
          grow: 24 + Math.random() * 12,
          life: 0.55 + Math.random() * 0.25,
          max: 0.8,
        });
      }
    }

    score = Math.floor(elapsed * 10);
    scoreEl.textContent = score;

    // Advance biome when the score crosses a threshold.
    const nextKey = biomeKeyForScore(score);
    if (nextKey !== currentBiomeKey) setBiome(nextKey);
  }

  function updateWeather(dt) {
    const w = currentBiome.weather;
    if (w === 'none') return;
    for (const p of weather) {
      p.x += (p.drift + (w === 'motes' ? Math.sin(p.ph + elapsed) * 8 : 0)) * dt;
      if (w === 'motes') {
        p.y -= p.spd * dt; // motes drift upward
        if (p.y < -10) { p.y = VH + 10; p.x = Math.random() * VW; }
      } else {
        p.y += p.spd * dt;
        if (p.y > VH + 10) { p.y = -10; p.x = Math.random() * VW; }
      }
      if (p.x < -10) p.x = VW + 10;
      if (p.x > VW + 10) p.x = -10;
    }
  }

  function updateSmoke(dt) {
    for (const p of smoke) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
      p.vx *= 0.95;
      p.life -= dt;
    }
    smoke = smoke.filter(p => p.life > 0);
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 700 * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  function drawSky() {
    const b = currentBiome;
    const grad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    grad.addColorStop(0, b.skyTop);
    grad.addColorStop(1, b.skyBot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VW, HORIZON_Y);

    // Far hill ridge
    ctx.fillStyle = b.hill2;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON_Y);
    for (let i = 0; i <= 8; i++) {
      const x = i * (VW / 8);
      const y = HORIZON_Y - 22 - Math.sin(i * 0.9 + 1) * 12;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(VW, HORIZON_Y); ctx.closePath(); ctx.fill();

    // Near hill ridge
    ctx.fillStyle = b.hill;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON_Y);
    for (let i = 0; i <= 8; i++) {
      const x = i * (VW / 8);
      const y = HORIZON_Y - 12 - Math.sin(i * 1.3) * 8 - (i % 2 === 0 ? 6 : 0);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(VW, HORIZON_Y); ctx.closePath(); ctx.fill();
  }

  function drawGround() {
    const b = currentBiome;
    const gGrad = ctx.createLinearGradient(0, HORIZON_Y, 0, VH);
    gGrad.addColorStop(0, b.groundTop);
    gGrad.addColorStop(1, b.groundBot);
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, HORIZON_Y, VW, VH - HORIZON_Y);

    // Forward-scrolling stripes (motion lines)
    for (const s of stripes) {
      const y = projectY(s.z);
      const alpha = (1 - s.z) * 0.30 + 0.04;
      ctx.strokeStyle = b.stripe.replace(/[\d.]+\)$/, alpha.toFixed(2) + ')');
      ctx.lineWidth = 1 + (1 - s.z) * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VW, y);
      ctx.stroke();
    }

    // Track edges (left + right) — converging toward horizon
    ctx.strokeStyle = b.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(projectX(-1, 0), projectY(0));
    ctx.lineTo(projectX(-1, 1), projectY(1));
    ctx.moveTo(projectX( 1, 0), projectY(0));
    ctx.lineTo(projectX( 1, 1), projectY(1));
    ctx.stroke();
  }

  function drawObstacles(farOnly) {
    // Sort far-to-near so near ones draw on top.
    // farOnly=true: only obstacles still behind the player (behind the mech sprite).
    // farOnly=false: only obstacles past the player (drawn on top of the mech).
    let list = obstacles;
    if (farOnly === true)  list = list.filter(o => o.z >= PLAYER_Z);
    if (farOnly === false) list = list.filter(o => o.z <  PLAYER_Z);
    const sorted = list.slice().sort((a, b) => b.z - a.z);
    for (const o of sorted) {
      if (o.z > 1.02) continue;
      const z = o.z;
      const s = scaleAt(z);
      const cx = projectX(o.worldX, z);
      const cy = projectY(z);
      const baseW = o.agW * TRACK_HALF_PX * s * 2;

      // Shadow on the ground (ellipse)
      ctx.fillStyle = `rgba(0,0,0,${0.26 * (1 - z * 0.4)})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, baseW * 0.55, baseW * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();

      const img = o.img;
      if (img && img.complete && img.naturalWidth > 0) {
        const aspect = img.naturalWidth / img.naturalHeight;
        const dw = baseW * 1.35; // items render a touch wider than the collision box
        const dh = dw / aspect;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, cx - dw / 2, cy - dh, dw, dh);
      } else {
        const h = baseW * 1.2;
        const grad = ctx.createLinearGradient(0, cy - h, 0, cy);
        grad.addColorStop(0, FALLBACK.color);
        grad.addColorStop(1, FALLBACK.dark);
        ctx.fillStyle = grad;
        roundRect(cx - baseW / 2, cy - h, baseW, h, Math.max(3, 6 * s));
        ctx.fill();
      }
    }
  }

  function drawPlayer() {
    const z = PLAYER_Z;
    const cx = projectX(player.worldX, z);
    const cy = projectY(z);
    const spr = currentSprite();
    const h = player.spriteH;
    const w = h * spr.aspect;
    const px = cx - w / 2;
    const py = cy - h * 0.85;

    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 4, w * 0.45, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (mechReady & spr.bit) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(spr.img, px, py, w, h);
    } else {
      ctx.fillStyle = '#7aa6ff';
      roundRect(px, py, w, h, 8);
      ctx.fill();
    }
  }

  function drawSmoke() {
    for (const p of smoke) {
      const a = Math.max(0, p.life / p.max) * 0.85;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grad.addColorStop(0, `rgba(245,248,255,${a})`);
      grad.addColorStop(0.6, `rgba(180,190,210,${a * 0.7})`);
      grad.addColorStop(1, `rgba(120,130,150,0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWeather() {
    const w = currentBiome.weather;
    if (w === 'none') return;
    if (w === 'rain') {
      ctx.strokeStyle = 'rgba(200,220,255,0.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const p of weather) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 2, p.y + p.len);
      }
      ctx.stroke();
    } else if (w === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const p of weather) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (w === 'motes') {
      for (const p of weather) {
        const tw = 0.5 + 0.5 * Math.sin(p.ph + elapsed * 2);
        ctx.fillStyle = `rgba(${currentBiome.moteColor},${(0.5 * tw + 0.15).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    if (bannerTimer <= 0) return;
    const fadeIn = Math.min(1, (2.6 - bannerTimer) / 0.25);
    const fadeOut = Math.min(1, bannerTimer / 0.6);
    ctx.globalAlpha = Math.max(0, Math.min(1, Math.min(fadeIn, fadeOut)));
    ctx.font = '600 22px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText(currentBiome.name, VW / 2 + 1, HORIZON_Y + 41);
    ctx.fillStyle = '#fff';
    ctx.fillText(currentBiome.name, VW / 2, HORIZON_Y + 40);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, VW, VH);
    drawSky();
    drawGround();
    drawObstacles(true);
    if (running || particles.length === 0) drawPlayer();
    drawObstacles(false);
    drawSmoke();
    drawWeather();
    drawParticles();
    drawBanner();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (running) update(dt);
    updateParticles(dt);
    updateSmoke(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
