import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  Upload,
  Sparkles,
  Camera,
  Wifi,
  RefreshCw,
  AlertCircle,
  Eye,
  Video,
  List,
  Terminal
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCameraManager } from '../hooks/useCameraManager';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface CameraFeedProps {
  style: string;
  background: string;
  onCaptured: (photoId: string, originalUrl: string) => void;
  uploadManual: (file: File) => Promise<any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio helpers
// ─────────────────────────────────────────────────────────────────────────────
function playShutter() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++)
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.010));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    src.connect(g); g.connect(ctx.destination); src.start();
  } catch (_) { /* silence */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// CDN Loaders
// ─────────────────────────────────────────────────────────────────────────────
async function loadFaceApi(): Promise<any> {
  if ((window as any).faceapi?.nets?.tinyFaceDetector?.isLoaded) return (window as any).faceapi;
  if (!(window as any).faceapi) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.js';
      s.async = true; s.onload = () => res(); s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const fa = (window as any).faceapi;
  const M = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
  await Promise.all([
    fa.nets.tinyFaceDetector.loadFromUri(M),
    fa.nets.faceLandmark68TinyNet.loadFromUri(M),
  ]);
  return fa;
}

async function loadORT(): Promise<any> {
  if ((window as any).ort) return (window as any).ort;
  await new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.min.js';
    s.async = true; s.onload = () => res(); s.onerror = rej;
    document.head.appendChild(s);
  });
  return (window as any).ort;
}

