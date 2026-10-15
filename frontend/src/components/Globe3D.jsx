import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ACCENT, DRIVER, SOURCES } from '../core/constants.js';
import { EARTH_TEX, BOUND_TEX } from '../core/data.js';
import { loadTileRect, ESRI_SAT, mercatorPatchToEquirect, getSatWorld, loadWorldTiles, mercatorToEquirect } from '../core/tiles.js';
import { fetchWind, windAt, windColor } from '../core/wind.js';
import { latLonToV3, clearGroup3, addGlow, addGraticule } from '../core/three3d.js';
import { toast } from '../core/live.js';

// ---- Wind on the 3D globe: the same GFS data and colours as the 2D wind layer (Western disturbances 500 hPa,
// Jet stream 250 hPa). Two layers: the whole world, plus a sharper patch over the western-disturbance corridor
// (Mediterranean -> Pakistan) for when the globe is focused on Pakistan. Textures run longitude/latitude left-right/top-bottom.
const WIND3_LAYERS = [
  { key: 'world', w: 1024, h: 512, lon0: -180, lon1: 180, lat0: -90, lat1: 90, parts: 3500, radius: 1.0045, line: 1.1 },
  { key: 'region', w: 1536, h: 768, lon0: 30, lon1: 90, lat0: 15, lat1: 45, parts: 2200, radius: 1.0055, line: 1.3 }];
const W3R = WIND3_LAYERS[1];
const inW3 = (L, lat, lon) => lat >= L.lat0 && lat <= L.lat1 && lon >= L.lon0 && lon <= L.lon1;
const liveTexCache = {};

