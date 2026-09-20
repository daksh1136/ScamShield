/* ScamShield globe — a black 3D sphere wrapped in red lines.
   Pure Canvas 2D (no libraries). Drag to spin; it also sways with the cursor.
   Public API:  ScamGlobe.setThreat(0..1)   ScamGlobe.setScanning(true|false)  */
(() => {
  'use strict';

  const canvas = document.getElementById('globe');
  if (!canvas || !canvas.getContext) {
    window.ScamGlobe = { setThreat() {}, setScanning() {} };
    return;
  }

  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- sizing ---------- */
  let W = 0, H = 0, CX = 0, CY = 0, R = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; CX = W / 2; CY = H / 2;
    R = Math.min(W, H) * 0.38;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  resize();

  /* ---------- geometry ---------- */
  const vec = (lat, lon) => {
    const c = Math.cos(lat);
    return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
  };
  const randVec = () => vec(Math.asin(Math.random() * 2 - 1), Math.random() * TAU);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const LINES = [];
  for (let d = -80; d <= 80; d += 20) {           // latitude rings
    const line = [];
    for (let i = 0; i <= 72; i++) line.push(vec(d * D2R, (i / 72) * TAU));
    LINES.push(line);
  }
  for (let d = 0; d < 360; d += 20) {             // meridians
    const line = [];
    for (let i = 0; i <= 48; i++) line.push(vec(-Math.PI / 2 + (i / 48) * Math.PI, d * D2R));
    LINES.push(line);
  }

  /* danger routes: arcs that lift off the surface between two hotspots */
  const ARC_N = 48;
  function makeArc() {
    let a, b, w;
    do {
      a = randVec(); b = randVec();
      w = Math.acos(clamp(dot(a, b), -1, 1));
    } while (w < 0.7 || w > 2.6);
    const s = Math.sin(w), pts = [];
    for (let i = 0; i <= ARC_N; i++) {
      const t = i / ARC_N;
      const ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
      const lift = 1 + (0.06 + 0.22 * w / Math.PI) * Math.sin(Math.PI * t);
      pts.push([
        (a[0] * ka + b[0] * kb) * lift,
        (a[1] * ka + b[1] * kb) * lift,
        (a[2] * ka + b[2] * kb) * lift
      ]);
    }
    return { pts, a, b, off: Math.random() * 1.5, sp: 0.7 + Math.random() * 0.6 };
  }
  const arcs = Array.from({ length: 10 }, makeArc);

  /* ---------- state ---------- */
  let ry = 0.5, rx = 0.32;                 // yaw / pitch
  let swayX = 0, swayY = 0, tSwayX = 0, tSwayY = 0;
  let boost = 0, dragging = false, lastX = 0, lastY = 0;
  let threat = 0.35, threatShown = 0.35, scanning = false;
  let time = 0;

  /* ---------- 3D helpers (shared scratch vars = no per-point allocation) ---------- */
  const T = { x: 0, y: 0, z: 0 };
  let PX = 0, PY = 0, cYaw = 1, sYaw = 0, cPit = 1, sPit = 0;

  function setRot() {
    const yaw = ry + swayY, pit = rx + swayX;
    cYaw = Math.cos(yaw); sYaw = Math.sin(yaw);
    cPit = Math.cos(pit); sPit = Math.sin(pit);
  }
  function rot(v) {
    const x1 = v[0] * cYaw + v[2] * sYaw;
    const z1 = -v[0] * sYaw + v[2] * cYaw;
    T.x = x1;
    T.y = v[1] * cPit - z1 * sPit;
    T.z = v[1] * sPit + z1 * cPit;
  }
  function project() {
    const f = 1 + T.z * 0.04;
    PX = CX + T.x * R * f;
    PY = CY - T.y * R * f;
  }
  const visible = () => T.z > 0 || T.x * T.x + T.y * T.y > 1;   // not hidden behind the sphere

  /* ---------- drawing pieces ---------- */
  function gridPass(front) {
    ctx.beginPath();
    for (const line of LINES) {
      let pen = false;
      for (const p of line) {
        rot(p);
        if (front ? T.z > 0 : T.z <= 0) {
          project();
          if (pen) ctx.lineTo(PX, PY); else { ctx.moveTo(PX, PY); pen = true; }
        } else pen = false;
      }
    }
    ctx.stroke();
  }

  function frontPoly(line) {
    ctx.beginPath();
    let pen = false;
    for (const p of line) {
      rot(p);
      if (T.z > 0) {
        project();
        if (pen) ctx.lineTo(PX, PY); else { ctx.moveTo(PX, PY); pen = true; }
      } else pen = false;
    }
    ctx.stroke();
  }

  function arcPath(pts, i0, i1) {
    ctx.beginPath();
    let pen = false;
    for (let i = i0; i <= i1; i++) {
      rot(pts[i]);
      if (visible()) {
        project();
        if (pen) ctx.lineTo(PX, PY); else { ctx.moveTo(PX, PY); pen = true; }
      } else pen = false;
    }
    ctx.stroke();
  }

  function drawNode(v, off) {
    rot(v);
    if (T.z < 0.03) return;
    project();
    const f = 0.55 + 0.45 * T.z;
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ff4a4a';
    ctx.beginPath(); ctx.arc(PX, PY, 2.6 * f, 0, TAU); ctx.fill();
    const ph = (time * 0.55 + off) % 1, rad = (4 + ph * 18) * f;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,74,74,${(1 - ph) * 0.65})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(PX, PY, rad, Math.max(1, rad * T.z), Math.atan2(PY - CY, PX - CX) + Math.PI / 2, 0, TAU);
    ctx.stroke();
  }

  function draw() {
    const t = threatShown;
    ctx.clearRect(0, 0, W, H);
    setRot();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /* red halo */
    let g = ctx.createRadialGradient(CX, CY, R * 0.92, CX, CY, Math.min(W, H) / 2);
    g.addColorStop(0, `rgba(255,40,40,${0.2 + 0.25 * t})`);
    g.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* far-side lines (seen faintly through the glossy shell) */
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,60,60,0.12)';
    gridPass(false);

    /* black sphere body */
    g = ctx.createRadialGradient(CX - R * 0.35, CY - R * 0.4, R * 0.05, CX, CY, R);
    g.addColorStop(0, '#2b2b31');
    g.addColorStop(0.45, '#0f0f12');
    g.addColorStop(1, '#000');
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    /* near-side red grid */
    ctx.strokeStyle = `rgba(255,48,48,${0.5 + 0.25 * t})`;
    gridPass(true);

    /* darken toward the limb so the sphere reads as round */
    g = ctx.createRadialGradient(CX, CY, R * 0.55, CX, CY, R);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.fill();

    /* scanning ring */
    if (scanning) {
      const lat = Math.sin(time * 1.7) * 72 * D2R, ring = [];
      for (let i = 0; i <= 72; i++) ring.push(vec(lat, (i / 72) * TAU));
      ctx.shadowColor = 'rgba(255,60,60,1)';
      ctx.shadowBlur = 14;
      ctx.strokeStyle = 'rgba(255,110,110,0.95)';
      ctx.lineWidth = 2;
      frontPoly(ring);
      ctx.shadowBlur = 0;
    }

    /* danger arcs + hotspots */
    const active = 4 + Math.round(t * 6);
    ctx.shadowColor = 'rgba(255,40,40,0.9)';
    for (let i = 0; i < active; i++) {
      const ar = arcs[i];
      ctx.shadowBlur = 8;
      ctx.strokeStyle = 'rgba(255,70,70,0.30)';
      ctx.lineWidth = 1.2;
      arcPath(ar.pts, 0, ARC_N);

      const hp = (time * 0.30 * ar.sp + ar.off) % 1.6;
      if (hp <= 1.15) {
        const head = Math.min(hp, 1) * ARC_N;
        for (let j = 0; j < 6; j++) {
          const a = head - 14 + j * 2.4, b = a + 2.6;
          const i0 = Math.max(0, Math.floor(a)), i1 = Math.min(ARC_N, Math.ceil(b));
          if (i1 <= i0) continue;
          ctx.strokeStyle = `rgba(255,${90 + j * 20},${90 + j * 20},${0.15 + j * 0.16})`;
          ctx.lineWidth = 1.4 + j * 0.35;
          arcPath(ar.pts, i0, i1);
        }
        rot(ar.pts[Math.min(ARC_N, Math.round(head))]);
        if (visible()) {
          project();
          ctx.shadowBlur = 16;
          ctx.fillStyle = '#ffd0d0';
          ctx.beginPath(); ctx.arc(PX, PY, 2.6, 0, TAU); ctx.fill();
        }
      }
      drawNode(ar.a, ar.off);
      drawNode(ar.b, ar.off + 0.5);
    }
    ctx.shadowBlur = 0;

    /* glossy highlight */
    g = ctx.createRadialGradient(CX - R * 0.4, CY - R * 0.45, 0, CX - R * 0.4, CY - R * 0.45, R * 0.7);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.fill();

    /* red rim light */
    ctx.shadowColor = 'rgba(255,50,50,0.9)';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(255,70,70,${0.35 + 0.4 * t})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /* ---------- update + loop ---------- */
  function update(dt) {
    const target = scanning ? Math.max(threat, 0.75) : threat;
    threatShown += (target - threatShown) * Math.min(1, dt * 2.5);
    swayX += (tSwayX - swayX) * Math.min(1, dt * 3);
    swayY += (tSwayY - swayY) * Math.min(1, dt * 3);

    if (!dragging) boost *= Math.pow(0.02, dt);
    const speed = reduce || dragging ? 0 : 0.22 * (1 + threatShown * 1.6) * (scanning ? 3 : 1);
    ry += (speed + (dragging ? 0 : boost)) * dt;
    if (!reduce) time += dt;
  }

  let last = 0, looping = false, inView = true;
  function loop(now) {
    if (!inView || document.hidden) { looping = false; return; }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  function start() {
    if (looping) return;
    looping = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { inView = es[0].isIntersecting; if (inView) start(); }).observe(canvas);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });

  /* ---------- interaction ---------- */
  canvas.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    ry += dx * 0.008;
    rx = clamp(rx + dy * 0.005, 0, 0.8);
    boost = clamp(dx * 0.45, -4, 4);
  });
  const endDrag = () => { dragging = false; canvas.classList.remove('drag'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('pointermove', e => {
    if (dragging) return;
    tSwayY = (e.clientX / window.innerWidth - 0.5) * 0.5;
    tSwayX = (e.clientY / window.innerHeight - 0.5) * 0.22;
  }, { passive: true });

  window.ScamGlobe = {
    setThreat(v) { threat = clamp(Number(v) || 0, 0, 1); },
    setScanning(on) { scanning = !!on; }
  };

  start();
})();