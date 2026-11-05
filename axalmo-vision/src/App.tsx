import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObjectDetector, PoseLandmarker } from '@mediapipe/tasks-vision';
import { createDetector, createPose, type Delegate, type ModelVariant } from './vision';
import { ObjectTracker, directionLabel, speedOf, type Obj, type TrackEvent } from './tracker';
import { CATEGORY_COLOR, CATEGORY_PLURAL, type Category } from './labels';
import { drawFrame, toVideo, type View } from './draw';
import { Analyzer, measureLuma, type Insight } from './analyze';
import { EgoMotion, type CamState } from './egomotion';
import { Scan, SCAN_MS, type ScanReport } from './scan';

type Facing = 'user' | 'environment';
type ModelStatus = 'ej laddad' | 'laddar…' | 'redo' | 'fel';
type Panel = 'settings' | 'calib' | 'log' | null;

interface Calibration { metersPerPx: number; pts: { x: number; y: number }[]; vw: number; vh: number; facing: Facing }
interface HudObj { id: number; name: string; cat: Category; score: number; pxs: number; kmh: number | null; dir: string; secs: number }
type LogCat = Insight['cat'] | 'report';
interface LogEntry { id: number; time: string; iso: string; text: string; cat: LogCat }
type LogFilter = 'alla' | 'människa' | 'djur' | 'fordon' | 'larm' | 'rapport';
const FILTERS: { id: LogFilter; label: string; match: (c: LogCat) => boolean }[] = [
  { id: 'alla', label: 'Alla', match: () => true },
  { id: 'människa', label: 'Människor', match: (c) => c === 'människa' },
  { id: 'djur', label: 'Djur', match: (c) => c === 'djur' },
  { id: 'fordon', label: 'Fordon', match: (c) => c === 'fordon' },
  { id: 'larm', label: 'Larm', match: (c) => c === 'alert' },
  { id: 'rapport', label: 'Rapporter', match: (c) => c === 'report' },
];
const TIMELINE_KEY = 'axalmo-timeline';
function loadTimeline(): LogEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(TIMELINE_KEY) ?? '[]');
    return Array.isArray(v) ? (v as LogEntry[]) : [];
  } catch {
    return [];
  }
}
interface AnalysisView { scene: string; light: string; level: string; lines: Insight[] }
const colorOf = (c: LogCat) => (c === 'ai' ? '#c9b6ff' : c === 'alert' ? '#ff4d6d' : c === 'report' ? '#ffd23d' : CATEGORY_COLOR[c]);
interface Fastest { name: string; pxs: number; kmh: number | null }

const CATS: Category[] = ['människa', 'djur', 'fordon', 'föremål'];

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privat läge – ignorera */
  }
}

