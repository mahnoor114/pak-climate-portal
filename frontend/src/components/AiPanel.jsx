import { useEffect, useRef, useState } from 'react';
import { CLIMATE_DATA } from '../core/data.js';
import { aiSnapshot } from '../core/live.js';
import { loadAsset } from '../core/tiles.js';

// Two assistants share one conversation; the choice is remembered in this browser. Each one runs through the portal
// server when that AI's API key is set there, and otherwise free through Puter (no key needed).
const AI_NAMES = { grok: 'Grok', claude: 'Claude' };
const PUTER_MODELS = { grok: 'x-ai/grok-4.7', claude: 'claude-sonnet-5' };
const CHIPS = ['Why is Winter precipitation so high?', 'Is it El Niño or La Niña right now?', 'Explain the western disturbance data', 'How are the scores calculated?'];
const readProvider = () => { try { const v = localStorage.getItem('pkAiProvider'); return AI_NAMES[v] ? v : 'grok'; } catch (e) { return 'grok'; } };

// Minimal, safe markdown: escape everything, then paragraphs, "-" / "1." lists, **bold**, `code`.
function aiMd(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let out = '', list = false;
  for (const raw of src.split('\n')) {
    const line = raw.trim(), m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!list) { out += '<ul>'; list = true; } out += '<li>' + inl(m[1]) + '</li>'; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (line) out += '<p>' + inl(line.replace(/^#+\s*/, '')) + '</p>';
  }
  return out + (list ? '</ul>' : '');
}

// Claude and Grok answer through the portal server (POST /api/chat, server-sent events); onText receives the text so far.
// Returns an error message, or null.
async function askServer(provider, history, onText) {
  let text = '', failed = null;
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, messages: history, page: aiSnapshot() }) });
  if (!r.ok) throw new Error(r.status === 404 || r.status === 501 ? 'The assistant needs the portal server. Start it with "python portal_server.py" and reload this page.' : 'Server error ' + r.status);
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, i); buf = buf.slice(i + 2);
      const kind = (evt.match(/^event: (.*)$/m) || [])[1], data = (evt.match(/^data: (.*)$/m) || [])[1];
      if (data === undefined) continue; const val = JSON.parse(data);
      if (kind === 'text') { text += val; onText(text); }
      else if (kind === 'error') failed = val;
    }
  }
  return failed;
}

// ---- Free route: Grok or Claude through Puter.js (developer.puter.com). No key: each user signs in to their
// own Puter account, which pays for usage. The script loads as soon as a Puter-routed AI is chosen, so at Send time
// puter.ai.chat runs straight from the click and the browser allows Puter's sign-in window. ----
let puterGuide = null, puterReady = null, puterScript = null;
function puterPrepare() {
  // the script must be added only once (it registers custom elements), even if a later step fails and is retried
  if (!puterScript) puterScript = window.puter ? Promise.resolve() : loadAsset('script', { src: 'https://js.puter.com/v2/' }).catch(e => { puterScript = null; throw e; });
  if (!puterReady) puterReady = Promise.all([
    puterScript,
    fetch('/api/guide').then(r => { if (!r.ok) throw 0; return r.json(); }).then(js => { puterGuide = js.text; }) // same instructions + data Claude and Grok get
      .catch(() => { puterGuide = 'You are the assistant of the Pakistan Climate Intelligence dashboard. Answer only from this data, quoting values with units and months:\n' + JSON.stringify(CLIMATE_DATA || {}); }),
  ]).catch(e => { puterReady = null; throw e; });
  return puterReady;
}
async function askPuter(provider, history, onText) {
  if (!window.puter || !puterGuide) await puterPrepare();
  const hist = history.slice(-20).map(m => ({ role: m.role, content: m.content }));
  hist[hist.length - 1] = { role: 'user', content: '<page_snapshot>' + JSON.stringify(aiSnapshot()) + '</page_snapshot>\n\n' + hist[hist.length - 1].content };
  let text = '';
  try {
    const resp = await window.puter.ai.chat([{ role: 'system', content: puterGuide }, ...hist], false, { model: PUTER_MODELS[provider], stream: true });
    for await (const part of resp) { if (part && part.text) { text += part.text; onText(text); } }
  } catch (e) { throw new Error('Puter: ' + ((e && (e.message || e.error && e.error.message)) || 'request failed or sign-in was closed') + '. Try again, or switch between Grok and Claude.'); }
  return text;
}

