"""Store everything the portal fetches from external APIs in PostgreSQL (schema "climate_portal").

Connection settings come from environment variables (the password is never written to a file):
  PORTAL_DB_PASSWORD   required - without it, storing is switched off and the portal works as before
  PORTAL_DB_NAME       default "landslide portal 2 " (the existing database; note the trailing space)
  PORTAL_DB_HOST / PORTAL_DB_PORT / PORTAL_DB_USER   default localhost / 5432 / postgres

portal_server.py calls enqueue(...) after each successful download. Writes happen on a background thread, so a slow
or unavailable database never delays or breaks the portal. Every refresh is kept with its fetch time, so the
tables build up a history; the latest_* views show the most recent refresh only.

To load the data the portal already has on disk:  python portal_db.py --backfill
"""
import datetime as dt
import json
import os
import queue
import re
import threading

SCHEMA = 'climate_portal'
_q = queue.Queue()
_started = False
_lock = threading.Lock()

DDL = f'''
create schema if not exists {SCHEMA};
create table if not exists {SCHEMA}.fetch_log(
  id bigserial primary key, source text not null, fetched_at timestamptz not null,
  stored_at timestamptz not null default now(), rows_stored integer, note text);
create table if not exists {SCHEMA}.api_responses(
  id bigserial primary key, source text not null, fetched_at timestamptz not null,
  lat double precision, lon double precision, payload jsonb not null,
  unique(source, fetched_at, lat, lon));
create table if not exists {SCHEMA}.climate_indices(
  series text not null, period date not null, label text, value double precision, z double precision,
  unit text, title text, source text, updated_at timestamptz not null,
  primary key(series, period));
create table if not exists {SCHEMA}.mjo_index(
  day date primary key, index_80e double precision, index_100e double precision, updated_at timestamptz not null);
create table if not exists {SCHEMA}.wind(
  fetched_at timestamptz not null, model_time timestamp, grid text not null, level_hpa integer not null,
  lat double precision not null, lon double precision not null, u_ms double precision, v_ms double precision,
  speed_ms double precision, primary key(fetched_at, grid, level_hpa, lat, lon));
create table if not exists {SCHEMA}.weather_forecast_grid(
  fetched_at timestamptz not null, forecast_date date not null, lat double precision not null, lon double precision not null,
  weather_code integer, temp_max_c double precision, temp_min_c double precision, rain_mm double precision,
  rain_chance_pct double precision, wind_max_kmh double precision, primary key(fetched_at, forecast_date, lat, lon));
create table if not exists {SCHEMA}.weather_forecast_city(
  fetched_at timestamptz not null, city text not null, forecast_date date not null, weather_code integer,
  temp_max_c double precision, temp_min_c double precision, rain_mm double precision, rain_chance_pct double precision,
  wind_max_kmh double precision, primary key(fetched_at, city, forecast_date));
create table if not exists {SCHEMA}.air_quality_grid(
  fetched_at timestamptz not null, forecast_date date not null, lat double precision not null, lon double precision not null,
  us_aqi_max double precision, pm2_5_mean double precision, pm10_mean double precision, aod_mean double precision,
  dust_max double precision, primary key(fetched_at, forecast_date, lat, lon));
create table if not exists {SCHEMA}.air_quality_city(
  fetched_at timestamptz not null, city text not null, forecast_date date not null, us_aqi_max double precision,
  pm2_5_mean double precision, pm10_mean double precision, aod_mean double precision, dust_max double precision,
  primary key(fetched_at, city, forecast_date));
create index if not exists wind_latest_idx on {SCHEMA}.wind(fetched_at desc);
create index if not exists wfg_latest_idx on {SCHEMA}.weather_forecast_grid(fetched_at desc);
create index if not exists aqg_latest_idx on {SCHEMA}.air_quality_grid(fetched_at desc);
create or replace view {SCHEMA}.latest_wind as
  select * from {SCHEMA}.wind where fetched_at = (select max(fetched_at) from {SCHEMA}.wind);
create or replace view {SCHEMA}.latest_weather_forecast_grid as
  select * from {SCHEMA}.weather_forecast_grid where fetched_at = (select max(fetched_at) from {SCHEMA}.weather_forecast_grid);
create or replace view {SCHEMA}.latest_weather_forecast_city as
  select * from {SCHEMA}.weather_forecast_city where fetched_at = (select max(fetched_at) from {SCHEMA}.weather_forecast_city);
create or replace view {SCHEMA}.latest_air_quality_grid as
  select * from {SCHEMA}.air_quality_grid where fetched_at = (select max(fetched_at) from {SCHEMA}.air_quality_grid);
create or replace view {SCHEMA}.latest_air_quality_city as
  select * from {SCHEMA}.air_quality_city where fetched_at = (select max(fetched_at) from {SCHEMA}.air_quality_city);
'''

MONTHS = {m: i for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], 1)}


def enabled():
    return bool(os.environ.get('PORTAL_DB_PASSWORD'))


