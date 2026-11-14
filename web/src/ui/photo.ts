import { app } from '../app';
import { url } from '../data';
import { openModal, esc } from './dom';

export function openPhoto(id: string) {
  const p = app.b.photos.find((q) => q.product_id === id)!;
  const h = p.heading;
  openModal(`<h2 style="margin:0 40px 8px 0">Ground photo · ${esc(p.camera)} · sol ${p.sol} <span class="tag obs">observed</span></h2>
    <div class="evGrid"><div><img src="${url('jezero/' + p.local_file)}" alt="${esc(p.product_id)}" style="width:100%;border-radius:10px"></div>
    <div><dl class="kv">
      <dt>Product ID</dt><dd><code style="word-break:break-all">${esc(p.product_id)}</code></dd>
      <dt>Camera</dt><dd>${esc(p.camera)}</dd><dt>Sol / date</dt><dd>${p.sol} · ${esc(p.date_utc)} UTC · ${esc(p.lmst)}</dd>
      <dt>Credit</dt><dd>${esc(p.credit)}</dd>
      <dt>Mission record</dt><dd>site ${p.mission_record.site}, drive ${p.mission_record.drive} (RMC ${p.mission_record.rmc}) · <a href="${p.source_page}" target="_blank" rel="noopener">raw-image page</a> · <a href="${p.record_url}" target="_blank" rel="noopener">JSON record</a></dd>
      <dt>Camera position</dt><dd>${p.camera_position.lat.toFixed(6)}° N, ${p.camera_position.lon.toFixed(6)}° E, ${p.camera_position.elev_geoid_m.toFixed(1)} m · <small>${esc(p.camera_position.source)}</small></dd>
      <dt>Photographed object</dt><dd><i>${esc(p.target_position_note)}</i></dd>
      <dt>Viewing direction</dt><dd>${h.azimuth_deg !== null ? `${h.azimuth_deg}° from north, elevation ${h.elevation_deg}°, horizontal FOV ${h.hfov_deg}°` : 'withheld'} <span class="tag derived">${esc(h.status)}</span><br>
        <small>Attitude-quaternion method ${h.from_attitude_quaternion_deg}° vs yaw + mast azimuth ${h.from_yaw_plus_mastAz_deg}° (agree within ${h.agreement_deg}°).</small></dd>
      <dt>Stop assignment</dt><dd>Assigned to stop <b>${esc(p.stop)}</b> because the record's site/drive equals that stop's rover localization, not because of how the scene looks.</dd>
      <dt>Why chosen</dt><dd>${esc(p.selection_note)}</dd>
    </dl><div class="note">${esc(p.caption)}</div></div></div>`);
}