// The 3D globe: satellite earth, the selected driver's region with arcs to Pakistan, its NASA layer or animated wind.
// preview = driver hovered in the bottom bar (shown until the pointer leaves), else the active one.
export default function Globe3D({ on, active, preview }) {
  const host = useRef(null), wrap = useRef(null), T = useRef(null), onRef = useRef(on), shownKey = useRef(null);
  const [nav, setNav] = useState({ pak: false, spin: true });
  onRef.current = on;

  function navState() { const t3 = T.current; if (t3) setNav({ pak: !!t3.pakFocus, spin: t3.spin !== false }); }

  function addLabel3(v3, text, hub) { const t3 = T.current, el = document.createElement('div'); el.className = 'lbl3d' + (hub ? ' hub' : ''); el.textContent = text; wrap.current.appendChild(el); t3.labels.push({ el, v: v3.clone() }); }
  function buildDriver3(key) {
    const t3 = T.current; if (!t3) return;
    clearGroup3(t3.markers); t3.labels.forEach(l => l.el.remove()); t3.labels.length = 0; t3.hubGlow = null;
    const d = DRIVER[key]; if (!d) return;
    const col = new THREE.Color(d.color);
    const hub = latLonToV3(30.3, 69.3, 1.012);
    const hubM = new THREE.Mesh(new THREE.SphereGeometry(.024, 16, 16), new THREE.MeshBasicMaterial({ color: 0x4ee59b })); hubM.position.copy(hub); t3.markers.add(hubM);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.034, .042, 32), new THREE.MeshBasicMaterial({ color: 0x4ee59b, transparent: true, opacity: .7, side: THREE.DoubleSide })); ring.position.copy(hub); ring.lookAt(0, 0, 0); t3.markers.add(ring);
    t3.hubGlow = addGlow(t3.markers, hub, .18, 0x4ee59b, .8);
    addLabel3(hub, 'Pakistan signal hub', true);
    d.points.forEach((p, i) => {
      const v = latLonToV3(p[0], p[1], 1.008);
      const m = new THREE.Mesh(new THREE.SphereGeometry(.016, 12, 12), new THREE.MeshBasicMaterial({ color: col })); m.position.copy(v); t3.markers.add(m);
      addGlow(t3.markers, v, .11, col.getHex(), .7);
      const mid = hub.clone().add(v).multiplyScalar(.5).normalize().multiplyScalar(1.09 + hub.distanceTo(v) * .32);
      const curve = new THREE.QuadraticBezierCurve3(hub.clone().multiplyScalar(1.006), mid, v.clone().multiplyScalar(1.006));
      const acol = col.clone().lerp(new THREE.Color(0xffffff), .35);
      t3.markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(56)), new THREE.LineBasicMaterial({ color: acol, transparent: true, opacity: .7, blending: THREE.AdditiveBlending, depthWrite: false })));
      if (i < 4) addLabel3(v, d.popup, false);
    });
  }
  function updateLabels3d() {
    const t3 = T.current, w = innerWidth, h = innerHeight;
    t3.labels.forEach(l => {
      const wp = t3.earth.localToWorld(l.v.clone());
      const vis = wp.clone().normalize().dot(t3.cam.position.clone().normalize()) > .12;
      if (!vis) { l.el.style.display = 'none'; return; }
      const pr = wp.project(t3.cam);
      l.el.style.display = 'block';
      l.el.style.left = ((pr.x * .5 + .5) * w) + 'px';
      l.el.style.top = ((-pr.y * .5 + .5) * h) + 'px';
    });
  }
  // High-resolution satellite base: global Esri imagery at zoom 4, plus a zoom-7 patch over Pakistan.
  function loadSatBase3(rd, baseMat) {
    const aniso = rd.capabilities.getMaxAnisotropy();
    getSatWorld().then(ec => {
      const tex = new THREE.CanvasTexture(ec); tex.anisotropy = aniso;
      baseMat.map = tex; baseMat.color.set(0xffffff); baseMat.needsUpdate = true;
    });
    const R = { lonW: 50, lonE: 90, latS: 15, latN: 45, z: 7 };
    const n = Math.pow(2, R.z), tx = lon => Math.floor((lon + 180) / 360 * n), ty = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2 * n); };
    const x0 = tx(R.lonW), x1 = tx(R.lonE), y0 = ty(R.latN), y1 = ty(R.latS);
    loadTileRect(ESRI_SAT, R.z, x0, x1, y0, y1).then(c => mercatorPatchToEquirect(c, R.z, x0, y0, R.lonW, R.lonE, R.latS, R.latN, Math.min(4096, Math.round((R.lonE - R.lonW) / 360 * n * 256)))).then(ec => {
      const tex = new THREE.CanvasTexture(ec); tex.anisotropy = aniso;
      const D = Math.PI / 180;
      const patch = new THREE.Mesh(new THREE.SphereGeometry(1.0012, 96, 96, (R.lonW + 180) * D, (R.lonE - R.lonW) * D, (90 - R.latN) * D, (R.latN - R.latS) * D), new THREE.MeshBasicMaterial({ map: tex }));
      T.current.earth.add(patch);
    });
  }

  function makeWind3Layer(cfg) {
    const mk = () => { const c = document.createElement('canvas'); c.width = cfg.w; c.height = cfg.h; return c; }, D = Math.PI / 180;
    const field = mk(), trails = mk(), comp = mk(), tex = new THREE.CanvasTexture(comp);
    const geo = cfg.key === 'world' ? new THREE.SphereGeometry(cfg.radius, 96, 96)
      : new THREE.SphereGeometry(cfg.radius, 64, 48, (cfg.lon0 + 180) * D, (cfg.lon1 - cfg.lon0) * D, (90 - cfg.lat1) * D, (cfg.lat1 - cfg.lat0) * D);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.visible = false; T.current.earth.add(mesh);
    return { ...cfg, field, trails, comp, tex, mesh, list: [] };
  }
  function spawn3(p, L) {
    if (L.key === 'world') { do { p.lon = Math.random() * 360 - 180; p.lat = Math.asin(Math.random() * 2 - 1) * 180 / Math.PI; } while (inW3(W3R, p.lat, p.lon)); } // the patch covers its own area
    else { p.lon = L.lon0 + Math.random() * (L.lon1 - L.lon0); p.lat = L.lat0 + Math.random() * (L.lat1 - L.lat0); }
    p.age = Math.random() * 80 | 0; return p;
  }
  function buildWind3(level) {
    const t3 = T.current; if (!t3) return;
    if (!t3.wind) t3.wind = { layers: WIND3_LAYERS.map(makeWind3Layer), level: null, frame: 0 };
    const W = t3.wind; W.level = level; W.layers.forEach(L => { L.list = []; L.mesh.visible = false; });
    fetchWind().then(() => {
      if (W.level !== level) return;
      W.layers.forEach(L => {
        // speed colours: one sample per 4x4 block on a small canvas, smoothed up to full size
        const sw = L.w / 4, sh = L.h / 4, small = document.createElement('canvas'); small.width = sw; small.height = sh;
        const sc = small.getContext('2d'), img = sc.createImageData(sw, sh), px = img.data;
        for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
          const lat = L.lat1 - (j + .5) / sh * (L.lat1 - L.lat0), lon = L.lon0 + (i + .5) / sw * (L.lon1 - L.lon0);
          if (L.key === 'world' && inW3(W3R, lat, lon)) continue; // the detailed patch colours its own area (no doubled tint)
          const w = windAt(lat, lon, level); if (!w) continue;
          const c = windColor(Math.hypot(w[0], w[1]), level), o = (j * sw + i) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 150;
        }
        sc.putImageData(img, 0, 0);
        const fc = L.field.getContext('2d'); fc.clearRect(0, 0, L.w, L.h); fc.imageSmoothingEnabled = true; fc.drawImage(small, 0, 0, L.w, L.h);
        L.trails.getContext('2d').clearRect(0, 0, L.w, L.h);
        for (let n = 0; n < L.parts; n++) L.list.push(spawn3({}, L));
        L.mesh.visible = true;
      });
    }).catch(() => { if (W.level === level) toast('Wind data unavailable right now - try again later'); });
  }
  function stopWind3() { const t3 = T.current; if (t3 && t3.wind) { t3.wind.level = null; t3.wind.layers.forEach(L => { L.list = []; L.mesh.visible = false; }); } }
  function windFrame3() {
    const W = T.current.wind; if (!W || !W.level) return;
    const k = W.level === 250 ? .0045 : .007;
    W.layers.forEach(L => {
      if (!L.list.length) return;
      const tc = L.trails.getContext('2d'), X = lon => (lon - L.lon0) / (L.lon1 - L.lon0) * L.w, Y = lat => (L.lat1 - lat) / (L.lat1 - L.lat0) * L.h;
      tc.globalCompositeOperation = 'destination-in'; tc.fillStyle = 'rgba(0,0,0,.93)'; tc.fillRect(0, 0, L.w, L.h);
      tc.globalCompositeOperation = 'source-over'; tc.strokeStyle = 'rgba(255,255,255,.9)'; tc.lineWidth = L.line; tc.beginPath();
      L.list.forEach(p => {
        const w = windAt(p.lat, p.lon, W.level);
        if (!w || ++p.age > 100 || Math.abs(p.lat) > 84) { spawn3(p, L); p.age = 0; return; }
        let lon = p.lon + w[0] * k / Math.max(.2, Math.cos(p.lat * Math.PI / 180)), lat = p.lat + w[1] * k;
        if (L.key === 'world') { if (lon > 180) lon -= 360; if (lon < -180) lon += 360; if (inW3(W3R, lat, lon)) { spawn3(p, L); p.age = 0; return; } }
        else if (!inW3(L, lat, lon)) { spawn3(p, L); p.age = 0; return; }
        if (Math.abs(lon - p.lon) < 180) { tc.moveTo(X(p.lon), Y(p.lat)); tc.lineTo(X(lon), Y(lat)); }
        p.lon = lon; p.lat = lat;
      });
      tc.stroke();
    });
    const L = W.layers[++W.frame % 2]; // upload one layer's texture per frame, alternating
    const cc = L.comp.getContext('2d'); cc.clearRect(0, 0, L.w, L.h); cc.drawImage(L.field, 0, 0); cc.drawImage(L.trails, 0, 0);
    L.tex.needsUpdate = true;
  }

  // ---- Focus the globe on Pakistan (button, and automatically for the wind tabs) ----
  function focusPakistan() {
    const t3 = T.current; if (!t3) return;
    // find the globe rotation (same Euler order as the globe) that turns Pakistan to face the camera
    const v = latLonToV3(30.5, 70, 1), e = new THREE.Euler(0, 0, 0, 'YXZ'), w = new THREE.Vector3(); let best = { z: -2 };
    for (let rx = -1.1; rx <= 1.1; rx += .01) for (let ry = -Math.PI; ry < Math.PI; ry += .01) { e.set(rx, ry, 0, 'YXZ'); w.copy(v).applyEuler(e); if (w.z > best.z) best = { z: w.z, rx, ry }; }
    t3.focus = { rx: best.rx, ry: best.ry, zoom: 1.75 }; t3.spin = false; t3.pakFocus = true; navState();
  }
  function whole() { const t3 = T.current; if (!t3) return; t3.focus = { zoom: 3.1 }; t3.spin = true; t3.pakFocus = false; navState(); }
  function toggleSpin() { const t3 = T.current; if (!t3) return; t3.spin = !t3.spin; if (t3.spin) t3.focus = t3.focus && t3.focus.zoom ? { zoom: t3.focus.zoom } : null; navState(); }
  function globeStep() { // called every frame: ease toward the focus target
    const t3 = T.current, now = performance.now(), dt = Math.min(.25, (now - (t3.lastStep || now)) / 1000); t3.lastStep = now;
    const f = t3.focus; if (!f) return; const E = t3.earth, a = 1 - Math.exp(-dt * 4); // time-based easing: ~1 s on any machine
    if (f.rx != null) { E.rotation.x += (f.rx - E.rotation.x) * a; let d = f.ry - E.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); E.rotation.y += d * a; }
    if (f.zoom) t3.cam.position.z += (f.zoom - t3.cam.position.z) * a;
    if (Math.abs(t3.cam.position.z - (f.zoom || t3.cam.position.z)) < .002 && (f.rx == null || (Math.abs(f.rx - E.rotation.x) < .002 && Math.abs(Math.atan2(Math.sin(f.ry - E.rotation.y), Math.cos(f.ry - E.rotation.y))) < .002))) t3.focus = null; // arrived
  }

  function buildLive3(key) {
    const t3 = T.current; if (!t3) return;
    const s = SOURCES[key];
    if (s && s.wind) { if (t3.overlay) t3.overlay.visible = false; t3.liveKey = key; buildWind3(s.wind); focusPakistan(); return; }
    stopWind3();
    if (!s || !s.gibs) { if (t3.overlay) t3.overlay.visible = false; return; }
    t3.liveKey = key;
    const [id, ext, lvl] = s.gibs;
    const apply = tex => {
      if (t3.liveKey !== key) return;
      if (!t3.overlay) {
        t3.overlay = new THREE.Mesh(new THREE.SphereGeometry(1.003, 64, 64), new THREE.MeshBasicMaterial({ transparent: true, opacity: .75, depthWrite: false }));
        t3.earth.add(t3.overlay);
      }
      t3.overlay.material.map = tex; t3.overlay.material.needsUpdate = true; t3.overlay.visible = true;
    };
    if (liveTexCache[id]) { apply(liveTexCache[id]); return; }
    // Not downloaded yet: hide the previous tab's image at once (it would be the wrong data) and say it's loading.
    if (t3.overlay) t3.overlay.visible = false;
    toast('Loading NASA layer: ' + s.label + '…');
    t3.loadingIds = t3.loadingIds || new Set();
    if (t3.loadingIds.has(id)) return; // already downloading; it is applied on arrival if this tab is still selected
    t3.loadingIds.add(id);
    loadWorldTiles(id, ext, 3, lvl).then(mercatorToEquirect).then(ec => {
      liveTexCache[id] = new THREE.CanvasTexture(ec);
      const cur = t3.liveKey && SOURCES[t3.liveKey]; // the tab selected now (may be another tab that shares this layer)
      if (onRef.current && cur && cur.gibs && cur.gibs[0] === id) buildLive3(t3.liveKey);
    }).catch(() => { toast('NASA layer unavailable right now - try again shortly'); }).finally(() => t3.loadingIds.delete(id));
  }

  function tint(key) {
    const t3 = T.current, c = (DRIVER[key] || {}).color || ACCENT, windTab = !!(SOURCES[key] && SOURCES[key].wind);
    // wind tabs (Western disturbances, Jet stream): no coloured halo around the globe, so the wind itself stands out
    host.current.style.setProperty('--glow', windTab ? '#0b1a2e' : c);
    if (t3) { t3.tint = new THREE.Color(c); t3.atmo.forEach(m => m.visible = !windTab); }
  }

  function init3D() {
    const el = host.current;
    el.style.touchAction = 'none';
    const s = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 100); cam.position.set(0, 0, 3.1);
    const rd = new THREE.WebGLRenderer({ antialias: true, alpha: true }); rd.setPixelRatio(Math.min(devicePixelRatio, 2)); rd.setSize(innerWidth, innerHeight); rd.setClearColor(0x000000, 0); el.appendChild(rd.domElement); // transparent: the tinted space background shows through
    const sg = new THREE.BufferGeometry(), sp = [];
    for (let i = 0; i < 900; i++) { const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(14 + Math.random() * 26); sp.push(v.x, v.y, v.z); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    s.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe4ff, size: .14, transparent: true, opacity: .85 })));
    const earth = new THREE.Group(); earth.rotation.order = 'YXZ';
    const hub0 = latLonToV3(30.3, 69.3, 1);
    earth.rotation.y = Math.atan2(-hub0.x, hub0.z); earth.rotation.x = 0; s.add(earth);
    let mat;
    if (EARTH_TEX) { const tex = new THREE.TextureLoader().load(EARTH_TEX); tex.anisotropy = rd.capabilities.getMaxAnisotropy(); mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff }); }
    else mat = new THREE.MeshBasicMaterial({ color: 0x0f4a63 });
    earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), mat));
    const atmo = [new THREE.Mesh(new THREE.SphereGeometry(1.05, 48, 48), new THREE.MeshBasicMaterial({ color: 0x3ac0ff, transparent: true, opacity: .34, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })),
      new THREE.Mesh(new THREE.SphereGeometry(1.16, 48, 48), new THREE.MeshBasicMaterial({ color: 0x1e7fd0, transparent: true, opacity: .2, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }))];
    atmo.forEach(m => earth.add(m));
    addGraticule(earth, 1.004, 0x49cce9, .15);
    const markers = new THREE.Group(); earth.add(markers);
    if (BOUND_TEX) {
      const bi = new Image();
      bi.onload = () => {
        const c = document.createElement('canvas'); c.width = bi.width; c.height = bi.height;
        const x = c.getContext('2d'); x.drawImage(bi, 0, 0);
        const id = x.getImageData(0, 0, c.width, c.height), dd = id.data;
        // The source image fills land with grey (170) and draws borders dark; keep only borders + coastlines as cyan lines.
        const W = c.width, H = c.height, src = new Uint8ClampedArray(dd);
        for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
          const i = (y * W + xx) * 4; let a = 0;
          if (src[i + 3] > 0) {
            a = Math.max(0, Math.min(255, (165 - src[i]) * 1.6));
            if (!a) { const nb = [xx > 0 ? i - 4 : i, xx < W - 1 ? i + 4 : i, y > 0 ? i - W * 4 : i, y < H - 1 ? i + W * 4 : i]; for (const j of nb) if (src[j + 3] === 0) { a = 255; break; } }
          }
          dd[i] = 110; dd[i + 1] = 230; dd[i + 2] = 255; dd[i + 3] = a;
        }
        x.putImageData(id, 0, 0);
        earth.add(new THREE.Mesh(new THREE.SphereGeometry(1.0035, 64, 64), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .9 })));
      };
      bi.src = BOUND_TEX;
    }
    const t3 = T.current = { s, cam, rd, earth, markers, atmo, tint: new THREE.Color(0x3ac0ff), labels: [], drag: false };
    loadSatBase3(rd, mat);
    let drag3 = null;
    el.addEventListener('pointerdown', e => { t3.drag = true; t3.focus = null; t3.spin = false; t3.pakFocus = false; navState(); drag3 = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { if (!t3.drag || !drag3) return; earth.rotation.y += (e.clientX - drag3.x) * .005; earth.rotation.x = Math.max(-1.1, Math.min(1.1, earth.rotation.x + (e.clientY - drag3.y) * .004)); drag3 = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', () => { t3.drag = false; drag3 = null; });
    el.addEventListener('pointercancel', () => { t3.drag = false; drag3 = null; });
    el.addEventListener('wheel', e => { e.preventDefault(); if (t3.focus) t3.focus.zoom = null; cam.position.z = Math.max(1.5, Math.min(6, cam.position.z + e.deltaY * .0022)); }, { passive: false });
    (function animate() {
      t3.raf = requestAnimationFrame(animate);
      if (!onRef.current) return;
      globeStep(); if (!t3.drag && t3.spin !== false) earth.rotation.y += .0016;
      atmo.forEach(m => m.material.color.lerp(t3.tint, .07));
      windFrame3();
      if (t3.hubGlow) t3.hubGlow.material.opacity = .55 + .35 * Math.sin(performance.now() * .004);
      updateLabels3d(); rd.render(s, cam);
    })();
  }

  // entering 3D: build once, then show the selected driver
  useEffect(() => {
    if (!on) return;
    const t3 = T.current;
    if (!t3) init3D();
    else { t3.cam.aspect = innerWidth / innerHeight; t3.cam.updateProjectionMatrix(); t3.rd.setSize(innerWidth, innerHeight); }
    buildDriver3(active); shownKey.current = active; tint(active);
    buildLive3(active);
  }, [on]);
  // a new driver picked while in 3D
  useEffect(() => { if (on && T.current) { buildDriver3(active); buildLive3(active); } }, [active]);
  // hover preview from the bottom bar
  useEffect(() => {
    if (!on || !T.current) return;
    const k = preview || active; if (k === shownKey.current) return; shownKey.current = k;
    tint(k); buildDriver3(k);
  }, [preview]);
  useEffect(() => {
    const resize = () => { const t3 = T.current; if (!t3) return; t3.cam.aspect = innerWidth / innerHeight; t3.cam.updateProjectionMatrix(); t3.rd.setSize(innerWidth, innerHeight); };
    addEventListener('resize', resize);
    return () => { removeEventListener('resize', resize); const t3 = T.current; if (t3) { cancelAnimationFrame(t3.raf); t3.rd.dispose(); } };
  }, []);

  return (
    <>
      <div id="globe3d" ref={host}></div>
      <div id="globeNav" aria-label="Globe view">
        <button type="button" className={nav.pak ? 'on' : ''} onClick={focusPakistan}>🎯 Focus Pakistan</button>
        <button type="button" className={nav.spin ? 'on' : ''} onClick={toggleSpin}>⟳ Rotate</button>
        <button type="button" onClick={whole}>🌍 Whole globe</button>
      </div>
      <div id="label3dWrap" ref={wrap}></div>
    </>
  );
}