def connect(timeout=15):
    import psycopg2
    return psycopg2.connect(host=os.environ.get('PORTAL_DB_HOST', 'localhost'), port=int(os.environ.get('PORTAL_DB_PORT', '5432')),
                            user=os.environ.get('PORTAL_DB_USER', 'postgres'), password=os.environ['PORTAL_DB_PASSWORD'],
                            dbname=os.environ.get('PORTAL_DB_NAME', 'landslide portal 2 '), connect_timeout=timeout)


def latest_payload(source, lat=None, lon=None, max_age=None):
    """Newest stored API reply for a source (and point), as (payload, age_seconds), or None.
    Used so the portal can answer from the database instead of calling the API again. Never raises: if the
    database is off or unreachable it returns None quickly and the caller carries on as before."""
    if not enabled():
        return None
    try:
        con = connect(timeout=3)
        try:
            with con.cursor() as cur:
                where = 'lat = %s and lon = %s' if lat is not None else 'lat is null'
                cur.execute(f'select payload, extract(epoch from now() - fetched_at) from {SCHEMA}.api_responses '
                            f'where source = %s and {where} order by fetched_at desc limit 1',
                            (source, lat, lon) if lat is not None else (source,))
                row = cur.fetchone()
        finally:
            con.close()
    except Exception:
        return None
    if not row or (max_age is not None and row[1] > max_age):
        return None
    return row[0], float(row[1])


def _ts(text):
    """'2026-10-13 03:53 UTC' -> aware datetime."""
    return dt.datetime.strptime(text.replace(' UTC', ''), '%Y-%m-%d %H:%M').replace(tzinfo=dt.timezone.utc)


def _grid_points(g):
    return [(round(g['lat0'] + j * g['step'], 3), round(g['lon0'] + i * g['step'], 3)) for j in range(g['ny']) for i in range(g['nx'])]


def _raw(cur, source, fetched, payload, lat=None, lon=None):
    cur.execute(f'insert into {SCHEMA}.api_responses(source, fetched_at, lat, lon, payload) values (%s,%s,%s,%s,%s) '
                'on conflict do nothing', (source, fetched, lat, lon, json.dumps(payload)))


def _log(cur, source, fetched, rows, note=None):
    cur.execute(f'insert into {SCHEMA}.fetch_log(source, fetched_at, rows_stored, note) values (%s,%s,%s,%s)', (source, fetched, rows, note))


def _already(cur, source, fetched):
    cur.execute(f'select 1 from {SCHEMA}.fetch_log where source=%s and fetched_at=%s limit 1', (source, fetched))
    return cur.fetchone() is not None


# ---- one writer per kind of data; each returns the number of rows stored ----

def _store_wind(cur, p):
    from psycopg2.extras import execute_values
    fetched, model = _ts(p['fetched']), p.get('model_time') or None
    rows = []
    for grid_name, g, d in [('global', p['grid'], p['d'])] + ([('region', p['region']['grid'], p['region']['d'])] if p.get('region') else []):
        pts = _grid_points(g)
        for lv, uv in d.items():
            for (lat, lon), u, v in zip(pts, uv['u'], uv['v']):
                rows.append((fetched, model, grid_name, int(lv), lat, lon, u, v, round((u * u + v * v) ** .5, 2)))
    execute_values(cur, f'insert into {SCHEMA}.wind values %s on conflict do nothing', rows, page_size=2000)
    return len(rows)


def _store_daily_grid(cur, p, grid_table, city_table, cols, src_vars):
    """Weather or air-quality grid + city payloads (vars[name][day][point], cities[name][var][day])."""
    from psycopg2.extras import execute_values
    fetched, days, pts = _ts(p['fetched']), p['days'], _grid_points(p['grid'])
    rows = [(fetched, day, lat, lon, *[p['vars'][v][d][k] for v in src_vars])
            for d, day in enumerate(days) for k, (lat, lon) in enumerate(pts)]
    execute_values(cur, f'insert into {SCHEMA}.{grid_table}(fetched_at, forecast_date, lat, lon, {cols}) values %s on conflict do nothing', rows, page_size=2000)
    crows = [(fetched, city, day, *[(vals.get(v) or [None] * len(days))[d] for v in src_vars])
             for city, vals in (p.get('cities') or {}).items() for d, day in enumerate(days)]
    if crows:
        execute_values(cur, f'insert into {SCHEMA}.{city_table}(fetched_at, city, forecast_date, {cols}) values %s on conflict do nothing', crows)
    return len(rows) + len(crows)


