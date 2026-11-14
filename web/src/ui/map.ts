import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AreaId, XY } from '../core/geo';
import { fmtLonLat } from '../core/geo';

/** Leaflet in CRS.Simple: lng = local x (m, east), lat = local y (m, north). No Earth projection anywhere. */
export const ll = (p: XY) => L.latLng(p[1], p[0]);
export const xy = (l: L.LatLng): XY => [l.lng, l.lat];

export function createMap(el: HTMLElement, coordsEl: HTMLElement, getArea: () => AreaId) {
  const map = L.map(el, { crs: L.CRS.Simple, minZoom: -3, maxZoom: 4, zoomSnap: 0.25, attributionControl: true, zoomControl: true });
  map.attributionControl.setPrefix('');
  L.control.scale({ imperial: false, maxWidth: 160, position: 'bottomright' }).addTo(map);
  const north = L.DomUtil.create('div', 'north');
  north.innerHTML = '▲<br>N';
  north.title = 'Map north = planetocentric north (local equirectangular projection)';
  el.parentElement!.appendChild(north);
  map.on('mousemove', (e: L.LeafletMouseEvent) => {
    const [x, y] = xy(e.latlng);
    coordsEl.textContent = `${fmtLonLat(getArea(), x, y)} · local x ${x.toFixed(0)} m, y ${y.toFixed(0)} m`;
  });
  return map;
}

export function boundsOf(b: [number, number, number, number]) { return L.latLngBounds(L.latLng(b[1], b[0]), L.latLng(b[3], b[2])); }
