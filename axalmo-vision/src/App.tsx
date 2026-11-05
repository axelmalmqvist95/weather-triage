import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createPoseLandmarker, type Delegate } from './pose';
import { Tracker, directionLabel, type Track } from './tracker';
import { drawFrame, toVideo, type View } from './draw';

type Facing = 'user' | 'environment';
type ModelStatus = 'ej laddad' | 'laddar…' | 'redo' | 'fel';

interface Calibration {
  metersPerPx: number;
  pts: { x: number; y: number }[];
  vw: number;
  vh: number;
  facing: Facing;
}

interface HudPerson { id: number; pxs: number; dir: string; kmh: number | null }

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Kamerabehörighet nekades. Gå till Inställningar › Safari › Kamera och välj "Fråga" eller "Tillåt", ladda sedan om sidan.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Ingen kamera hittades på enheten.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Kameran används redan av en annan app. Stäng den och försök igen.';
    case 'OverconstrainedError':
      return 'Den valda kameran stöder inte begärd upplösning.';
    case 'SecurityError':
      return 'Kameran blockerades av säkerhetsskäl. Appen måste köras via HTTPS.';
    default:
      return `Kunde inte starta kameran: ${(e as Error)?.message ?? String(e)}`;
  }
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const trackerRef = useRef(new Tracker());
  const runningRef = useRef(false);
  const loopIdRef = useRef(0);
  const fpsRef = useRef({ frames: 0, since: performance.now(), fps: 0, inferMs: 0 });
  const hudRef = useRef<HudPerson[]>([]);
  const calibRef = useRef<Calibration | null>(null);
  const calibPtsRef = useRef<{ x: number; y: number }[]>([]);
  const stillRef = useRef(false);
  const facingRef = useRef<Facing>('environment');

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<Facing>('environment');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('ej laddad');
  const [delegate, setDelegate] = useState<Delegate | null>(null);
  const [numPoses, setNumPoses] = useState(1);
  const [prefDelegate, setPrefDelegate] = useState<Delegate>(() => {
    try {
      return localStorage.getItem('axalmo-delegate') === 'CPU' ? 'CPU' : 'GPU';
    } catch {
      return 'GPU';
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<{ fps: number; inferMs: number; people: HudPerson[] }>({ fps: 0, inferMs: 0, people: [] });
  const [calibMode, setCalibMode] = useState(false);
  const [calibPts, setCalibPts] = useState<{ x: number; y: number }[]>([]);
  const [calibMeters, setCalibMeters] = useState('2');
  const [calib, setCalib] = useState<Calibration | null>(null);
  const [cameraStill, setCameraStill] = useState(false);
  const [showCalibPanel, setShowCalibPanel] = useState(false);

  calibRef.current = calib;
  calibPtsRef.current = calibPts;
  stillRef.current = cameraStill;
  facingRef.current = facing;

  const view = useCallback((): View | null => {
    const v = videoRef.current, st = stageRef.current;
    if (!v || !st || !v.videoWidth) return null;
    return { cw: st.clientWidth, ch: st.clientHeight, vw: v.videoWidth, vh: v.videoHeight, mirrored: facingRef.current === 'user' };
  }, []);

  // Huvudloop: ritar varje skärmuppdatering, men kör inferens bara när huvudtråden har tid över.
  // Inferensen får ta högst ~50 % av tiden så att video och UI förblir mjuka på iPhone.
  const loop = useCallback(() => {
    const myId = ++loopIdRef.current;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let lastVideoTime = -1;
    let nextInferAt = 0;
    let lastInferT = 0;
    let labels = new Map<number, string[]>();
    let tracks: Track[] = [];

    const step = () => {
      if (!runningRef.current || myId !== loopIdRef.current) return;
      requestAnimationFrame(step);
      const lmk = landmarkerRef.current;
      const v = view();
      if (!lmk || !v || video.readyState < 2) return;
      const now = performance.now();

      if (now >= nextInferAt && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        let poses: Track['landmarks'][] = [];
        try {
          poses = lmk.detectForVideo(video, now).landmarks;
        } catch (e) {
          console.error(e);
          setError(`Modellfel under körning: ${(e as Error).message}`);
        }
        const t1 = performance.now();
        const cost = t1 - now;
        nextInferAt = t1 + cost; // ~50 % arbetscykel
        lastInferT = now;
        tracks = trackerRef.current.update(poses, now, v.vw, v.vh);

        const cal = calibRef.current;
        const calOk = !!cal && stillRef.current && cal.vw === v.vw && cal.vh === v.vh && cal.facing === facingRef.current;
        labels = new Map();
        const people: HudPerson[] = [];
        for (const tr of tracks) {
          const pxs = Math.hypot(tr.vx, tr.vy);
          const kmh = calOk && tr.age > 5 ? pxs * cal!.metersPerPx * 3.6 : null;
          const dir = directionLabel(tr, v.mirrored);
          people.push({ id: tr.id, pxs, dir, kmh });
          const l = [`P${tr.id}  ${Math.round(pxs)} px/s`, dir];
          if (kmh !== null) l.push(`≈ ${kmh.toFixed(1)} km/h (uppsk.)`);
          labels.set(tr.id, l);
        }
        hudRef.current = people;

        const f = fpsRef.current;
        f.frames++;
        f.inferMs += (cost - f.inferMs) * 0.1;
        if (t1 - f.since >= 1000) {
          f.fps = (f.frames * 1000) / (t1 - f.since);
          f.frames = 0;
          f.since = t1;
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(v.cw * dpr) || canvas.height !== Math.round(v.ch * dpr)) {
        canvas.width = Math.round(v.cw * dpr);
        canvas.height = Math.round(v.ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cal = calibRef.current;
      drawFrame(ctx, v, tracks, labels, calibPtsRef.current.length ? calibPtsRef.current : cal?.pts ?? [], now - lastInferT);
    };
    step();
  }, [view]);

  // HUD uppdateras 4 ggr/s (billigare än React-render per bildruta).
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const f = fpsRef.current;
      setHud({ fps: f.fps, inferMs: f.inferMs, people: hudRef.current });
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const c = canvasRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    trackerRef.current.reset();
    hudRef.current = [];
    setHud({ fps: 0, inferMs: 0, people: [] });
    setRunning(false);
  }, []);

  const ensureModel = useCallback(async () => {
    if (landmarkerRef.current) return;
    setModelStatus('laddar…');
    try {
      const { landmarker, delegate } = await createPoseLandmarker(numPoses, prefDelegate);
      landmarkerRef.current = landmarker;
      setDelegate(delegate);
      setModelStatus('redo');
    } catch (e) {
      setModelStatus('fel');
      throw new Error(`Modellen kunde inte laddas (${(e as Error).message}). Kontrollera anslutningen första gången appen öppnas.`);
    }
  }, [numPoses, prefDelegate]);

  const startCamera = useCallback(
    async (face: Facing) => {
      setError(null);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('Kameran kräver säker anslutning (HTTPS eller localhost). Se README för hur du testar på iPhone.');
        return;
      }
      setBusy(true);
      try {
        // Behörighet begärs först här – när användaren tryckt Starta.
        const camPromise = navigator.mediaDevices
          .getUserMedia({
            audio: false,
            video: { facingMode: { ideal: face }, width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } },
          })
          .catch((e) => {
            if ((e as { name?: string }).name === 'OverconstrainedError')
              return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: face } });
            throw e;
          });
        const [stream] = await Promise.all([camPromise.catch((e) => Promise.reject(new Error(cameraError(e)))), ensureModel()]);
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        trackerRef.current.reset();
        runningRef.current = true;
        setRunning(true);
        loop();
      } catch (e) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [ensureModel, loop],
  );

  const toggleRun = () => (running ? stopCamera() : startCamera(facing));

  const switchCamera = async () => {
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    facingRef.current = next;
    if (running) {
      stopCamera();
      await startCamera(next);
    }
  };

  const changeNumPoses = async (n: number) => {
    setNumPoses(n);
    trackerRef.current.reset();
    try {
      await landmarkerRef.current?.setOptions({ numPoses: n });
    } catch (e) {
      setError(`Kunde inte ändra antal personer: ${(e as Error).message}`);
    }
  };

  // Byt GPU/CPU: stäng modellen och ladda om med nytt val.
  const changeDelegate = async (d: Delegate) => {
    if (d === prefDelegate || busy) return;
    setPrefDelegate(d);
    try {
      localStorage.setItem('axalmo-delegate', d);
    } catch {
      /* ignorera */
    }
    setBusy(true);
    const old = landmarkerRef.current;
    landmarkerRef.current = null;
    old?.close();
    setModelStatus('laddar…');
    try {
      const { landmarker, delegate } = await createPoseLandmarker(numPoses, d);
      landmarkerRef.current = landmarker;
      setDelegate(delegate);
      setModelStatus('redo');
      trackerRef.current.reset();
      fpsRef.current = { frames: 0, since: performance.now(), fps: 0, inferMs: 0 };
    } catch (e) {
      setModelStatus('fel');
      setError(`Kunde inte ladda modellen med ${d}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Stoppa kameran när appen hamnar i bakgrunden (sparar batteri, iOS pausar ändå).
  useEffect(() => {
    const onVis = () => document.hidden && runningRef.current && stopCamera();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      runningRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [stopCamera]);

  // Kalibrering: tryck två punkter i bilden.
  const onStageTap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!calibMode) return;
    const v = view();
    if (!v) return;
    const r = stageRef.current!.getBoundingClientRect();
    const p = toVideo(v, e.clientX - r.left, e.clientY - r.top);
    const pts = calibPts.length >= 2 ? [p] : [...calibPts, p];
    setCalibPts(pts);
    if (pts.length === 2) setCalibMode(false);
  };

  const calibPx = calibPts.length === 2 ? Math.hypot(calibPts[0].x - calibPts[1].x, calibPts[0].y - calibPts[1].y) : 0;
  const meters = parseFloat(calibMeters.replace(',', '.'));
  const canSaveCalib = calibPx > 20 && meters > 0 && meters < 1000;

  const saveCalib = () => {
    const v = view();
    if (!v || !canSaveCalib) return;
    setCalib({ metersPerPx: meters / calibPx, pts: calibPts, vw: v.vw, vh: v.vh, facing });
    setCalibPts([]);
    setShowCalibPanel(false);
  };

  const clearCalib = () => {
    setCalib(null);
    setCalibPts([]);
    setCalibMode(false);
  };

  const calibValid = !!calib && calib.facing === facing;
  const kmhActive = calibValid && cameraStill;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          AXALMO<span>VISION</span>
        </div>
        <div className="chips">
          <span className={`chip ${running ? 'on' : ''}`}>{running ? `${hud.fps.toFixed(0)} FPS` : 'AV'}</span>
          <span className={`chip model-${modelStatus === 'redo' ? 'ok' : modelStatus === 'fel' ? 'err' : 'idle'}`}>
            Modell: {modelStatus}
            {delegate && modelStatus === 'redo' ? ` · ${delegate}` : ''}
          </span>
        </div>
      </header>

      <div ref={stageRef} className={`stage ${calibMode ? 'calibrating' : ''}`} onPointerDown={onStageTap}>
        <video ref={videoRef} className={facing === 'user' ? 'mirrored' : ''} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
        {!running && !busy && (
          <div className="placeholder">
            <div className="reticle" />
            <p>Tryck <b>Starta</b> för att aktivera kameran.</p>
            <p className="small">All bearbetning sker lokalt i telefonen. Ingen bild sparas eller skickas.</p>
          </div>
        )}
        {busy && (
          <div className="placeholder">
            <div className="spinner" />
            <p>{modelStatus === 'laddar…' ? 'Laddar modell…' : 'Startar kamera…'}</p>
          </div>
        )}
        {calibMode && <div className="banner">Tryck på punkt {calibPts.length + 1} av 2 med känd sträcka</div>}
        {running && (
          <div className="hud">
            {hud.people.length === 0 && <div className="hud-row muted">Ingen person i bild</div>}
            {hud.people.map((p) => (
              <div key={p.id} className="hud-row">
                <b>P{p.id}</b> {Math.round(p.pxs)} px/s · {p.dir}
                {p.kmh !== null && <span className="kmh"> ≈ {p.kmh.toFixed(1)} km/h (uppskattning)</span>}
              </div>
            ))}
            <div className="hud-row muted">Inferens {hud.inferMs.toFixed(0)} ms</div>
          </div>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Stäng">✕</button>
        </div>
      )}

      {showCalibPanel && !calibMode && (
        <div className="panel">
          <h3>Kalibrera km/h</h3>
          <ol>
            <li>Ställ telefonen still (stativ eller stöd).</li>
            <li>Tryck "Markera" och peka ut två punkter i bilden med känt avstånd, t.ex. en 2 m lång markering på marken där personen rör sig.</li>
            <li>Ange avståndet och spara.</li>
          </ol>
          <div className="row">
            <button className="btn secondary" disabled={!running} onClick={() => { setCalibPts([]); setCalibMode(true); }}>
              {calibPts.length === 2 ? 'Markera om' : 'Markera'}
            </button>
            <label className="field">
              <input inputMode="decimal" value={calibMeters} onChange={(e) => setCalibMeters(e.target.value)} />
              <span>meter</span>
            </label>
          </div>
          <p className="small">{calibPts.length === 2 ? `Markerad sträcka: ${calibPx.toFixed(0)} px` : 'Ingen sträcka markerad.'}</p>
          <label className="check">
            <input type="checkbox" checked={cameraStill} onChange={(e) => setCameraStill(e.target.checked)} />
            Kameran står stilla
          </label>
          <p className="small warn">
            km/h är en uppskattning som bara gäller rörelse tvärs bilden på ungefär samma avstånd som den kalibrerade sträckan.
          </p>
          <div className="row">
            <button className="btn primary" disabled={!canSaveCalib} onClick={saveCalib}>Spara</button>
            {calib && <button className="btn danger" onClick={clearCalib}>Rensa</button>}
            <button className="btn secondary" onClick={() => { setShowCalibPanel(false); setCalibMode(false); }}>Stäng</button>
          </div>
        </div>
      )}

      <footer className="controls">
        <button className={`btn big ${running ? 'danger' : 'primary'}`} disabled={busy} onClick={toggleRun}>
          {busy ? '…' : running ? 'Stopp' : 'Starta'}
        </button>
        <button className="btn" disabled={busy} onClick={switchCamera}>
          {facing === 'user' ? 'Framkamera' : 'Bakkamera'} ⇄
        </button>
        <button className={`btn ${kmhActive ? 'active' : ''}`} onClick={() => setShowCalibPanel((s) => !s)}>
          {kmhActive ? 'km/h på' : calibValid ? 'km/h: stilla?' : 'Kalibrera'}
        </button>
        <div className="seg" role="group" aria-label="Beräkning">
          {(['GPU', 'CPU'] as const).map((d) => (
            <button key={d} className={prefDelegate === d ? 'sel' : ''} disabled={busy} onClick={() => changeDelegate(d)}>
              {d}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Antal personer">
          {[1, 2, 3].map((n) => (
            <button key={n} className={numPoses === n ? 'sel' : ''} onClick={() => changeNumPoses(n)}>
              {n}P
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
