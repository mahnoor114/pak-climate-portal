"""Serve the dashboard and its AI assistant.

Run:  python portal_server.py        then open http://localhost:8000/Pak%20Climate.html

The page itself is static. This server adds one endpoint, POST /api/chat, which forwards the
question to Claude together with the portal's data (lib/indices.js) and a snapshot of what the
page is showing, and streams the answer back as server-sent events.

The chat panel can use two assistants with the same portal data:
- Claude: set ANTHROPIC_API_KEY (or log in once with `ant auth login`).
- Grok (xAI): set XAI_API_KEY (from console.x.ai).
Keys stay on this machine; the browser never sees them.
"""
import datetime as dt
import http.client
import io
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import anthropic

ROOT = os.path.dirname(os.path.abspath(__file__))
INDICES = os.path.join(ROOT, 'lib', 'indices.js')
PORT = int(os.environ.get('PORTAL_PORT', '8000'))
MODEL = 'claude-opus-5-5'
MAX_HISTORY = 20  # messages kept from the browser-side conversation
# Grok (xAI) as a second assistant. Key from console.x.ai, set as XAI_API_KEY; it never reaches the browser.
XAI_URL = 'https://api.x.ai/v1/chat/completions'
XAI_MODEL = 'grok-4.7'
NO_XAI_KEY = ('Grok is not connected yet: no xAI API key found. Set XAI_API_KEY (from console.x.ai) '
              'and restart portal_server.py, or switch the assistant back to Claude.')
NO_KEY = ('The AI assistant is not connected yet: no Claude API key found. Set ANTHROPIC_API_KEY '
          '(or run `ant auth login`) and restart portal_server.py.')