export default function AiPanel({ open, setOpen }) {
  const [provider, setProvider] = useState(readProvider);
  const [keys, setKeys] = useState({ grok: false, claude: false }); // filled from /api/ai-status
  const [msgs, setMsgs] = useState([]); // {cls, html, who}
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const history = useRef([]), logEl = useRef(null), inputEl = useRef(null);
  const viaPuter = !keys[provider];
  const label = AI_NAMES[provider] + (viaPuter ? ' · free via Puter' : '');

  useEffect(() => { fetch('/api/ai-status').then(r => r.ok ? r.json() : null).then(s => { if (s) setKeys({ grok: !!s.grok, claude: !!s.claude }); }).catch(() => {}); }, []);
  useEffect(() => { try { localStorage.setItem('pkAiProvider', provider); } catch (e) { /* storage blocked */ } }, [provider]);
  useEffect(() => { if (open && viaPuter) puterPrepare().catch(() => {}); }, [open, provider, keys]);
  useEffect(() => { if (open) { const t = setTimeout(() => inputEl.current && inputEl.current.focus(), 250); return () => clearTimeout(t); } }, [open]);
  useEffect(() => { if (logEl.current) logEl.current.scrollTop = logEl.current.scrollHeight; }, [msgs]);
  useEffect(() => { const el = inputEl.current; el.style.height = 'auto'; el.style.height = Math.min(110, el.scrollHeight) + 'px'; }, [input]);

  async function ask(q) {
    q = (q || '').trim(); if (!q || busy) return;
    setBusy(true); setInput('');
    history.current.push({ role: 'user', content: q });
    const who = label, id = Date.now();
    setMsgs(m => [...m, { cls: 'user', html: aiMd(q) }, { id, cls: 'bot typing', html: '', who }]);
    const update = patch => setMsgs(m => m.map(x => x.id === id ? { ...x, ...patch } : x));
    let text = '', failed = null;
    const onText = t => { text = t; update({ html: '<span class="aiWho">' + who + '</span>' + aiMd(text) }); };
    try {
      if (viaPuter) await askPuter(provider, history.current, onText);
      else failed = await askServer(provider, history.current, onText);
    } catch (e) { failed = e.message === 'Failed to fetch' ? 'Cannot reach the portal server. Start it with "python portal_server.py".' : e.message; }
    if (text) { history.current.push({ role: 'assistant', content: text }); update({ cls: 'bot' }); }
    else { history.current.pop(); setMsgs(m => m.filter(x => x.id !== id)); }
    if (failed) setMsgs(m => [...m, { cls: 'bot err', html: aiMd('⚠ ' + failed) }]);
    setBusy(false); setTimeout(() => inputEl.current && inputEl.current.focus(), 0);
  }
  const clear = () => { if (busy) return; history.current = []; setMsgs([]); };

  return (
    <>
      <button id="aiFab" type="button" title="Ask the AI assistant about this portal" aria-label="Open the AI assistant" onClick={() => setOpen(true)}><span className="fabIcon">✨</span><span className="fabText">Ask AI</span></button>
      <section id="aiPanel" className={open ? 'on' : ''} aria-label="AI assistant" aria-hidden={!open}>
        <div className="aiHead">
          <span className="aiOrb">✨</span>
          <div><div className="aiTitle">Portal assistant</div><div className="aiSub">Answers from this portal's data · {label}</div></div>
          <div className="aiSwitch" role="radiogroup" aria-label="Choose the AI">
            {Object.keys(AI_NAMES).map(p => <button key={p} type="button" role="radio" aria-checked={provider === p} className={provider === p ? 'on' : ''}
              title={AI_NAMES[p] + (p === 'grok' ? ' (xAI). Free through Puter unless an xAI key is set on the server' : ' (Anthropic). Free through Puter unless a Claude key is set on the server')}
              onClick={() => { if (!busy) setProvider(p); }}>{AI_NAMES[p]}</button>)}
          </div>
          <button className="aiIcon" type="button" title="New conversation" onClick={clear}>↺</button>
          <button className="aiIcon" type="button" title="Close" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div id="aiLog" aria-live="polite" ref={logEl}>
          <div className="aiMsg bot">Hi! Ask me anything about this portal — what a score means, why a driver is high, or how the data is calculated.</div>
          {!msgs.length && <div className="aiChips">{CHIPS.map(c => <button key={c} type="button" onClick={() => ask(c)}>{c}</button>)}</div>}
          {msgs.map((m, i) => <div key={m.id || i} className={'aiMsg ' + m.cls} dangerouslySetInnerHTML={{ __html: m.html }} />)}
        </div>
        <form id="aiForm" autoComplete="off" onSubmit={e => { e.preventDefault(); ask(input); }}>
          <textarea id="aiInput" ref={inputEl} rows="1" placeholder="Ask about the portal… (English or Urdu)" aria-label="Your question" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}></textarea>
          <button id="aiSend" type="submit" title="Send" disabled={busy}>➤</button>
        </form>
      </section>
    </>
  );
}
