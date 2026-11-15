import { app } from '../app';
import { url } from '../data';
import { openModal, esc } from './dom';
import { state } from '../state';

export function openPhoto(id: string) {
  const p = app.b.photos.find((q) => q.product_id === id)!;
  const h = p.heading;
  const stop = (state.areas.jezero.stops.find((q) => q.id === p.stop)?.label ?? p.stop).split('(')[0].trim();
  const compass = (az: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8];
  openModal(`<h2 class="evTitle">Photo at ${esc(stop)} <span class="tag obs">real rover photo</span></h2>
    <p class="evLead">${esc(p.selection_note)}.</p>
    <div class="evGrid"><div><img src="${url('jezero/' + p.local_file)}" alt="Rover photo at ${esc(stop)}" style="width:100%;border-radius:10px"></div>
    <div><dl class="kv">
      <dt>Looking</dt><dd>${h.azimuth_deg !== null ? `${compass(h.azimuth_deg)} (${h.azimuth_deg}°), ${h.hfov_deg}° wide` : 'direction not available'}</dd>
      <dt>Taken</dt><dd>Sol ${p.sol} (${esc(p.date_utc.slice(0, 10))}) by Perseverance, ${esc(p.camera.replace('MCZ_', 'Mastcam-Z ').toLowerCase())}</dd>
      <dt>Taken from</dt><dd>The rover's position at this stop. Shown as 📷 with a view cone on the map.</dd>
      <dt>Distance to subject</dt><dd>Not known</dd>
    </dl>
    <details class="evMore"><summary>Mission record and technical details</summary><dl class="kv">
      <dt>Product ID</dt><dd><code style="word-break:break-all">${esc(p.product_id)}</code></dd>
      <dt>Date / time</dt><dd>${esc(p.date_utc)} UTC · ${esc(p.lmst)}</dd>
      <dt>Mission record</dt><dd>site ${p.mission_record.site}, drive ${p.mission_record.drive} (RMC ${p.mission_record.rmc}) · <a href="${p.source_page}" target="_blank" rel="noopener">raw-image page</a> · <a href="${p.record_url}" target="_blank" rel="noopener">JSON record</a></dd>
      <dt>Camera position</dt><dd>${p.camera_position.lat.toFixed(6)}° N, ${p.camera_position.lon.toFixed(6)}° E, ${p.camera_position.elev_geoid_m.toFixed(1)} m · <small>${esc(p.camera_position.source)}</small></dd>
      <dt>Viewing direction</dt><dd>elevation ${h.elevation_deg}°, <span class="tag derived">${esc(h.status)}</span>. Attitude-quaternion method ${h.from_attitude_quaternion_deg}° vs yaw + mast azimuth ${h.from_yaw_plus_mastAz_deg}° (agree within ${h.agreement_deg}°).</dd>
      <dt>Subject position</dt><dd><i>${esc(p.target_position_note)}</i></dd>
      <dt>Stop match</dt><dd>Matched to this stop because the record's site/drive equals the stop's rover position, not by how the scene looks.</dd>
      <dt>Credit</dt><dd>${esc(p.credit)}</dd>
    </dl><div class="note">${esc(p.caption)}</div></details></div></div>`);
}
