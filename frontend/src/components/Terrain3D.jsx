import { useEffect, useRef, useState } from 'react';
import { MAPBOX_TOKEN, ACCENT, SOURCES, FC_CITIES, PLACES } from '../core/constants.js';
import { PAK_BOUNDARY, HAS_PAK_BOUNDARY, COUNTRIES } from '../core/data.js';
import { gibsUrl, loadAsset } from '../core/tiles.js';
import { fetchWind, windAt, windColor } from '../core/wind.js';
import { wmo, wxKind, sunPosition } from '../core/weather.js';
import { toast } from '../core/live.js';

const TWIND = { lon0: 52, lon1: 88, lat0: 18, lat1: 42, w: 1400, h: 1100 }; // wind box over Pakistan and its neighbours
const mixRGB = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const rgba = (c, a) => 'rgba(' + c.join(',') + ',' + a + ')';

// Mapbox GL JS (lib/mapbox-gl.js, 1.8 MB) is loaded only when the terrain is first opened.
let mbLoading = null;
function ensureMapboxGL() {
  if (window.mapboxgl) return Promise.resolve();
  if (!mbLoading) mbLoading = Promise.all([loadAsset('link', { rel: 'stylesheet', href: '/lib/mapbox-gl.css' }), loadAsset('script', { src: '/lib/mapbox-gl.js' })]).catch(e => { mbLoading = null; throw e; });
  return mbLoading;
}

