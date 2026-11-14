// Acceptance tests against the built site (npm run build && npx vite preview --port 4173).
// Run: node tests/e2e.cjs [baseUrl]   -> prints a results table and writes ../docs/e2e_results.json
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:4173/';
const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass === true ? 'PASS' : pass === false ? 'FAIL' : 'BLOCKED'}  ${name} — ${detail}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForSelector('#cRoutes');
  const panel = () => p.textContent('#panel');

  // 1. ground photo traced to mission record
  await p.evaluate(() => document.getElementById('cPhotos').classList.remove('collapsed'));
  await p.click('[data-photo]');
  const modal = await p.textContent('#modal');
  const rmcMatch = /RMC (\d+_\d+)/.exec(modal); const link = await p.getAttribute('#modal a[href*="raw-images"]', 'href');
  const photos = JSON.parse(fs.readFileSync(__dirname + '/../public/data/jezero/photos.json')).photos;
  const wps = JSON.parse(fs.readFileSync(__dirname + '/../public/data/jezero/rover_waypoints.json')).stops;
  const ph = photos[0]; const wp = wps.find((w) => w.rmc === ph.mission_record.rmc);
  rec('Ground photo traces to its mission record', !!rmcMatch && link.includes(ph.product_id) && !!wp && Math.abs(wp.lon - ph.camera_position.lon) < 1e-9,
    `${ph.product_id} → RMC ${rmcMatch && rmcMatch[1]} (sol ${wp && wp.sol}), raw-image page ${link}`);
  await p.click('#modal .close');

  // 2. landing pin move & weather distance / gap
  const before = await p.textContent('#cBrief');
  const box = await p.locator('.leaflet-marker-draggable').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height - 2); await p.mouse.down(); await p.mouse.move(box.x + 140, box.y - 60, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(400);
  const after = await p.textContent('#cBrief');
  rec('Moving the landing pin updates the briefing', before !== after, `pin text changed: ${/Pin: ([^(]+)/.exec(after)?.[1]?.trim()}`);
  const wx = await p.textContent('#cWx');
  const dKm = (t) => (/Distance to pin(\d+\.\d) km/.exec(t.replace(/\s+/g, '')) || /Distance to pin\s*([\d.]+) km/.exec(t) || [])[1];
  const box2 = await p.locator('.leaflet-marker-draggable').boundingBox();
  await p.mouse.move(box2.x + box2.width / 2, box2.y + box2.height - 2); await p.mouse.down(); await p.mouse.move(box2.x - 200, box2.y + 40, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400);
  const wx2 = await p.textContent('#cWx');
  rec('Pin move changes distance to a dated MEDA observation; missing interval explicit', !!dKm(wx) && !!dKm(wx2) && dKm(wx) !== dKm(wx2) && /Sol \d+ \(\d{4}-\d\d-\d\d\)/.test(wx) && /not reported|gap/.test(wx) && /not a forecast/.test(wx),
    `distance ${dKm(wx)} km → ${dKm(wx2)} km after moving the pin; gaps shown as "not reported"/"gap"; NASA MEDA daily summary`);

  // 3. two routes with return legs
  const routes = await p.textContent('#cRoutes');
  rec('Two Jezero routes to the same objective both include the return leg', (routes.match(/incl\. return/g) || []).length === 2, /Total distance([^E]+)/.exec(routes)?.[1]?.replace(/\s+/g, ' '));

  // 4. MC reproducible and responsive
  const mc1 = await p.textContent('#cMC');
  await p.evaluate(() => document.querySelector('#cMC details').open = true);
  await p.fill('[data-a=o2Kg]', '0.16'); await p.dispatchEvent('[data-a=o2Kg]', 'change'); await p.waitForTimeout(500);
  const mc2 = await p.textContent('#cMC');
  await p.evaluate(() => document.querySelector('#cMC details').open = true);
  await p.fill('[data-a=o2Kg]', '1.2'); await p.dispatchEvent('[data-a=o2Kg]', 'change'); await p.waitForTimeout(500);
  const mc3 = await p.textContent('#cMC');
  const pct = (t) => (t.match(/(\d+\.\d)% of \d+ simulated/g) || []).join(' | ');
  rec('Success estimate responds to resources and is reproducible', pct(mc1) === pct(mc3) && pct(mc1) !== pct(mc2) && /Oxygen fell below/.test(mc2), `default ${pct(mc1)}; O2 0.16 kg ${pct(mc2)} (main failure oxygen); restored ${pct(mc3)}`);
  await p.evaluate(() => document.querySelector('#cMC details').open = true);
  await p.selectOption('[data-a=environment]', 'cold'); await p.fill('[data-a=batteryWh]', '290'); await p.dispatchEvent('[data-a=batteryWh]', 'change'); await p.waitForTimeout(500);
  const mc4 = await p.textContent('#cMC');
  await p.evaluate(() => document.querySelector('#cMC details').open = true);
  await p.fill('[data-a=obstaclesPerKm]', '40'); await p.fill('[data-a=evaLimitH]', '2'); await p.dispatchEvent('[data-a=evaLimitH]', 'change'); await p.waitForTimeout(500);
  const mc5 = await p.textContent('#cMC');
  rec('Environment and obstacle density change the estimate and name the limiting factor', /Battery fell below/.test(mc4) && /EVA time limit/.test(mc5), `cold+290 Wh: ${pct(mc4)} (battery); 40 obstacles/km + 2 h: ${pct(mc5)} (time)`);
  await p.evaluate(() => document.querySelector('#mcReset').click()); await p.waitForTimeout(400);

  // 5. Nili: intersecting, clear, outside coverage
  await p.click('#areaSel button[data-area=nili]'); await p.waitForTimeout(800);
  const st = {};
  for (const id of ['crossing', 'south', 'east']) { await p.click(`[data-route=${id}]`); await p.waitForTimeout(400); st[id] = (await p.textContent('#cChange')).match(/Route impact[^\n]*?\n?([\s\S]*?)Covered by analysis: ([^.]+)/)?.[0]?.replace(/\s+/g, ' ').slice(0, 220); }
  rec('Intersecting / non-intersecting / out-of-coverage routes give different, correct results',
    /Inspect the highlighted crossing/.test(st.crossing) && /crosses no candidate/.test(st.south) && /no repeat-imagery analysis/.test(st.east), JSON.stringify(st));
  await p.click('[data-route=crossing]'); await p.waitForTimeout(300);

  // 6. leakage
  await p.click('#areaSel button[data-area=jezero]'); await p.waitForTimeout(600);
  const jt = await panel(); const jl = await p.textContent('#legend');
  rec('Nili Patera evidence never appears in Jezero', !/NP-0|PSP_00|PIA15680/.test(jt + jl) && /no change analysis here/.test(await p.textContent('#cRoutes')) && (await p.textContent('#decision')).trim() === '', 'Jezero panel/legend free of Nili IDs; Jezero routes report "no change analysis here"; no alert banner');
  await p.click('#areaSel button[data-area=nili]'); await p.waitForTimeout(600);
  const nt = await panel();
  rec('Jezero surface weather never appears in Nili', /No surface weather is shown for Nili Patera/.test(nt) && !/MEDA station/.test(nt), 'Nili card states no surface weather');

  // 6b. decluttered header, hide panel, organised sources
  const hdr = await p.textContent('#top');
  await p.click('#panelBtn'); await p.waitForTimeout(300);
  const hiddenOk = await p.evaluate(() => getComputedStyle(document.querySelector('#panel')).display === 'none' && document.querySelector('#map').getBoundingClientRect().width > innerWidth - 5);
  await p.click('#panelBtn'); await p.waitForTimeout(300);
  const shownOk = await p.evaluate(() => getComputedStyle(document.querySelector('#panel')).display !== 'none');
  rec('Side panel can be hidden and shown; header has no prototype label', hiddenOk && shownOk && !/prototype/i.test(hdr), `hidden: map full width ${hiddenOk}; shown again ${shownOk}; header "${hdr.replace(/\s+/g, ' ').trim()}"`);
  await p.click('#sourcesBtn');
  const tabs = await p.$$eval('[data-st]', (bs) => bs.map((b) => b.textContent));
  await p.click('[data-st=change]'); const chg = await p.textContent('#srcBody');
  await p.click('[data-st=datasets]'); const ds = await p.textContent('#srcBody');
  rec('Sources tab is organised into sections with the moved details', tabs.length >= 6 && /held back for checking/.test(chg) && /PIA15680/.test(chg) && /Jezero Crater/.test(ds) && /Nili Patera/.test(ds), `tabs: ${tabs.join(', ')}`);
  await p.click('#modal .close');

  // 6c. globe distance and survival tools
  await p.click('#viewSel button[data-view=globe]'); await p.waitForTimeout(2500);
  const gb = await p.locator('#globeCanvas').boundingBox();
  await p.mouse.click(gb.x + gb.width * 0.45, gb.y + gb.height * 0.45); await p.waitForTimeout(200); await p.mouse.click(gb.x + gb.width * 0.55, gb.y + gb.height * 0.6); await p.waitForTimeout(500);
  const gtxt = await p.textContent('#globeCard');
  const gm = /Point A([\d.]+)° ([NS]), ([\d.]+)° ([EW])Point B([\d.]+)° ([NS]), ([\d.]+)° ([EW])Distance over the surface([\d.]+) km/.exec(gtxt.replace(/\s+(?=Point|Distance)/g, ''));
  let gOk = false, gDet = gtxt.slice(0, 160);
  if (gm) { const sg = (v, h) => (h === 'S' || h === 'W' ? -1 : 1) * +v; const la1 = sg(gm[1], gm[2]), lo1 = sg(gm[3], gm[4]), la2 = sg(gm[5], gm[6]), lo2 = sg(gm[7], gm[8]);
    const r = Math.PI / 180; const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2; const ref = 2 * 3389.5 * Math.asin(Math.sqrt(a));
    gOk = Math.abs(ref - +gm[9]) <= Math.max(1, ref * 0.002); gDet = `A ${la1},${lo1} B ${la2},${lo2}: shown ${gm[9]} km, independent check ${ref.toFixed(1)} km`; }
  rec('3D globe: two picked points give the great-circle distance on Mars', gOk, gDet);
  await p.click('#viewSel button[data-view=planner]'); await p.waitForTimeout(300);
  const sv = await p.textContent('#cSurv');
  rec('Survival check shows reserve margin, turn-back point, shelter, daylight and dust', /spare above the reserve|short of the reserve/.test(sv) && /Turn back by|No turn-back point/.test(sv) && /to shelter/.test(sv) && /sunset/.test(sv) && /Dust/.test(sv), sv.replace(/\s+/g, ' ').slice(0, 220));

  // 7. crew: drop tablet, move, interrupt link, restore
  await p.click('#areaSel button[data-area=jezero]'); await p.waitForTimeout(400);
  await p.click('#viewSel button[data-view=tablet]'); await p.click('#tbReset'); await p.waitForTimeout(200);
  await p.click('#tbScen'); await p.click('[data-tcs=drop]'); await p.click('#tbStart'); await p.waitForTimeout(2500);
  const s1 = await p.textContent('#tbSide');
  await p.click('[data-tcs=cut]'); await p.waitForTimeout(1500);
  const s2 = await p.textContent('#tbSide');
  await p.click('[data-tcs=restore]'); await p.waitForTimeout(800);
  const s3 = await p.textContent('#tbSide');
  await p.click('[data-tcs=spare]'); await p.waitForTimeout(500);
  const s4 = await p.textContent('#tbSide');
  rec('Tablet left behind vs suit fix', /TAB-1 is not with its wearer/.test(s1), /TAB-1 is not with its wearer[^.]*\.[^.]*\.[^.]*\./.exec(s1)?.[0]);
  rec('Suit link loss freezes last fix and shows age; restore resumes live', /SUIT-B2 ○ LAST KNOWN/.test(s2) && /last contact/.test(s2) && /SUIT-B2 ● LIVE/.test(s3), `${/SUIT-B2[^±]*/.exec(s2)?.[0]} → ${/SUIT-B2[^±]*/.exec(s3)?.[0]}`);
  rec('Empty/unconfirmed suit reports location with wearer uncertainty', /SUIT-S3 ● LIVE/.test(s4) && /Wearer unconfirmed/.test(s4), /SUIT-S3[^…]*/.exec(s4)?.[0]);
  await p.click('#tbPause');

  await p.click('#tbEmerg'); await p.waitForTimeout(400);
  const em = await p.textContent('#tbInstr'); const lg = await p.evaluate(() => JSON.parse(localStorage.getItem('marsdelta.mission.v1') || '{}').log?.slice(-3).map((x) => x.text).join(' | ') ?? '');
  rec('Emergency return gives a route home with distance, time and oxygen needed', /Emergency return to habitat/.test(em) && /min/.test(em) && /O₂/.test(em), em.replace(/\s+/g, ' '));
  await p.click('#tbEmerg');
  // 8. touch targets
  const small = await p.$$eval('#tabletView button', (bs) => bs.filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()));
  rec('Tablet touch targets ≥ 44 px', small.length === 0, small.length ? `small: ${small.join(', ')}` : 'all tablet buttons ≥ 44 px tall');
  for (const vp of [{ width: 1024, height: 768 }, { width: 1194, height: 834 }, { width: 1366, height: 1024 }]) {
    await p.setViewportSize(vp); await p.waitForTimeout(300);
    const ok = await p.evaluate(() => { const c = document.querySelector('#tabletView .controls').getBoundingClientRect(); const n = document.querySelector('canvas.nav').getBoundingClientRect(); return c.bottom <= innerHeight + 1 && n.height > 300 && document.documentElement.scrollWidth <= innerWidth; });
    await p.screenshot({ path: `/tmp/shots/tablet_${vp.width}x${vp.height}.png` });
    rec(`Tablet landscape layout ${vp.width}×${vp.height}`, ok, ok ? 'controls visible, nav canvas > 300 px, no horizontal scroll' : 'layout problem');
  }
  await p.setViewportSize({ width: 1280, height: 800 });

  // 9. guided Nili demo
  await p.click('#viewSel button[data-view=planner]');
  await p.click('#demoBtn'); await p.click('#dN'); await p.waitForTimeout(800);
  for (let i = 0; i < 6; i++) { await p.click('#dNext'); await p.waitForTimeout(i === 3 ? 2500 : 900); }
  const logTxt = await p.textContent('#cLog');
  rec('Guided Nili demo runs end to end and logs the decision', /Acknowledged crossing of NP-/.test(logTxt) && /Bypass search/.test(logTxt) && /repeat observation PSP_005684_1890/.test(logTxt), 'log contains simulated receipt, bypass result and acknowledgement');
  await p.click('#dNext').catch(() => {});

  // 10. offline after caching
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(3000);
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  const offOk = await p.evaluate(() => !!document.querySelector('#cRoutes') && document.querySelectorAll('.leaflet-image-layer').length > 0);
  await p.click('#areaSel button[data-area=nili]').catch(() => {}); await p.waitForTimeout(800);
  const offN = await p.evaluate(() => !!document.querySelector('#cChange'));
  rec('Works offline (airplane mode) after first load', offOk && offN, `offline reload: planner ${offOk}, Nili evidence ${offN}, pill "${await p.textContent('#netState')}"`);
  await p.screenshot({ path: '/tmp/shots/offline_nili.png' });
  await ctx.setOffline(false);

  rec('No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
  fs.mkdirSync(__dirname + '/../../docs', { recursive: true });
  fs.writeFileSync(__dirname + '/../../docs/e2e_results.json', JSON.stringify({ date: new Date().toISOString(), base: BASE, results }, null, 2));
  await browser.close();
  process.exit(results.some((r) => r.pass === false) ? 1 : 0);
})();
