// Runtime prototype of the 3D table readability design (no repo code changed).
// Load into dev3d.html, then: await P.run({ game, n, name, turn?, ... }).
window.P = {
  A: 1.2, B: 0.85, Y: 0.76,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  slot(a, f) { const r = (a * Math.PI) / 180; return { x: this.A * f * Math.sin(r), z: -this.B * f * Math.cos(r) }; },
  tan(a) { const r = (a * Math.PI) / 180; return { x: -Math.cos(r), z: -Math.sin(r) }; },

  // A1: seat angles (0 = far, 90 = right, 180 = near/you, 270 = left), seat 0 = you.
  angles(game, n, cfg = {}) {
    const out = [180];
    if (game === 'poker') { for (let k = 1; k < n; k++) out.push((180 + (k * 360) / n) % 360); return out; }
    const L = Math.ceil((n - 1) / 2), R = n - 1 - L, half = cfg.bjHalfArc ?? 80;
    const d = Math.min(half / Math.max(L, 1), cfg.bjMaxStep ?? 45);
    for (let j = 1; j <= L; j++) out.push(180 + j * d);
    for (let j = R; j >= 1; j--) out.push(180 - j * d);
    return out;
  },

  hide(o) { Object.defineProperty(o, 'visible', { get: () => false, set: () => {}, configurable: true }); },
  hideAll() {
    const s = window.__bj3d, V = s.camera.position.constructor, wp = new V();
    for (const f of s.figures.values()) this.hide(f.group);
    const hidden = [];
    s.scene.traverse((o) => {
      if (!(o.isMesh || o.isSprite)) return;
      o.getWorldPosition(wp);
      const lamp = Math.abs(wp.x) < 0.05 && Math.abs(wp.z + 0.05) < 0.05 && wp.y > 1.4;
      const cigar = Math.hypot(wp.x + 0.85, wp.z - 0.55) < 0.3 && wp.y > 0.7 && wp.y < 3;
      const glass = Math.hypot(wp.x - 0.78, wp.z - 0.62) < 0.25 && wp.y > 0.7 && wp.y < 3;
      if (lamp || cigar || glass) { this.hide(o); hidden.push((lamp ? 'lamp ' : cigar ? 'cigar ' : 'glass ') + (o.geometry?.type ?? 'sprite')); }
    });
    return hidden;
  },

  // A1: move every card and chip stack to the new layout.
  layout(cfg) {
    const s = window.__bj3d, ang = this.angles(cfg.game, cfg.n, cfg);
    const HF = cfg.hf ?? 0.8, BF = cfg.bf ?? 0.58, STEP = cfg.step ?? 0.125, HAND_GAP = 0.45;
    const groups = {}; // seat -> hand -> [[i, obj]]
    const dealer = [], board = [];
    for (const [k, o] of s.cards) {
      let m;
      if ((m = k.match(/^h:(\d+):(\d+)$/))) ((groups[m[1]] ??= {})[0] ??= []).push([+m[2], o]);
      else if ((m = k.match(/^s(\d+):h(\d+):c(\d+)$/))) ((groups[m[1]] ??= {})[m[2]] ??= []).push([+m[3], o]);
      else if ((m = k.match(/^d:(\d+)$/))) dealer.push([+m[1], o]);
      else if ((m = k.match(/^cc:(\d+)$/))) board.push([+m[1], o]);
    }
    const put = (o, x, z, rotY) => o.placeAt({ x, y: o.group.position.y, z, rotY });
    for (const [seat, hands] of Object.entries(groups)) {
      const a = ang[+seat], c = this.slot(a, HF), t = this.tan(a), facing = (((180 - a) * Math.PI) / 180) * 0.35;
      const hk = Object.keys(hands).map(Number).sort();
      for (const h of hk) {
        const cards = hands[h].sort((p, q) => p[0] - q[0]);
        const handOff = (h - (hk.length - 1) / 2) * HAND_GAP;
        cards.forEach(([i, o]) => { const off = handOff + (i - (cards.length - 1) / 2) * STEP; put(o, c.x + t.x * off, c.z + t.z * off, facing); });
      }
    }
    const d = this.slot(0, cfg.df ?? 0.62);
    dealer.sort((p, q) => p[0] - q[0]).forEach(([i, o]) => put(o, d.x + (i - (dealer.length - 1) / 2) * STEP, d.z, 0));
    board.forEach(([i, o]) => put(o, (i - 2) * (cfg.boardStep ?? 0.19), cfg.boardZ ?? 0, 0));
    const chipPos = {};
    for (const [k, v] of s.chips) {
      let m, p;
      if (k === 'pot') p = { x: 0, z: cfg.potZ ?? -0.25 };
      else if ((m = k.match(/^bet:(\d+)/))) p = this.slot(ang[+m[1]], BF);
      if (p) { v.group.position.set(p.x, v.group.position.y, p.z); chipPos[k] = [+p.x.toFixed(2), +p.z.toFixed(2)]; }
    }
    return { angles: ang, chipPos };
  },

  // A4: big-index faces, drawn straight onto a canvas.
  faceCanvas(card) {
    const W = 256, H = 358, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.beginPath(); c.roundRect(0, 0, W, H, 14); c.clip();
    c.fillStyle = '#e4d5ad'; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,60,20,0.28)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const red = card.suit === 'hearts' || card.suit === 'diamonds';
    const sym = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }[card.suit];
    c.fillStyle = c.strokeStyle = red ? '#a3221b' : '#1b1410';
    c.textAlign = 'center';
    const index = () => {
      c.save();
      if (card.rank === '10') { c.translate(54, 100); c.scale(0.72, 1); c.font = 'bold 100px Georgia, serif'; c.fillText('10', 0, 0); }
      else { c.font = 'bold 104px Georgia, serif'; c.fillText(card.rank, 52, 100); }
      c.restore();
      c.font = '76px "Segoe UI Symbol", serif'; c.fillText(sym, 52, 172);
    };
    index();
    c.save(); c.translate(W, H); c.rotate(Math.PI); index(); c.restore();
    c.textBaseline = 'middle';
    if ('JQK'.includes(card.rank)) {
      c.lineWidth = 3; c.globalAlpha = 0.75; c.strokeRect(W * 0.3, H * 0.3, W * 0.4, H * 0.4);
      c.font = '86px "Segoe UI Symbol", serif'; c.fillText({ J: '♞', Q: '♛', K: '♚' }[card.rank], W / 2, H / 2 + 4); c.globalAlpha = 1;
    } else {
      c.globalAlpha = 0.9; c.font = '150px "Segoe UI Symbol", serif'; c.fillText(sym, W / 2, H * 0.52); c.globalAlpha = 1;
    }
    return cv;
  },
  faces() {
    const s = window.__bj3d; let n = 0;
    for (const o of s.cards.values()) {
      if (!o.card || !o.frontMat.map) continue;
      const t = o.frontMat.map.clone(); t.image = this.faceCanvas(o.card); t.needsUpdate = true;
      o.frontMat.map = t; o.frontMat.needsUpdate = true; n++;
    }
    return n;
  },

  // A5: printed felt.
  felt(cfg) {
    const s = window.__bj3d; let mesh;
    s.scene.traverse((o) => { if (o.isMesh && o.geometry.type === 'ShapeGeometry' && Math.abs(o.position.y - 0.76) < 0.01) mesh = o; });
    const mat = mesh.material, old = mat.__origMap ?? mat.map; mat.__origMap = old;
    const W = 2048, Hh = 1451, ppm = W / 2.4;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const c = cv.getContext('2d');
    const pat = c.createPattern(old.image, 'repeat');
    pat.setTransform(new DOMMatrix().scale((W / 2.4) / old.repeat.x / old.image.width, (Hh / 1.7) / old.repeat.y / old.image.height));
    c.fillStyle = pat; c.fillRect(0, 0, W, Hh);
    const X = (x) => ((x + 1.2) / 2.4) * W, Z = (z) => ((z + 0.85) / 1.7) * Hh;
    const ink = 'rgba(232, 205, 140, 0.5)';
    c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 2.5; c.textAlign = 'center';
    const arcText = (txt, cz, Rm, font, spacing) => {
      const R = Rm * ppm; c.save(); c.font = font;
      const widths = [...txt].map((ch) => c.measureText(ch).width + spacing);
      const total = widths.reduce((a, b) => a + b, 0) - spacing;
      let ang = -total / R / 2; const ccx = X(0), ccy = Z(cz) + R;
      for (let i = 0; i < txt.length; i++) {
        const a = ang + (widths[i] - spacing) / R / 2;
        c.save(); c.translate(ccx + Math.sin(a) * R, ccy - Math.cos(a) * R); c.rotate(a); c.fillText(txt[i], 0, 0); c.restore();
        ang += widths[i] / R;
      }
      c.restore();
    };
    if (cfg.game === 'bj') {
      arcText('BLACKJACK PAYS 3 TO 2', cfg.arc1Z ?? -0.2, cfg.arc1R ?? 1.1, 'bold 46px Georgia, serif', 8);
      arcText('Dealer must stand on 17 and draw to 16', cfg.arc2Z ?? -0.08, cfg.arc2R ?? 1.1, 'italic 30px Georgia, serif', 3);
      for (const [k, v] of s.chips) {
        if (!k.startsWith('bet:')) continue;
        const p = v.group.position; c.beginPath(); c.arc(X(p.x), Z(p.z), 0.09 * ppm, 0, Math.PI * 2); c.stroke();
      }
    } else {
      const f = cfg.lineF ?? 0.68;
      c.beginPath(); c.ellipse(X(0), Z(0), f * 1.2 * ppm, f * 0.85 * (Hh / 1.7), 0, 0, Math.PI * 2); c.stroke();
      const step = cfg.boardStep ?? 0.19, bz = cfg.boardZ ?? 0;
      c.globalAlpha = 0.6; c.lineWidth = 2; c.beginPath();
      c.roundRect(X(-2 * step - 0.1), Z(bz - 0.12), X(2 * step + 0.1) - X(-2 * step - 0.1), Z(bz + 0.12) - Z(bz - 0.12), 28); c.stroke(); c.globalAlpha = 1;
    }
    const t = old.clone(); t.image = cv; t.repeat.set(1 / 2.4, 1 / 1.7); t.offset.set(0.5, 0.5);
    t.wrapS = t.wrapT = 1001; t.needsUpdate = true; mat.map = t; mat.needsUpdate = true;
  },

  // A2: fixed pitch, long lens, framing solved so the table fills the frame with even margins.
  fit(cfg) {
    const s = window.__bj3d, cam = s.camera, V = cam.position.constructor;
    const pitch = ((cfg.pitch ?? 50) * Math.PI) / 180, fov = cfg.fov ?? 35, m = cfg.margin ?? 0.05;
    const c2 = cam.clone(); c2.fov = fov; c2.aspect = s.width / s.height; c2.updateProjectionMatrix();
    const dir = new V(0, -Math.sin(pitch), -Math.cos(pitch));
    const pts = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new V(1.28 * Math.cos(a), 0.79, 0.93 * Math.sin(a)), new V(1.3 * Math.cos(a), 0.6, 0.95 * Math.sin(a)));
    }
    let d = 3, zl = 0, P = null, b = null;
    for (let it = 0; it < 80; it++) {
      const L = new V(0, 0.76, zl); P = L.clone().addScaledVector(dir, -d);
      c2.position.copy(P); c2.up.set(0, 1, 0); c2.lookAt(L); c2.updateMatrixWorld();
      let xmax = 0, ymax = -9, ymin = 9;
      for (const p of pts) { const q = p.clone().project(c2); xmax = Math.max(xmax, Math.abs(q.x)); ymax = Math.max(ymax, q.y); ymin = Math.min(ymin, q.y); }
      b = { xmax, ymax, ymin };
      zl -= ((ymax + ymin) / 2) * d * 0.25;
      d *= Math.max(xmax, (ymax - ymin) / 2) / (1 - m);
    }
    cam.fov = fov; cam.updateProjectionMatrix();
    const pos = P.toArray(), look = [0, 0.76, zl];
    if (!cam.__patched) {
      const base = Object.getPrototypeOf(cam).lookAt;
      cam.lookAt = function () { this.position.set(...window.P.POS); return base.call(this, ...window.P.LOOK); };
      cam.__patched = true;
    }
    this.POS = pos; this.LOOK = look;
    return { pos: pos.map((v) => +v.toFixed(3)), look: look.map((v) => +v.toFixed(3)), fov, bounds: b };
  },

  // A6: turn light pool on a seat (or 'dealer').
  turnLight(cfg) {
    const s = window.__bj3d, who = cfg.turn.seat;
    const keys = [...s.cards.keys()].filter((k) => (who === 'dealer' ? /^d:/.test(k) : new RegExp(`^(h:${who}:|s${who}:)`).test(k)));
    const ps = keys.map((k) => s.cards.get(k).group.position);
    const tx = ps.reduce((a, p) => a + p.x, 0) / ps.length, tz = ps.reduce((a, p) => a + p.z, 0) / ps.length;
    const l = s.room.spot.clone(); l.castShadow = false; l.angle = cfg.turn.angle ?? 0.3; l.penumbra = 0.7;
    l.intensity = s.room.spot.intensity * (cfg.turn.k ?? 2.5);
    l.position.set(tx * 0.85, 2.0, tz * 0.85); l.target.position.set(tx, 0.76, tz);
    s.scene.add(l, l.target);
    return { tx: +tx.toFixed(2), tz: +tz.toFixed(2), I: +l.intensity.toFixed(1) };
  },

  async run(cfg) {
    const s = window.__bj3d, log = {};
    await this.sleep(cfg.wait ?? 4500);
    log.hidden = this.hideAll();
    for (let i = 0; i < 14; i++) s.advance(0.5);
    log.layout = this.layout(cfg);
    log.faces = this.faces();
    if (cfg.felt !== false) this.felt(cfg);
    log.cam = this.fit(cfg);
    if (cfg.turn) log.turn = this.turnLight(cfg);
    s.advance(0.05);
    log.cards = s.debugCards().map((c) => `${c.key} ${c.faceUp ? 'U' : 'D'}${c.landed ? 'L' : 'x'} ${c.pos.map((v) => +v.toFixed(2)).join(',')}`);
    if (cfg.name) {
      const r = await fetch('http://127.0.0.1:3199/save?name=' + cfg.name, { method: 'POST', body: s.renderer.domElement.toDataURL('image/png') });
      log.save = r.status + ' ' + (await r.text()).slice(0, 60);
    }
    return JSON.stringify(log);
  },
};
