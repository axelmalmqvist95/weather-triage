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
  // dag1–dag3 (veckoschemat) accepteras i gamla CSV-filer men används inte längre i filmen
  const need = ['fornamn', 'region', 'startdatum', 'starttid', 'plats', 'gruppledare'];
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
      startdag: VECKODAG[start.getUTCDay()],
      datumTid: `${stor(VECKODAG[start.getUTCDay()])} ${datumText(start)} · kl. ${tid}`,
      platsText: stor(r.plats),
    }, halsning,
  };
}

// ------------------------------------------------------------------ hjälp: ffmpeg
function run(cmd, a) { const r = spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`${cmd} misslyckades: ${(r.stderr || '').slice(-1500)}`); return r.stdout; }
function probe(f) { return JSON.parse(run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f])); }

/* Filmklipp (hälsning eller montage): avkodas en gång per (fil, start, längd, inställning) och cachas som
 * JPG-rutor (+ normaliserat ljud för hälsningen). 40 filmer med samma klipp avkodar det alltså bara en gång.
 * typ 'halsning': täcks till 9:16 från mitten, ljudet behålls. typ 'montage': samma gradering som fotona
 * (svärtan lyft mot marin, mjuk kontrast), valfri slowmotion med rörelseinterpolering. */
function forberedKlipp(h, fps, typ) {
  const st = fs.statSync(h.fil);
  const key = crypto.createHash('sha1').update([h.fil, st.size, st.mtimeMs, h.start, h.langd, fps, typ, !!h.slowmo, 'v3'].join('|')).digest('hex').slice(0, 16);
  const dir = path.join(HAR, 'cache', typ + '-' + key);
  const infoF = path.join(dir, 'info.json');
  if (fs.existsSync(infoF)) return { ...JSON.parse(fs.readFileSync(infoF, 'utf8')), dir, key, url: `cache/${typ}-${key}/`, cache: true };
  fs.mkdirSync(dir, { recursive: true });
  const pr = probe(h.fil);
  const dur = +pr.format.duration;
  if (h.start >= dur - 0.5) throw new Error(`${path.basename(h.fil)}: start ${h.start}s ligger efter klippets slut (${dur.toFixed(1)}s)`);
  const fart = h.slowmo ? 0.5 : 1; // slowmotion: halv fart, mellanrutor räknas fram
  const langd = Math.min(h.langd * fart, dur - h.start);
  const harLjud = typ === 'halsning' && pr.streams.some(s => s.codec_type === 'audio');
  const grade = typ === 'montage' ? ",eq=contrast=1.05:saturation=0.92,colorbalance=bs=0.035:bm=0.01,curves=all='0/0.035 0.5/0.5 1/0.985'" : '';
  const slow = h.slowmo ? `minterpolate=fps=${fps * 2}:mi_mode=mci:mc_mode=aobmc:vsbmc=1,setpts=2*PTS,` : '';
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(h.start), '-t', String(langd), '-i', h.fil,
    '-vf', `${slow}fps=${fps},scale=1188:2112:force_original_aspect_ratio=increase:flags=lanczos,crop=1188:2112,setsar=1${grade}`,
    '-q:v', '2', path.join(dir, '%05d.jpg')]);
  const frames = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length;
  if (harLjud) {
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(h.start), '-t', String(langd), '-i', h.fil, '-vn',
      '-af', `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.12,afade=t=out:st=${(langd - 0.25).toFixed(2)}:d=0.25,aresample=48000`,
      '-ac', '2', path.join(dir, 'ljud.wav')]);
  }
  const info = { frames, langd: frames / fps, ljud: harLjud };
  fs.writeFileSync(infoF, JSON.stringify(info));
  return { ...info, dir, key, url: `cache/${typ}-${key}/`, cache: false };
}
function filmData(pers, o) {
  const data = { ...pers.p, takt: CFG.film, halsning: null, montage: [] };
  let hals = null;
  if (pers.halsning) {
    hals = forberedKlipp(pers.halsning, o.fps, 'halsning');
    data.halsning = { url: hals.url, frames: hals.frames, langd: hals.langd };
    console.log(`  hälsningsklipp: ${hals.frames} rutor, ${hals.langd.toFixed(2)} s, ${hals.ljud ? 'med ljud' : 'utan ljud'}${hals.cache ? ' (från cache)' : ''}`);
  }
  const montage = o.montage ? JSON.parse(fs.readFileSync(o.montage, 'utf8')) : (CFG.montage || []);
  for (const m of montage) {
    const k = forberedKlipp({ fil: m.fil, start: m.start || 0, langd: m.langd || 1.5, slowmo: !!m.slowmo }, o.fps, 'montage');
    data.montage.push({ url: k.url, frames: k.frames, langd: m.langd || 1.5 });
  }
  return { data, hals };
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
/* Ljudet byggs före bilden: syntetisk effektbädd (ljud.js) + valfri musik (under effekterna, sänkt under
 * hälsningen) + hälsningens eget ljud. Mixen normaliseras sedan linjärt till -16 LUFS (två pass) med
 * toppbegränsning på -1,5 dBTP. */
function byggLjud(ljud, dur, musik, hals, halsStart, tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const fx = path.join(tmpDir, 'effekter.wav');
  require('./ljud.js').syntes(ljud, dur, fx);
  const inp = ['-i', fx], filt = []; const mix = ['[0:a]']; let n = 1;
  if (musik) {
    inp.push('-stream_loop', '-1', '-i', musik); const m = n++;
    let f = `[${m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur.toFixed(3)},asetpts=N/SR/TB,loudnorm=I=-18:TP=-2:LRA=11,afade=t=in:d=1.2,afade=t=out:st=${(dur - 2.5).toFixed(3)}:d=2.5`;
    if (hals && hals.ljud) { const a = halsStart - 0.4, b = halsStart + hals.langd + 0.3; f += `,volume='1-0.8*max(0,min(1,min((t-${a.toFixed(3)})/0.5,(${b.toFixed(3)}-t)/0.5)))':eval=frame`; }
    filt.push(f + '[mus]'); mix.push('[mus]');
  }
  if (hals && hals.ljud) { inp.push('-i', path.join(hals.dir, 'ljud.wav')); const h = n++; const ms = Math.round(halsStart * 1000); filt.push(`[${h}:a]adelay=${ms}|${ms}[hal]`); mix.push('[hal]'); }
  filt.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0,apad=whole_dur=${dur.toFixed(3)}[aout]`);
  const mixF = path.join(tmpDir, 'mix.wav');
  run('ffmpeg', ['-v', 'error', '-y', ...inp, '-filter_complex', filt.join(';'), '-map', '[aout]', '-t', dur.toFixed(3), '-c:a', 'pcm_s24le', '-ar', '48000', mixF]);
  const m = spawnSync('ffmpeg', ['-hide_banner', '-i', mixF, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const js = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf('{')));
  const gain = -16 - parseFloat(js.input_i);
  const ut = path.join(tmpDir, 'slutmix.wav');
  run('ffmpeg', ['-v', 'error', '-y', '-i', mixF, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=false`, '-c:a', 'pcm_s24le', ut]);
  return { fil: ut, uppmatt: parseFloat(js.input_i), gain };
}

