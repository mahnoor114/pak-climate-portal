import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import Chart from 'chart.js/auto';
import { DRIVER, SOURCES, DESCRIPTIONS } from '../core/constants.js';
import { CLIMATE_DATA, EARTH_TEX } from '../core/data.js';
import { PHASE } from '../core/scores.js';
import { fetchWind, jetSeries } from '../core/wind.js';
import { getSatWorld } from '../core/tiles.js';
import { latLonToV3, clearGroup3, addGlow, addGraticule } from '../core/three3d.js';

const S = 380; // globe size, px
const fmt = (v, u) => (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)) + (u ? ' ' + u : '');
const hexRgb = h => { h = h.replace('#', ''); return parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16); };
// The chart series of a driver: lib/indices.js (NOAA / NASA / Rutgers, from update_data.py) or the daily GFS winds for the jet
const seriesOf = key => key === 'jet' ? jetSeries() : (CLIMATE_DATA && CLIMATE_DATA.series[key]);

// The three KPI tiles above the chart
function kpis(key, s) {
  const k = { latest: '–', latestS: '', changeK: 'Change', change: '–', changeS: '', through: '–', source: '' };
  if (!s || !s.values || !s.values.length) return k;
  const vals = s.values, n = vals.length, last = vals[n - 1], prev = vals[n - 2];
  if (s.xIsLon) {
    const mx = Math.max(...vals);
    Object.assign(k, { latest: fmt(mx, 'm/s'), latestS: 'Jet core near ' + s.labels[vals.indexOf(mx)], changeK: 'Average', change: fmt(vals.reduce((a, b) => a + b, 0) / n, 'm/s'), changeS: 'mean along 30–35°N' });
  } else {
    Object.assign(k, { latest: fmt(last, s.unit), latestS: PHASE[key] ? PHASE[key](last) : s.labels[n - 1] });
    if (prev !== undefined) { const dl = last - prev; Object.assign(k, { change: (dl >= 0 ? '▲ ' : '▼ ') + fmt(Math.abs(dl), ''), changeS: 'vs ' + s.labels[n - 2] }); }
  }
  return Object.assign(k, { through: s.through || s.labels[n - 1], source: s.source });
}

