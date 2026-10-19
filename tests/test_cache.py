"""The server answers the forecast, air-quality and wind grids from memory, and picks up a refreshed file."""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import portal_server as core  # noqa: E402


def write(path, payload, mtime):
    path.write_text(json.dumps(payload), encoding='utf-8')
    os.utime(path, (mtime, mtime))


def test_grid_is_served_from_memory(tmp_path, monkeypatch):
    f = tmp_path / 'pak.json'
    write(f, {'grid': core.PAK_GRID, 'fetched': 'first'}, time.time())
    monkeypatch.setattr(core, 'PAK_CACHE', str(f))

    payload, err = core.get_pak_grid()
    assert err is None and payload['fetched'] == 'first' and payload['stale'] is False

    os.remove(f)  # within the recheck window the answer still comes from memory, without touching the disk
    payload, _ = core.get_pak_grid()
    assert payload['fetched'] == 'first'
    assert 'stale' not in core._parsed[str(f)][1]  # each answer is a copy; the cached grid itself is unchanged


def test_refreshed_file_replaces_the_cached_copy(tmp_path, monkeypatch):
    f = tmp_path / 'aq.json'
    old = time.time() - 13 * 3600  # older than AQ_MAX_AGE
    write(f, {'grid': core.PAK_GRID, 'fetched': 'yesterday'}, old)
    monkeypatch.setattr(core, 'AQ_CACHE', str(f))
    payload, _ = core.get_aq_grid()
    assert payload['fetched'] == 'yesterday' and payload['stale'] is True

    write(f, {'grid': core.PAK_GRID, 'fetched': 'today'}, time.time())  # what the refresher does
    assert core.json_file(str(f), 0)[0]['fetched'] == 'today'  # the refresher's own check sees it at once
    payload, _ = core.get_aq_grid()
    assert payload['fetched'] == 'today' and payload['stale'] is False


def test_wind_cache_reports_its_age(tmp_path, monkeypatch):
    f = tmp_path / 'wind.json'
    write(f, {'grid': core.WG, 'fetched': 'w', 'd': {}}, time.time() - 3600)
    monkeypatch.setattr(core, 'WIND_CACHE', str(f))
    payload, age = core._read_cache(0)
    assert payload['fetched'] == 'w' and 3500 < age < 3700
