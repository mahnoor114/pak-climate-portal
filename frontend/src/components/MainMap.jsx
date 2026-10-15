import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MAPBOX_TOKEN, ACCENT, DRIVERS, SOURCES } from '../core/constants.js';
import { COUNTRIES, PAK_BOUNDARY, HAS_PAK_BOUNDARY, DISTRICTS, HAS_DISTRICTS, districtAt } from '../core/data.js';
import { gibsDay, gibsUrl } from '../core/tiles.js';
import { fetchWind, windAt, windColor, getWindDay, hasWind } from '../core/wind.js';
import { toast } from '../core/live.js';

// The 2D analytical map: driver regions, the driver's live NASA GIBS layer or the animated upper-level wind.
// visible=false while the 3D globe or terrain is shown (the map stays mounted, hidden by CSS).
export default function MainMap({ active, visible, onLiveSrc }) {
  const el = useRef(null), st = useRef(null), visibleRef = useRef(visible);
  visibleRef.current = visible;
  const liveSrcRef = useRef(onLiveSrc); liveSrcRef.current = onLiveSrc;

  useEffect(() => {
    const map = L.map(el.current, { zoomControl: false, attributionControl: true, minZoom: 2, worldCopyJump: true }).setView([30.3, 69.3], 4.2);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    // Pane order (bottom to top): dark basemap 150 -> coloured regions 180 -> live NASA GIBS tiles (tilePane 200) -> markers.
    // The live data tiles therefore draw over the colours, so SST anomalies etc. stay readable.
    map.createPane('basemap').style.zIndex = 150;
    map.createPane('regions').style.zIndex = 180;
    map.getPane('regions').style.pointerEvents = 'none';
    const base = L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=' + MAPBOX_TOKEN,
      { pane: 'basemap', tileSize: 512, zoomOffset: -1, maxZoom: 12, attribution: '&copy; <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener"><b>Improve this map</b></a>' }).addTo(map);
    let tileErrors = 0;
    base.on('tileerror', () => {
      if (++tileErrors === 6) { // Mapbox unreachable or token rejected: fall back to Esri's dark canvas
        map.removeLayer(base);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { pane: 'basemap', maxZoom: 10, attribution: '&copy; Esri' }).addTo(map);
      }
    });
    // Country borders: neighbours from Natural Earth (lib/countries.js) as neutral lines; Pakistan from the
    // official National_Boundary shapefile (lib/pak_boundary.js), with the disputed Jammu & Kashmir region dashed.
    if (COUNTRIES) {
      L.geoJSON(COUNTRIES, { pane: 'regions', interactive: false,
        filter: f => !(HAS_PAK_BOUNDARY && f.properties.i === 'PAK'),
        style: f => f.properties.i === 'PAK'
          ? { color: ACCENT, weight: 2, opacity: 1, fillColor: ACCENT, fillOpacity: .1, className: 'cty cty-pk' }
          : { color: '#94a3b8', weight: .7, opacity: .4, fill: false, className: 'cty' },
      }).addTo(map);
    }
    if (HAS_PAK_BOUNDARY) {
      map.createPane('pakBoundary').style.zIndex = 410; // above live data tiles (200) and overlays (400), below markers (600)
      L.geoJSON(PAK_BOUNDARY, { pane: 'pakBoundary',
        style: f => f.properties.disputed
          ? { color: ACCENT, weight: 1.6, opacity: .95, dashArray: '6 5', fillColor: ACCENT, fillOpacity: .05 }
          : { color: ACCENT, weight: 2, opacity: 1, fillColor: ACCENT, fillOpacity: .1, className: 'cty-pk' },
        onEachFeature: (f, l) => l.bindTooltip(f.properties.name, { sticky: true, className: 'pkTip' }),
      }).addTo(map);
    }
    if (HAS_DISTRICTS) { // district outlines once zoomed in
      const dl = L.geoJSON(DISTRICTS, { pane: 'pakBoundary', interactive: false, style: f => ({ color: '#cbd5e1', weight: .7, opacity: .5, fill: false, dashArray: f.properties.disputed ? '4 4' : null }) });
      const sync = () => { if (map.getZoom() >= 6) dl.addTo(map); else dl.remove(); };
      map.on('zoomend', sync); sync();
      map.on('mousemove', e => { const d = map.getZoom() >= 6 && districtAt(e.latlng.lat, e.latlng.lng); map.getContainer().title = d ? d.properties.n + ' district · ' + d.properties.p : ''; });
    }
    // one marker group per driver region
    const layers = {};
    DRIVERS.forEach(d => {
      const g = L.layerGroup();
      d.points.forEach(p => L.circleMarker(p, { radius: d.radius, color: d.color, fillColor: d.color, fillOpacity: .65, weight: 1.2 }).bindPopup(d.popup).addTo(g));
      layers[d.key] = g;
    });

    // Animated upper-level wind layer: speed colours on one canvas, particle trails on another
    const wind = { level: null, parts: [], raf: 0, w: 0, h: 0, moving: false };
    const windField = document.createElement('canvas'), windCv = document.createElement('canvas');
    windField.className = windCv.className = 'windcv';
    map.getContainer().appendChild(windField); map.getContainer().appendChild(windCv);
    function drawWindField() {
      // One pixel per 8x8 block on a small canvas, then scaled up with smoothing so the colours blend.
      const B = 8, sw = Math.ceil(wind.w / B), sh = Math.ceil(wind.h / B);
      const small = document.createElement('canvas'); small.width = sw; small.height = sh;
      const sc = small.getContext('2d'), img = sc.createImageData(sw, sh), px = img.data;
      for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
        const ll = map.containerPointToLatLng([i * B + B / 2, j * B + B / 2]), w = windAt(ll.lat, ll.lng, wind.level); if (!w) continue;
        const c = windColor(Math.hypot(w[0], w[1]), wind.level), o = (j * sw + i) * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 128;
      }
      sc.putImageData(img, 0, 0);
      const fx = windField.getContext('2d'); fx.clearRect(0, 0, wind.w, wind.h);
      fx.imageSmoothingEnabled = true; fx.imageSmoothingQuality = 'high';
      fx.drawImage(small, 0, 0, sw * B, sh * B);
    }
    const spawn = p => { p.x = Math.random() * wind.w; p.y = Math.random() * wind.h; p.age = Math.random() * 90 | 0; return p; };
    function resetWind() {
      if (!wind.level || !hasWind()) return;
      const sz = map.getSize(); if (!sz.x || !sz.y) return; // hidden (3D view): redrawn when shown again
      wind.w = sz.x; wind.h = sz.y;
      windField.width = windCv.width = wind.w; windField.height = windCv.height = wind.h;
      drawWindField();
      const n = Math.min(4000, (wind.w * wind.h / 450) | 0);
      wind.parts = []; for (let i = 0; i < n; i++) wind.parts.push(spawn({}));
    }
    function windFrame() {
      wind.raf = requestAnimationFrame(windFrame);
      if (!visibleRef.current || wind.moving || !wind.parts.length) return;
      const ctx = windCv.getContext('2d');
      ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,.93)'; ctx.fillRect(0, 0, wind.w, wind.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.1; ctx.beginPath();
      const k = wind.level === 250 ? .045 : .07;
      wind.parts.forEach(p => {
        const ll = map.containerPointToLatLng([p.x, p.y]), w = windAt(ll.lat, ll.lng, wind.level);
        if (!w || ++p.age > 110) { spawn(p); p.age = 0; return; }
        const nx = p.x + w[0] * k, ny = p.y - w[1] * k;
        ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); p.x = nx; p.y = ny;
      });
      ctx.stroke();
    }
    function startWind(level, label) {
      wind.level = level; wind.parts = [];
      windCv.getContext('2d').clearRect(0, 0, windCv.width, windCv.height);
      windField.classList.add('on'); windCv.classList.add('on');
      fetchWind().then(() => {
        if (wind.level !== level) return;
        liveSrcRef.current('LIVE LAYER: ' + label + ' · data ' + getWindDay());
        resetWind(); if (!wind.raf) windFrame();
      }).catch(() => { if (wind.level === level) toast('Wind data unavailable right now — try again later'); });
    }
    function stopWind() {
      wind.level = null; wind.parts = [];
      if (wind.raf) { cancelAnimationFrame(wind.raf); wind.raf = 0; }
      windField.classList.remove('on'); windCv.classList.remove('on');
    }
    map.on('movestart zoomstart', () => { if (!wind.level) return; wind.moving = true; windCv.getContext('2d').clearRect(0, 0, wind.w, wind.h); windField.getContext('2d').clearRect(0, 0, wind.w, wind.h); });
    map.on('moveend zoomend resize', () => { wind.moving = false; resetWind(); });

    let liveLayer = null, shown = null;
    function applyLive(key) {
      if (liveLayer) { map.removeLayer(liveLayer); liveLayer = null; }
      const s = SOURCES[key]; if (!s) return;
      if (s.wind) { liveSrcRef.current('LIVE LAYER: ' + s.label); startWind(s.wind, s.label); return; }
      stopWind();
      const [id, ext, lvl] = s.gibs;
      liveLayer = L.tileLayer(gibsUrl(id, ext, lvl), { maxZoom: lvl, opacity: .65, attribution: 'Live data: <a href="https://gibs.earthdata.nasa.gov" target="_blank" rel="noopener">NASA GIBS</a>' });
      // NASA GIBS occasionally answers with a temporary 500: retry a failed tile up to twice.
      liveLayer.on('tileerror', e => {
        const t = e.tile, n = +(t.dataset.retry || 0);
        if (n < 2) { t.dataset.retry = n + 1; setTimeout(() => { t.src = t.src.split('?')[0] + '?retry=' + (n + 1); }, 800 * (n + 1)); }
      });
      liveLayer.addTo(map);
      liveLayer.setZIndex(1);
      liveSrcRef.current('LIVE TILES: NASA GIBS — ' + s.label + (gibsDay(id) ? ' (yesterday, complete coverage)' : ''));
    }
    function setDriver(key) {
      if (shown) map.removeLayer(layers[shown]);
      shown = key; layers[key].addTo(map);
      applyLive(key);
    }
    st.current = { map, setDriver, resetWind };
    return () => { stopWind(); map.remove(); st.current = null; };
  }, []);

  useEffect(() => { st.current.setDriver(active); }, [active]);
  useEffect(() => { if (visible && st.current) { st.current.map.invalidateSize(); st.current.resetWind(); } }, [visible]);

  return <div id="map" ref={el}></div>;
}
