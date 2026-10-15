import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DRIVER } from './core/constants.js';
import { live, toast } from './core/live.js';
import MainMap from './components/MainMap.jsx';
import Globe3D from './components/Globe3D.jsx';
import Terrain3D from './components/Terrain3D.jsx';
import { TopBar, MapLabel, LeftPanel, RightPanel, BottomBar, Toast } from './components/Panels.jsx';
import ForecastModal from './components/Forecast.jsx';
import AiPanel from './components/AiPanel.jsx';
import DriverCard from './components/DriverCard.jsx';

const VIEW_NAME = { '2d': '2D map', '3d': '3D globe', terrain: '3D terrain' };
const initialMode = () => { const h = location.hash.toLowerCase(); return h.includes('terrain') ? 'terrain' : h.includes('3d') ? '3d' : '2d'; };

// Immersive Map design: full-screen map (2D, 3D globe or 3D terrain), floating pill top bar and driver chips,
// the side panels as drawers, and the forecast, driver card and AI assistant as overlays.
export default function App() {
  const [active, setActive] = useState('enso');      // selected driver
  const [preview, setPreview] = useState(null);      // driver hovered in the bottom bar (3D globe preview)
  const [mode, setMode] = useState(initialMode);     // '2d' | '3d' | 'terrain'
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [card, setCard] = useState(null);            // driver whose analysis card is open
  const [fc, setFc] = useState({ open: false, view: 'map', place: null, seq: 0 });
  const [liveSrc, setLiveSrc] = useState('');
  const cardRef = useRef(card); cardRef.current = card;

  live.view = VIEW_NAME[mode]; live.activeLayer = DRIVER[active].name; live.liveSrc = liveSrc; live.driverCard = card && DRIVER[card].name;

  // the stylesheet keys the layout off body classes. A layout effect, so the classes are in place before the
  // children's effects run (e.g. the 2D map re-measuring itself when it becomes visible again)
  useLayoutEffect(() => {
    const b = document.body.classList;
    b.toggle('mode3d', mode === '3d'); b.toggle('modeTerrain', mode === 'terrain');
    b.toggle('showLeft', showLeft); b.toggle('showRight', showRight); b.toggle('aiOpen', aiOpen);
  }, [mode, showLeft, showRight, aiOpen]);

  // Escape closes the forecast and the driver card; the AI panel only when no driver card was open
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      setFc(f => f.open ? { ...f, open: false } : f);
      if (cardRef.current) setCard(null); else setAiOpen(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const selectDriver = key => { setActive(key); setCard(key); toast('Activated ' + DRIVER[key].name); };
  const openForecast = place => setFc(f => ({ open: true, view: place ? 'city' : 'map', place: place || null, seq: f.seq + 1 }));

  return (
    <>
      <MainMap active={active} visible={mode === '2d'} onLiveSrc={setLiveSrc} />
      <Globe3D on={mode === '3d'} active={active} preview={preview} />
      <Terrain3D on={mode === 'terrain'} active={active} onOpenForecast={openForecast} onFail={() => setMode('2d')} />
      <TopBar mode={mode} setMode={setMode} aiOpen={aiOpen} toggleAi={() => setAiOpen(o => !o)} openForecast={openForecast} />
      <MapLabel mode={mode} />
      <LeftPanel onDriver={selectDriver} />
      <RightPanel active={active} liveSrc={liveSrc} onDriver={selectDriver} />
      <BottomBar active={active} onSelect={selectDriver} onHover={setPreview} />
      <Toast />
      <ForecastModal fc={fc} setFc={setFc} />
      <AiPanel open={aiOpen} setOpen={setAiOpen} />
      <DriverCard driverKey={card} onClose={() => setCard(null)} />
      <button id="drawerLeft" type="button" className={'drawerBtn' + (showLeft ? ' on' : '')} onClick={() => setShowLeft(v => !v)}>📊  INDICES</button>
      <button id="drawerRight" type="button" className={'drawerBtn' + (showRight ? ' on' : '')} onClick={() => setShowRight(v => !v)}>📈  INSIGHTS</button>
    </>
  );
}
