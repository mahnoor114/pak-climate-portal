import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { DRIVERS, DRIVER, SOURCES, DESCRIPTIONS, HORIZONS } from '../core/constants.js';
import { CD, SCORES, SCORE_NAME, DRV_NAME, latestZ, fz, trendSeries, horizonStatus } from '../core/scores.js';
import { pktClock } from '../core/live.js';

export function TopBar({ mode, setMode, aiOpen, toggleAi, openForecast }) {
  const [clock, setClock] = useState(pktClock);
  useEffect(() => { const t = setInterval(() => setClock(pktClock()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brandmark">CI</div>
        <div><div className="title">Pakistan Climate Intelligence</div><div className="subtitle">National weather influence &amp; early-warning dashboard • Prototype</div></div>
      </div>
      <div className="status">
        <div className="pill pill-info"><span className="dot"></span><span className="live">SYSTEM ONLINE</span></div>
        <button className={'pill viewbtn aibtn' + (aiOpen ? ' on' : '')} id="aiBtn" type="button" title="Ask the AI assistant about this portal" onClick={toggleAi}>✨ Ask AI</button>
        <button className="pill viewbtn mbbtn" id="mbBtn" type="button" title="Live weather map and 7-day city forecasts" onClick={() => openForecast()}>🌦 Forecast</button>
        <button className={'pill viewbtn terrainbtn' + (mode === 'terrain' ? ' on' : '')} id="terrainBtn" type="button" title="3D mountain terrain of Pakistan" onClick={() => setMode(mode === 'terrain' ? '2d' : 'terrain')}>{mode === 'terrain' ? '🗺 2D' : '⛰ Terrain'}</button>
        <button className={'pill viewbtn' + (mode === '3d' ? ' on' : '')} id="viewBtn" type="button" onClick={() => setMode(mode === '3d' ? '2d' : '3d')}>{mode === '3d' ? '🗺 2D' : '🌐 3D'}</button>
        <div className="pill" id="clock">{clock}</div>
      </div>
    </div>
  );
}

const MAP_LABEL = {
  '2d': 'LIVE ANALYTICAL MAP • Switch driver layers with the cards below',
  '3d': '3D GLOBE • Drag to rotate • Scroll to zoom • Satellite: Esri World Imagery (Esri, Maxar, Earthstar Geographics) • NASA GIBS live layer',
  terrain: '3D TERRAIN • Drag to pan • Right-drag or Ctrl+drag to tilt & rotate • Click a city for its forecast • Imagery & elevation: Mapbox',
};
export const MapLabel = ({ mode }) => <div className="maplabel">{MAP_LABEL[mode]}</div>;

// Left drawer: the four influence scores; a row opens its leading driver
export function LeftPanel({ onDriver }) {
  return (
    <aside className="left"><div className="leftScroll">
      <div className="section-title">Current influence index</div>
      {Object.keys(SCORE_NAME).map(id => {
        const s = SCORES && SCORES[id];
        return (
          <div className="driver" id={'row_' + id} key={id} title="Open the leading driver" onClick={() => s && onDriver(s.lead)}>
            <div className="driver-head"><span>{SCORE_NAME[id]}</span><span className="score">{s ? s.score : '–'} / 100</span></div>
            <div className="bar"><i style={{ width: (s ? s.score : 0) + '%' }}></i></div>
            <div className="small">{s ? s.status : 'No data file yet. Run "python update_data.py".'}</div>
          </div>
        );
      })}
      <div className="stamp">50 = normal. Scores weight each driver's latest anomaly against its 1991–2020 climate. Click a row to open its leading driver.</div>
    </div></aside>
  );
}

const tickFont = { size: 10 }, tickCol = '#a8b8c6';
function TrendChart() {
  const cv = useRef(null);
  useEffect(() => {
    if (!CD) return;
    const { months, series } = trendSeries();
    const TC = { monsoon: '#38bdf8', winter: '#cbd5e1', heat: '#f59e0b', flood: '#2dd4bf' };
    const ch = new Chart(cv.current, {
      type: 'line',
      data: { labels: months, datasets: Object.keys(series).map(id => ({ label: SCORE_NAME[id].replace(' signal', ''), data: series[id], borderColor: TC[id], backgroundColor: TC[id], tension: .35, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2, fill: false, hidden: id === 'flood' }))
        .concat([{ label: 'Normal', data: months.map(() => 50), borderColor: 'rgba(255,255,255,.3)', borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false }]) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#cbd5e1', font: tickFont, boxWidth: 10, filter: i => i.text !== 'Normal' } }, tooltip: { filter: i => i.dataset.label !== 'Normal' } },
        scales: { x: { ticks: { color: tickCol, font: tickFont, maxRotation: 0, autoSkipPadding: 6 }, grid: { display: false } }, y: { min: 0, max: 100, ticks: { color: tickCol, font: tickFont, stepSize: 25 }, grid: { color: 'rgba(130,180,200,.08)' } } } },
    });
    return () => ch.destroy();
  }, []);
  return <div className="chartbox"><canvas ref={cv}></canvas></div>;
}
// Contribution: share of current anomaly strength |z|; clicking a slice opens that driver
function PieChart({ onDriver }) {
  const cv = useRef(null), cb = useRef(onDriver); cb.current = onDriver;
  useEffect(() => {
    if (!CD) return;
    const keys = Object.keys(DRV_NAME).filter(k => CD[k]);
    const mags = keys.map(k => Math.abs(latestZ(k))), tot = mags.reduce((a, b) => a + b, 0) || 1;
    const ch = new Chart(cv.current, {
      type: 'doughnut',
      data: { labels: keys.map(k => DRV_NAME[k]), datasets: [{ data: mags.map(m => Math.round(m / tot * 1000) / 10), backgroundColor: keys.map(k => DRIVER[k].color), borderColor: '#0a1622', borderWidth: 2, hoverOffset: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%',
        onClick: (e, els) => { if (els.length) cb.current(keys[els[0].index]); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: { legend: { position: 'right', labels: { color: '#cbd5e1', font: tickFont, boxWidth: 10, padding: 6 } },
          tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + c.parsed + '% (z ' + fz(latestZ(keys[c.dataIndex])) + ')' } } } },
    });
    return () => ch.destroy();
  }, []);
  return <div className="piebox"><canvas ref={cv}></canvas></div>;
}

// Right drawer: trend, contribution, forecast horizon, active layer
export function RightPanel({ active, liveSrc, onDriver }) {
  const s = SOURCES[active];
  return (
    <aside className="right">
      <div className="card">
        <h3>Driver influence trend</h3><div className="muted" style={{ marginBottom: 6 }}>Monthly scores from observed anomalies · click legend to toggle</div>
        <TrendChart />
      </div>
      <div className="card">
        <h3>Current contribution to signal</h3><div className="muted" style={{ marginBottom: 6 }}>Share of current anomaly strength · click a slice to open</div>
        <PieChart onDriver={onDriver} />
      </div>
      <div className="card">
        <h3>Forecast horizon</h3>
        <div className="grid2">
          {HORIZONS.map(h => (
            <div className="kpi horizon" key={h.name} title="Open the lead driver" onClick={() => CD && onDriver(h.drivers[0])}>
              <div className="muted">{h.range}</div><b>{h.name}</b><div className="small">{h.small}</div><div className="hstat">{horizonStatus(h.drivers)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3 id="activeTitle">Active layer: {DRIVER[active].name}</h3>
        <div className="small" id="activeText">{DESCRIPTIONS[active] + ' (Prototype layer — connect the relevant live dataset for operational use.)'}</div>
        <div className="srcrow">
          <a className="srclink" id="srcNull" href={s.url} target="_blank" rel="noopener">🌍 earth.nullschool ↗</a>
        </div>
        <div className="livesrc" id="liveSrc">{liveSrc}</div>
        <div className="legend" style={{ marginTop: 8 }}><span style={{ color: '#38bdf8' }}>Ocean</span><span style={{ color: '#a78bfa' }}>Circulation</span><span style={{ color: '#fbbf24' }}>Land &amp; snow</span><span style={{ color: '#34d399' }}>Teleconnections</span></div>
      </div>
    </aside>
  );
}

// Driver chips; hovering one previews it on the 3D globe
export function BottomBar({ active, onSelect, onHover }) {
  const refs = useRef({});
  useEffect(() => { const b = refs.current[active]; if (b) b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }, [active]);
  const glow = e => { const b = e.currentTarget, r = b.getBoundingClientRect(); b.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%'); b.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%'); };
  return (
    <div className="bottombar"><div className="bbtrack">
      {DRIVERS.map(d => (
        <button key={d.key} ref={el => refs.current[d.key] = el} className={'layer' + (active === d.key ? ' active' : '')} data-layer={d.key} style={{ '--c': d.color }}
          onClick={() => onSelect(d.key)} onMouseEnter={() => onHover(d.key)} onFocus={() => onHover(d.key)} onMouseLeave={() => onHover(null)} onBlur={() => onHover(null)} onPointerMove={glow}>
          <span className="icon">{d.icon}</span><span className="layername">{d.name}</span><span className="toggle"></span>
        </button>
      ))}
    </div></div>
  );
}

export function Toast() {
  const [st, setSt] = useState({ msg: '', on: false });
  useEffect(() => {
    let t = 0;
    const show = e => { setSt({ msg: e.detail, on: true }); clearTimeout(t); t = setTimeout(() => setSt(s => ({ ...s, on: false })), 1800); };
    addEventListener('portal-toast', show);
    return () => { removeEventListener('portal-toast', show); clearTimeout(t); };
  }, []);
  return <div id="toast" style={{ opacity: st.on ? 1 : 0, transform: 'translateX(-50%) translateY(' + (st.on ? 0 : 15) + 'px)' }}>{st.msg}</div>;
}
