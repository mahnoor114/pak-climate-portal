import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import Chart from 'chart.js/auto';
import { MAPBOX_TOKEN, FC_CITIES, PAK_BOUNDS } from '../core/constants.js';
import { PAK_BOUNDARY, HAS_PAK_BOUNDARY, DISTRICTS, HAS_DISTRICTS, districtAt } from '../core/data.js';
import { wmo, compass, r0, aqiInfo, PK_VARS, pkColor, pkValue, pkCityValue, pkDistrictValue } from '../core/weather.js';
import { live } from '../core/live.js';

const WEATHER_VARS = Object.keys(PK_VARS).filter(k => PK_VARS[k].src !== 'aq'), AIR_VARS = Object.keys(PK_VARS).filter(k => PK_VARS[k].src === 'aq');
const HINT = 'Hover for values · click anywhere for that spot\'s full forecast';
const dayLabel = (t, i) => (i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' })) + ' ' + t.slice(8) + '/' + t.slice(5, 7);

// ---- Whole-Pakistan forecast map: Open-Meteo 0.75° grid (via /api/pakforecast), clipped to the official boundary.
// Fills the whole window; the day picker and layer chips float over it. Clicking a spot opens its full forecast.
function PakMap({ open, cityView, onPoint }) {
  const el = useRef(null), M = useRef(null), pointRef = useRef(onPoint); pointRef.current = onPoint;
  const [pk, setPk] = useState({ data: null, aq: null, day: 0, v: 'precipitation_sum' });
  const pkRef = useRef(pk); pkRef.current = pk;
  const [info, setInfo] = useState(null), [msg, setMsg] = useState('');
  const D = PK_VARS[pk.v].src === 'aq' ? pk.aq : pk.data; // dataset behind the selected variable
  live.pk = pk;

  // Re-measure the map once the full-screen window has its final size, then frame all of Pakistan clear of the floating bars.
  const fit = () => [60, 350].forEach(ms => setTimeout(() => { const m = M.current; if (!m) return; m.map.invalidateSize(); m.map.fitBounds(PAK_BOUNDS, { paddingTopLeft: [20, 130], paddingBottomRight: [20, 80] }); }, ms));

  function init() {
    const map = L.map(el.current, { zoomControl: false, attributionControl: true, minZoom: 4, maxZoom: 9, zoomSnap: .1, zoomDelta: .5 }).fitBounds(PAK_BOUNDS);
    L.control.zoom({ position: 'bottomright' }).addTo(map); // top-left sits under the floating header
    L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=' + MAPBOX_TOKEN,
      { tileSize: 512, zoomOffset: -1, attribution: '&copy; Mapbox &copy; OpenStreetMap · Weather data: Open-Meteo' }).addTo(map);
    map.createPane('pkTop').style.zIndex = 450;
    if (HAS_PAK_BOUNDARY) L.geoJSON(PAK_BOUNDARY, { pane: 'pkTop', interactive: false, style: f => ({ color: '#ffffff', weight: f.properties.disputed ? 1.2 : 1.6, opacity: .9, dashArray: f.properties.disputed ? '6 5' : null, fill: false }) }).addTo(map);
    if (HAS_DISTRICTS) L.geoJSON(DISTRICTS, { pane: 'pkTop', interactive: false, style: f => ({ color: '#e2e8f0', weight: .6, opacity: .45, fill: false, dashArray: f.properties.disputed ? '4 4' : null }) }).addTo(map);
    const labels = L.layerGroup().addTo(map);
    const curD = () => { const p = pkRef.current; return PK_VARS[p.v].src === 'aq' ? p.aq : p.data; };
    map.on('mousemove', e => {
      const p = pkRef.current, Dn = curD(), v = pkValue(Dn, p.v, p.day, e.latlng.lat, e.latlng.lng);
      if (v == null) { setInfo(null); return; }
      const d = districtAt(e.latlng.lat, e.latlng.lng);
      setInfo({ v, d, dv: d && pkDistrictValue(Dn, p.v, p.day, d), lat: e.latlng.lat, lon: e.latlng.lng });
    });
    map.on('click', e => {
      const p = pkRef.current; if (pkValue(curD(), p.v, p.day, e.latlng.lat, e.latlng.lng) == null) return;
      const lat = +e.latlng.lat.toFixed(2), lon = +e.latlng.lng.toFixed(2);
      const near = FC_CITIES.map(c => ({ c, d: Math.hypot(c.ll[0] - lon, c.ll[1] - lat) })).sort((a, b) => a.d - b.d)[0];
      const d = districtAt(lat, lon);
      pointRef.current({ n: d ? d.properties.n + ' district (' + lat + '°N ' + lon + '°E)' : lat + '°N ' + lon + '°E' + (near.d < 1 ? ' (near ' + near.c.n + ')' : ''), ll: [lon, lat] });
    });
    M.current = { map, labels, overlay: null };
  }

  async function load() {
    const p = pkRef.current;
    if (!p.aq || Date.now() - (M.current.aqAt || 0) > 30 * 60000) // air quality loads alongside; a failure only affects the air views
      fetch('/api/aqmap').then(r => r.ok ? r.json() : null).then(js => { if (js) { M.current.aqAt = Date.now(); setPk(s => ({ ...s, aq: js })); } }).catch(() => {});
    if (p.data && !p.data.stale && Date.now() - M.current.loadedAt < 30 * 60000) return;
    try {
      const r = await fetch('/api/pakforecast'), js = await r.json();
      if (!r.ok) throw new Error(js.error || 'error ' + r.status);
      M.current.loadedAt = Date.now(); setMsg(''); setPk(s => ({ ...s, data: js }));
    } catch (e) { setMsg((e.message || 'Forecast map unavailable') + '. It will appear automatically once ready - reopen in a minute.'); }
  }

  // opening the window (either view): create the map once, frame it, refresh the data when old
  useEffect(() => { if (!open) return; if (!M.current) init(); fit(); load(); }, [open]);
  useEffect(() => { const r = () => { if (M.current && open) fit(); }; addEventListener('resize', r); return () => removeEventListener('resize', r); }, [open]);
  useEffect(() => () => { if (M.current) M.current.map.remove(); }, []);

  // colour overlay + city values for the selected variable and day
  useEffect(() => {
    const m = M.current; if (!m || !pk.data) return;
    if (m.overlay) { m.map.removeLayer(m.overlay); m.overlay = null; }
    m.labels.clearLayers();
    if (!D || pk.day >= D.days.length) return; // air data not loaded yet, or a day beyond its 5-day range
    const g = D.grid, V = PK_VARS[pk.v], S = g.lat0, N = g.lat0 + (g.ny - 1) * g.step, W = g.lon0, E = g.lon0 + (g.nx - 1) * g.step;
    // canvas in Web Mercator rows so it lines up with the map
    const my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), yN = my(N), yS = my(S), w = 520, h = Math.round(w * (yN - yS) / ((E - W) * Math.PI / 180));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'), img = x.createImageData(w, h), px = img.data;
    for (let j = 0; j < h; j++) {
      const lat = Math.atan(Math.sinh(yN - (j + .5) / h * (yN - yS))) * 180 / Math.PI;
      for (let i = 0; i < w; i++) { const c = pkColor(pkValue(D, pk.v, pk.day, lat, W + (i + .5) / w * (E - W)), V.stops), o = (j * w + i) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3]; }
    }
    x.putImageData(img, 0, 0);
    if (HAS_PAK_BOUNDARY) { // keep colour only inside the official boundary
      x.globalCompositeOperation = 'destination-in'; x.beginPath();
      const P = ([lon, lat]) => [(lon - W) / (E - W) * w, (yN - my(lat)) / (yN - yS) * h];
      PAK_BOUNDARY.features.forEach(f => f.geometry.coordinates.forEach(poly => poly.forEach(ring => ring.forEach((pt, k) => { const [a, b] = P(pt); k ? x.lineTo(a, b) : x.moveTo(a, b); }))));
      x.fill('evenodd');
    }
    m.overlay = L.imageOverlay(cv.toDataURL(), [[S, W], [N, E]], { opacity: .85, interactive: false }).addTo(m.map);
    FC_CITIES.forEach(c => {
      const v = pkCityValue(D, pk.v, pk.day, c); if (v == null) return;
      L.marker([c.ll[1], c.ll[0]], { interactive: false, pane: 'pkTop', icon: L.divIcon({ className: '', html: '<div class="pkCity">' + V.fmt(v) + '<br><small>' + c.n + '</small></div>', iconSize: [0, 0] }) }).addTo(m.labels);
    });
  }, [pk, D]);

  const V = PK_VARS[pk.v], set = patch => setPk(s => ({ ...s, ...patch }));
  const chips = keys => keys.map(k => <button key={k} type="button" className={pk.v === k ? 'on' : ''} onClick={() => set({ v: k })}>{PK_VARS[k].label}</button>);
  let legend = null;
  if (pk.data) {
    if (!D || pk.day >= D.days.length) legend = D ? 'Air-quality forecasts cover the next ' + D.days.length + ' days - pick an earlier day.' : 'Air-quality data is loading - it appears in a moment.';
    else legend = <>
      <b style={{ color: 'var(--ink)' }}>{V.label + (V.note ? ' (' + V.note + ')' : '') + ' · ' + dayLabel(pk.data.days[pk.day], pk.day)}</b>
      <div className="bar" style={{ background: 'linear-gradient(90deg,' + V.ramp.map(([, c], i) => c + ' ' + (i / (V.ramp.length - 1) * 100) + '%').join(',') + ')' }}></div>
      <div className="ticks">{V.ramp.map(([v]) => <span key={v}>{v}</span>)}</div>
      <div style={{ marginTop: 4 }}>{(V.src === 'aq' ? 'Open-Meteo / CAMS air quality' : 'Open-Meteo') + ' · updated ' + D.fetched + (D.stale ? ' (refreshing)' : '')}</div>
    </>;
  }
  return (
    <>
      <div className="pkMapWrap">
        <div id="pkMap" ref={el}></div>
        <div className="pkInfo" id="pkInfo">{!info ? HINT : <>
          {info.d ? <><b>{info.d.properties.n}</b> district · {info.d.properties.p} · pop. {(info.d.properties.pop / 1e6).toFixed(1)} M<br />
            District average: {info.dv == null ? '–' : V.fmt(info.dv) + (pk.v === 'us_aqi' ? ' - ' + aqiInfo(info.dv).cat : '')} · this spot: </>
            : info.lat.toFixed(2) + '°N ' + info.lon.toFixed(2) + '°E · '}
          {V.fmt(info.v)} · click for this spot's full forecast</>}
        </div>
        <div className="pkLegend" id="pkLegend">{legend}</div>
      </div>
      {!cityView && <>
        <div className="fcBar fcDayBar"><div className="fcSeg" id="pkDays">
          {pk.data && pk.data.days.map((t, i) => <button key={t} type="button" className={(pk.day === i ? 'on' : '') + (D && i >= D.days.length ? ' na' : '')} onClick={() => set({ day: i })}>{dayLabel(t, i)}</button>)}
        </div></div>
        <div className="fcBar fcVarBar"><span className="lbl">Weather</span><div className="fcSeg">{chips(WEATHER_VARS)}</div><span className="sep"></span><span className="lbl">Air</span><div className="fcSeg">{chips(AIR_VARS)}</div></div>
        <div className={'fcMsg' + (msg ? ' on' : '')} id="pkMsg">{msg}</div>
      </>}
    </>
  );
}