// ------------------------------------------------------------------ rendera en film
async function renderaFilm(browser, base, row, pers, o, utfil) {
  const t0 = Date.now();
  const { data, hals } = filmData(pers, o);
  const sidor = [];
  for (let i = 0; i < o.arbetare; i++) sidor.push(await oppnaSida(browser, base + '/film.html', data));
  const fel = await sidor[0].page.evaluate(() => window.validate());
  if (fel.length) { await Promise.all(sidor.map(s => s.ctx.close())); throw new Error(fel.join('\n  ')); }
  const { duration, timeline, ljud } = sidor[0].info;
  const N = Math.round(duration * o.fps);
  const halsStart = (timeline.find(s => s.namn === 'Hälsning') || {}).start;
  const tmp = path.join(HAR, 'cache', 'ljud-' + path.basename(utfil, '.mp4'));
  const lj = byggLjud(ljud, N / o.fps, o.musik, hals, halsStart, tmp);
  console.log(`  ljud: mix ${lj.uppmatt.toFixed(1)} LUFS, justerad ${lj.gain >= 0 ? '+' : ''}${lj.gain.toFixed(1)} dB till -16 LUFS`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg', '-i', '-', '-i', lj.fil,
    '-map', '0:v', '-map', '1:a',
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
  // affisch: namnet framtvättat
  const nm = timeline.find(s => s.namn === 'Namn');
  run('ffmpeg', ['-v', 'error', '-y', '-ss', (nm.start + 5.0).toFixed(3), '-i', utfil, '-frames:v', '1', '-q:v', '2', utfil.replace(/\.mp4$/, '.jpg')]);
  if (o.kontaktark) kontaktark(utfil, timeline, N, o.fps);
  fs.writeFileSync(utfil.replace(/\.mp4$/, '-tidslinje.json'), JSON.stringify({ bpm: CFG.film.bpm, scener: timeline }, null, 1));
  const sek = (Date.now() - t0) / 1000;
  return { sek, N, duration, bytes: fs.statSync(utfil).size, timeline };
}

function kontaktark(mp4, timeline, N, fps) {
  const ark = (n, cols, ut) => {
    const idx = [...Array(n)].map((_, i) => Math.round((i + 0.5) * N / n));
    const sel = idx.map(i => `eq(n\\,${i})`).join('+');
    run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', `select='${sel}',format=rgb24,scale=270:480:flags=lanczos+accurate_rnd+full_chroma_int,tile=${cols}x${Math.ceil(n / cols)}:padding=8:margin=8:color=0x06111b`, '-frames:v', '1', '-fps_mode', 'vfr', ut]);
  };
  const b = mp4.replace(/\.mp4$/, '');
  ark(12, 6, b + '-kontaktark-12.png');
  ark(24, 6, b + '-kontaktark-24.png');
  // stillbilder i full storlek för granskning
  const st = n => timeline.find(s => s.namn === n).start;
  const stills = { 'namn-start': st('Namn') + 0.9, 'namn-mitt': st('Namn') + 2.1, 'namn-klar': st('Namn') + 5.3, karta: st('Karta') + 5.3,
    torkning: st('Före/efter') + 1.03, 'vi-ses': st('Vi ses') + 3.6, slutbild: st('Slut') + 1.9 };
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
    const s = await oppnaSida(browser, base + '/film.html', { ...p.p, takt: CFG.film, montage: [], halsning: p.halsning ? { url: '', frames: 1, langd: p.halsning.langd } : null });
    const fel = await s.page.evaluate(() => window.validate()); await s.ctx.close();
    if (fel.length) { await browser.close(); srv.close(); fail(`rad ${p.r._rad} (${p.r.fornamn}): texten får inte plats:\n  ${fel.join('\n  ')}\n\nIngen film renderades.`); }
  }
  if (o.kontrollera) { console.log(`${personer.length} rader kontrollerade, inga fel.`); await browser.close(); srv.close(); return; }
  if (o.stillbilder) { // snabb förhandsgranskning: enskilda bildrutor som PNG, ingen film
    const p = personer[0]; const { data } = filmData(p, o);
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
