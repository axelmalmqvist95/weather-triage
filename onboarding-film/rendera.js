#!/usr/bin/env node
/* Renderar välkomstfilmer från en CSV, en rad per person.
 *
 *   node rendera.js --csv personer.csv                 alla rader
 *   node rendera.js --csv personer.csv --namn Erik     bara Erik
 *   node rendera.js --csv personer.csv --kontrollera   bara validering, ingen rendering
 *   node rendera.js ... --musik musik.mp3              lägg på musik (−16 LUFS, in/uttoning)
 *   node rendera.js ... --fps 60 --arbetare 3 --ut /sökväg/till/ut --kontaktark
 *
 * Filmen ritas av film.html (window.renderAt(t)) i Chromium via Playwright, bildruta för bildruta,
 * och kodas med ffmpeg till H.264 (high, yuv420p, CRF 17, faststart) med AAC-ljud.
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const HAR = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(HAR, 'config.json'), 'utf8'));
const REGIONER = Object.keys(CFG.regioner);

// ------------------------------------------------------------------ argument
function args() {
  const a = process.argv.slice(2), o = { csv: path.join(HAR, 'personer.csv'), fps: 30, arbetare: 3, ut: CFG.ut || path.join(HAR, 'ut'), suffix: '' };
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, ''); const flag = ['kontrollera', 'kontaktark', 'snabb'].includes(k);
    o[k] = flag ? true : a[++i];
  }
  o.fps = +o.fps; o.arbetare = +o.arbetare;
  return o;
}
const fail = msg => { console.error('\nFEL: ' + msg); process.exit(1); };

// ------------------------------------------------------------------ CSV
function parseCsv(txt) {
  txt = txt.replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ';') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(x => x.trim()));
  const head = nonEmpty.shift().map(h => h.trim().toLowerCase());
  return nonEmpty.map((r, i) => { const o = { _rad: i + 2 }; head.forEach((h, j) => o[h] = (r[j] || '').trim()); return o; });
}

// ------------------------------------------------------------------ svenska datum
const VECKODAG = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const MANAD = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const stor = s => s.charAt(0).toLocaleUpperCase('sv-SE') + s.slice(1);
function parseDatum(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
const datumText = d => `${d.getUTCDate()} ${MANAD[d.getUTCMonth()]}`;

// ------------------------------------------------------------------ validering + formatering
function person(r) {
  const fel = [];
  const need = ['fornamn', 'region', 'startdatum', 'starttid', 'plats', 'gruppledare', 'dag1', 'dag2', 'dag3'];
  need.forEach(k => { if (!r[k]) fel.push(`kolumnen "${k}" är tom`); });
  if (fel.length) return { fel };
  const namnOk = s => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]*$/.test(s);
  if (!namnOk(r.fornamn)) fel.push(`förnamnet "${r.fornamn}" innehåller otillåtna tecken (bara bokstäver, bindestreck, mellanslag)`);
  if (r.fornamn.length > 12) fel.push(`förnamnet "${r.fornamn}" är för långt (max 12 tecken, bara förnamn)`);
  if (!namnOk(r.gruppledare)) fel.push(`gruppledarens namn "${r.gruppledare}" innehåller otillåtna tecken`);
  if (r.gruppledare.length > 14) fel.push(`gruppledarens namn "${r.gruppledare}" är för långt (max 14 tecken, bara förnamn)`);
  const region = REGIONER.find(x => x.toLowerCase() === r.region.toLowerCase());
  if (!region) fel.push(`okänd region "${r.region}". Tillåtna: ${REGIONER.join(', ')}`);
  const start = parseDatum(r.startdatum);
  if (!start) fel.push(`startdatum "${r.startdatum}" är inte ett giltigt datum (skriv ÅÅÅÅ-MM-DD, t.ex. 2027-01-11)`);
  if (!/^([01]\d|2[0-3])[:.][0-5]\d$/.test(r.starttid)) fel.push(`starttid "${r.starttid}" ska skrivas TT:MM, t.ex. 07:00`);
  if (r.plats.length > 34) fel.push(`platsen "${r.plats}" är för lång (max 34 tecken)`);
  if (fel.length) return { fel };
  const tid = r.starttid.replace('.', ':');
  const fyll = s => s.replace(/\{gruppledare\}/g, r.gruppledare).replace(/\{starttid\}/g, tid).replace(/\{plats\}/g, r.plats).replace(/\{fornamn\}/g, r.fornamn);
  // dagN: "tisdag: Du åker med {gruppledare}". Utan veckodag gäller startdagen för dag1.
  const dagar = [];
  ['dag1', 'dag2', 'dag3'].forEach((k, i) => {
    let txt = r[k], d = null;
    const m = /^\s*(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\s*[:·\-–]\s*(.+)$/i.exec(txt);
    if (m) {
      const wd = VECKODAG.indexOf(m[1].toLowerCase()); txt = m[2];
      d = new Date(start); while (d.getUTCDay() !== wd) d.setUTCDate(d.getUTCDate() + 1);
    } else if (i === 0) d = new Date(start);
    else { fel.push(`${k}: börja med veckodag, t.ex. "tisdag: Du åker med {gruppledare}"`); return; }
    txt = fyll(txt.trim());
    if (txt.length > 80) fel.push(`${k}: texten är ${txt.length} tecken, max 80`);
    dagar.push({ veckodag: VECKODAG[d.getUTCDay()].toLocaleUpperCase('sv-SE'), nr: String(d.getUTCDate()), text: stor(txt), d });
  });
  for (let i = 1; i < dagar.length; i++) if (+dagar[i].d <= +dagar[i - 1].d) fel.push(`dag${i + 1} måste ligga efter dag${i} i veckan`);
  const d1 = dagar[0] && dagar[0].d, d3 = dagar[dagar.length - 1] && dagar[dagar.length - 1].d;
  const veckaText = !d1 ? '' : (d1.getUTCMonth() === d3.getUTCMonth()
    ? `${d1.getUTCDate()}–${d3.getUTCDate()} ${MANAD[d1.getUTCMonth()]}` : `${datumText(d1)} – ${datumText(d3)}`).toLocaleUpperCase('sv-SE');
  let halsning = null;
  if (r.halsning) {
    const p = path.resolve(HAR, r.halsning);
    if (!fs.existsSync(p)) fel.push(`hälsningsklippet "${r.halsning}" finns inte`);
    const st = r.halsning_start ? +r.halsning_start.replace(',', '.') : 0;
    const ln = r.halsning_langd ? +r.halsning_langd.replace(',', '.') : 5;
    if (!(st >= 0)) fel.push('halsning_start ska vara sekunder, t.ex. 1,5');
    if (!(ln >= 2 && ln <= 8)) fel.push('halsning_langd ska vara mellan 2 och 8 sekunder');
    halsning = { fil: p, start: st, langd: ln };
  }
  if (fel.length) return { fel };
  return {
    p: {
      fornamn: stor(r.fornamn), region, gruppledare: stor(r.gruppledare),
      sasong: `SÄSONG ${start.getUTCFullYear()}`,
      subline: 'Du är en del av Nanostone nu.',
      startdag: VECKODAG[start.getUTCDay()],
      datumTid: `${stor(VECKODAG[start.getUTCDay()])} ${datumText(start)} · kl. ${tid}`,
      platsText: stor(r.plats),
      veckaText,
      dagar: dagar.map(({ veckodag, nr, text }) => ({ veckodag, nr, text })),
    }, halsning,
  };
}

// ------------------------------------------------------------------ hjälp: ffmpeg
function run(cmd, a) { const r = spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`${cmd} misslyckades: ${(r.stderr || '').slice(-1500)}`); return r.stdout; }
function probe(f) { return JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f])); }

/* Hälsningsklipp: avkodas en gång per (fil, start, längd) och cachas som JPG-rutor + normaliserat ljud. */
function forberedHalsning(h, fps) {
  const st = fs.statSync(h.fil);
  const key = crypto.createHash('sha1').update([h.fil, st.size, st.mtimeMs, h.start, h.langd, fps, 'v2'].join('|')).digest('hex').slice(0, 16);
  const dir = path.join(HAR, 'cache', 'halsning-' + key);
  const infoF = path.join(dir, 'info.json');
  if (fs.existsSync(infoF)) return { ...JSON.parse(fs.readFileSync(infoF, 'utf8')), dir, key, cache: true };
  fs.mkdirSync(dir, { recursive: true });
  const pr = probe(h.fil);
  const dur = +pr.format.duration;
  if (h.start >= dur - 0.5) throw new Error(`halsning_start ${h.start}s ligger efter klippets slut (${dur.toFixed(1)}s)`);
  const langd = Math.min(h.langd, dur - h.start);
  const harLjud = pr.streams.some(s => s.codec_type === 'audio');
  // täck 9:16 (centrerat), lite större än bilden för långsam inzoomning; ffmpeg roterar enligt metadata
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(h.start), '-t', String(langd), '-i', h.fil,
    '-vf', `fps=${fps},scale=1188:2112:force_original_aspect_ratio=increase:flags=lanczos,crop=1188:2112,setsar=1`,
    '-q:v', '2', path.join(dir, '%05d.jpg')]);
  const frames = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length;
  if (harLjud) {
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(h.start), '-t', String(langd), '-i', h.fil, '-vn',
      '-af', `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.12,afade=t=out:st=${(langd - 0.25).toFixed(2)}:d=0.25,aresample=48000`,
      '-ac', '2', path.join(dir, 'ljud.wav')]);
  }
  const info = { frames, langd: frames / fps, ljud: harLjud };
  fs.writeFileSync(infoF, JSON.stringify(info));
  return { ...info, dir, key, cache: false };
}