function cameraError(e: unknown): string {
  switch ((e as { name?: string })?.name ?? '') {
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

const clock = () => new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtKmh = (k: number | null) => (k === null ? '' : ` ≈ ${k.toFixed(1)} km/h`);

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);
  const poseRef = useRef<PoseLandmarker | null>(null);
  const trackerRef = useRef(new ObjectTracker());
  const runningRef = useRef(false);
  const loopIdRef = useRef(0);
  const fpsRef = useRef({ frames: 0, since: performance.now(), fps: 0, inferMs: 0 });
  const hudRef = useRef<HudObj[]>([]);
  const calibRef = useRef<Calibration | null>(null);
  const calibPtsRef = useRef<{ x: number; y: number }[]>([]);
  const stillRef = useRef(false);
  const facingRef = useRef<Facing>('environment');
  const skeletonRef = useRef(true);
  const logRef = useRef<LogEntry[]>(loadTimeline());
  const savedLogIdRef = useRef(-1);
  const egoRef = useRef(new EgoMotion());
  const scanRef = useRef(new Scan());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const seenRef = useRef<Record<Category, number>>({ människa: 0, djur: 0, fordon: 0, föremål: 0 });
  const fastestRef = useRef<Fastest | null>(null);
  const logIdRef = useRef(logRef.current.reduce((m, l) => Math.max(m, l.id), 0));
  const analyzerRef = useRef(new Analyzer());
  const analysisRef = useRef<AnalysisView>({ scene: '–', light: '–', level: '–', lines: [] });
  const voiceRef = useRef(false);
  const lastSpeakRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<Facing>('environment');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('ej laddad');
  const [activeDelegate, setActiveDelegate] = useState<Delegate | null>(null);
  const [prefDelegate, setPrefDelegate] = useState<Delegate>(() => load('axalmo-delegate', ['GPU', 'CPU'] as const, 'CPU'));
  const [variant, setVariant] = useState<ModelVariant>(() => load('axalmo-variant', ['lite', 'full'] as const, 'lite'));
  const [skeleton, setSkeleton] = useState(() => load('axalmo-skeleton', ['on', 'off'] as const, 'on') === 'on');
  const [numPoses, setNumPoses] = useState(1);
  const [voice, setVoice] = useState(() => load('axalmo-voice', ['on', 'off'] as const, 'off') === 'on');
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState({
    fps: 0,
    inferMs: 0,
    objs: [] as HudObj[],
    seen: { ...seenRef.current },
    fastest: null as Fastest | null,
    log: logRef.current,
    analysis: analysisRef.current,
    cam: 'stilla' as CamState,
    scanLeft: 0,
  });
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [logFilter, setLogFilter] = useState<LogFilter>('alla');
  const [panel, setPanel] = useState<Panel>(null);
  const [calibMode, setCalibMode] = useState(false);
  const [calibPts, setCalibPts] = useState<{ x: number; y: number }[]>([]);
  const [calibMeters, setCalibMeters] = useState('2');
  const [calib, setCalib] = useState<Calibration | null>(null);
  const [cameraStill, setCameraStill] = useState(false);

  calibRef.current = calib;
  calibPtsRef.current = calibPts;
  stillRef.current = cameraStill;
  facingRef.current = facing;
  skeletonRef.current = skeleton;
  voiceRef.current = voice;

  const view = useCallback((): View | null => {
    const v = videoRef.current, st = stageRef.current;
    if (!v || !st || !v.videoWidth) return null;
    return { cw: st.clientWidth, ch: st.clientHeight, vw: v.videoWidth, vh: v.videoHeight, mirrored: facingRef.current === 'user' };
  }, []);

  const pushLog = useCallback((text: string, cat: LogCat) => {
    logRef.current = [{ id: ++logIdRef.current, time: clock(), iso: new Date().toISOString(), text, cat }, ...logRef.current].slice(0, 300);
  }, []);

  /** Läser upp text på svenska (lokal talsyntes). Larm går alltid före. */
  const speak = useCallback((text: string, urgent = false) => {
    if (!voiceRef.current || !('speechSynthesis' in window)) return;
    const now = performance.now();
    if (!urgent && now - lastSpeakRef.current < 2500) return;
    lastSpeakRef.current = now;
    const u = new SpeechSynthesisUtterance(text.replace('⚠', 'Varning,'));
    u.lang = 'sv-SE';
    u.rate = 1.1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, []);

  // Huvudloop: ritar varje skärmuppdatering; inferens bara när huvudtråden har tid över (~60 %).
  // Objektdetektorn körs varannan gång och skelettmodellen varannan – men bara när en person syns.
  const loop = useCallback(() => {
    const myId = ++loopIdRef.current;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let lastVideoTime = -1;
    let nextInferAt = 0;
    let tick = 0;
    let labels = new Map<number, string[]>();
    const lumaCanvas = document.createElement('canvas');
    let luma: number | null = null;
    let lastLumaAt = 0;

    const kmhFor = (pxs: number, v: View) => {
      const cal = calibRef.current;
      const ok = !!cal && stillRef.current && egoRef.current.state === 'stilla' && cal.vw === v.vw && cal.vh === v.vh && cal.facing === facingRef.current;
      return ok ? pxs * cal!.metersPerPx * 3.6 : null;
    };

    const onEvents = (events: TrackEvent[], v: View) => {
      for (const e of events) {
        const o = e.obj;
        if (e.kind === 'in') {
          seenRef.current[o.cat]++;
          pushLog(`${o.name} dök upp (${Math.round(o.score * 100)} %)`, o.cat);
        } else {
          const secs = ((o.lastT - o.firstSeen) / 1000).toFixed(1);
          const top = o.maxSpeed >= 20 ? ` · topp ${Math.round(o.maxSpeed)} px/s${fmtKmh(kmhFor(o.maxSpeed, v))}` : '';
          pushLog(`${o.name} lämnade bilden · ${secs} s${top}`, o.cat);
        }
      }
    };

    const step = () => {
      if (!runningRef.current || myId !== loopIdRef.current) return;
      requestAnimationFrame(step);
      const det = detectorRef.current;
      const v = view();
      if (!det || !v || video.readyState < 2) return;
      const now = performance.now();
      const tracker = trackerRef.current;

      if (now >= nextInferAt && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const pose = poseRef.current;
        const personVisible = tracker.visible(now).some((o) => o.label === 'person');
        const runPose = skeletonRef.current && !!pose && personVisible && tick % 2 === 1;
        tick++;
        egoRef.current.update(video, now);
        try {
          if (runPose) {
            tracker.attachPoses(pose!.detectForVideo(video, now).landmarks, now, v.vw, v.vh);
          } else {
            onEvents(tracker.update(det.detectForVideo(video, now).detections, now, egoRef.current), v);
          }
        } catch (e) {
          console.error(e);
          setError(`Modellfel under körning: ${(e as Error).message}`);
        }
        const t1 = performance.now();
        const cost = t1 - now;
        nextInferAt = t1 + cost * 0.6;

        // AI-analys (lokal, regelbaserad)
        if (now - lastLumaAt > 1500) {
          lastLumaAt = now;
          luma = measureLuma(video, lumaCanvas);
        }
        const an = analyzerRef.current.analyze(tracker.visible(now), now, v.vw, v.vh, v.mirrored, luma);
        for (const ev of an.events) {
          pushLog(ev.text, ev.cat);
          speak(ev.text, ev.cat === 'alert');
        }
        analysisRef.current = { scene: an.scene, light: an.light, level: an.level, lines: an.lines };

        // Skanning -> lägesrapport
        const scan = scanRef.current;
        if (scan.active) {
          scan.add(tracker.visible(now), an.acts, an.scene, an.light, egoRef.current.state);
          if (now >= scan.endsAt) {
            const rep = scan.finish();
            pushLog(`Lägesrapport – ${rep.title}\n${rep.lines.join('\n')}`, 'report');
            setScanReport(rep);
            speak(`Rapport: ${rep.summary}`, true);
          }
        }

        // Etiketter och HUD-data
        labels = new Map();
        const hudObjs: HudObj[] = [];
        for (const o of tracker.visible(now)) {
          const pxs = speedOf(o);
          const kmh = kmhFor(pxs, v);
          const dir = directionLabel(o, v.mirrored);
          const secs = (now - o.firstSeen) / 1000;
          if (o.hits > 5 && (!fastestRef.current || o.maxSpeed > fastestRef.current.pxs) && o.maxSpeed >= 20) {
            fastestRef.current = { name: o.name, pxs: o.maxSpeed, kmh: kmhFor(o.maxSpeed, v) };
          }
          const act = an.acts.get(o.id);
          const l = [`${o.name} ${o.id} · ${Math.round(o.score * 100)}%`];
          if (act && o.cat !== 'föremål') l.push(act);
          l.push(`${Math.round(pxs)} px/s · ${dir}`);
          if (kmh !== null) l.push(`≈ ${kmh.toFixed(1)} km/h (uppsk.)`);
          labels.set(o.id, l);
          hudObjs.push({ id: o.id, name: o.name, cat: o.cat, score: o.score, pxs, kmh, dir, secs });
        }
        hudRef.current = hudObjs;

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
      const objs: Obj[] = tracker.visible(now);
      drawFrame(ctx, v, objs, labels, calibPtsRef.current.length ? calibPtsRef.current : calibRef.current?.pts ?? [], now);
    };
    step();
  }, [view, pushLog, speak]);

  // HUD uppdateras 4 ggr/s (billigare än React-render per bildruta).
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const f = fpsRef.current;
      setHud({
        fps: f.fps,
        inferMs: f.inferMs,
        objs: hudRef.current,
        seen: { ...seenRef.current },
        fastest: fastestRef.current,
        log: logRef.current,
        analysis: analysisRef.current,
        cam: egoRef.current.state,
        scanLeft: scanRef.current.active ? Math.max(0, scanRef.current.endsAt - performance.now()) : 0,
      });
      // Spara tidslinjen i telefonen när något nytt tillkommit (bara text, inga bilder).
      const top = logRef.current[0]?.id ?? 0;
      if (top !== savedLogIdRef.current) {
        savedLogIdRef.current = top;
        try {
          localStorage.setItem(TIMELINE_KEY, JSON.stringify(logRef.current));
        } catch {
          /* fullt/privat läge */
        }
      }
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
    analyzerRef.current.reset();
    egoRef.current.reset();
    scanRef.current.endsAt = 0;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    hudRef.current = [];
    setHud((h) => ({ ...h, fps: 0, inferMs: 0, objs: [] }));
    setRunning(false);
  }, []);

  /** Laddar de modeller som behövs. force = stäng och ladda om (t.ex. efter byte av GPU/CPU). */
  const loadModels = useCallback(
    async (opts: { delegate: Delegate; variant: ModelVariant; skeleton: boolean; reloadDetector?: boolean; reloadPose?: boolean }) => {
      setModelStatus('laddar…');
      try {
        if (opts.reloadDetector) {
          detectorRef.current?.close();
          detectorRef.current = null;
        }
        if (opts.reloadPose || !opts.skeleton) {
          poseRef.current?.close();
          poseRef.current = null;
        }
        if (!detectorRef.current) {
          const { model, delegate } = await createDetector(opts.delegate);
          detectorRef.current = model;
          setActiveDelegate(delegate);
        }
        if (opts.skeleton && !poseRef.current) {
          poseRef.current = (await createPose(numPoses, opts.delegate, opts.variant)).model;
        }
        setModelStatus('redo');
      } catch (e) {
        setModelStatus('fel');
        throw new Error(`Modellen kunde inte laddas (${(e as Error).message}). Första starten kräver internet.`);
      }
    },
    [numPoses],
  );

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
        const cam = navigator.mediaDevices
          .getUserMedia({
            audio: false,
            video: { facingMode: { ideal: face }, width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 30, max: 30 } },
          })
          .catch((e) => {
            if ((e as { name?: string }).name === 'OverconstrainedError')
              return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: face } });
            throw e;
          })
          .catch((e) => Promise.reject(new Error(cameraError(e))));
        const [stream] = await Promise.all([cam, loadModels({ delegate: prefDelegate, variant, skeleton })]);
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        trackerRef.current.reset();
        runningRef.current = true;
        setRunning(true);
        loop();
        // Håll skärmen tänd medan appen kör (stöds i iOS 16.4+).
        navigator.wakeLock?.request('screen').then((l) => (wakeLockRef.current = l)).catch(() => {});
      } catch (e) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loadModels, loop, prefDelegate, variant, skeleton],
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

  const applyModelChange = async (o: { delegate?: Delegate; variant?: ModelVariant; skeleton?: boolean }) => {
    const d = o.delegate ?? prefDelegate, va = o.variant ?? variant, sk = o.skeleton ?? skeleton;
    setPrefDelegate(d);
    setVariant(va);
    setSkeleton(sk);
    save('axalmo-delegate', d);
    save('axalmo-variant', va);
    save('axalmo-skeleton', sk ? 'on' : 'off');
    if (!detectorRef.current && !poseRef.current) return; // laddas vid Starta
    setBusy(true);
    try {
      await loadModels({
        delegate: d,
        variant: va,
        skeleton: sk,
        reloadDetector: o.delegate !== undefined,
        reloadPose: o.delegate !== undefined || o.variant !== undefined,
      });
      fpsRef.current = { frames: 0, since: performance.now(), fps: 0, inferMs: 0 };
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeNumPoses = async (n: number) => {
    setNumPoses(n);
    try {
      await poseRef.current?.setOptions({ numPoses: n });
    } catch (e) {
      setError(`Kunde inte ändra antal skelett: ${(e as Error).message}`);
    }
  };

  const toggleVoice = (on: boolean) => {
    setVoice(on);
    voiceRef.current = on;
    save('axalmo-voice', on ? 'on' : 'off');
    // iOS kräver att talsyntesen startas från en knapptryckning.
    if (on && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('Röstanalys på');
      u.lang = 'sv-SE';
      window.speechSynthesis.speak(u);
    }
  };

  const startScan = () => {
    if (!running) return;
    setScanReport(null);
    scanRef.current.start(performance.now());
  };

  const exportCsv = async () => {
    const esc = (t: string) => `"${t.replace(/"/g, '""').replace(/\n/g, ' | ')}"`;
    const rows = ['datum;tid;typ;händelse', ...[...logRef.current].reverse().map((l) => [l.iso.slice(0, 10), l.time, l.cat, esc(l.text)].join(';'))];
    const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const name = `axalmo-tidslinje-${new Date().toISOString().slice(0, 10)}.csv`;
    const file = new File([blob], name, { type: 'text/csv' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Axalmo tidslinje' });
        return;
      }
    } catch {
      /* avbrutet – fall tillbaka till nedladdning */
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const resetStats = () => {
    logRef.current = [];
    try {
      localStorage.removeItem(TIMELINE_KEY);
    } catch {
      /* ignorera */
    }
    seenRef.current = { människa: 0, djur: 0, fordon: 0, föremål: 0 };
    fastestRef.current = null;
    setHud((h) => ({ ...h, log: [], seen: { ...seenRef.current }, fastest: null }));
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
    setPanel(null);
  };

  const clearCalib = () => {
    setCalib(null);
    setCalibPts([]);
    setCalibMode(false);
  };

  const calibValid = !!calib && calib.facing === facing;
  const kmhActive = calibValid && cameraStill;
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  const counts = CATS.map((c) => ({ c, n: hud.objs.filter((o) => o.cat === c).length })).filter((x) => x.n > 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          AXALMO<span>VISION</span>
        </div>
        <div className="chips">
          <span className={`chip ${running ? 'on' : ''}`}>{running ? `${hud.fps.toFixed(0)} FPS` : 'AV'}</span>
          <span className={`chip model-${modelStatus === 'redo' ? 'ok' : modelStatus === 'fel' ? 'err' : 'idle'}`}>
            {modelStatus === 'redo' && activeDelegate ? `AI · ${activeDelegate}` : `Modell: ${modelStatus}`}
          </span>
          {running && <span className={`chip cam-${hud.cam === 'stilla' ? 'ok' : 'move'}`}>📷 {hud.cam}</span>}
          {kmhActive && <span className="chip warn-chip">km/h</span>}
        </div>
      </header>

      <div ref={stageRef} className={`stage ${calibMode ? 'calibrating' : ''}`} onPointerDown={onStageTap}>
        <video ref={videoRef} className={facing === 'user' ? 'mirrored' : ''} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
        {!running && !busy && (
          <div className="placeholder">
            <div className="reticle" />
            <p>Tryck <b>Starta</b> för att aktivera kameran.</p>
            <p className="small">Känner igen människor, djur, fordon och föremål. All bearbetning sker lokalt – ingen bild sparas eller skickas.</p>
          </div>
        )}
        {busy && (
          <div className="placeholder">
            <div className="spinner" />
            <p>{modelStatus === 'laddar…' ? 'Laddar AI-modeller…' : 'Startar kamera…'}</p>
          </div>
        )}
        {hud.scanLeft > 0 && (
          <div className="scan-overlay">
            <div className="scan-line" />
            <div className="banner scan">Skannar… {Math.ceil(hud.scanLeft / 1000)} s – håll kameran mot området</div>
            <div className="scan-bar" style={{ width: `${100 - (hud.scanLeft / SCAN_MS) * 100}%` }} />
          </div>
        )}
        {scanReport && (
          <div className="report" onPointerDown={(e) => e.stopPropagation()}>
            <div className="report-head">
              <span>✦ LÄGESRAPPORT {clock()}</span>
              <button onClick={() => setScanReport(null)} aria-label="Stäng">✕</button>
            </div>
            <div className="report-title">{scanReport.title}</div>
            {scanReport.lines.map((l, i) => (
              <div key={i} className="report-line">{l}</div>
            ))}
            <div className="small">Sparad i tidslinjen.</div>
          </div>
        )}
        {calibMode && <div className="banner">Tryck på punkt {calibPts.length + 1} av 2 med känd sträcka</div>}
        {running && (
          <>
            <div className="summary">
              {counts.length === 0 ? (
                <span className="pill muted">Inget i bild</span>
              ) : (
                counts.map(({ c, n }) => (
                  <span key={c} className="pill" style={{ borderColor: CATEGORY_COLOR[c], color: CATEGORY_COLOR[c] }}>
                    {n} {CATEGORY_PLURAL[c][n === 1 ? 0 : 1]}
                  </span>
                ))
              )}
            </div>
            <div className="hud">
              <div className="ai-card">
                <div className="ai-head">
                  <span>✦ AI-ANALYS</span>
                  <span className="muted">
                    {hud.analysis.scene} · ljus {hud.analysis.light} · aktivitet {hud.analysis.level} · kamera {hud.cam}
                  </span>
                </div>
                {hud.analysis.lines.length === 0 ? (
                  <div className="ai-line muted">Söker efter människor, djur, fordon och föremål…</div>
                ) : (
                  hud.analysis.lines.map((l, i) => (
                    <div key={i} className="ai-line" style={{ borderLeftColor: colorOf(l.cat) }}>
                      {l.text}
                    </div>
                  ))
                )}
                {hud.log[0] && (
                  <div className="ai-event" style={{ color: colorOf(hud.log[0].cat) }}>
                    {hud.log[0].time} · {hud.log[0].text}
                  </div>
                )}
                <div className="ai-foot">
                  {hud.inferMs.toFixed(0)} ms
                  {hud.fastest && ` · Snabbast: ${hud.fastest.name} ${Math.round(hud.fastest.pxs)} px/s${fmtKmh(hud.fastest.kmh)}`}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Stäng">✕</button>
        </div>
      )}

      {panel === 'settings' && (
        <div className="panel">
          <h3>Inställningar</h3>
          <div className="setting">
            <span>Beräkning</span>
            <div className="seg">
              {(['CPU', 'GPU'] as const).map((d) => (
                <button key={d} className={prefDelegate === d ? 'sel' : ''} disabled={busy} onClick={() => applyModelChange({ delegate: d })}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>Röst läser upp analysen</span>
            <div className="seg">
              <button className={voice ? 'sel' : ''} onClick={() => toggleVoice(true)}>På</button>
              <button className={!voice ? 'sel' : ''} onClick={() => toggleVoice(false)}>Av</button>
            </div>
          </div>
          <div className="setting">
            <span>Skelett på personer</span>
            <div className="seg">
              <button className={skeleton ? 'sel' : ''} disabled={busy} onClick={() => applyModelChange({ skeleton: true })}>På</button>
              <button className={!skeleton ? 'sel' : ''} disabled={busy} onClick={() => applyModelChange({ skeleton: false })}>Av</button>
            </div>
          </div>
          {skeleton && (
            <>
              <div className="setting">
                <span>Skelettmodell</span>
                <div className="seg">
                  <button className={variant === 'lite' ? 'sel' : ''} disabled={busy} onClick={() => applyModelChange({ variant: 'lite' })}>Snabb</button>
                  <button className={variant === 'full' ? 'sel' : ''} disabled={busy} onClick={() => applyModelChange({ variant: 'full' })}>Exakt</button>
                </div>
              </div>
              <div className="setting">
                <span>Antal skelett</span>
                <div className="seg">
                  {[1, 2, 3].map((n) => (
                    <button key={n} className={numPoses === n ? 'sel' : ''} onClick={() => changeNumPoses(n)}>{n}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          <p className="small">Hackigt? Prova CPU/GPU, stäng av skelett eller välj Snabb. Valen sparas på telefonen.</p>
          <div className="row">
            <button className="btn secondary" onClick={() => setPanel('calib')}>Kalibrera km/h</button>
            <button className="btn secondary" onClick={() => setPanel(null)}>Stäng</button>
          </div>
        </div>
      )}

      {panel === 'calib' && !calibMode && (
        <div className="panel">
          <h3>Kalibrera km/h</h3>
          <ol>
            <li>Ställ telefonen still (stativ eller stöd).</li>
            <li>Tryck på knappen nedan och peka ut två punkter i bilden med känt avstånd, t.ex. en 2 m lång markering på marken där rörelsen sker.</li>
            <li>Ange avståndet och spara.</li>
          </ol>
          <div className="row">
            <button className="btn secondary" disabled={!running} onClick={() => { setCalibPts([]); setCalibMode(true); }}>
              {calibPts.length === 2 ? 'Markera om' : 'Markera punkter'}
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
            <button className="btn secondary" onClick={() => { setPanel(null); setCalibMode(false); }}>Stäng</button>
          </div>
        </div>
      )}

      {panel === 'log' && (
        <div className="panel log">
          <h3>Tidslinje & statistik</h3>
          <div className="stats">
            {CATS.map((c) => (
              <div key={c} className="stat" style={{ color: CATEGORY_COLOR[c] }}>
                <b>{hud.seen[c]}</b>
                <span>{CATEGORY_PLURAL[c][1]}</span>
              </div>
            ))}
          </div>
          <p className="small">
            {hud.fastest
              ? `Snabbast hittills: ${hud.fastest.name}, ${Math.round(hud.fastest.pxs)} px/s${fmtKmh(hud.fastest.kmh)}${hud.fastest.kmh !== null ? ' (uppskattning)' : ''}`
              : 'Ingen rörelse uppmätt än.'}
          </p>
          <div className="filters">
            {FILTERS.map((f) => (
              <button key={f.id} className={logFilter === f.id ? 'sel' : ''} onClick={() => setLogFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <ul>
            {hud.log.filter((l) => FILTERS.find((f) => f.id === logFilter)!.match(l.cat)).length === 0 && (
              <li className="small">Inget registrerat här än.</li>
            )}
            {hud.log.filter((l) => FILTERS.find((f) => f.id === logFilter)!.match(l.cat)).map((l) => (
              <li key={l.id}>
                <span className="time">{l.time}</span>
                <span style={{ color: colorOf(l.cat) }}>●</span> {l.text}
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="btn secondary" disabled={!hud.log.length} onClick={exportCsv}>Exportera CSV</button>
            <button className="btn danger" onClick={resetStats}>Rensa</button>
            <button className="btn secondary" onClick={() => setPanel(null)}>Stäng</button>
          </div>
        </div>
      )}

      <footer className="controls">
        <button className={`btn big ${running ? 'danger' : 'primary'}`} disabled={busy} onClick={toggleRun}>
          {busy ? '…' : running ? 'Stopp' : 'Starta'}
        </button>
        <button className="btn big scan-btn" disabled={!running || hud.scanLeft > 0} onClick={startScan}>
          ◎ Skanna
        </button>
        <button className="btn" disabled={busy} onClick={switchCamera}>
          {facing === 'user' ? 'Fram' : 'Bak'} ⇄
        </button>
        <button className={`btn ${panel === 'log' ? 'active' : ''}`} onClick={() => togglePanel('log')}>
          Tidslinje{hud.log.length ? ` (${hud.log.length})` : ''}
        </button>
        <button className={`btn ${panel === 'settings' || panel === 'calib' ? 'active' : ''}`} onClick={() => togglePanel('settings')}>
          ⚙︎
        </button>
      </footer>
    </div>
  );
}
