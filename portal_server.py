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
import json
import math
import os
import re
import threading
import time
import urllib.error
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
  (Islamabad, Lahore, Karachi, Peshawar, Quetta, Gilgit) open that city's forecast. Purely visual.
- "🌦 Forecast" button: free meteoblue widgets - an animated live weather map (wind, gusts, rain and
  clouds, temperature, satellite, sunshine, extreme-forecast index) and a "City forecast" tab for the
  six cities above: current weather + 3-hourly forecast, a 7-day forecast, and links that open
  meteoblue's full forecast page, meteogram, 10-day, multi-model and seasonal outlook in a new tab. You cannot see the numbers inside these widgets; for a specific city forecast, tell
  the user to open it there.

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
WIND_REQUEST_GAP = 20        # seconds between requests: ~430 points/min, under the ~600/min limit
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
        req = urllib.request.Request(url, headers={'User-Agent': 'PakClimateDashboard/1.0'})
        if j0:
            time.sleep(WIND_REQUEST_GAP)
        with urllib.request.urlopen(req, timeout=90) as r:
            js = json.loads(r.read())
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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        route = self.path.split('?')[0]
        if route == '/api/ai-status':
            # Which assistants can answer through this server. Only yes/no - the keys never leave the machine.
            # Without a key the page uses that AI free through Puter instead.
            body = json.dumps({'claude': bool(os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_AUTH_TOKEN')),
                               'grok': bool(os.environ.get('XAI_API_KEY'))}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if route == '/api/guide':
            # Same instructions and data Claude and Grok receive, for the in-browser (Puter) assistant. No secrets.
            body = json.dumps({'text': PORTAL_GUIDE + load_data()}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if route != '/api/wind':
            return super().do_GET()
        payload, error = get_wind()
        body = json.dumps(payload if payload else {'error': error}).encode('utf-8')
        self.send_response(200 if payload else 503)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

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
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