// ------------------------------------------------------------------ statisk server för film.html + assets
function server() {
  const typer = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  const s = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.normalize(path.join(HAR, u));
    if (!f.startsWith(HAR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': typer[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}

async function oppnaSida(browser, url, data) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url);
  const info = await page.evaluate(d => window.init(d), data).catch(e => { throw new Error('Sidan kunde inte starta: ' + e.message + ' ' + errs.join(' ')); });
  const cdp = await ctx.newCDPSession(page);
  return { page, cdp, info, ctx };
}
async function bildruta(s, t, fps) {
  await s.page.evaluate(([t, fps]) => window.prepare(t).then(() => window.renderAt(t, { fps })), [t, fps]);
  const r = await s.cdp.send('Page.captureScreenshot', s.png ? { format: 'png', optimizeForSpeed: true } : { format: 'jpeg', quality: 97, optimizeForSpeed: true });
  return Buffer.from(r.data, 'base64');
}

// ------------------------------------------------------------------ ljud
function ljudArgs(dur, musik, hals, halsStart) {
  const inp = [], filt = []; let n = 1; const mix = [];
  inp.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'); const tyst = n++; mix.push(`[${tyst}:a]`);
  if (musik) {
    inp.push('-i', musik); const m = n++;
    let f = `[${m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur.toFixed(3)},asetpts=N/SR/TB,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=1.2,afade=t=out:st=${(dur - 2.5).toFixed(3)}:d=2.5`;
    if (hals && hals.ljud) { // duckning under hälsningen
      const a = halsStart - 0.3, b = halsStart + hals.langd + 0.3;
      f += `,volume='1-0.82*max(0,min(1,min((t-${a.toFixed(3)})/0.4,(${b.toFixed(3)}-t)/0.4)))':eval=frame`;
    }
    filt.push(f + '[mus]'); mix.push('[mus]');
  }
  if (hals && hals.ljud) {
    inp.push('-i', path.join(hals.dir, 'ljud.wav')); const h = n++;
    const ms = Math.round(halsStart * 1000);
    filt.push(`[${h}:a]adelay=${ms}|${ms}[hal]`); mix.push('[hal]');
  }
  filt.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0,alimiter=limit=0.89[aout]`);
  return { inp, filt: filt.join(';') };
}

// ------------------------------------------------------------------ rendera en film
async function renderaFilm(browser, base, row, pers, o, utfil) {
  const t0 = Date.now();
  const data = { ...pers.p, halsning: null };
  let hals = null;
  if (pers.halsning) {
    hals = forberedHalsning(pers.halsning, o.fps);
    data.halsning = { url: `cache/halsning-${hals.key}/`, frames: hals.frames, langd: hals.langd };
    console.log(`  hälsningsklipp: ${hals.frames} rutor, ${hals.langd.toFixed(2)} s, ${hals.ljud ? 'med ljud' : 'utan ljud'}${hals.cache ? ' (från cache)' : ''}`);
  }
  const sidor = [];
  for (let i = 0; i < o.arbetare; i++) sidor.push(await oppnaSida(browser, base + '/film.html', data));
  const fel = await sidor[0].page.evaluate(() => window.validate());
  if (fel.length) { await Promise.all(sidor.map(s => s.ctx.close())); throw new Error(fel.join('\n  ')); }
  const { duration, timeline } = sidor[0].info;
  const N = Math.round(duration * o.fps);
  const halsStart = (timeline.find(s => s.namn === 'Hälsning') || {}).start;
  const lj = ljudArgs(N / o.fps, o.musik, hals, halsStart);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg', '-i', '-', ...lj.inp,
    '-filter_complex', lj.filt, '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', o.snabb ? 'veryfast' : 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-maxrate', o.maxrate || '5M', '-bufsize', '10M', '-x264-params', 'aq-mode=3:deblock=-1,-1', '-r', String(o.fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-t', (N / o.fps).toFixed(3), utfil], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg avslutades med kod ' + c))));
  // parallella sidor, skrivs i ordning
  let next = 0, written = 0; const klara = new Map(); let wake = null;
  const worker = async s => { while (true) { const f = next++; if (f >= N) return; klara.set(f, await bildruta(s, f / o.fps, o.fps)); if (wake) wake(); } };
  const ws = sidor.map(worker);
  const tStart = Date.now();
  while (written < N) {
    if (!klara.has(written)) { await new Promise(r => wake = r); wake = null; continue; }
    const buf = klara.get(written); klara.delete(written);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    written++;
    if (written % 15 === 0 || written === N) {
      const el = (Date.now() - tStart) / 1000, eta = el / written * (N - written);
      process.stdout.write(`\r  ${row}: ruta ${written}/${N}  ${(written / el).toFixed(1)} rutor/s  kvar ~${eta.toFixed(0)} s   `);
    }
  }
  await Promise.all(ws); ff.stdin.end(); await ffDone;
  await Promise.all(sidor.map(s => s.ctx.close()));
  process.stdout.write('\n');
  // affisch: namnet fullt utskrivet
  const hello = timeline.find(s => s.namn === 'Välkommen');
  run('ffmpeg', ['-v', 'error', '-y', '-ss', (hello.start + 3.0).toFixed(3), '-i', utfil, '-frames:v', '1', '-q:v', '2', utfil.replace(/\.mp4$/, '.jpg')]);
  if (o.kontaktark) kontaktark(utfil, timeline, N, o.fps);
  const sek = (Date.now() - t0) / 1000;
  return { sek, N, duration, bytes: fs.statSync(utfil).size, timeline };
}

function kontaktark(mp4, timeline, N, fps) {
  const ark = (n, cols, ut) => {
    const idx = [...Array(n)].map((_, i) => Math.round((i + 0.5) * N / n));
    const sel = idx.map(i => `eq(n\\,${i})`).join('+');
    run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', `select='${sel}',scale=270:480:flags=lanczos,tile=${cols}x${Math.ceil(n / cols)}:padding=8:margin=8:color=0x06111b`, '-frames:v', '1', '-fps_mode', 'vfr', ut]);
  };
  const b = mp4.replace(/\.mp4$/, '');
  ark(12, 6, b + '-kontaktark-12.png');
  ark(24, 6, b + '-kontaktark-24.png');
  // tre stillbilder i full storlek: rubrik, karta i regionen, före/efter mitt i torkningen
  const st = n => timeline.find(s => s.namn === n).start;
  const stills = { rubrik: st('Välkommen') + 3.0, karta: st('Karta') + 7.4, torkning: st('Det här gör vi') + 1.17 };
  for (const [k, t] of Object.entries(stills))
    run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1', `${b}-still-${k}.png`]);
}

// ------------------------------------------------------------------ main
(async () => {
  const o = args();
  if (!fs.existsSync(o.csv)) fail(`hittar inte CSV-filen ${o.csv}`);
  if (!fs.existsSync(path.join(HAR, 'assets', 'meta.json'))) fail('assets saknas. Kör först: python3 forbered.py');
  if (o.musik && !fs.existsSync(o.musik)) fail(`musikfilen ${o.musik} finns inte`);
  let rows = parseCsv(fs.readFileSync(o.csv, 'utf8'));
  if (o.namn) rows = rows.filter(r => (r.fornamn || '').toLowerCase() === o.namn.toLowerCase());
  if (o.rad) rows = rows.filter(r => r._rad === +o.rad);
  if (!rows.length) fail('inga rader att rendera (kontrollera --namn/--rad och CSV-filen)');
  // validera alla först så att ingen film renderas halvt
  const personer = rows.map(r => ({ r, ...person(r) }));
  const dåliga = personer.filter(p => p.fel);
  if (dåliga.length) fail(dåliga.map(p => `rad ${p.r._rad} (${p.r.fornamn || 'utan namn'}):\n  ${p.fel.join('\n  ')}`).join('\n') + '\n\nIngen film renderades. Rätta CSV-filen och kör igen.');
  fs.mkdirSync(o.ut, { recursive: true });
  const srv = await server(); const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  // layoutkontroll med riktiga typsnitt
  for (const p of personer) {
    const s = await oppnaSida(browser, base + '/film.html', { ...p.p, halsning: p.halsning ? { url: '', frames: 1, langd: p.halsning.langd } : null });
    const fel = await s.page.evaluate(() => window.validate()); await s.ctx.close();
    if (fel.length) { await browser.close(); srv.close(); fail(`rad ${p.r._rad} (${p.r.fornamn}): texten får inte plats:\n  ${fel.join('\n  ')}\n\nIngen film renderades.`); }
  }
  if (o.kontrollera) { console.log(`${personer.length} rader kontrollerade, inga fel.`); await browser.close(); srv.close(); return; }
  if (o.stillbilder) { // snabb förhandsgranskning: enskilda bildrutor som PNG, ingen film
    const p = personer[0]; const data = { ...p.p, halsning: null };
    if (p.halsning) { const h = forberedHalsning(p.halsning, o.fps); data.halsning = { url: `cache/halsning-${h.key}/`, frames: h.frames, langd: h.langd }; }
    const s = await oppnaSida(browser, base + '/film.html', data); s.png = true;
    console.log('tidslinje:', JSON.stringify(s.info.timeline));
    for (const t of String(o.stillbilder).split(',').map(Number)) {
      const f = path.join(o.ut, `still-${t.toFixed(2).padStart(6, '0')}.png`);
      fs.writeFileSync(f, await bildruta(s, t, o.fps)); console.log(f);
    }
    await browser.close(); srv.close(); return;
  }
  const anvanda = new Map(); const sum = [];
  for (const [i, p] of personer.entries()) {
    const slug = p.p.fornamn.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    const n = (anvanda.get(slug) || 0) + 1; anvanda.set(slug, n);
    const utfil = path.join(o.ut, `valkomst-${slug}${n > 1 ? '-' + n : ''}${o.suffix}.mp4`);
    console.log(`[${i + 1}/${personer.length}] ${p.p.fornamn}, ${p.p.region} -> ${utfil}`);
    try {
      const r = await renderaFilm(browser, base, `${i + 1}/${personer.length} ${p.p.fornamn}`, p, o, utfil);
      console.log(`  klar på ${r.sek.toFixed(0)} s, ${(r.bytes / 1e6).toFixed(1)} MB, ${r.duration.toFixed(1)} s film`);
      sum.push(r.sek);
    } catch (e) { console.error(`  FEL för ${p.p.fornamn}: ${e.message}`); process.exitCode = 1; }
  }
  await browser.close(); srv.close();
  if (sum.length > 1) console.log(`Klart: ${sum.length} filmer, i snitt ${(sum.reduce((a, b) => a + b) / sum.length).toFixed(0)} s per film.`);
})().catch(e => fail(e.stack || e.message));