// 3D terrain of Pakistan (Mapbox terrain DEM) with live weather where the camera looks: rain/snow, sky and sun follow
// the forecast; city badges show today's forecast and open the city's full forecast; the selected driver's layer
// (NASA tiles, or animated wind) is draped over the mountains.
export default function Terrain3D({ on, active, onOpenForecast, onFail }) {
  const flash = useRef(null), S = useRef({ tmap: null, spin: true, layerKey: null, windAnim: 0, tw: { key: null, data: null, at: 0, busy: false, ticker: 0, flash: 0, cityEls: {} } });
  const onRef = useRef(on); onRef.current = on;
  const openRef = useRef(onOpenForecast); openRef.current = onOpenForecast;
  const [spin, setSpin] = useState(true);
  const [place, setPlace] = useState(null);
  const [wx, setWx] = useState('⏳ loading weather…');

  function twApply() {
    const { tmap, tw } = S.current; if (!tmap || !tw.data) return;
    const cur = tw.data.current, code = cur.weather_code, k = wxKind(code), mm = cur.precipitation || 0, cloud = (cur.cloud_cover || 0) / 100;
    const c = tmap.getCenter(), sp = sunPosition(new Date(), c.lat, c.lng), day = Math.max(0, Math.min(1, (sp.alt + 6) / 12)); // 0 night .. 1 day
    const grey = Math.min(1, cloud * (k === 'sun' || k === 'partly' ? .5 : 1) + (k === 'rain' || k === 'storm' || k === 'snow' || k === 'fog' ? .35 : 0));
    // falling rain / snow
    if (k === 'rain' || k === 'storm') tmap.setRain({ density: k === 'storm' ? .9 : Math.min(.85, .4 + mm / 4), intensity: Math.min(1, .45 + mm / 4), color: '#a8adbc', opacity: .75, vignette: .7, 'vignette-color': '#3f4652', direction: [0, 80], 'droplet-size': [2.6, 18.2], 'distortion-strength': .6, 'center-thinning': 0 });
    else tmap.setRain(null);
    if (k === 'snow') tmap.setSnow({ density: Math.min(.95, .55 + mm / 3), intensity: 1, 'center-thinning': .1, direction: [0, 50], opacity: 1, color: '#ffffff', 'flake-size': .71, vignette: .3, 'vignette-color': '#ffffff' });
    else tmap.setSnow(null);
    // sky colour: clear blue -> overcast grey, darkening toward night
    const dayFog = mixRGB([150, 200, 255], [150, 158, 170], grey), dayHigh = mixRGB([42, 95, 214], [92, 100, 112], grey);
    tmap.setFog({ range: [1, 12], color: rgba(mixRGB([18, 26, 44], dayFog, day), .45 + .2 * grey), 'high-color': rgba(mixRGB([8, 12, 28], dayHigh, day), 1),
      'horizon-blend': .08 + .1 * grey, 'space-color': '#030a12', 'star-intensity': .8 * (1 - day) });
    if (tmap.getLayer('sky')) {
      tmap.setPaintProperty('sky', 'sky-atmosphere-sun', [sp.az, Math.max(0, Math.min(180, 90 - sp.alt))]);
      tmap.setPaintProperty('sky', 'sky-atmosphere-sun-intensity', 2 + 13 * day * (1 - .7 * grey));
    }
    if (tmap.getLayer('satellite')) { // dim the land at night and under heavy cloud
      tmap.setPaintProperty('satellite', 'raster-brightness-max', .3 + .7 * day * (1 - .3 * grey));
      tmap.setPaintProperty('satellite', 'raster-saturation', -.35 * grey);
    }
    // lightning for thunderstorms
    clearInterval(tw.flash); tw.flash = 0;
    if (k === 'storm') tw.flash = setInterval(() => {
      if (!onRef.current || Math.random() < .5) return; const f = flash.current;
      f.style.opacity = .55; setTimeout(() => f.style.opacity = 0, 90); setTimeout(() => { f.style.opacity = .35; setTimeout(() => f.style.opacity = 0, 70); }, 180);
    }, 2500);
    // "weather here" chip
    const [ic, ds] = wmo(code, cur.is_day), near = FC_CITIES.map(x => ({ x, d: Math.hypot(x.ll[0] - c.lng, x.ll[1] - c.lat) })).sort((a, b) => a.d - b.d)[0];
    setWx(ic + ' ' + (near.d < .15 ? near.x.n : near.d < .8 ? 'near ' + near.x.n : c.lat.toFixed(1) + '°N ' + c.lng.toFixed(1) + '°E') + ' now: ' + ds + ' · ' + Math.round(cur.temperature_2m) + '°C' +
      (mm > 0 ? ' · ' + mm + ' mm/h' : '') + ' · cloud ' + Math.round(cloud * 100) + '%' + (day < .3 ? ' · night' : ''));
  }
  async function twUpdate(force) {
    const { tmap, tw } = S.current; if (!onRef.current || !tmap || tw.busy) return;
    const c = tmap.getCenter(), lat = Math.round(c.lat * 4) / 4, lon = Math.round(c.lng * 4) / 4, key = lat + ',' + lon; // re-check when the view moves ~25 km
    if (!force && key === tw.key && Date.now() - tw.at < 10 * 60000) { twApply(); return; }
    tw.busy = true;
    try { const r = await fetch('/api/forecast?lat=' + lat + '&lon=' + lon); if (r.ok) { tw.data = await r.json(); tw.key = key; tw.at = Date.now(); twApply(); } }
    catch (e) { /* offline: keep the last weather */ } finally { tw.busy = false; }
  }
  async function twCities() { // animated badges: today's forecast for each city
    try {
      const js = await (await fetch('/api/pakforecast')).json(); if (!js.cities) return;
      FC_CITIES.forEach(c => {
        const d = js.cities[c.n], el = S.current.tw.cityEls[c.n]; if (!d || !el) return;
        const code = d.weather_code[0], k = wxKind(code), [ic, ds] = wmo(code);
        el.classList.add('wx'); el.querySelector('.wxi').className = 'wxi wx-' + k; el.querySelector('.wxi').textContent = ic;
        el.querySelector('.tt').textContent = Math.round(d.temperature_2m_max[0]) + '°' + (d.precipitation_sum[0] >= .1 ? ' · ' + d.precipitation_sum[0].toFixed(1) + ' mm' : '');
        el.title = c.n + ' today: ' + ds + ', high ' + Math.round(d.temperature_2m_max[0]) + '°C, low ' + Math.round(d.temperature_2m_min[0]) + '°C - click for the full forecast';
      });
    } catch (e) { /* badges stay plain */ }
  }

  function layerClear() {
    const { tmap } = S.current; if (!tmap) return;
    ['drv-live', 'drv-wind'].forEach(id => { if (tmap.getLayer(id)) tmap.removeLayer(id); if (tmap.getSource(id)) tmap.removeSource(id); });
    cancelAnimationFrame(S.current.windAnim); S.current.windAnim = 0;
  }
  function terrainLayer(key) {
    const { tmap } = S.current;
    if (!tmap || !tmap.isStyleLoaded()) { setTimeout(() => onRef.current && terrainLayer(key), 500); return; }
    layerClear(); S.current.layerKey = key;
    const s = SOURCES[key]; if (!s) return;
    const firstLabel = (tmap.getStyle().layers.find(l => l.type === 'symbol') || {}).id; // keep place names on top
    if (s.gibs) {
      const [id, ext, lvl] = s.gibs;
      tmap.addSource('drv-live', { type: 'raster', tileSize: 256, maxzoom: lvl, attribution: 'NASA GIBS', tiles: [gibsUrl(id, ext, lvl)] });
      tmap.addLayer({ id: 'drv-live', type: 'raster', source: 'drv-live', paint: { 'raster-opacity': .6, 'raster-fade-duration': 200 } }, firstLabel);
      toast('Terrain: showing ' + s.label);
    } else if (s.wind) {
      fetchWind().then(() => { if (S.current.layerKey !== key || !onRef.current) return; terrainWind(s.wind, firstLabel); toast('Terrain: showing ' + s.label); })
        .catch(() => toast('Wind data unavailable right now'));
    }
  }
  function terrainWind(level, beforeId) {
    const { tmap } = S.current, B = TWIND, cv = document.createElement('canvas'); cv.width = B.w; cv.height = B.h; const cx = cv.getContext('2d');
    const my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), yN = my(B.lat1), yS = my(B.lat0); // canvas rows follow the map's projection
    const X = lon => (lon - B.lon0) / (B.lon1 - B.lon0) * B.w, Y = lat => (yN - my(lat)) / (yN - yS) * B.h;
    // speed colours once, particles every frame
    const field = document.createElement('canvas'); field.width = B.w / 5; field.height = B.h / 5; const fc = field.getContext('2d'), img = fc.createImageData(field.width, field.height);
    for (let j = 0; j < field.height; j++) {
      const lat = Math.atan(Math.sinh(yN - (j + .5) / field.height * (yN - yS))) * 180 / Math.PI;
      for (let i = 0; i < field.width; i++) {
        const w = windAt(lat, B.lon0 + (i + .5) / field.width * (B.lon1 - B.lon0), level); if (!w) continue;
        const c = windColor(Math.hypot(w[0], w[1]), level), o = (j * field.width + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 110;
      }
    }
    fc.putImageData(img, 0, 0);
    const trails = document.createElement('canvas'); trails.width = B.w; trails.height = B.h; const tc = trails.getContext('2d');
    const spawn = q => { q.lon = B.lon0 + Math.random() * (B.lon1 - B.lon0); q.lat = B.lat0 + Math.random() * (B.lat1 - B.lat0); q.age = Math.random() * 80 | 0; return q; };
    const parts = [...Array(2600)].map(() => spawn({})), k = level === 250 ? .012 : .02;
    tmap.addSource('drv-wind', { type: 'canvas', canvas: cv, animate: true, coordinates: [[B.lon0, B.lat1], [B.lon1, B.lat1], [B.lon1, B.lat0], [B.lon0, B.lat0]] });
    tmap.addLayer({ id: 'drv-wind', type: 'raster', source: 'drv-wind', paint: { 'raster-opacity': .9, 'raster-fade-duration': 0 } }, beforeId);
    (function frame() {
      S.current.windAnim = requestAnimationFrame(frame); if (!onRef.current) return;
      tc.globalCompositeOperation = 'destination-in'; tc.fillStyle = 'rgba(0,0,0,.92)'; tc.fillRect(0, 0, B.w, B.h);
      tc.globalCompositeOperation = 'source-over'; tc.strokeStyle = 'rgba(255,255,255,.9)'; tc.lineWidth = 1.4; tc.beginPath();
      parts.forEach(q => {
        const w = windAt(q.lat, q.lon, level); if (!w || ++q.age > 90) { spawn(q); q.age = 0; return; }
        const lon = q.lon + w[0] * k / Math.cos(q.lat * Math.PI / 180), lat = q.lat + w[1] * k;
        if (lon < B.lon0 || lon > B.lon1 || lat < B.lat0 || lat > B.lat1) { spawn(q); return; }
        tc.moveTo(X(q.lon), Y(q.lat)); tc.lineTo(X(lon), Y(lat)); q.lon = lon; q.lat = lat;
      });
      tc.stroke();
      cx.clearRect(0, 0, B.w, B.h); cx.imageSmoothingEnabled = true; cx.drawImage(field, 0, 0, B.w, B.h); cx.drawImage(trails, 0, 0);
    })();
  }

  function initTerrain(key) {
    const mapboxgl = window.mapboxgl;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const tmap = S.current.tmap = new mapboxgl.Map({ container: 'terrain3d', style: 'mapbox://styles/mapbox/satellite-streets-v12', center: [75.2, 35.7], zoom: 7.4, pitch: 70, bearing: -25, maxPitch: 80, projection: 'globe', attributionControl: true });
    tmap.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-left');
    tmap.on('style.load', () => {
      tmap.addSource('dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
      tmap.setTerrain({ source: 'dem', exaggeration: 1.7 });
      tmap.setFog({ range: [1, 12], color: 'rgba(150,200,255,0.45)', 'high-color': '#2a5fd6', 'horizon-blend': 0.08, 'space-color': '#030a12', 'star-intensity': 0.55 });
      tmap.addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [180, 45], 'sky-atmosphere-sun-intensity': 15 } });
      // the selected tab's layer, city weather badges and the live weather where the camera looks
      terrainLayer(S.current.pendingKey || key); twCities(); twUpdate(true);
      clearInterval(S.current.tw.ticker); S.current.tw.ticker = setInterval(() => twUpdate(false), 2000); // follows fly-to and panning
      const pakData = HAS_PAK_BOUNDARY ? PAK_BOUNDARY : (COUNTRIES ? { type: 'FeatureCollection', features: COUNTRIES.features.filter(f => f.properties.i === 'PAK') } : null);
      if (pakData) {
        tmap.addSource('pak', { type: 'geojson', data: pakData });
        tmap.addLayer({ id: 'pak-glow', type: 'line', source: 'pak', filter: ['!=', ['get', 'disputed'], true], paint: { 'line-color': ACCENT, 'line-width': 9, 'line-blur': 7, 'line-opacity': .6 } });
        tmap.addLayer({ id: 'pak-line', type: 'line', source: 'pak', filter: ['!=', ['get', 'disputed'], true], paint: { 'line-color': '#ffffff', 'line-width': 1.6 } });
        tmap.addLayer({ id: 'pak-disputed', type: 'line', source: 'pak', filter: ['==', ['get', 'disputed'], true], paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-dasharray': [2, 2] } });
      }
    });
    FC_CITIES.forEach(c => {
      const el = document.createElement('div'); el.className = 'tCity'; el.title = 'Open the 7-day forecast for ' + c.n;
      el.innerHTML = '<span class="wxi"></span><span>' + c.n + '</span><span class="tt"></span>';
      el.addEventListener('click', e => { e.stopPropagation(); openRef.current(c.n); });
      new mapboxgl.Marker({ element: el, anchor: 'left' }).setLngLat(c.ll).addTo(tmap);
      S.current.tw.cityEls[c.n] = el;
    });
    // Slow orbit until the user takes over (drag, scroll, touch); the ⟳ chip resumes it.
    const stop = () => { S.current.spin = false; setSpin(false); };
    ['mousedown', 'touchstart', 'wheel'].forEach(ev => tmap.getCanvasContainer().addEventListener(ev, stop, { passive: true }));
    (function orbit() { S.current.orbit = requestAnimationFrame(orbit); if (onRef.current && S.current.spin && !tmap.isMoving()) tmap.setBearing(tmap.getBearing() + 0.05); })();
  }

  useEffect(() => {
    if (!on) return;
    ensureMapboxGL().then(() => {
      if (!onRef.current) return;
      const { tmap } = S.current;
      if (!tmap) initTerrain(active);
      else { tmap.resize(); if (S.current.layerKey !== active) terrainLayer(active); }
    }).catch(e => { toast('3D terrain unavailable: ' + e.message); onFail(); });
  }, [on]);
  useEffect(() => { S.current.pendingKey = active; if (on && S.current.tmap) terrainLayer(active); }, [active]);
  useEffect(() => {
    const resize = () => { if (S.current.tmap && onRef.current) S.current.tmap.resize(); };
    addEventListener('resize', resize);
    return () => {
      removeEventListener('resize', resize);
      const s = S.current; clearInterval(s.tw.ticker); clearInterval(s.tw.flash); cancelAnimationFrame(s.orbit); cancelAnimationFrame(s.windAnim);
      if (s.tmap) s.tmap.remove();
    };
  }, []);

  const fly = (pl, i) => { const { tmap } = S.current; if (!tmap) return; setPlace(i); tmap.flyTo({ center: pl.c, zoom: pl.z, pitch: pl.p, bearing: pl.b, duration: 4500, essential: true }); };
  return (
    <>
      <div id="terrain3d"></div>
      <div id="tFlash" ref={flash}></div>
      <div id="terrainNav" aria-label="Fly to">
        <b>Fly to</b>
        {PLACES.map((pl, i) => <button key={pl.n} type="button" className={place === i ? 'on' : ''} onClick={() => fly(pl, i)}>{pl.n}</button>)}
        <button type="button" className={'spin' + (spin ? ' on' : '')} onClick={() => { S.current.spin = !S.current.spin; setSpin(S.current.spin); }}>⟳ Auto-rotate</button>
        <span className="twx" id="tWx">{wx}</span>
      </div>
    </>
  );
}