// ─────────────────────────────────────────────────────────────────────────────
// WebGL Style Transfer Function
// ─────────────────────────────────────────────────────────────────────────────
async function runAnimeGAN(
  session: any,
  srcCanvas: HTMLCanvasElement,
  outCtx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  ort: any
): Promise<void> {
  const SIZE = 512;
  const tmp = document.createElement('canvas');
  tmp.width = SIZE; tmp.height = SIZE;
  const tc = tmp.getContext('2d')!;
  tc.drawImage(srcCanvas, 0, 0, SIZE, SIZE);
  const imgData = tc.getImageData(0, 0, SIZE, SIZE);
  const { data } = imgData;

  const float32 = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    float32[i]                  = (data[i * 4]     / 127.5) - 1.0; // R
    float32[SIZE * SIZE + i]    = (data[i * 4 + 1] / 127.5) - 1.0; // G
    float32[SIZE * SIZE * 2 + i] = (data[i * 4 + 2] / 127.5) - 1.0; // B
  }

  const tensor = new ort.Tensor('float32', float32, [1, 3, SIZE, SIZE]);
  const feeds: Record<string, any> = {};
  feeds[session.inputNames[0]] = tensor;
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]].data as Float32Array;

  const outImg = outCtx.createImageData(SIZE, SIZE);
  const od = outImg.data;
  for (let i = 0; i < SIZE * SIZE; i++) {
    od[i * 4]     = Math.min(255, Math.max(0, (out[i]                   + 1.0) * 127.5));
    od[i * 4 + 1] = Math.min(255, Math.max(0, (out[SIZE * SIZE + i]     + 1.0) * 127.5));
    od[i * 4 + 2] = Math.min(255, Math.max(0, (out[SIZE * SIZE * 2 + i] + 1.0) * 127.5));
    od[i * 4 + 3] = 255;
  }

  const scaleTmp = document.createElement('canvas');
  scaleTmp.width = SIZE; scaleTmp.height = SIZE;
  scaleTmp.getContext('2d')!.putImageData(outImg, 0, 0);
  outCtx.drawImage(scaleTmp, 0, 0, outW, outH);
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera Feed View Component
// ─────────────────────────────────────────────────────────────────────────────
export const CameraFeed: React.FC<CameraFeedProps> = ({
  style,
  background,
  onCaptured,
  uploadManual,
}) => {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef        = useRef<HTMLVideoElement>(null);
  const mirrorCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const sessionRef      = useRef<any>(null);
  const ortRef          = useRef<any>(null);
  const faceApiRef      = useRef<any>(null);
  const rafRef          = useRef<number>(0);
  const detectionTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const smileTimer      = useRef<number>(0);
  const lastFrameTime   = useRef<number>(0);

  // ── Camera Manager Hook ───────────────────────────────────────────────────
  const camera = useCameraManager(videoRef);

  // ── AI Model States ───────────────────────────────────────────────────────
  const [aiState, setAiState]       = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [aiBootMsg, setAiBootMsg]   = useState('');
  const [aiBootPct, setAiBootPct]   = useState(0);
  const [aiError, setAiError]       = useState('');

  // ── Interaction States ────────────────────────────────────────────────────
  const [flash, setFlash]           = useState(false);
  const [smilePct, setSmilePct]     = useState(0);
  const [faceCount, setFaceCount]   = useState(0);
  const [fps, setFps]               = useState(0);
  const [showConsole, setShowConsole] = useState(false);
  const [showCameraPicker, setShowCameraPicker] = useState(false);

  const fpsCountRef = useRef(0);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── AI initialization sequence (starts ONLY after camera is ready) ───────
  useEffect(() => {
    if (camera.phase !== 'ready') {
      setAiState('idle');
      setAiBootPct(0);
      setAiReady(false);
      return;
    }

    setAiState('loading');
    let active = true;

    const loadModels = async () => {
      try {
        setAiBootMsg('Loading ONNX Runtime WebGL engine...');
        setAiBootPct(20);
        const ort = await loadORT();
        ort.env.wasm.numThreads = 1;
        ortRef.current = ort;

        if (!active) return;
        setAiBootMsg('Downloading Ghibli style model (~8MB)...');
        setAiBootPct(55);
        const session = await ort.InferenceSession.create(
          'http://localhost:8000/static/models/AnimeGANv2_Hayao.onnx',
          { executionProviders: ['webgl', 'wasm'], graphOptimizationLevel: 'all' }
        );
        sessionRef.current = session;

        if (!active) return;
        setAiBootMsg('Initializing face analytics parser...');
        setAiBootPct(85);
        faceApiRef.current = await loadFaceApi();

        if (!active) return;
        setAiBootPct(100);
        setAiState('ready');
        setAiReady(true);
      } catch (err: any) {
        if (active) {
          console.error('AI load error:', err);
          setAiState('error');
          setAiError(err.message || String(err));
        }
      }
    };

    loadModels();
    return () => {
      active = false;
    };
  }, [camera.phase]);

  const [aiReady, setAiReady] = useState(false);

  // ── Render loop (requestAnimationFrame) ───────────────────────────────────
  const startMirrorLoop = useCallback(() => {
    const TARGET_MS = 1000 / 30; // target 30 fps

    const loop = async () => {
      const video   = videoRef.current;
      const canvas  = mirrorCanvasRef.current;
      const session = sessionRef.current;
      const ort     = ortRef.current;
      const now     = performance.now();
      const elapsed = now - lastFrameTime.current;

      if (
        video &&
        canvas &&
        !video.paused &&
        video.readyState >= 2 &&
        elapsed >= TARGET_MS
      ) {
        lastFrameTime.current = now;
        const w = canvas.width  = video.videoWidth  || 640;
        const h = canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d')!;

        // Draw flipped mirror BGR canvas
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tc = tmp.getContext('2d')!;
        tc.save();
        tc.translate(w, 0);
        tc.scale(-1, 1);
        tc.drawImage(video, 0, 0, w, h);
        tc.restore();

        if (aiReady && session && ort) {
          if (faceCount > 0) {
            try {
              await runAnimeGAN(session, tmp, ctx, w, h, ort);
              fpsCountRef.current++;
            } catch (_) {
              ctx.drawImage(tmp, 0, 0);
            }
          } else {
            // Desaturated background when idle
            ctx.filter = 'grayscale(70%) brightness(0.4)';
            ctx.drawImage(tmp, 0, 0);
            ctx.filter = 'none';
          }
        } else {
          // Draw raw camera feed if models aren't ready yet
          ctx.drawImage(tmp, 0, 0);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [aiReady, faceCount]);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (camera.phase === 'ready') {
      startMirrorLoop();
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [camera.phase, startMirrorLoop]);

  // ── Face Tracking & Smile Loop ────────────────────────────────────────────
  useEffect(() => {
    if (camera.phase !== 'ready' || aiState !== 'ready') {
      setFaceCount(0);
      setSmilePct(0);
      if (detectionTimer.current) clearInterval(detectionTimer.current);
      return;
    }

    const fa = faceApiRef.current;
    const video = videoRef.current;
    if (!fa || !video) return;

    detectionTimer.current = setInterval(async () => {
      if (video.paused || video.readyState < 2) return;
      let count = 0;
      let smileScore = 0;

      try {
        const opts = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });
        const dets = await fa.detectAllFaces(video, opts).withFaceLandmarks(true);
        count = dets.length;

        if (count === 1) {
          const lm = dets[0].landmarks.positions;
          const mouthTop    = lm[62]?.y ?? 0;
          const mouthBottom = lm[66]?.y ?? 0;
          const mouthLeft   = lm[48]?.x ?? 0;
          const mouthRight  = lm[54]?.x ?? 0;
          const opening = Math.abs(mouthBottom - mouthTop);
          const width   = Math.abs(mouthRight - mouthLeft);
          const ratio   = width > 0 ? opening / width : 0;

          const cornerLeft  = lm[48];
          const cornerRight = lm[54];
          const cornerUp    = lm[51];
          const cornerLift  = ((cornerLeft.y + cornerRight.y) / 2) - cornerUp.y;

          smileScore = Math.min(1, Math.max(0, (cornerLift / 16) * 0.65 + ratio * 0.35));
        }
      } catch (_) {}

      setFaceCount(count);

      if (count === 1 && smileScore > 0.48) {
        smileTimer.current += 150;
        setSmilePct(Math.min(100, (smileTimer.current / 3000) * 100));
        if (smileTimer.current >= 3000) {
          smileTimer.current = 0;
          setSmilePct(0);
          triggerAutoCapture();
        }
      } else {
        smileTimer.current = Math.max(0, smileTimer.current - 120);
        setSmilePct(Math.max(0, (smileTimer.current / 3000) * 100));
      }
    }, 150);

    return () => {
      if (detectionTimer.current) clearInterval(detectionTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.phase, aiState]);

  // ── FPS Tracker ───────────────────────────────────────────────────────────
  useEffect(() => {
    fpsTimerRef.current = setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);
    return () => {
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
    };
  }, []);

  // ── Capture execution ─────────────────────────────────────────────────────
  const triggerAutoCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    setFlash(true);
    playShutter();
    setTimeout(() => setFlash(false), 350);

    try {
      const w = video.videoWidth  || 1280;
      const h = video.videoHeight || 720;
      const cap = document.createElement('canvas');
      cap.width = w; cap.height = h;
      const cc = cap.getContext('2d')!;
      cc.save(); cc.translate(w, 0); cc.scale(-1, 1);
      cc.drawImage(video, 0, 0, w, h);
      cc.restore();

      const blob: Blob | null = await new Promise(r => cap.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) return;

      const file = new File([blob], 'mirror_capture.jpg', { type: 'image/jpeg' });
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      console.error('Mirror auto-capture failed:', err);
    }
  }, [uploadManual, onCaptured]);

  const handleFileUpload = async (file: File) => {
    try {
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    }
  };

  // ── Computed states ───────────────────────────────────────────────────────
  const isCameraBusy = ['checking', 'requesting', 'initializing'].includes(camera.phase);
  const isCameraError = ['permission_denied', 'not_found', 'in_use', 'disconnected', 'https_required', 'error'].includes(camera.phase);

  // Auto-switch display details based on active camera phase
  const cameraStatusText = useMemo(() => {
    switch (camera.phase) {
      case 'checking': return 'Checking permissions...';
      case 'requesting': return 'Requesting camera access...';
      case 'initializing': return 'Starting video feed...';
      case 'reconnecting': return `Reconnecting camera... Attempt ${camera.retryAttempt} of 5`;
      default: return 'Loading digital mirror...';
    }
  }, [camera.phase, camera.retryAttempt]);

  const currentFacingDevice = useMemo(() => {
    return camera.devices.find(d => d.deviceId === camera.activeDeviceId);
  }, [camera.devices, camera.activeDeviceId]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Probe to help device change checks */}
      <div id="camera-phase-probe" className="hidden" data-phase={camera.phase} />

      <div
        className="relative w-full rounded-2xl overflow-hidden bg-[#05050a] border border-white/5 shadow-2xl transition-all duration-500"
        style={{ aspectRatio: '16/9', minHeight: 320 }}
      >
        {/* Live hidden source element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
        />

        {/* Display rendering canvas */}
        <canvas
          ref={mirrorCanvasRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ display: camera.phase === 'ready' ? 'block' : 'none' }}
        />

        {/* ── 1. Smart Camera Connecting Overlay ── */}
        <AnimatePresence>
          {isCameraBusy && (
            <motion.div
              key="camera-connecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-40 p-6"
            >
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center relative animate-pulse">
                  <Camera className="w-6 h-6 text-emerald-400" />
                  <div className="absolute inset-0 rounded-full border-2 border-t-emerald-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                </div>
              </div>
              <h3 className="font-orbitron font-bold text-xs tracking-widest text-white uppercase mb-2">
                Connecting Camera
              </h3>
              <p className="text-[10px] text-gray-500 font-mono tracking-widest mb-6">
                {cameraStatusText}
              </p>
              {/* Retro progress bar */}
              <div className="w-32 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 animate-pulse" style={{ width: '60%' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 2. Smart Reconnecting Overlay ── */}
        <AnimatePresence>
          {camera.phase === 'reconnecting' && (
            <motion.div
              key="camera-reconnecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a]/90 backdrop-blur-sm z-40 p-6 text-center"
            >
              <div className="w-12 h-12 rounded-full border border-cyan-500/20 bg-cyan-500/5 flex items-center justify-center mb-4 relative">
                <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
              </div>
              <h4 className="font-orbitron text-xs text-cyan-300 tracking-widest uppercase mb-1">
                RECONNECTING CAMERA
              </h4>
              <p className="text-[10px] font-mono text-gray-400 mb-3">
                Attempt {camera.retryAttempt} of {camera.maxRetries}
              </p>
              <p className="text-[9px] font-mono text-gray-500">
                Next attempt in {camera.nextRetryIn}s...
              </p>
              <button
                onClick={camera.retryNow}
                className="mt-6 font-orbitron text-[9px] tracking-widest border border-cyan-500/40 hover:border-cyan-400 px-4 py-2 rounded-lg text-cyan-400 hover:bg-cyan-500/10 transition-colors"
              >
                RECONNECT NOW
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 3. High-End Error Recoveries ── */}
        <AnimatePresence>
          {isCameraError && (
            <motion.div
              key="camera-error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-40 p-8 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4 shadow-[0_0_15px_rgba(239,68,68,0.05)]">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>

              {camera.phase === 'permission_denied' ? (
                <>
                  <h3 className="font-orbitron text-xs text-white tracking-widest uppercase mb-2">
                    Allow Camera Access
                  </h3>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed mb-6">
                    This Ghibli Portrait Studio requires camera access. Please approve the prompt or click Enable Camera to check again.
                  </p>
                  <button
                    onClick={camera.retryNow}
                    className="font-orbitron text-xs tracking-widest bg-emerald-500 hover:bg-emerald-400 px-6 py-3 rounded-xl text-white font-bold transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)]"
                  >
                    ENABLE CAMERA
                  </button>
                </>
              ) : camera.phase === 'https_required' ? (
                <>
                  <h3 className="font-orbitron text-xs text-red-400 tracking-widest uppercase mb-2">
                    HTTPS connection required
                  </h3>
                  <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
                    Browser security protocols prevent access to camera streams over standard HTTP. Please open this app using a secure HTTPS connection.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="font-orbitron text-xs text-white tracking-widest uppercase mb-2">
                    {camera.phase === 'disconnected' ? 'CAMERA DISCONNECTED' : 'CAMERA OFFLINE'}
                  </h3>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed mb-6">
                    {camera.errorMessage || 'Unable to connect to camera device.'}
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={camera.retryNow}
                      className="font-orbitron text-xs tracking-widest border border-white/10 hover:border-white/30 px-5 py-2.5 rounded-lg text-white hover:bg-white/5 transition-colors"
                    >
                      RETRY
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="font-orbitron text-xs tracking-widest border border-emerald-500/40 hover:border-emerald-400 px-5 py-2.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                    >
                      UPLOAD PHOTO
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 4. AI Model Initializing Overlay (Loaded only when camera is up) ── */}
        <AnimatePresence>
          {camera.phase === 'ready' && aiState === 'loading' && (
            <motion.div
              key="ai-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a]/80 backdrop-blur-md z-30 p-6 text-center"
            >
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full border border-emerald-400/20 flex items-center justify-center relative">
                  <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400 animate-spin" />
                  <Sparkles className="w-6 h-6 text-emerald-300 animate-pulse" />
                </div>
              </div>
              <h4 className="font-orbitron font-bold text-xs text-white tracking-widest uppercase mb-1">
                Initializing AI Mirror
              </h4>
              <p className="text-[10px] text-emerald-400 font-mono tracking-wider animate-pulse mb-6">
                {aiBootMsg}
              </p>
              {/* Progress bar */}
              <div className="w-40 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-300" style={{ width: `${aiBootPct}%` }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 5. Idle Ghibli Painted Scenery Overlay (When ready, but no face detected) ── */}
        <AnimatePresence>
          {camera.phase === 'ready' && aiState === 'ready' && faceCount === 0 && (
            <motion.div
              key="idle-scene"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 z-20 pointer-events-none"
            >
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(180deg, #12122b 0%, #1e1240 30%, #32194c 55%, #582960 75%, #7e4368 90%, #9e5d4d 100%)',
                }}
              />
              {/* Sparkle Stars */}
              {[...Array(25)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-pulse"
                  style={{
                    width: Math.random() * 2 + 0.8,
                    height: Math.random() * 2 + 0.8,
                    top: `${Math.random() * 55}%`,
                    left: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 3}s`,
                    animationDuration: `${1.5 + Math.random() * 2}s`,
                    opacity: Math.random() * 0.6 + 0.4,
                  }}
                />
              ))}
              {/* Moon */}
              <div
                className="absolute rounded-full"
                style={{
                  width: 55, height: 55,
                  top: '12%', right: '15%',
                  background: 'radial-gradient(circle at 35% 35%, #fffbf2, #ebd08d)',
                  boxShadow: '0 0 25px 8px rgba(235,208,141,0.22)',
                }}
              />
              <svg className="absolute bottom-0 w-full" viewBox="0 0 800 200" preserveAspectRatio="none">
                <path d="M0,180 C100,125 200,165 300,145 C400,125 500,175 600,150 C700,125 750,160 800,145 L800,200 L0,200 Z" fill="#203d0f" />
                <path d="M0,195 C80,160 180,190 280,170 C380,150 480,190 580,172 C680,155 740,180 800,167 L800,200 L0,200 Z" fill="#14260a" />
              </svg>
              {/* Floating Spirits */}
              {[...Array(4)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full bg-white/15 blur-[3px]"
                  style={{
                    width: 10 + i * 3,
                    height: 10 + i * 3,
                    bottom: `${12 + i * 6}%`,
                    left: `${15 + i * 22}%`,
                  }}
                  animate={{ y: [-6, 6, -6] }}
                  transition={{ duration: 3.5 + i * 0.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
                />
              ))}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.div
                  animate={{ y: [-3, 3, -3] }}
                  transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-center"
                >
                  <p className="font-orbitron text-white text-xs md:text-sm tracking-widest mb-1 drop-shadow-md">
                    ✨ STEP IN FRONT OF THE CAMERA
                  </p>
                  <p className="text-white/40 text-[10px] font-sans tracking-wide">
                    Portrait rendering starts instantly
                  </p>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 6. Flash Shutter Overlay ── */}
        <AnimatePresence>
          {flash && (
            <motion.div
              key="flash-shutter"
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0 bg-white z-50 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* ── 7. Active HUD display details (LIVE + FPS + Camera label) ── */}
        {camera.phase === 'ready' && (
          <>
            {/* Live Indicator */}
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-orbitron text-emerald-400 tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                LIVE
              </div>
              {aiState === 'ready' && (
                <div className="px-2 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-mono text-white/50">
                  {fps} FPS
                </div>
              )}
            </div>

            {/* Selected Camera Label */}
            {currentFacingDevice && (
              <div className="absolute top-3 right-3 z-20">
                <div className="px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 tracking-wider flex items-center gap-1">
                  <Video className="w-3 h-3 text-emerald-400" />
                  {currentFacingDevice.label.length > 20
                    ? `${currentFacingDevice.label.slice(0, 18)}...`
                    : currentFacingDevice.label}
                </div>
              </div>
            )}

            {/* Capture Smile Tracker progress circle */}
            {smilePct > 4 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1"
              >
                <div className="relative w-11 h-11">
                  <svg className="w-11 h-11 -rotate-90" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 20}`}
                      strokeDashoffset={`${2 * Math.PI * 20 * (1 - smilePct / 100)}`}
                      style={{ transition: 'stroke-dashoffset 0.12s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-xs select-none">😊</div>
                </div>
                <p className="text-[8px] font-orbitron text-emerald-400 tracking-widest">
                  {smilePct < 100 ? 'HOLD SMILE' : 'CAPTURING'}
                </p>
              </motion.div>
            )}
          </>
        )}

        {/* File upload hidden triggers */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f);
          }}
        />

        {/* Dynamic actions toggler bar (Bottom Right) */}
        {!isCameraBusy && camera.phase !== 'https_required' && (
          <div className="absolute bottom-3 right-3 z-20 flex gap-2">
            {camera.devices.length > 1 && (
              <button
                onClick={() => setShowCameraPicker(!showCameraPicker)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 hover:text-white transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                CAMERAS
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 hover:text-white transition-colors"
            >
              <Upload className="w-2.5 h-2.5" />
              UPLOAD
            </button>
          </div>
        )}
      </div>

      {/* ── 8. Active Camera Selector Panel ── */}
      {showCameraPicker && camera.devices.length > 1 && (
        <div className="w-full bg-[#0b0b14] border border-white/5 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-[10px] font-orbitron text-gray-400 tracking-widest uppercase mb-1">
            Choose Camera Device
          </p>
          <div className="flex flex-col gap-1">
            {camera.devices.map(d => (
              <button
                key={d.deviceId}
                onClick={() => {
                  switchCamera(d.deviceId);
                  setShowCameraPicker(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-sans flex items-center justify-between transition-colors ${
                  d.deviceId === camera.activeDeviceId
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                    : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span>{d.label}</span>
                {d.deviceId === camera.activeDeviceId && <span className="text-[9px] font-orbitron text-emerald-400 font-bold uppercase tracking-wider">ACTIVE</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 9. Structured Diagnostic Logs Console ── */}
      <div className="w-full bg-[#08080f] border border-white/5 rounded-xl p-3 flex flex-col gap-2">
        <button
          onClick={() => setShowConsole(!showConsole)}
          className="w-full flex items-center justify-between text-left text-[10px] font-orbitron text-gray-400 hover:text-white tracking-widest uppercase select-none"
        >
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            DIAGNOSTIC LOGS
          </span>
          <span className="text-gray-600">{showConsole ? 'HIDE' : 'SHOW'}</span>
        </button>

        {showConsole && (
          <div className="w-full max-h-48 overflow-y-auto bg-black/60 rounded-lg p-2 font-mono text-[9px] text-gray-400 flex flex-col gap-1 border border-white/5 scrollbar-thin">
            {camera.logs.length === 0 ? (
              <span className="text-gray-600">Console empty.</span>
            ) : (
              camera.logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-gray-600">[{new Date(l.ts).toLocaleTimeString()}]</span>
                  <span className="text-cyan-400">[{l.tag}]</span>
                  <span className="text-gray-300">{l.msg}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraFeed;