// Driver analysis card: rotating satellite globe with arcs from the driver's region to Pakistan, KPIs and the data chart.
export default function DriverCard({ driverKey, onClose }) {
  const open = !!driverKey, d = open ? DRIVER[driverKey] : null;
  const globeEl = useRef(null), lblEl = useRef(null), cv = useRef(null), mg = useRef(null);
  const [, setWindTick] = useState(0); // re-render when the jet's wind data arrives
  const [windErr, setWindErr] = useState(null);

  function initMiniGlobe() {
    const host = globeEl.current;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(36, 1, .1, 50); cam.position.set(0, 0, 3.6);
    const rd = new THREE.WebGLRenderer({ antialias: true, alpha: true }); rd.setPixelRatio(Math.min(devicePixelRatio, 2)); rd.setSize(S, S); rd.setClearColor(0x000000, 0);
    host.insertBefore(rd.domElement, host.firstChild);
    const tilt = new THREE.Group(), spin = new THREE.Group(); tilt.add(spin); scene.add(tilt);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9cc2ff });
    if (EARTH_TEX) mat.map = new THREE.TextureLoader().load(EARTH_TEX);
    spin.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), mat));
    getSatWorld().then(ec => { const t = new THREE.CanvasTexture(ec); t.anisotropy = rd.capabilities.getMaxAnisotropy(); mat.map = t; mat.needsUpdate = true; });
    addGraticule(spin, 1.003, 0x6fd6ff, .12);
    // Fresnel atmosphere: outer halo + inner rim
    const vs = 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 64), new THREE.ShaderMaterial({ vertexShader: vs,
      fragmentShader: 'varying vec3 vN;void main(){float i=pow(0.72-dot(vN,vec3(0.0,0.0,1.0)),3.2);gl_FragColor=vec4(0.25,0.68,1.0,1.0)*i;}',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.004, 64, 64), new THREE.ShaderMaterial({ vertexShader: vs,
      fragmentShader: 'varying vec3 vN;void main(){float i=pow(1.0-dot(vN,vec3(0.0,0.0,1.0)),2.6);gl_FragColor=vec4(0.35,0.75,1.0,1.0)*i*0.9;}',
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
    const markers = new THREE.Group(); spin.add(markers);
    const m = mg.current = { scene, cam, rd, tilt, spin, markers, labels: [], pulses: [], target: { x: 0, y: 0 }, drag: null, raf: 0, open: false };
    host.addEventListener('pointerdown', e => { m.drag = { x: e.clientX, y: e.clientY }; host.setPointerCapture(e.pointerId); host.style.cursor = 'grabbing'; });
    host.addEventListener('pointermove', e => { if (!m.drag) return; m.target.y += (e.clientX - m.drag.x) * .006; m.target.x = Math.max(-1.2, Math.min(1.2, m.target.x + (e.clientY - m.drag.y) * .005)); m.drag = { x: e.clientX, y: e.clientY }; });
    const end = () => { m.drag = null; host.style.cursor = ''; };
    host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
  }
  function buildMiniGlobe(key) {
    if (!mg.current) initMiniGlobe();
    const m = mg.current, dd = DRIVER[key];
    clearGroup3(m.markers); m.labels.forEach(l => l.el.remove()); m.labels = []; m.pulses = [];
    const col = new THREE.Color(dd.color);
    const hub = latLonToV3(30.3, 69.3, 1.01);
    const addLabel = (v, text, isHub) => { const el = document.createElement('div'); el.className = 'lbl3d' + (isHub ? ' hub' : ''); el.textContent = text; lblEl.current.appendChild(el); m.labels.push({ el, v: v.clone() }); };
    const dot = (v, c, r) => { const x = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14), new THREE.MeshBasicMaterial({ color: c })); x.position.copy(v); m.markers.add(x); };
    dot(hub, 0x4ee59b, .026); m.hubHalo = addGlow(m.markers, hub, .22, 0x4ee59b, .9);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.04, .048, 40), new THREE.MeshBasicMaterial({ color: 0x4ee59b, transparent: true, opacity: .75, side: THREE.DoubleSide })); ring.position.copy(hub); ring.lookAt(0, 0, 0); m.markers.add(ring);
    addLabel(hub, 'Pakistan signal hub', true);
    const center = hub.clone().normalize();
    dd.points.forEach((p, i) => {
      const v = latLonToV3(p[0], p[1], 1.008); center.add(v.clone().normalize());
      dot(v, col, .018); addGlow(m.markers, v, .13, col.getHex(), .8);
      const mid = hub.clone().add(v).multiplyScalar(.5).normalize().multiplyScalar(1.08 + hub.distanceTo(v) * .35);
      const curve = new THREE.QuadraticBezierCurve3(hub.clone(), mid, v.clone());
      m.markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)), new THREE.LineBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), .35), transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false })));
      m.pulses.push({ sp: addGlow(m.markers, v, .07, 0xffffff, .95), curve, t: i / dd.points.length });
      if (i < 4) addLabel(v, dd.popup + ' ' + (i + 1), false);
    });
    // turn the globe so the middle of the hub + driver region faces the camera
    center.normalize();
    m.target.y = Math.atan2(-center.x, center.z);
    m.target.x = Math.atan2(center.y, Math.hypot(center.x, center.z));
  }
  function miniFrame() {
    const m = mg.current;
    if (!m.open) { m.raf = 0; return; }
    m.raf = requestAnimationFrame(miniFrame);
    m.spin.rotation.y += (m.target.y - m.spin.rotation.y) * .08;
    m.tilt.rotation.x += (m.target.x - m.tilt.rotation.x) * .08;
    m.pulses.forEach(p => { p.t = (p.t + .006) % 1; p.sp.position.copy(p.curve.getPoint(p.t)); });
    if (m.hubHalo) m.hubHalo.material.opacity = .55 + .35 * Math.sin(performance.now() * .004);
    m.rd.render(m.scene, m.cam);
    const camDir = m.cam.position.clone().normalize();
    m.labels.forEach(l => {
      const wp = l.v.clone().applyMatrix4(m.spin.matrixWorld);
      if (wp.clone().normalize().dot(camDir) < .15) { l.el.style.display = 'none'; return; }
      const pr = wp.project(m.cam), half = l.el.offsetWidth / 2 + 4;
      l.el.style.display = 'block'; l.el.style.left = Math.max(half, Math.min(S - half, (pr.x * .5 + .5) * S)) + 'px'; l.el.style.top = ((-pr.y * .5 + .5) * S) + 'px';
    });
  }

  // globe: rebuilt for each driver, animated only while the card is open
  useEffect(() => {
    if (!open) { if (mg.current) mg.current.open = false; return; }
    buildMiniGlobe(driverKey);
    mg.current.open = true; if (!mg.current.raf) miniFrame();
  }, [driverKey]);

  // the jet stream needs today's wind data first
  useEffect(() => {
    setWindErr(null);
    if (driverKey === 'jet' && !jetSeries()) fetchWind().then(() => setWindTick(t => t + 1)).catch(e => setWindErr(e.message));
  }, [driverKey]);

  const s = open ? seriesOf(driverKey) : null, hasData = !!(s && s.values && s.values.length);
  // chart: redrawn when the driver or its data changes
  useEffect(() => {
    if (!hasData) return;
    const vals = s.values, rgb = hexRgb(d.color), diverging = vals.some(v => v < 0), ds = [];
    if (s.kind === 'bar') {
      ds.push({ type: 'bar', label: s.title, data: vals, borderRadius: 3, maxBarThickness: 16,
        backgroundColor: vals.map(v => diverging ? (v >= 0 ? 'rgba(245,158,11,.9)' : 'rgba(56,189,248,.9)') : 'rgba(' + rgb + ',.8)') });
    } else {
      ds.push({ type: 'line', label: s.names ? s.names[0] : s.title, data: vals, borderColor: d.color, backgroundColor: 'rgba(' + rgb + ',.14)', fill: !s.values2, tension: .35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 });
      if (s.values2) ds.push({ type: 'line', label: s.names[1], data: s.values2, borderColor: '#ffc857', tension: .35, pointRadius: 0, borderWidth: 2 });
    }
    (s.thresholds || []).forEach(t => ds.push({ type: 'line', label: 'threshold ' + t, data: vals.map(() => t), borderColor: 'rgba(255,255,255,.35)', borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false }));
    const ch = new Chart(cv.current, {
      type: s.kind === 'bar' ? 'bar' : 'line',
      data: { labels: s.labels, datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: 600 }, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: !!s.values2, labels: { color: '#cbd5e1', font: { size: 9 }, boxWidth: 10 } },
          tooltip: { filter: i => !/^threshold/.test(i.dataset.label), callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.parsed.y + ' ' + s.unit } } },
        scales: { x: { ticks: { color: '#a8b8c6', font: { size: 9 }, maxRotation: 0, autoSkipPadding: 8 }, grid: { display: false } },
          y: { ticks: { color: '#a8b8c6', font: { size: 9 } }, grid: { color: 'rgba(148,163,184,.12)' }, title: { display: true, text: s.unit, color: '#a8b8c6', font: { size: 9 } } } } },
    });
    return () => ch.destroy();
  }, [driverKey, hasData]);

  useEffect(() => () => { const m = mg.current; if (m) { m.open = false; cancelAnimationFrame(m.raf); m.rd.dispose(); } }, []);

  const k = kpis(driverKey, s), src = open && SOURCES[driverKey];
  const empty = !open || hasData ? null : driverKey === 'jet'
    ? (windErr ? 'Live jet-stream data is unavailable right now (' + windErr + '). The portal retries automatically, so reopen this card later.' : 'Loading today’s GFS wind data…')
    : 'No data yet. Run "python update_data.py" in the dashboard folder to download the latest NOAA / NASA series.';
  const upd = CLIMATE_DATA ? ' · series downloaded ' + CLIMATE_DATA.updated : '';
  return (
    <div id="drvModal" className={open ? 'on' : ''} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dvmCard">
        <div className="dvmHead">
          <span className="dvmChip" style={d ? { background: d.color, color: d.color } : null}></span>
          <div><div className="dvmTitle">{d && d.name}</div><div className="dvmSub">Driver analysis · latest observed data</div></div>
          <button id="dvmClose" title="Close" onClick={onClose}>✕</button>
        </div>
        <div className="dvmBody">
          <div className="dvmGlobeWrap">
            <div className="dvmGlobe" ref={globeEl}><div id="dvmLbls" ref={lblEl}></div></div>
            <div className="dvmCap">Esri World Imagery · drag to rotate</div>
          </div>
          <div className="dvmRight">
            <div className="dvmKpis">
              <div className="dvmKpi"><div className="k">Latest</div><div className="v">{k.latest}</div><div className="s">{k.latestS}</div></div>
              <div className="dvmKpi"><div className="k">{k.changeK}</div><div className="v">{k.change}</div><div className="s">{k.changeS}</div></div>
              <div className="dvmKpi"><div className="k">Data through</div><div className="v">{k.through}</div><div className="s">{k.source}</div></div>
            </div>
            <div className="dvmPanel">
              <div className="dvmChartHead">
                <b>{hasData ? <>{s.title} <span style={{ textTransform: 'none' }}>({s.unit})</span></> : d && d.name}</b>
                {hasData && <a href={s.url} target="_blank" rel="noopener">{s.source} ↗</a>}
              </div>
              <div className="dvmChartBox">
                <canvas ref={cv} style={{ display: hasData ? 'block' : 'none' }}></canvas>
                <div className="dvmEmpty" style={{ display: empty ? 'flex' : 'none' }}>{empty}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="dvmDesc">{open && DESCRIPTIONS[driverKey]}</div>
        <div className="dvmLinks">
          <a href={src && src.url ? src.url : 'https://earth.nullschool.net/'} target="_blank" rel="noopener">earth.nullschool.net ↗</a>
          <a href={SOURCES.jet.url} target="_blank" rel="noopener" style={{ display: driverKey === 'wd' ? '' : 'none' }}>jet stream ↗</a>
          <span>{(src && src.label ? (src.wind ? src.label : 'Map: NASA GIBS · ' + src.label) : '') + upd}</span>
        </div>
      </div>
    </div>
  );
}
