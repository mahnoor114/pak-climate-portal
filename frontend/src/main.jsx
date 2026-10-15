import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App.jsx';

// No StrictMode: the maps and 3D views are created once per mount, and double-mounting them in development
// would build two Leaflet maps / WebGL contexts on the same element.
createRoot(document.getElementById('root')).render(<App />);