PORTAL_GUIDE = """You are the built-in assistant of the "Pakistan Climate Driver Intelligence" dashboard, a prototype
early-warning portal that tracks the large-scale climate drivers behind Pakistan's weather. Answer
questions about the portal: what it shows, what the current numbers mean, how they are computed,
where the data comes from, and how to use it.

How to answer:
- Ground every number in the portal data below or the live page snapshot sent with the question.
  Quote the value, its unit and its month (e.g. "Niño 3.4 was +1.89 °C in Aug 26"). Never invent data.
- If the data cannot answer the question, say so plainly and suggest where to look (the source
  links below). You are not an official forecast service; for warnings point people to the
  Pakistan Meteorological Department (pmd.gov.pk) and NDMA.
- Be concise: a short direct answer first, then a few supporting points. Plain language for
  non-specialists; explain terms like "σ" or "anomaly" when you use them.
- Reply in the language the user writes in (English or Urdu, including Roman Urdu).
- The chat panel is narrow and renders only short paragraphs, "-" bullet lists, **bold** and
  `code`. Do not use tables or headings.

PORTAL LAYOUT
- Top bar: title, "3D" button (switches the flat map to a rotating satellite globe; press "2D" to go
  back), clock in Pakistan time (PKT).
- Left panel "Current influence index": four 0-100 scores - Monsoon, Winter precipitation, Heat
  risk, Flood-supporting signal. 50 = normal, >=60 "Above normal", <=40 "Below normal". Clicking a
  row opens the driver that currently contributes most to it.
- Bottom bar: 11 driver buttons. Clicking one switches the map layer and opens its driver card
  (satellite globe, latest value, change vs previous month, chart, description, source links).
- Right panels: "Driver influence trend" (monthly scores for the last 12 months; legend toggles
  lines), "Current contribution to signal" (doughnut: each driver's share of current anomaly
  strength |z|; click a slice to open it), "Forecast horizon" tiles (0-10 days synoptic: Jet + WD +
  MJO; 10-45 days subseasonal: MJO + SST + ENSO; 1-3 months seasonal: ENSO + IOD + SST; 3-12 months
  climate: ENSO + AO + NAO + Snow), and the active-layer card with an earth.nullschool link.
- "⛰ Terrain" button: a 3D view of Pakistan's real terrain (Mapbox satellite imagery and elevation,
  heights exaggerated 1.7x) that slowly rotates. Its "Fly to" bar visits K2 & Karakoram, Nanga Parbat,
  Hunza, Hindu Kush, Tarbela Dam, Islamabad, Quetta, the Indus Delta and all of Pakistan. City labels
  open that city's forecast. Purely visual.
- "🌦 Forecast" button opens on a whole-Pakistan forecast map (Open-Meteo 0.75° grid covering the official
  boundary, 7 days): pick a day and Rain / Chance of rain / Max temp / Min temp / Max wind; hover for values,
  click anywhere for that spot's full forecast. Pakistan's 167 districts are outlined (from the user's
  Pakistan_Districts.geojson); hovering shows the district average. When this map is open the snapshot has
  "forecast_map" with the day, variable, "top_districts" (highest district averages) and each city's value;
  the city/point tab also has a search box for any district. Its second tab has forecasts for 14 Pakistani cities from Open-Meteo (free; global weather
  models such as ECMWF, GFS and DWD ICON, best model chosen per location), refreshed at most every 30 min:
  current conditions, a 7-day outlook (high/low, rain amount and chance, wind, gusts, UV, sunrise/sunset)
  and a 48-hour chart of temperature, rain and wind. When the forecast window is open, the page snapshot
  includes the shown city's forecast as "forecast_shown" - quote it when asked about upcoming weather.
  These are model forecasts, not official warnings.
- Air quality (same Forecast window, from Open-Meteo / Copernicus CAMS, 5 days): the map's "Air" row shows US AQI,
  smog particles PM2.5 and PM10 (µg/m³), aerosol optical depth (AOD: haze in the whole air column, 0 clear,
  >1 very hazy) and dust. The city/point view has an air card ("air_quality_now" in the snapshot) with AQI,
  category, health advice and the worst AQI in the next 24 h. US AQI bands: 0-50 Good, 51-100 Moderate,
  101-150 Unhealthy for sensitive groups, 151-200 Unhealthy, 201-300 Very unhealthy, 301+ Hazardous. Give health
  advice from these bands; for official smog alerts refer people to the Punjab EPD / Pak-EPA.

DRIVERS (key: name - what the data series is)
- enso: ENSO - Niño 3.4 sea-surface temperature anomaly (°C). >=+0.5 El Niño, <=-0.5 La Niña, else neutral.
- iod: Indian Ocean Dipole - Dipole Mode Index (°C). >=+0.4 positive, <=-0.4 negative, else neutral.
- mjo: MJO convection - MJO index (σ), pentad data.
- sst: Arabian Sea SST (°C).
- bengal: Bay of Bengal SST (°C).
- wd: Western disturbances - monthly precipitation at one grid point over northern Pakistan
  (34°N 72°E) from NASA POWER / MERRA-2.
- jet: Jet stream - live 250 hPa wind speed along 30-35°N from the GFS model (via Open-Meteo),
  fetched once a day by the page; not in the data file.
- tibet: Tibetan Plateau temperature (°C).
- ao: Arctic Oscillation index; nao: North Atlantic Oscillation index (>=0 positive phase).
- snow: Eurasian snow cover (million km²).
Every monthly series also carries z: its standardized anomaly against its own 1991-2020 climatology
for that calendar month (z = +2 means two standard deviations above normal for that month).

HOW THE SCORES ARE COMPUTED (a transparent heuristic, not a model forecast)
score = clamp(0..100, round(50 + 25 * sum(weight_k * z_k) / sum(|weight_k|))), using each driver's
latest z. Weights:
- Monsoon: enso -1, iod +0.8, sst +0.5, bengal +0.5, tibet +0.5, mjo +0.3
- Winter precipitation: enso +0.7, nao +0.5, wd +0.6
- Heat risk: tibet +1, sst +0.6, bengal +0.4, enso +0.3
- Flood-supporting signal: sst +0.6, bengal +0.4, iod +0.5, enso -0.4, wd +0.5
The "led by" driver is the one with the largest |weight * z|. The trend chart recomputes the same
scores month by month (a lagging series carries its last value forward; MJO is left out there).

KNOWN LIMITATIONS - mention them when relevant
- The "western disturbance" series is total rainfall at a single point, so in summer (Jun-Sep) it
  is mostly MONSOON rain, not western-disturbance rain. A high WD value in Jul/Aug therefore
  inflates the Winter and Flood scores. Western disturbances mainly matter Dec-Apr.
- Monthly data lags by about a month (NASA POWER, NOAA). Check "updated" and each series' last
  label before calling something "current".
- Map layers are live NASA GIBS satellite tiles and live GFS winds; they are imagery for context and
  are not used in the scores.
- To refresh the data file: run `python update_data.py` in the dashboard folder.

PORTAL DATA FILE (lib/indices.js, JSON; each series has labels, values, z, unit, source, url):
"""


def load_data():
    with open(INDICES, encoding='utf-8') as f:
        txt = f.read()
    m = re.search(r'=\s*(\{.*\})\s*;?\s*$', txt, re.S)
    return m.group(1) if m else txt


client = anthropic.Anthropic()