// ---- City / point forecast (Open-Meteo via /api/forecast, cached 30 min on the server) ----
function CityForecast({ place, onPick, mb }) {
  const cv = useRef(null), { data, air, msg } = mb;
  useEffect(() => {
    if (!data) return;
    const cur = data.current, h = data.hourly, start = Math.max(0, h.time.findIndex(t => t >= cur.time.slice(0, 13) + ':00')), idx = [...Array(48).keys()].map(i => start + i).filter(i => i < h.time.length);
    const labels = idx.map(i => { const t = h.time[i]; return t.slice(11, 13) === '00' ? new Date(t).toLocaleDateString('en-GB', { weekday: 'short' }) + ' 00' : t.slice(11, 16); });
    const ch = new Chart(cv.current, {
      data: { labels, datasets: [
        { type: 'line', label: 'Temperature (°C)', data: idx.map(i => h.temperature_2m[i]), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.12)', fill: true, tension: .35, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
        { type: 'bar', label: 'Chance of rain (%)', data: idx.map(i => h.precipitation_probability[i]), backgroundColor: 'rgba(56,189,248,.45)', borderRadius: 2, yAxisID: 'y1' },
        { type: 'line', label: 'Wind (km/h)', data: idx.map(i => h.wind_speed_10m[i]), borderColor: '#cbd5e1', borderDash: [4, 3], pointRadius: 0, borderWidth: 1.5, tension: .35, yAxisID: 'y2' }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, animation: { duration: 400 },
        plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 10 }, boxWidth: 10 } },
          tooltip: { callbacks: { afterBody: items => { const i = idx[items[0].dataIndex]; return 'Rain: ' + (h.precipitation[i] || 0) + ' mm · ' + wmo(h.weather_code[i])[1]; } } } },
        scales: { x: { ticks: { color: '#a8b8c6', font: { size: 9 }, maxRotation: 0, autoSkipPadding: 10 }, grid: { display: false } },
          y: { position: 'left', ticks: { color: '#f59e0b', font: { size: 9 }, callback: v => v + '°' }, grid: { color: 'rgba(148,163,184,.12)' } },
          y1: { position: 'right', min: 0, max: 100, ticks: { color: '#38bdf8', font: { size: 9 }, callback: v => v + '%' }, grid: { display: false } },
          y2: { display: false, min: 0 } } },
    });
    return () => ch.destroy();
  }, [data]);

  const onDistrict = e => {
    const f = DISTRICTS.features.find(x => x.properties.n + ' - ' + x.properties.p === e.target.value);
    if (f) { onPick({ n: f.properties.n + ' district (' + f.properties.p + ')', ll: f.properties.c }); e.target.value = ''; }
  };
  let now = null, days = null, airBox = null;
  if (data) {
    const cur = data.current, day = data.daily, [ico, desc] = wmo(cur.weather_code, cur.is_day);
    now = <>
      <div className="fcBig"><span className="ico">{ico}</span><span className="t">{r0(cur.temperature_2m)}<small>°C</small></span></div>
      <div className="fcDesc"><b>{desc}</b><span>Feels like {r0(cur.apparent_temperature)}°C · today {r0(day.temperature_2m_min[0])}° to {r0(day.temperature_2m_max[0])}° · sunrise {day.sunrise[0].slice(11)}, sunset {day.sunset[0].slice(11)}</span></div>
      <div className="fcStats"><div>Wind<b>{r0(cur.wind_speed_10m)} km/h {compass(cur.wind_direction_10m)}</b></div><div>Gusts<b>{r0(cur.wind_gusts_10m)} km/h</b></div><div>Humidity<b>{r0(cur.relative_humidity_2m)}%</b></div>
        <div>Rain now<b>{cur.precipitation || 0} mm</b></div><div>Cloud<b>{r0(cur.cloud_cover)}%</b></div><div>UV today<b>{r0(day.uv_index_max[0])}</b></div></div>
    </>;
    days = day.time.map((t, i) => {
      const [ic, ds] = wmo(day.weather_code[i]), dn = i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' });
      const mm = day.precipitation_sum[i] || 0, pp = day.precipitation_probability_max[i];
      return <div key={t} className={'fcDay' + (i === 0 ? ' today' : '')} title={ds}><div className="d">{dn}</div><div>{t.slice(8) + '/' + t.slice(5, 7)}</div><div className="ico">{ic}</div>
        <div className="hl">{r0(day.temperature_2m_max[i])}° <span>{r0(day.temperature_2m_min[i])}°</span></div>
        <div className={'rain' + (mm < 0.1 && (pp || 0) < 30 ? ' dry' : '')}>{(mm >= 0.1 ? mm.toFixed(1) + ' mm' : 'dry') + (pp != null ? ' · ' + pp + '%' : '')}</div>
        <div className="mini">💨 {r0(day.wind_speed_10m_max[i])} (gust {r0(day.wind_gusts_10m_max[i])}) km/h</div><div className="mini">UV {r0(day.uv_index_max[i])}</div></div>;
    });
  }
  if (air) {
    const a = air.current, info = aqiInfo(a.us_aqi || 0), worst = air.worst;
    airBox = <div className="fcAir" title={'Particles in µg/m³ · AOD = how hazy the air column is (0 clear, >1 very hazy) · source: Open-Meteo / CAMS' + (air.stale ? ' (saved copy)' : '')}>
      <div className="aqi" style={{ background: info.color }}>{r0(a.us_aqi)}<small>US AQI</small></div>
      <div className="cat"><b>Air: {info.cat}</b>{info.advice + (worst ? ' · worst next 24 h: AQI ' + r0(worst.v) + ' at ' + worst.t.slice(11, 16) : '')}</div>
      <div className="st">PM2.5<b>{r0(a.pm2_5)}</b></div><div className="st">PM10<b>{r0(a.pm10)}</b></div><div className="st">AOD<b>{a.aerosol_optical_depth != null ? a.aerosol_optical_depth.toFixed(2) : '–'}</b></div>
      <div className="st">Dust<b>{r0(a.dust)}</b></div><div className="st">Ozone<b>{r0(a.ozone)}</b></div><div className="st">NO₂<b>{r0(a.nitrogen_dioxide)}</b></div>
    </div>;
  }
  return (
    <>
      {HAS_DISTRICTS && <div className="fcSearch"><input list="fcDistrictList" placeholder="🔎 Search any of Pakistan's 167 districts…" autoComplete="off" onChange={onDistrict} />
        <datalist id="fcDistrictList">{DISTRICTS.features.map(f => <option key={f.properties.n + f.properties.p} value={f.properties.n + ' - ' + f.properties.p} />)}</datalist></div>}
      <div className="mbCities">{FC_CITIES.map(c => <button key={c.n} type="button" className={place === c.n ? 'on' : ''} onClick={() => onPick(c.n)}>{c.n}</button>)}</div>
      <div className={'fcMsg' + (msg ? ' on' : '')}>{msg}</div>
      <div style={{ display: msg ? 'none' : '' }}>
        <div className="fcNow">{now}</div>
        {airBox}
        <div className="fcDays">{days}</div>
        <div className="fcChartWrap">
          <div className="fcChartHead"><b>Next 48 hours</b><span className="muted">temperature · chance of rain · wind</span></div>
          <div className="fcChartBox"><canvas ref={cv}></canvas></div>
        </div>
      </div>
    </>
  );
}

