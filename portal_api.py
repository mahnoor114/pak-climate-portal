"""Pakistan Climate portal - FastAPI server.

Run:  python portal_api.py          then open http://localhost:8000/
API documentation (interactive): http://localhost:8000/docs

All data logic (caching, database, Open-Meteo / NOAA / NASA downloads, AI assistant) lives in portal_server.py;
this file only exposes it through FastAPI, served by uvicorn. Blocking work runs in FastAPI's thread pool, so a
slow download for one user never holds up anyone else.
"""
import json
import mimetypes
import os
from contextlib import asynccontextmanager
from typing import Literal, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

import portal_server as core

mimetypes.add_type('application/javascript', '.js')


@asynccontextmanager
async def lifespan(app):
    core.start_background()   # data refresh threads + database backfill
    yield


app = FastAPI(
    title='Pakistan Climate Portal API',
    version='1.0',
    description='Climate drivers, weather and air-quality forecasts for Pakistan. Every endpoint is served from '
                'memory, disk or the PostgreSQL database first; external APIs are called only when data is missing '
                'or out of date, and simultaneous requests for the same data share one call.',
    lifespan=lifespan)


def reply(result, max_age=300):
    """(payload, error) from portal_server -> JSON response; 503 with the reason when there is no data yet."""
    payload, error = result
    if payload is None:
        return JSONResponse({'error': error}, status_code=503, headers={'Cache-Control': 'no-cache'})
    return JSONResponse(payload, headers={'Cache-Control': f'max-age={max_age}'})


Lat = Query(..., ge=-90, le=90, description='Latitude in degrees')
Lon = Query(..., ge=-180, le=180, description='Longitude in degrees')


@app.get('/api/forecast', tags=['Weather'], summary='7-day weather forecast for one point (Open-Meteo)')
async def forecast(lat: float = Lat, lon: float = Lon):
    return reply(await run_in_threadpool(core.get_forecast, lat, lon))


@app.get('/api/pakforecast', tags=['Weather'], summary='7-day forecast grid for all of Pakistan + 14 cities')
async def pak_forecast():
    return reply(await run_in_threadpool(core.get_pak_grid))


@app.get('/api/airquality', tags=['Air quality'], summary='Current air quality and next 48 h for one point (CAMS)')
async def air_quality(lat: float = Lat, lon: float = Lon):
    return reply(await run_in_threadpool(core.get_aq_point, lat, lon))


@app.get('/api/aqmap', tags=['Air quality'], summary='5-day AQI, PM2.5, PM10, AOD and dust grid for Pakistan + cities')
async def aq_map():
    return reply(await run_in_threadpool(core.get_aq_grid))


@app.get('/api/wind', tags=['Climate drivers'], summary='Upper-level wind (250 / 500 hPa), global + western-disturbance region')
async def wind():
    return reply(await run_in_threadpool(core.get_wind))


@app.get('/api/indices', tags=['Climate drivers'], summary='Monthly climate-driver series (ENSO, IOD, AO, NAO, snow, SST, MJO ...)')
async def indices():
    return JSONResponse(json.loads(await run_in_threadpool(core.load_data)), headers={'Cache-Control': 'max-age=300'})


@app.get('/api/ai-status', tags=['AI assistant'], summary='Which assistants answer through this server (yes/no only)')
async def ai_status():
    return {'claude': bool(os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_AUTH_TOKEN')),
            'grok': bool(os.environ.get('XAI_API_KEY'))}


@app.get('/api/guide', tags=['AI assistant'], summary="The assistant's instructions + portal data (no secrets)")
async def guide():
    return {'text': core.PORTAL_GUIDE + await run_in_threadpool(core.load_data)}


class ChatMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str


class ChatRequest(BaseModel):
    provider: Optional[Literal['grok', 'claude']] = 'claude'
    messages: list[ChatMessage] = Field(..., description='Conversation so far; the last message is the question')
    page: dict = Field(default_factory=dict, description='Snapshot of what the user sees on the portal')


@app.post('/api/chat', tags=['AI assistant'], summary='Ask the assistant (answer streams back as server-sent events)')
async def chat(req: ChatRequest):
    try:
        history = core.chat_history({'messages': [m.model_dump() for m in req.messages], 'page': req.page})
    except ValueError:
        raise HTTPException(400, 'Expected a conversation ending with a user question')

    def stream():
        for kind, payload in core.chat_events(req.provider, history):
            yield f'event: {kind}\ndata: {json.dumps(payload)}\n\n'
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache'})


@app.get('/{path:path}', include_in_schema=False)
async def static(path: str, request: Request):
    """The React app (dist/, '/' = its index.html) and lib/ files, from the in-memory cache (with ETag revalidation)."""
    if path.lower() in core.OLD_PAGES:  # the pre-React page's address
        return RedirectResponse('/', status_code=301)
    got = await run_in_threadpool(core.static_lookup, path)
    if got is None:
        raise HTTPException(404)
    data, mtime, full = got
    etag = f'"{int(mtime * 1000):x}-{len(data):x}"'
    if request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers={'ETag': etag})
    kind = mimetypes.guess_type(full)[0] or 'application/octet-stream'
    return Response(data, media_type=kind, headers={'ETag': etag, 'Cache-Control': 'no-cache'})


if __name__ == '__main__':
    # 0.0.0.0 = reachable from other PCs on the network (http://<this PC's IP>:8000). Set PORTAL_HOST=127.0.0.1 for this PC only.
    uvicorn.run(app, host=os.environ.get('PORTAL_HOST', '0.0.0.0'), port=core.PORT, log_level='warning', access_log=False)