def _store_climate(cur, data):
    from psycopg2.extras import execute_values
    updated = dt.datetime.strptime(data['updated'], '%Y-%m-%d %H:%M').replace(tzinfo=dt.timezone(dt.timedelta(hours=5)))  # written in PKT
    rows, mjo = [], []
    for key, s in data['series'].items():
        if key == 'mjo':
            today = dt.date.today()
            for label, a, b in zip(s['labels'], s['values'], s.get('values2') or [None] * len(s['values'])):
                day, mon = label.split()
                d = dt.date(today.year, MONTHS[mon], int(day))
                if d > today:
                    d = d.replace(year=today.year - 1)
                mjo.append((d, a, b, updated))
            continue
        for label, v, z in zip(s['labels'], s['values'], s.get('z') or [None] * len(s['values'])):
            m = re.match(r'([A-Za-z]{3}) (\d{2})', label)
            rows.append((key, dt.date(2000 + int(m.group(2)), MONTHS[m.group(1)], 1), label, v, z, s.get('unit'), s.get('title'), s.get('source'), updated))
    execute_values(cur, f'''insert into {SCHEMA}.climate_indices values %s on conflict (series, period) do update set
        value=excluded.value, z=excluded.z, label=excluded.label, unit=excluded.unit, title=excluded.title,
        source=excluded.source, updated_at=excluded.updated_at''', rows)
    if mjo:
        execute_values(cur, f'''insert into {SCHEMA}.mjo_index values %s on conflict (day) do update set
            index_80e=excluded.index_80e, index_100e=excluded.index_100e, updated_at=excluded.updated_at''', mjo)
    return len(rows) + len(mjo), updated


WEATHER_COLS = 'weather_code, temp_max_c, temp_min_c, rain_mm, rain_chance_pct, wind_max_kmh'
WEATHER_VARS = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
                'precipitation_probability_max', 'wind_speed_10m_max']
AQ_COLS = 'us_aqi_max, pm2_5_mean, pm10_mean, aod_mean, dust_max'
AQ_VARS = ['us_aqi', 'pm2_5', 'pm10', 'aerosol_optical_depth', 'dust']


def _write(kind, payload, lat=None, lon=None):
    con = connect()
    try:
        with con, con.cursor() as cur:
            if kind == 'climate':
                n, fetched = _store_climate(cur, payload)
                _log(cur, 'climate_indices', fetched, n)
                return n
            if kind in ('point_forecast', 'point_air'):
                fetched = _ts(payload['fetched'])
                _raw(cur, kind, fetched, payload, lat, lon)
                _log(cur, kind, fetched, 1, f'{lat},{lon}')
                return 1
            fetched = _ts(payload['fetched'])
            if _already(cur, kind, fetched):
                return 0
            if kind == 'wind':
                n = _store_wind(cur, payload)
            elif kind == 'weather_grid':
                n = _store_daily_grid(cur, payload, 'weather_forecast_grid', 'weather_forecast_city', WEATHER_COLS, WEATHER_VARS)
            elif kind == 'air_quality_grid':
                n = _store_daily_grid(cur, payload, 'air_quality_grid', 'air_quality_city', AQ_COLS, AQ_VARS)
            else:
                raise ValueError(f'unknown kind {kind}')
            _raw(cur, kind, fetched, payload)
            _log(cur, kind, fetched, n)
            return n
    finally:
        con.close()


def _worker():
    schema_ready = False
    while True:
        kind, payload, lat, lon = _q.get()
        try:
            if not schema_ready:
                ensure_schema()
                schema_ready = True
            n = _write(kind, payload, lat, lon)
            if n and kind not in ('point_forecast', 'point_air'):
                print(f'Database: stored {n:,} rows of {kind}', flush=True)
        except Exception as e:  # the portal must keep working even if the database is down
            print(f'Database: could not store {kind} ({type(e).__name__}: {str(e).strip()[:200]})', flush=True)


def enqueue(kind, payload, lat=None, lon=None):
    """Queue a fetched payload for storing; returns at once. No-op when no database password is set."""
    global _started
    if not enabled() or not payload:
        return
    with _lock:
        if not _started:
            threading.Thread(target=_worker, daemon=True).start()
            _started = True
    _q.put((kind, payload, lat, lon))


def ensure_schema():
    con = connect()
    try:
        with con, con.cursor() as cur:
            cur.execute(DDL)
    finally:
        con.close()


def backfill(root):
    """Store the data the portal already has on disk (no API calls)."""
    ensure_schema()
    lib = os.path.join(root, 'lib')
    for kind, name in [('wind', 'wind_cache.json'), ('weather_grid', 'pak_forecast_cache.json'), ('air_quality_grid', 'aq_cache.json')]:
        path = os.path.join(lib, name)
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                print(f'{kind}: {_write(kind, json.load(f)):,} rows')
    path = os.path.join(lib, 'indices.js')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            txt = f.read()
        print(f"climate_indices: {_write('climate', json.loads(txt[txt.index('{'):txt.rindex('}') + 1])):,} rows")


if __name__ == '__main__':
    import sys
    if not enabled():
        raise SystemExit('Set PORTAL_DB_PASSWORD first.')
    if '--backfill' in sys.argv:
        backfill(sys.argv[sys.argv.index('--backfill') + 1] if len(sys.argv) > sys.argv.index('--backfill') + 1
                 else os.path.dirname(os.path.abspath(__file__)))
    else:
        ensure_schema()
        print('schema ready')