// Forecast window: full-screen Pakistan map with floating controls; the city/point forecast opens as a panel over it.
// fc = {open, view: 'map'|'city', place, seq} from App; seq changes each time a place is requested.
export default function ForecastModal({ fc, setFc }) {
  const [mb, setMb] = useState({ city: null, data: null, air: null, msg: '' });
  const want = useRef(null);
  live.forecastOpen = fc.open; live.forecastView = fc.view; live.mb = mb.data ? { data: mb.data, air: mb.air && mb.air.summary } : null;

  async function show(place) { // a city name, or {n:'label', ll:[lon,lat]} for any clicked point
    const c = (place && typeof place === 'object') ? place : (FC_CITIES.find(x => x.n === place) || FC_CITIES[0]);
    want.current = c.n;
    setMb(s => ({ ...s, city: c.n, msg: !s.data || s.data.city !== c.n ? 'Loading the forecast for ' + c.n + '…' : '' }));
    try {
      const r = await fetch('/api/forecast?lat=' + c.ll[1] + '&lon=' + c.ll[0]), js = await r.json();
      if (!r.ok) throw new Error(js.error || ('error ' + r.status));
      if (want.current !== c.n) return; // another city was picked meanwhile
      setMb(s => ({ ...s, data: { city: c.n, ...js }, msg: '' }));
      showAir(c);
    } catch (e) { if (want.current === c.n) setMb(s => ({ ...s, msg: 'Forecast unavailable right now (' + (e.message || 'network error') + '). Try again in a minute.' })); }
  }
  // Air-quality card (/api/airquality, cached 60 min on the server)
  async function showAir(c) {
    try {
      const r = await fetch('/api/airquality?lat=' + c.ll[1] + '&lon=' + c.ll[0]); if (!r.ok) throw 0;
      const js = await r.json(); if (want.current !== c.n) return;
      const a = js.current, h = js.hourly || {}, now = a.time.slice(0, 13);
      const next = (h.time || []).map((t, i) => ({ t, v: h.us_aqi[i] })).filter(x => x.t.slice(0, 13) >= now && x.v != null).slice(0, 24);
      const worst = next.reduce((m, x) => !m || x.v > m.v ? x : m, null);
      const summary = { aqi: a.us_aqi, category: aqiInfo(a.us_aqi || 0).cat, pm2_5: a.pm2_5, pm10: a.pm10, aod: a.aerosol_optical_depth, dust: a.dust, ozone: a.ozone, no2: a.nitrogen_dioxide, worst_next_24h: worst && { aqi: worst.v, time: worst.t } };
      setMb(s => ({ ...s, air: { current: a, worst, stale: js.stale, summary } }));
    } catch (e) { if (want.current === c.n) setMb(s => ({ ...s, air: null })); }
  }
  useEffect(() => { if (fc.open && fc.view === 'city') show(fc.place || mb.city || FC_CITIES[0].n); }, [fc.seq]);

  const close = () => setFc(f => ({ ...f, open: false }));
  const pick = place => setFc(f => ({ ...f, open: true, view: 'city', place, seq: f.seq + 1 }));
  const isMap = fc.view === 'map';
  const title = isMap ? 'Weather forecast · Pakistan' : mb.city ? 'Weather forecast · ' + mb.city : 'Weather forecast';
  const upd = mb.data && mb.data.fetched ? new Date(mb.data.fetched.replace(' UTC', 'Z').replace(' ', 'T')) : null;
  return (
    <div id="mbModal" role="dialog" aria-label="Weather forecast" className={fc.open ? 'on' : ''} data-view={fc.view} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="dvmCard mbCard">
        <PakMap open={fc.open} cityView={!isMap} onPoint={pick} />
        <div className="dvmHead">
          <span className="dvmChip" style={{ background: '#38bdf8', color: '#38bdf8' }}></span>
          <div><div className="dvmTitle">{title}</div><div className="dvmSub">{isMap ? 'Whole Pakistan · 7 days' : 'Now · 7 days · next 48 hours'}</div></div>
          <div className="fcTabs">
            <button type="button" className={isMap ? 'on' : ''} onClick={() => setFc(f => ({ ...f, view: 'map' }))}>🗺 Pakistan map</button>
            <button type="button" className={!isMap ? 'on' : ''} onClick={() => mb.city ? setFc(f => ({ ...f, view: 'city' })) : pick(FC_CITIES[0].n)}>📍 City / point forecast</button>
          </div>
          <button className="aiIcon" type="button" title="Close" onClick={close}>✕</button>
        </div>
        <div className={'fcView' + (isMap ? '' : ' on')} data-view="city">
          <CityForecast place={mb.city} mb={mb} onPick={pick} />
        </div>
        <div className="mbCredit">Weather data: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · air quality: Copernicus CAMS · map © <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · model forecasts, not official warnings (see PMD for alerts) · <span>
          {mb.data ? 'updated ' + (upd && !isNaN(upd) ? upd.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' }) + ' PKT' : mb.data.fetched || '') + (mb.data.stale ? ' (saved copy - service busy)' : '') : ''}</span></div>
      </div>
    </div>
  );
}
