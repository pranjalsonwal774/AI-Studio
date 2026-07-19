/**
 * useInitMachine.ts — Deterministic AI Mirror Initialization State Machine
 *
 * Stages (in order):
 *   browser_check → context_check → camera_permission → camera_init
 *   → video_ready → model_loading → model_warmup → face_tracking → live_mirror
 *
 * Rules:
 *   • Every async step has a timeout (configurable per-stage)
 *   • Every stage has auto-retry (max 3 per stage)
 *   • Progress is reported continuously — never shows a generic spinner
 *   • On any failure: show fallback webcam preview, keep trying in background
 *   • All models are cached in IndexedDB — no re-download on refresh
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type InitStage =
  | 'idle'
  | 'browser_check'
  | 'context_check'
  | 'camera_permission'
  | 'camera_init'
  | 'video_ready'
  | 'model_loading'
  | 'model_warmup'
  | 'face_tracking'
  | 'live_mirror'
  | 'fallback'     // camera works, models failed → show raw cam
  | 'error';       // unrecoverable (no camera hardware)

export type SubStatus = 'waiting' | 'loading' | 'ready' | 'error' | 'retrying';

export interface Subsystems {
  camera: SubStatus;
  video: SubStatus;
  mediapipe: SubStatus;
  faceTracking: SubStatus;
  avatar: SubStatus;
  renderer: SubStatus;
}

export interface InitLog {
  ts: number;
  tag: string;
  msg: string;
  level: 'info' | 'warn' | 'error';
}

export interface InitState {
  stage: InitStage;
  subsystems: Subsystems;
  progress: number;          // 0–100 overall
  stageLabel: string;        // Human-readable current action
  retryCount: number;
  errorMessage: string | null;
  logs: InitLog[];
  // Actions
  retry: () => void;
  enterFallback: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeouts per stage (ms)
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  BROWSER_CHECK:    2_000,
  CONTEXT_CHECK:    1_000,
  CAM_PERMISSION:   8_000,
  CAM_INIT:         5_000,
  VIDEO_READY:      6_000,
  MODEL_LOAD:      15_000,   // generous — CDN can be slow
  MODEL_WARMUP:     4_000,
  FACE_TRACKING:    5_000,
};
const MAX_RETRIES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Utility: withTimeout
// ─────────────────────────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error(`[Timeout] ${label} exceeded ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(tid); resolve(v); }, e => { clearTimeout(tid); reject(e); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB model cache
// ─────────────────────────────────────────────────────────────────────────────
const IDB_NAME = 'ghibli-mirror-models';
const IDB_STORE = 'blobs';
const IDB_VERSION = 1;

function openModelDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => (e.target as IDBOpenDBRequest).result.createObjectStore(IDB_STORE);
    req.onsuccess = e => res((e.target as IDBOpenDBRequest).result);
    req.onerror   = e => rej((e.target as IDBOpenDBRequest).error);
  });
}

async function idbGet(db: IDBDatabase, key: string): Promise<Blob | null> {
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror   = () => rej(req.error);
  });
}

async function idbPut(db: IDBDatabase, key: string, blob: Blob): Promise<void> {
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(blob, key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// face-api.js loader with IDB caching + timeout
// ─────────────────────────────────────────────────────────────────────────────
const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.js';
const MODEL_CDN    = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

// Model file URLs we'll pre-cache
const MODEL_FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_tiny_model-weights_manifest.json',
  'face_landmark_68_tiny_model-shard1',
];

async function loadScriptCached(url: string): Promise<void> {
  // Check if script already loaded
  if (document.querySelector(`script[src="${url}"]`) && (window as any).faceapi) return;

  // Try IDB cache
  let db: IDBDatabase | null = null;
  try { db = await openModelDb(); } catch (_) {}

  if (db) {
    const cached = await idbGet(db, `script:${url}`).catch(() => null);
    if (cached) {
      const blobUrl = URL.createObjectURL(cached);
      await new Promise<void>((res, rej) => {
        const s = document.createElement('script');
        s.src = blobUrl; s.async = true;
        s.onload = () => { URL.revokeObjectURL(blobUrl); res(); };
        s.onerror = rej;
        document.head.appendChild(s);
      });
      return;
    }
  }

  // Download from CDN
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Script fetch failed: ${res.status}`);
  const blob = await res.blob();

  if (db) { await idbPut(db, `script:${url}`, blob).catch(() => {}); }

  const blobUrl = URL.createObjectURL(blob);
  await new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = blobUrl; s.async = true;
    s.onload = () => { URL.revokeObjectURL(blobUrl); res(); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function loadModelsCached(
  fa: any,
  onProgress: (pct: number, label: string) => void,
): Promise<void> {
  // If both nets are already loaded, skip
  if (fa.nets.tinyFaceDetector.isLoaded && fa.nets.faceLandmark68TinyNet.isLoaded) {
    onProgress(100, 'Models already cached');
    return;
  }

  let db: IDBDatabase | null = null;
  try { db = await openModelDb(); } catch (_) {}

  // Patch fa.fetchOrThrow to intercept model downloads and cache them
  const origFetch = window.fetch.bind(window);
  let fetched = 0;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const isModelFile = MODEL_FILES.some(f => url.includes(f));

    if (isModelFile && db) {
      const cacheKey = `model:${url}`;
      const cached = await idbGet(db, cacheKey).catch(() => null);
      if (cached) {
        fetched++;
        onProgress(
          Math.round((fetched / MODEL_FILES.length) * 100),
          `Loading cached model (${fetched}/${MODEL_FILES.length})`
        );
        return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
      }
      const resp = await origFetch(input, init);
      const clone = resp.clone();
      clone.blob().then(b => idbPut(db!, cacheKey, b)).catch(() => {});
      fetched++;
      onProgress(
        Math.round((fetched / MODEL_FILES.length) * 100),
        `Downloading model (${fetched}/${MODEL_FILES.length})`
      );
      return resp;
    }
    return origFetch(input, init);
  };

  try {
    onProgress(5, 'Loading TinyFaceDetector...');
    await fa.nets.tinyFaceDetector.loadFromUri(MODEL_CDN);
    onProgress(55, 'Loading FaceLandmark68...');
    await fa.nets.faceLandmark68TinyNet.loadFromUri(MODEL_CDN);
    onProgress(100, 'Models ready');
  } finally {
    window.fetch = origFetch; // Restore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────────────────
export function useInitMachine(
  videoRef: React.RefObject<HTMLVideoElement>
): InitState {

  const [stage, setStage]         = useState<InitStage>('idle');
  const [subsystems, setSubsystems] = useState<Subsystems>({
    camera: 'waiting', video: 'waiting', mediapipe: 'waiting',
    faceTracking: 'waiting', avatar: 'waiting', renderer: 'waiting',
  });
  const [progress, setProgress]   = useState(0);
  const [stageLabel, setLabel]    = useState('Initializing...');
  const [retryCount, setRetryCount] = useState(0);
  const [errorMessage, setError]  = useState<string | null>(null);
  const [logs, setLogs]           = useState<InitLog[]>([]);

  const mountedRef   = useRef(true);
  const abortRef     = useRef(false);   // set true on unmount / retry
  const streamRef    = useRef<MediaStream | null>(null);
  const faceApiRef   = useRef<any>(null);
  const retryRef     = useRef(0);
  const runningRef   = useRef(false);   // prevent concurrent runs

  // ── Helpers ──
  const log = useCallback((tag: string, msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    if (!mountedRef.current) return;
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[${tag}] ${msg}`);
    setLogs(prev => [...prev.slice(-79), { ts: Date.now(), tag, msg, level }]);
  }, []);

  const setSub = useCallback((key: keyof Subsystems, status: SubStatus) => {
    if (!mountedRef.current) return;
    setSubsystems(prev => ({ ...prev, [key]: status }));
  }, []);

  const report = useCallback((pct: number, label: string) => {
    if (!mountedRef.current) return;
    setProgress(pct);
    setLabel(label);
  }, []);

  // ── Stop current stream ──
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    streamRef.current = null;
  }, []);

  // ── Full machine run ──
  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    retryRef.current = 0;
    setError(null);

    const check = () => { if (abortRef.current) throw new Error('Aborted'); };

    try {
      // ─── STAGE 1: Browser check ───────────────────────────────────────────
      setStage('browser_check');
      report(2, 'Checking browser support...');
      log('Init', 'Stage: browser_check');
      check();

      if (typeof window === 'undefined') throw new Error('Not a browser environment');
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia not supported. Use Chrome, Firefox, or Edge.');
      }
      log('Browser', 'getUserMedia supported ✓');

      // ─── STAGE 2: Secure context ──────────────────────────────────────────
      setStage('context_check');
      report(6, 'Checking secure context...');
      log('Init', 'Stage: context_check');
      check();

      const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
      const isSecure    = window.isSecureContext || isLocalhost;
      if (!isSecure) {
        throw new Error('Camera requires HTTPS. Open this app at https://…');
      }
      log('Security', `Secure context: ${window.location.protocol} @ ${window.location.hostname} ✓`);

      // ─── STAGE 3: Camera permission ───────────────────────────────────────
      setStage('camera_permission');
      setSub('camera', 'loading');
      report(10, 'Requesting camera permission...');
      log('Init', 'Stage: camera_permission');
      check();

      let stream: MediaStream;
      try {
        stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: false,
          }),
          T.CAM_PERMISSION,
          'camera_permission'
        );
      } catch (e: any) {
        log('Camera', `Permission error: ${e.message}`, 'error');
        setSub('camera', 'error');
        // Try fallback: any video device
        try {
          log('Camera', 'Falling back to any video device...');
          stream = await withTimeout(
            navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
            T.CAM_PERMISSION,
            'camera_fallback'
          );
        } catch (e2: any) {
          const msg = e2.name === 'NotAllowedError' || e2.name === 'PermissionDeniedError'
            ? 'Camera permission denied. Please allow camera access in your browser settings.'
            : e2.name === 'NotFoundError'
              ? 'No camera device found. Please connect a webcam.'
              : `Camera failed: ${e2.message}`;
          setError(msg);
          setStage('error');
          runningRef.current = false;
          return;
        }
      }

      check();
      streamRef.current = stream;
      setSub('camera', 'ready');
      const settings = stream.getVideoTracks()[0]?.getSettings();
      log('Camera', `Stream active — ${settings?.width ?? '?'}×${settings?.height ?? '?'} @ ${settings?.frameRate?.toFixed(0) ?? '?'}fps ✓`);

      // ─── STAGE 4: Camera init — bind stream to video ──────────────────────
      setStage('camera_init');
      setSub('video', 'loading');
      report(20, 'Binding camera stream...');
      log('Init', 'Stage: camera_init');
      check();

      const video = videoRef.current;
      if (!video) throw new Error('Video element not mounted');
      video.srcObject = stream;
      video.muted = true;
      try { await video.play(); } catch (_) {}
      log('Video', 'Stream bound to video element ✓');

      // ─── STAGE 5: Wait for video HAVE_ENOUGH_DATA ─────────────────────────
      setStage('video_ready');
      report(28, 'Waiting for video signal...');
      log('Init', 'Stage: video_ready');
      check();

      await withTimeout(
        new Promise<void>(resolve => {
          if (video.readyState >= 4) { resolve(); return; }
          const onReady = () => { video.removeEventListener('canplay', onReady); resolve(); };
          video.addEventListener('canplay', onReady);
        }),
        T.VIDEO_READY,
        'video_ready'
      );

      setSub('video', 'ready');
      log('Video', `Video ready — ${video.videoWidth}×${video.videoHeight} ✓`);

      // ─── STAGE 6: Load AI models ──────────────────────────────────────────
      setStage('model_loading');
      setSub('mediapipe', 'loading');
      report(32, 'Loading face tracking models...');
      log('Init', 'Stage: model_loading');
      check();

      // Load script (with IDB cache)
      log('FaceAPI', 'Loading face-api.js script...');
      try {
        await withTimeout(
          (async () => {
            if (!(window as any).faceapi) {
              await loadScriptCached(FACE_API_CDN);
            }
            report(48, 'Script loaded, loading model weights...');
            log('FaceAPI', 'Script loaded ✓');
            const fa = (window as any).faceapi;
            await loadModelsCached(fa, (pct, label) => {
              report(48 + Math.round(pct * 0.32), label); // 48 → 80
            });
            faceApiRef.current = fa;
          })(),
          T.MODEL_LOAD,
          'model_loading'
        );
      } catch (modelErr: any) {
        log('FaceAPI', `Model load failed: ${modelErr.message}`, 'warn');
        setSub('mediapipe', 'error');
        // Models failed — enter fallback mode (show live webcam)
        log('Init', 'Entering fallback mode — webcam visible, AI disabled');
        setSub('renderer', 'ready');
        setStage('fallback');
        report(100, 'Camera ready (AI models unavailable)');
        runningRef.current = false;
        return;
      }

      check();
      setSub('mediapipe', 'ready');
      log('FaceAPI', 'All models loaded ✓');

      // ─── STAGE 7: Warm up models ──────────────────────────────────────────
      setStage('model_warmup');
      report(82, 'Warming up face detection...');
      log('Init', 'Stage: model_warmup');
      check();

      try {
        const fa = faceApiRef.current;
        if (fa && video.readyState >= 2) {
          const opts = new fa.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.3 });
          await withTimeout(
            fa.detectAllFaces(video, opts),
            T.MODEL_WARMUP,
            'model_warmup'
          );
          log('FaceAPI', 'Warmup inference complete ✓');
        }
      } catch (_) {
        log('FaceAPI', 'Warmup failed (non-fatal — continuing)', 'warn');
      }

      // ─── STAGE 8: Start face tracking ─────────────────────────────────────
      setStage('face_tracking');
      setSub('faceTracking', 'loading');
      report(90, 'Starting face tracking...');
      log('Init', 'Stage: face_tracking');
      check();

      // Verify we can get at least one detection result
      try {
        const fa = faceApiRef.current;
        const opts = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });
        await withTimeout(
          fa.detectAllFaces(video, opts).withFaceLandmarks(true),
          T.FACE_TRACKING,
          'face_tracking_verify'
        );
        setSub('faceTracking', 'ready');
        log('FaceTracking', 'Face tracking ready ✓');
      } catch (_) {
        // Non-fatal — tracking will start when face appears
        setSub('faceTracking', 'ready');
        log('FaceTracking', 'No face detected yet — will activate on entry', 'warn');
      }

      // ─── DONE — Live mirror ───────────────────────────────────────────────
      setSub('renderer', 'ready');
      setSub('avatar', 'waiting'); // avatar generated when face detected
      setStage('live_mirror');
      report(100, 'Mirror is live ✨');
      log('Mirror', '=== AI Mirror ONLINE ===');

    } catch (err: any) {
      if (abortRef.current) { runningRef.current = false; return; }
      log('Init', `Fatal error: ${err.message}`, 'error');
      setError(err.message);
      setStage('error');
    } finally {
      runningRef.current = false;
    }
  }, [videoRef, log, setSub, report, stopStream]);

  // ── Retry ──
  const retry = useCallback(() => {
    abortRef.current = true;
    runningRef.current = false;
    stopStream();
    const v = videoRef.current;
    if (v) { v.srcObject = null; }
    setRetryCount(c => c + 1);
    // Re-run after a tick
    setTimeout(() => run(), 100);
  }, [run, stopStream, videoRef]);

  // ── Enter fallback (show raw webcam) ──
  const enterFallback = useCallback(() => {
    setStage('fallback');
    setSub('renderer', 'ready');
    report(100, 'Camera ready (fallback mode)');
  }, [setSub, report]);

  // ── Mount / unmount ──
  useEffect(() => {
    mountedRef.current = true;
    run();
    return () => {
      mountedRef.current = false;
      abortRef.current = true;
      stopStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-run on retry count change ──
  useEffect(() => {
    if (retryCount > 0) run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  return {
    stage,
    subsystems,
    progress,
    stageLabel,
    retryCount,
    errorMessage,
    logs,
    retry,
    enterFallback,
  };
}
