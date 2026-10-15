// Helpers shared by the 3D globe and the driver-card globe.
import * as THREE from 'three';

export function latLonToV3(lat, lon, r) { const p = (90 - lat) * Math.PI / 180, t = (lon + 180) * Math.PI / 180; return new THREE.Vector3(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)); }
export function clearGroup3(g) { while (g.children.length) { const c = g.children.pop(); g.remove(c); if (c.isSprite) { if (c.material) c.material.dispose(); } else if (c.geometry) c.geometry.dispose(); } }

let glowTex = null;
function makeGlowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
// Soft additive glow sprite at pos, added to group
export function addGlow(group, pos, size, color, op) {
  if (!glowTex) glowTex = makeGlowTex();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.position.copy(pos); sp.scale.set(size, size, 1);
  group.add(sp);
  return sp;
}
// Latitude/longitude grid lines every 30°
export function addGraticule(group, r, color, opacity) {
  const gm = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  for (let lat = -60; lat <= 60; lat += 30) { const p = []; for (let lon = 0; lon <= 360; lon += 5) p.push(latLonToV3(lat, lon, r)); group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), gm)); }
  for (let lon = 0; lon < 360; lon += 30) { const p = []; for (let lat = -90; lat <= 90; lat += 5) p.push(latLonToV3(lat, lon, r)); group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), gm)); }
}