# ---- Open-Meteo rate limiting ----
# Open-Meteo's free plan counts every location in a request as one call: ~600/minute and ~10,000/day per IP.
# Every Open-Meteo request (wind, Pakistan grid, city forecasts) goes through open_meteo_json(), which keeps
# the total under OM_POINTS_PER_MINUTE by waiting when needed.
OM_POINTS_PER_MINUTE = 400
_om_lock = threading.Lock()
_om_recent = []  # (timestamp, points)


def open_meteo_json(url, points):
    while True:
        with _om_lock:
            now = time.time()
            _om_recent[:] = [(t, n) for t, n in _om_recent if now - t < 60]
            used = sum(n for _, n in _om_recent)
            if used + points <= OM_POINTS_PER_MINUTE or not _om_recent:
                _om_recent.append((now, points))
                break
            wait = 60 - (now - _om_recent[0][0]) + 0.5
        time.sleep(wait)
    # Retry dropped connections, truncated replies and 5xx errors (up to 3 tries). 4xx answers such as 429
    # "limit reached" are raised at once - retrying them would only use up more of the quota.
    req = urllib.request.Request(url, headers={'User-Agent': 'PakClimateDashboard/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code < 500 or attempt == 2:
                raise
        except (http.client.HTTPException, urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
            if attempt == 2:
                raise
        time.sleep(5 * (attempt + 1) ** 2)  # 5 s, then 20 s


# ---- Shared upper-level wind (jet stream / western disturbances) ----
# Open-Meteo counts every grid point as one API call against a free limit of ~10,000/day per IP, so
# browsers must not each fetch it. The global 7.5° grid below is 1,008 points; refreshing every 6 h
# (the GFS update cycle) uses ~4,000 calls/day. The server keeps the last good copy on disk and backs
# off after a failure. The page reads the grid from the payload, so the two can't drift apart.
WIND_CACHE = os.path.join(ROOT, 'lib', 'wind_cache.json')
WIND_MAX_AGE = 6 * 3600
WIND_RETRY_AFTER = 30 * 60   # wait this long after a failed fetch
WG = dict(lat0=-75, lon0=-180, step=7.5, ny=21, nx=48)  # whole globe: 75°S-75°N, 180°W-172.5°E
WIND_ROWS_PER_REQUEST = 3    # 144 points per request keeps the URL short
_wind_lock = threading.Lock()


def _fetch_wind():
    d = {'250': {'u': [], 'v': []}, '500': {'u': [], 'v': []}}
    model_time = ''
    for j0 in range(0, WG['ny'], WIND_ROWS_PER_REQUEST):
        la, lo = [], []
        for j in range(j0, min(j0 + WIND_ROWS_PER_REQUEST, WG['ny'])):
            for i in range(WG['nx']):
                la.append(WG['lat0'] + j * WG['step'])
                lo.append(WG['lon0'] + i * WG['step'])
        url = ('https://api.open-meteo.com/v1/gfs?latitude=' + ','.join(map(str, la)) + '&longitude=' + ','.join(map(str, lo))
               + '&current=wind_speed_250hPa,wind_direction_250hPa,wind_speed_500hPa,wind_direction_500hPa&wind_speed_unit=ms')
        js = open_meteo_json(url, len(la))
        js = js if isinstance(js, list) else [js]
        if len(js) != len(la):
            raise ValueError(f'Open-Meteo returned {len(js)} points, expected {len(la)}')
        for o in js:
            cur = o.get('current') or {}
            model_time = model_time or cur.get('time', '')
            for lv in ('250', '500'):
                s = cur.get(f'wind_speed_{lv}hPa') or 0
                a = math.radians(cur.get(f'wind_direction_{lv}hPa') or 0)
                d[lv]['u'].append(round(-s * math.sin(a), 2))
                d[lv]['v'].append(round(-s * math.cos(a), 2))
    return {'fetched': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'), 'model_time': model_time, 'grid': WG, 'd': d}


def _read_cache():
    """Return (payload, age_seconds) for a cache matching the current grid, else (None, None)."""
    try:
        with open(WIND_CACHE, encoding='utf-8') as f:
            cached = json.load(f)
        if cached.get('grid') == WG:
            return cached, time.time() - os.path.getmtime(WIND_CACHE)
    except (OSError, ValueError):
        pass
    return None, None


_wind_status = 'Wind data is downloading (about 2 minutes after the server starts)'


def _refresh_wind_forever():
    """Background thread: keep lib/wind_cache.json fresh without ever making a page wait."""
    global _wind_status
    while True:
        cached, age = _read_cache()
        if cached is None or age >= WIND_MAX_AGE:
            try:
                fresh = _fetch_wind()
                with _wind_lock:
                    with open(WIND_CACHE, 'w', encoding='utf-8') as f:
                        json.dump(fresh, f)
                _wind_status = ''
                print(f'Wind data refreshed ({fresh["fetched"]})', flush=True)
            except urllib.error.HTTPError as e:
                try:
                    reason = json.loads(e.read()).get('reason', '')
                except ValueError:
                    reason = ''
                _wind_status = f'Open-Meteo refused the request ({e.code}{": " + reason if reason else ""})'
                print(_wind_status, flush=True)
                time.sleep(WIND_RETRY_AFTER)
                continue
            except (urllib.error.URLError, OSError, ValueError) as e:
                _wind_status = f'Open-Meteo unreachable ({e})'
                print(_wind_status, flush=True)
                time.sleep(WIND_RETRY_AFTER)
                continue
        time.sleep(300)


# ---- City forecasts (Open-Meteo, free; credit "Weather data: Open-Meteo") ----
# Fetched when a city is opened and cached for FORECAST_MAX_AGE, so repeat views cost no API calls.
FORECAST_MAX_AGE = 30 * 60
FORECAST_URL = ('https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&timezone=Asia%2FKarachi'
                '&forecast_days=7&wind_speed_unit=kmh'
                '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,'
                'wind_direction_10m,wind_gusts_10m,precipitation,cloud_cover,is_day'
                '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m'
                '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,'
                'wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset')
_forecasts = {}  # (lat, lon) -> (fetched_at, payload)
_forecast_lock = threading.Lock()


def get_forecast(lat, lon):
    """Return (payload, error) for a point, from cache when fresh. Falls back to a stale copy if Open-Meteo fails."""
    key = (round(lat, 2), round(lon, 2))
    with _forecast_lock:
        hit = _forecasts.get(key)
    if hit and time.time() - hit[0] < FORECAST_MAX_AGE:
        return hit[1], None
    try:
        payload = open_meteo_json(FORECAST_URL.format(lat=key[0], lon=key[1]), 1)
        payload['fetched'] = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        with _forecast_lock:
            _forecasts[key] = (time.time(), payload)
        return payload, None
    except (urllib.error.URLError, OSError, ValueError) as e:
        if hit:
            return dict(hit[1], stale=True), None
        return None, f'Forecast service unavailable ({e})'


# ---- Whole-Pakistan daily forecast grid (Open-Meteo) ----
# 0.75° grid (~80 km) covering Pakistan's official boundary (incl. Jammu & Kashmir): 20 x 26 = 520 points, 7 days.
# Refreshed in the background every 6 h (~2,100 calls/day); the page draws it as a smooth colour map clipped to the boundary.
PAK_GRID = dict(lat0=23.5, lon0=60.75, step=0.75, ny=20, nx=26)   # 23.5-37.75°N, 60.75-79.5°E
PAK_CACHE = os.path.join(ROOT, 'lib', 'pak_forecast_cache.json')
PAK_CITIES = {  # name: (lat, lon) - same as FC_CITIES in Pak Climate.html
    'Islamabad': (33.69, 73.05), 'Lahore': (31.55, 74.34), 'Karachi': (24.86, 67.01), 'Peshawar': (34.01, 71.58),
    'Quetta': (30.18, 66.99), 'Multan': (30.20, 71.47), 'Faisalabad': (31.42, 73.08), 'Hyderabad': (25.40, 68.37),
    'Sukkur': (27.70, 68.86), 'Gwadar': (25.13, 62.32), 'Muzaffarabad': (34.37, 73.47), 'Gilgit': (35.92, 74.31),
    'Skardu': (35.30, 75.63), 'Chitral': (35.85, 71.79)}
PAK_MAX_AGE = 6 * 3600
PAK_VARS = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
            'precipitation_probability_max', 'wind_speed_10m_max']
_pak_status = 'The Pakistan forecast map is being prepared (about 1 minute after the server starts)'


def _fetch_pak_grid():
    g = PAK_GRID
    out = {v: None for v in PAK_VARS}
    days = None
    for j0 in range(0, g['ny'], 5):  # 5 rows = 130 points per request
        la, lo = [], []
        for j in range(j0, min(j0 + 5, g['ny'])):
            for i in range(g['nx']):
                la.append(round(g['lat0'] + j * g['step'], 2))
                lo.append(round(g['lon0'] + i * g['step'], 2))
        url = ('https://api.open-meteo.com/v1/forecast?latitude=' + ','.join(map(str, la)) + '&longitude=' + ','.join(map(str, lo))
               + '&timezone=Asia%2FKarachi&forecast_days=7&wind_speed_unit=kmh&daily=' + ','.join(PAK_VARS))
        js = open_meteo_json(url, len(la))
        js = js if isinstance(js, list) else [js]
        if len(js) != len(la):
            raise ValueError(f'Open-Meteo returned {len(js)} points, expected {len(la)}')
        for o in js:
            daily = o.get('daily') or {}
            days = days or daily.get('time')
            for v in PAK_VARS:
                vals = daily.get(v) or [None] * len(days or [])
                if out[v] is None:
                    out[v] = [[] for _ in vals]
                for d, x in enumerate(vals):
                    out[v][d].append(x)
    # The ~80 km grid averages a mountain town with the peaks around it, so the city labels on the map use
    # each city's own point forecast (one extra request). Names and coordinates match FC_CITIES in the page.
    names = list(PAK_CITIES)
    url = ('https://api.open-meteo.com/v1/forecast?latitude=' + ','.join(str(PAK_CITIES[n][0]) for n in names)
           + '&longitude=' + ','.join(str(PAK_CITIES[n][1]) for n in names)
           + '&timezone=Asia%2FKarachi&forecast_days=7&wind_speed_unit=kmh&daily=' + ','.join(PAK_VARS))
    js = open_meteo_json(url, len(names))
    js = js if isinstance(js, list) else [js]
    cities = {n: {v: (o.get('daily') or {}).get(v) for v in PAK_VARS} for n, o in zip(names, js)}
    return {'fetched': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'), 'grid': g, 'days': days,
            'vars': out, 'cities': cities}


def _refresh_pak_grid_forever():
    global _pak_status
    while True:
        try:
            age = time.time() - os.path.getmtime(PAK_CACHE)
        except OSError:
            age = PAK_MAX_AGE
        if age >= PAK_MAX_AGE:
            try:
                fresh = _fetch_pak_grid()
                tmp = PAK_CACHE + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(fresh, f, separators=(',', ':'))
                os.replace(tmp, PAK_CACHE)
                _pak_status = ''
                print(f'Pakistan forecast grid refreshed ({fresh["fetched"]})', flush=True)
            except Exception as e:  # keep the last good copy; retry later
                _pak_status = f'Pakistan forecast temporarily unavailable ({e})'
                print(_pak_status, flush=True)
                time.sleep(WIND_RETRY_AFTER)
                continue
        time.sleep(300)


def get_pak_grid():
    try:
        with open(PAK_CACHE, encoding='utf-8') as f:
            payload = json.load(f)
        if payload.get('grid') == PAK_GRID:
            payload['stale'] = time.time() - os.path.getmtime(PAK_CACHE) >= PAK_MAX_AGE
            return payload, None
    except (OSError, ValueError):
        pass
    return None, _pak_status


# ---- Air quality: AQI, smog particles (PM2.5 / PM10), aerosol optical depth, dust (Open-Meteo / CAMS, free) ----
# Whole-Pakistan grid: same points as the weather grid, 5 days, hourly values reduced to daily figures here
# (AQI = daily worst hour; PM2.5, PM10, AOD = daily mean; dust = daily max). CAMS updates twice a day, so the
# grid is refreshed every 12 h (~1,000 calls/day) and kept on disk. Single points are cached for 60 min.
AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
AQ_HOURLY = ['us_aqi', 'pm2_5', 'pm10', 'aerosol_optical_depth', 'dust']
AQ_DAILY = {'us_aqi': max, 'pm2_5': 'mean', 'pm10': 'mean', 'aerosol_optical_depth': 'mean', 'dust': max}
AQ_CACHE = os.path.join(ROOT, 'lib', 'aq_cache.json')
AQ_MAX_AGE = 12 * 3600
AQ_POINT_MAX_AGE = 60 * 60
_aq_status = 'The air-quality map is being prepared (a few minutes after the server starts)'
_aq_points = {}
_aq_lock = threading.Lock()


def _aq_daily(hourly, days):
    """Reduce one location's hourly series to one value per day."""
    out = {}
    for v, how in AQ_DAILY.items():
        vals, times = hourly.get(v) or [], hourly.get('time') or []
        per_day = []
        for day in days:
            xs = [x for t, x in zip(times, vals) if t.startswith(day) and x is not None]
            if not xs:
                per_day.append(None)
            elif how == 'mean':
                per_day.append(round(sum(xs) / len(xs), 3 if v == 'aerosol_optical_depth' else 1))
            else:
                per_day.append(round(how(xs), 1))
        out[v] = per_day
    return out


def _fetch_aq_grid():
    g = PAK_GRID
    out = {v: None for v in AQ_DAILY}
    days = None

    def fetch(la, lo):
        url = (f'{AQ_URL}?latitude=' + ','.join(map(str, la)) + '&longitude=' + ','.join(map(str, lo))
               + '&timezone=Asia%2FKarachi&forecast_days=5&hourly=' + ','.join(AQ_HOURLY))
        js = open_meteo_json(url, len(la))
        js = js if isinstance(js, list) else [js]
        if len(js) != len(la):
            raise ValueError(f'air-quality service returned {len(js)} points, expected {len(la)}')
        return js

    for j0 in range(0, g['ny'], 2):  # 2 rows = 52 points: hourly replies are large, keep each one small
        la, lo = [], []
        for j in range(j0, min(j0 + 2, g['ny'])):
            for i in range(g['nx']):
                la.append(round(g['lat0'] + j * g['step'], 2))
                lo.append(round(g['lon0'] + i * g['step'], 2))
        for o in fetch(la, lo):
            h = o.get('hourly') or {}
            days = days or sorted({t[:10] for t in h.get('time', [])})
            daily = _aq_daily(h, days)
            for v in AQ_DAILY:
                if out[v] is None:
                    out[v] = [[] for _ in days]
                for d, x in enumerate(daily[v]):
                    out[v][d].append(x)
    names = list(PAK_CITIES)
    cities = {n: _aq_daily(o.get('hourly') or {}, days)
              for n, o in zip(names, fetch([PAK_CITIES[n][0] for n in names], [PAK_CITIES[n][1] for n in names]))}
    return {'fetched': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC'), 'grid': g, 'days': days,
            'vars': out, 'cities': cities}


def _refresh_aq_forever():
    global _aq_status
    while True:
        try:
            age = time.time() - os.path.getmtime(AQ_CACHE)
        except OSError:
            age = AQ_MAX_AGE
        if age >= AQ_MAX_AGE:
            try:
                fresh = _fetch_aq_grid()
                tmp = AQ_CACHE + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(fresh, f, separators=(',', ':'))
                os.replace(tmp, AQ_CACHE)
                _aq_status = ''
                print(f'Air-quality grid refreshed ({fresh["fetched"]})', flush=True)
            except Exception as e:  # keep the last good copy; retry later
                _aq_status = f'Air-quality map temporarily unavailable ({e})'
                print(_aq_status, flush=True)
                time.sleep(WIND_RETRY_AFTER)
                continue
        time.sleep(600)


def get_aq_grid():
    try:
        with open(AQ_CACHE, encoding='utf-8') as f:
            payload = json.load(f)
        if payload.get('grid') == PAK_GRID:
            payload['stale'] = time.time() - os.path.getmtime(AQ_CACHE) >= AQ_MAX_AGE
            return payload, None
    except (OSError, ValueError):
        pass
    return None, _aq_status


def get_aq_point(lat, lon):
    """Current air quality + next 48 h for one point, cached for AQ_POINT_MAX_AGE (stale copy if the service fails)."""
    key = (round(lat, 2), round(lon, 2))
    with _aq_lock:
        hit = _aq_points.get(key)
    if hit and time.time() - hit[0] < AQ_POINT_MAX_AGE:
        return hit[1], None
    try:
        url = (f'{AQ_URL}?latitude={key[0]}&longitude={key[1]}&timezone=Asia%2FKarachi&forecast_days=3'
               '&current=us_aqi,pm2_5,pm10,aerosol_optical_depth,dust,ozone,nitrogen_dioxide&hourly=us_aqi,pm2_5')
        payload = open_meteo_json(url, 1)
        payload['fetched'] = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        with _aq_lock:
            _aq_points[key] = (time.time(), payload)
        return payload, None
    except (urllib.error.URLError, OSError, ValueError) as e:
        if hit:
            return dict(hit[1], stale=True), None
        return None, f'Air-quality service unavailable ({e})'


DATA_MAX_AGE = 24 * 3600  # refresh lib/indices.js once a day


def _refresh_climate_data_forever():
    """Background thread: run update_data.py's download when lib/indices.js is over a day old."""
    import update_data
    while True:
        try:
            age = time.time() - os.path.getmtime(INDICES)
        except OSError:
            age = DATA_MAX_AGE
        if age >= DATA_MAX_AGE:
            print('Refreshing climate data (NOAA, NASA, Rutgers)...', flush=True)
            try:
                update_data.update()
            except Exception as e:  # keep the last good file; try again in an hour
                print(f'Climate data refresh failed: {e}', flush=True)
                time.sleep(3600)
                continue
        time.sleep(1800)


def get_wind():
    """Return (payload, error). payload carries 'stale': True when it is older than WIND_MAX_AGE."""
    with _wind_lock:
        cached, age = _read_cache()
    if cached:
        return dict(cached, stale=age >= WIND_MAX_AGE), None
    return None, _wind_status


# The portal folder is on a network drive that can stall for seconds at a time. Static files are kept in
# memory after the first read; each file's timestamp is re-checked at most every STATIC_RECHECK seconds,
# so edits still show up quickly without a disk round trip on every request.
STATIC_RECHECK = 10
_static = {}  # path -> {'mtime', 'data', 'checked'}
_static_lock = threading.Lock()


def static_file(path):
    """Return (bytes, mtime) for a file under ROOT, or None if it doesn't exist."""
    now = time.time()
    with _static_lock:
        hit = _static.get(path)
        if hit and now - hit['checked'] < STATIC_RECHECK:
            return hit['data'], hit['mtime']
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    with _static_lock:
        hit = _static.get(path)
        if hit and hit['mtime'] == mtime:
            hit['checked'] = now
            return hit['data'], mtime
    with open(path, 'rb') as f:
        data = f.read()
    with _static_lock:
        _static[path] = {'mtime': mtime, 'data': data, 'checked': now}
    return data, mtime


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def send_head(self):
        """Serve regular files from the in-memory cache (with ETag revalidation); defer everything else."""
        path = self.translate_path(self.path)
        if not os.path.basename(path) or os.path.isdir(path):
            return super().send_head()
        got = static_file(path)
        if got is None:
            self.send_error(404, 'File not found')
            return None
        data, mtime = got
        etag = f'"{int(mtime * 1000):x}-{len(data):x}"'
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.end_headers()
            return None
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('ETag', etag)
        self.send_header('Cache-Control', 'no-cache')  # browser revalidates (cheap 304) so edits appear on reload
        self.end_headers()
        return io.BytesIO(data)

    def send_json(self, payload, error=None, max_age=0):
        """JSON reply; 503 with the error when there is no payload. max_age lets the browser reuse the answer
        for that many seconds without asking again (browser-side buffering on top of the server caches)."""
        body = json.dumps(payload if payload is not None else {'error': error}, separators=(',', ':')).encode('utf-8')
        self.send_response(200 if payload is not None else 503)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', f'max-age={max_age}' if payload is not None and max_age else 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def query_latlon(self):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        try:
            lat, lon = float(q['lat'][0]), float(q['lon'][0])
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return lat, lon
        except (KeyError, ValueError, IndexError):
            pass
        self.send_error(400, 'Expected ?lat=..&lon=..')
        return None

    def do_GET(self):
        route = self.path.split('?')[0]
        if route == '/api/pakforecast':
            return self.send_json(*get_pak_grid(), max_age=300)
        if route == '/api/aqmap':
            return self.send_json(*get_aq_grid(), max_age=300)
        if route in ('/api/forecast', '/api/airquality'):
            ll = self.query_latlon()
            if ll:
                self.send_json(*(get_forecast(*ll) if route == '/api/forecast' else get_aq_point(*ll)), max_age=300)
            return
        if route == '/api/wind':
            return self.send_json(*get_wind(), max_age=300)
        if route == '/api/ai-status':
            # Which assistants can answer through this server. Only yes/no - the keys never leave the machine.
            # Without a key the page uses that AI free through Puter instead.
            return self.send_json({'claude': bool(os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_AUTH_TOKEN')),
                                   'grok': bool(os.environ.get('XAI_API_KEY'))})
        if route == '/api/guide':
            # Same instructions and data Claude and Grok receive, for the in-browser (Puter) assistant. No secrets.
            return self.send_json({'text': PORTAL_GUIDE + load_data()})
        return super().do_GET()

    def send_event(self, kind, payload):
        self.wfile.write(f'event: {kind}\ndata: {json.dumps(payload)}\n\n'.encode('utf-8'))
        self.wfile.flush()

    def do_POST(self):
        if self.path != '/api/chat':
            self.send_error(404)
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            history = [m for m in body.get('messages', []) if m.get('role') in ('user', 'assistant') and isinstance(m.get('content'), str) and m['content'].strip()]
            history = history[-MAX_HISTORY:]
            while history and history[0]['role'] != 'user':
                history.pop(0)
            if not history or history[-1]['role'] != 'user':
                raise ValueError('no question')
        except (ValueError, KeyError, TypeError):
            self.send_error(400, 'Expected {"messages": [...], "page": {...}}')
            return

        # The live page snapshot changes on every question, so it goes in the newest user turn,
        # after the cached system prompt.
        page = json.dumps(body.get('page', {}), ensure_ascii=False)
        history[-1] = {'role': 'user', 'content': f'<page_snapshot>{page}</page_snapshot>\n\n{history[-1]["content"]}'}

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        try:
            if body.get('provider') == 'grok':
                self.answer_grok(history)
            else:
                self.answer_claude(history)
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser closed the panel mid-answer

    def answer_grok(self, history):
        """Stream an answer from xAI's Grok (OpenAI-compatible chat completions, server-sent events)."""
        key = os.environ.get('XAI_API_KEY')
        if not key:
            self.send_event('error', NO_XAI_KEY)
            return
        req = urllib.request.Request(
            XAI_URL, method='POST',
            data=json.dumps({'model': XAI_MODEL, 'stream': True, 'max_tokens': 4000,
                             'messages': [{'role': 'system', 'content': PORTAL_GUIDE + load_data()}] + history}).encode('utf-8'),
            headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'User-Agent': 'PakClimateDashboard/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                for raw in r:
                    line = raw.decode('utf-8').strip()
                    if not line.startswith('data:'):
                        continue
                    data = line[5:].strip()
                    if data == '[DONE]':
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    for choice in chunk.get('choices', []):
                        text = (choice.get('delta') or {}).get('content')
                        if text:
                            self.send_event('text', text)
                        if choice.get('finish_reason') == 'length':
                            self.send_event('text', '\n\n…(answer cut off - ask me to continue)')
            self.send_event('done', '')
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                self.send_event('error', 'xAI rejected the Grok API key. Check XAI_API_KEY and restart portal_server.py.')
            elif e.code == 429:
                self.send_event('error', 'Grok: too many requests or out of credit - try again later.')
            else:
                detail = e.read().decode('utf-8', 'replace')[:200]
                self.send_event('error', f'Grok API error {e.code}: {detail}')
        except (urllib.error.URLError, TimeoutError) as e:
            self.send_event('error', f'Could not reach the Grok API ({e}).')

    def answer_claude(self, history):
        try:
            with client.beta.messages.stream(
                model=MODEL,
                max_tokens=16000,
                output_config={'effort': 'medium'},
                system=[{'type': 'text', 'text': PORTAL_GUIDE + load_data(), 'cache_control': {'type': 'ephemeral'}}],
                messages=history,
                betas=['server-side-fallback-2026-07-01'],
                fallbacks='default',  # if Claude declines, the API retries on its recommended fallback model
            ) as stream:
                for text in stream.text_stream:
                    self.send_event('text', text)
                final = stream.get_final_message()
            if final.stop_reason == 'refusal':
                self.send_event('error', 'The assistant declined to answer that question.')
            elif final.stop_reason == 'max_tokens':
                self.send_event('text', '\n\n…(answer cut off - ask me to continue)')
            self.send_event('done', '')
        except anthropic.AuthenticationError:
            self.send_event('error', NO_KEY)
        except anthropic.RateLimitError:
            self.send_event('error', 'Too many requests right now - try again in a minute.')
        except anthropic.APIStatusError as e:
            self.send_event('error', f'Claude API error {e.status_code}: {e.message}')
        except anthropic.APIConnectionError:
            self.send_event('error', 'Could not reach the Claude API - check the internet connection.')
        except (BrokenPipeError, ConnectionResetError):
            raise
        except Exception as e:
            # With no credentials at all, the SDK fails before sending the request.
            self.send_event('error', NO_KEY if 'authentication' in str(e).lower() else f'Assistant unavailable: {e}')


if __name__ == '__main__':
    print(f'Portal: http://localhost:{PORT}/Pak%20Climate.html', flush=True)
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('Note: ANTHROPIC_API_KEY is not set - the Claude assistant will only work with an `ant auth login` profile.', flush=True)
    if not os.environ.get('XAI_API_KEY'):
        print('Note: XAI_API_KEY is not set - the Grok assistant is unavailable until it is.', flush=True)
    threading.Thread(target=_refresh_wind_forever, daemon=True).start()
    threading.Thread(target=_refresh_climate_data_forever, daemon=True).start()
    threading.Thread(target=_refresh_pak_grid_forever, daemon=True).start()
    threading.Thread(target=_refresh_aq_forever, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
