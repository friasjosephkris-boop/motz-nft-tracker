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

  // ---- Storage ----
  const STORAGE_KEY = 'endless-dodge-best';
  let best = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  bestEl.textContent = 'Best: ' + best;

  // ---- Sprites ----
  const mechSheet = new Image();
  let mechReady = false;
  mechSheet.onload = () => { mechReady = true; };
  mechSheet.onerror = () => { mechReady = false; };
  mechSheet.src = 'assets/mech-sheet.png?v=4';

  const FRAMES = {
    left:   [56,  584, 416, 443],
    center: [209, 90,  576, 500],
    right:  [523, 585, 416, 457],
  };

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
  // Visual: a colored box sitting on the ground at the projected position.
  const OBS_TYPES = [
    { color: '#a0a4b0', dark: '#6e7280', wx: 0.28, hPx: 70, label: 'rock' },
    { color: '#7ec8e3', dark: '#3e88a8', wx: 0.20, hPx: 90, label: 'crate' },
    { color: '#f0a868', dark: '#9c5a2a', wx: 0.34, hPx: 60, label: 'barrel' },
  ];

  let obstacles = [];
  let stripes = [];
  let particles = [];
  let smoke = [];
  let smokeTimer = 0;

  // Ground motion stripes (lateral lines on the ground that scroll forward)
  function seedStripes() {
    stripes = [];
    for (let i = 0; i < 14; i++) stripes.push({ z: i / 14 });
  }
  seedStripes();

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
    seedStripes();
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
    const sx = projectX(player.worldX, 0);
    const sy = projectY(0) - player.spriteH * 0.5;
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
    const t = OBS_TYPES[Math.floor(Math.random() * OBS_TYPES.length)];
    const worldX = (Math.random() * 2 - 1) * 0.78;
    obstacles.push({ worldX, z: 1.0, type: t });
  }

  function update(dt) {
    elapsed += dt;
    forwardSpeed = 0.55 + Math.min(elapsed * 0.025, 0.95);

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

    // Advance obstacles toward camera
    for (const o of obstacles) o.z -= forwardSpeed * dt;
    obstacles = obstacles.filter(o => o.z > -0.05);

    // Ground stripes scroll forward (toward camera)
    for (const s of stripes) {
      s.z -= forwardSpeed * dt;
      if (s.z < 0) s.z += 1;
    }

    // Collision: only at near plane (when obstacle z ~ 0)
    for (const o of obstacles) {
      if (o.z < 0.06 && o.z > -0.05) {
        const dx = Math.abs(o.worldX - player.worldX);
        const collideX = o.type.wx + 0.10; // half-width sum
        if (dx < collideX) {
          gameOver();
          return;
        }
      }
    }

    // Smoke from thrusters
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = 0.022;
      const baseY = projectY(0) - player.spriteH * 0.35;
      const cx    = projectX(player.worldX, 0);
      const leftX  = cx - player.spriteH * 0.22;
      const rightX = cx + player.spriteH * 0.22;
      for (const tx of [leftX, rightX]) {
        smoke.push({
          x: tx + (Math.random() - 0.5) * 4,
          y: baseY + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 30 - player.vx * 18,
          vy: 50 + Math.random() * 35,
          r: 5 + Math.random() * 3,
          grow: 24 + Math.random() * 12,
          life: 0.55 + Math.random() * 0.25,
          max: 0.8,
        });
      }
    }

    score = Math.floor(elapsed * 10);
    scoreEl.textContent = score;
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
    const grad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    grad.addColorStop(0, '#86c6f5');
    grad.addColorStop(1, '#c8e6fa');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VW, HORIZON_Y);

    // Distant hills
    ctx.fillStyle = '#7fb27a';
    ctx.beginPath();
    ctx.moveTo(0, HORIZON_Y);
    for (let i = 0; i <= 8; i++) {
      const x = i * (VW / 8);
      const y = HORIZON_Y - 14 - Math.sin(i * 1.3) * 8 - (i % 2 === 0 ? 6 : 0);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(VW, HORIZON_Y);
    ctx.closePath();
    ctx.fill();
  }

  function drawGround() {
    // Grass fill
    const gGrad = ctx.createLinearGradient(0, HORIZON_Y, 0, VH);
    gGrad.addColorStop(0, '#7cc26e');
    gGrad.addColorStop(1, '#8fd57f');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, HORIZON_Y, VW, VH - HORIZON_Y);

    // Forward-scrolling stripes (motion lines)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (const s of stripes) {
      const y = projectY(s.z);
      const alpha = (1 - s.z) * 0.35 + 0.05;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1 + (1 - s.z) * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(VW, y);
      ctx.stroke();
    }

    // Track edges (left + right) — converging toward horizon
    ctx.strokeStyle = 'rgba(60,80,50,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(projectX(-1, 0), projectY(0));
    ctx.lineTo(projectX(-1, 1), projectY(1));
    ctx.moveTo(projectX( 1, 0), projectY(0));
    ctx.lineTo(projectX( 1, 1), projectY(1));
    ctx.stroke();
  }

  function drawObstacles() {
    // Sort far-to-near so near ones draw on top
    const sorted = obstacles.slice().sort((a, b) => b.z - a.z);
    for (const o of sorted) {
      if (o.z > 1.02) continue;
      const z = Math.max(o.z, 0);
      const s = scaleAt(z);
      const cx = projectX(o.worldX, z);
      const cy = projectY(z);
      const w = o.type.wx * TRACK_HALF_PX * s * 2;
      const h = o.type.hPx * s;

      // Shadow on the ground (ellipse)
      ctx.fillStyle = `rgba(0,0,0,${0.28 * (1 - z * 0.4)})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, w * 0.55, h * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Body
      const grad = ctx.createLinearGradient(0, cy - h, 0, cy);
      grad.addColorStop(0, o.type.color);
      grad.addColorStop(1, o.type.dark);
      ctx.fillStyle = grad;
      roundRect(cx - w / 2, cy - h, w, h, Math.max(3, 6 * s));
      ctx.fill();

      // Highlight stripe
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(cx - w / 2 + 3, cy - h + 3, Math.max(2, 4 * s), Math.max(2, h - 8));
    }
  }

  function drawPlayer() {
    const z = 0;
    const cx = projectX(player.worldX, z);
    const cy = projectY(z);
    const h = player.spriteH;
    const w = h * 0.92;
    const px = cx - w / 2;
    const py = cy - h * 0.85;

    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 4, w * 0.45, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (mechReady) {
      let frame = FRAMES.center;
      if (player.vx < -0.6) frame = FRAMES.left;
      else if (player.vx > 0.6) frame = FRAMES.right;
      const [sx, sy, sw, sh] = frame;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mechSheet, sx, sy, sw, sh, px, py, w, h);
    } else {
      ctx.fillStyle = '#7aa6ff';
      roundRect(px, py, w, h, 8);
      ctx.fill();
    }
  }

  function drawSmoke() {
    for (const p of smoke) {
      const a = Math.max(0, p.life / p.max) * 0.55;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grad.addColorStop(0, `rgba(220,230,245,${a})`);
      grad.addColorStop(1, `rgba(160,170,190,0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
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

  function draw() {
    ctx.clearRect(0, 0, VW, VH);
    drawSky();
    drawGround();
    drawObstacles();
    drawSmoke();
    if (running || particles.length === 0) drawPlayer();
    drawParticles();
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
