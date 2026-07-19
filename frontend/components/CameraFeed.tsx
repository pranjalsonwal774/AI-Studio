import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { Upload, Sparkles, Camera, Wifi } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface CameraFeedProps {
  style: string;
  background: string;
  onCaptured: (photoId: string, originalUrl: string) => void;
  uploadManual: (file: File) => Promise<any>;
}

type MirrorPhase =
  | 'boot'          // loading ONNX model
  | 'idle'          // camera live, no person detected
  | 'mirror'        // live Ghibli mirror active
  | 'autocapture'   // smile+stable → capturing HQ photo
  | 'error';        // camera or model failed

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
// Load face-api.js from CDN
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

// ─────────────────────────────────────────────────────────────────────────────
// Load ONNX Runtime Web from CDN
// ─────────────────────────────────────────────────────────────────────────────
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
// Run AnimeGANv2 inference on a single canvas/image source
// Input: [1,3,512,512] NCHW float32 in [-1,1]
// Output: [1,3,512,512] NCHW float32 in [-1,1]
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

  // RGBA → NCHW float32 normalized to [-1,1]
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

  // NCHW → RGBA ImageData
  const outImg = outCtx.createImageData(SIZE, SIZE);
  const od = outImg.data;
  for (let i = 0; i < SIZE * SIZE; i++) {
    od[i * 4]     = Math.min(255, Math.max(0, (out[i]                   + 1.0) * 127.5));
    od[i * 4 + 1] = Math.min(255, Math.max(0, (out[SIZE * SIZE + i]     + 1.0) * 127.5));
    od[i * 4 + 2] = Math.min(255, Math.max(0, (out[SIZE * SIZE * 2 + i] + 1.0) * 127.5));
    od[i * 4 + 3] = 255;
  }
  // Draw scaled up to outW × outH
  const scaleTmp = document.createElement('canvas');
  scaleTmp.width = SIZE; scaleTmp.height = SIZE;
  scaleTmp.getContext('2d')!.putImageData(outImg, 0, 0);
  outCtx.drawImage(scaleTmp, 0, 0, outW, outH);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export const CameraFeed: React.FC<CameraFeedProps> = ({
  style,
  background,
  onCaptured,
  uploadManual,
}) => {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef        = useRef<HTMLVideoElement>(null);
  const mirrorCanvasRef = useRef<HTMLCanvasElement>(null); // displayed Ghibli canvas
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const sessionRef      = useRef<any>(null);
  const ortRef          = useRef<any>(null);
  const faceApiRef      = useRef<any>(null);
  const rafRef          = useRef<number>(0);
  const detectionTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const smileTimer      = useRef<number>(0);       // ms of continuous smile
  const lastFrameTime   = useRef<number>(0);

  // ── State ─────────────────────────────────────────────────────────────────
  const [phase, setPhase]           = useState<MirrorPhase>('boot');
  const [bootMsg, setBootMsg]       = useState('Loading neural engine...');
  const [bootPct, setBootPct]       = useState(0);
  const [errorMsg, setErrorMsg]     = useState('');
  const [flash, setFlash]           = useState(false);
  const [smilePct, setSmilePct]     = useState(0);   // 0-100 for smile ring
  const [faceCount, setFaceCount]   = useState(0);
  const [fps, setFps]               = useState(0);
  const fpsCountRef = useRef(0);
  const fpsTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Boot sequence: camera → ORT → model → face-api
  // ─────────────────────────────────────────────────────────────────────────
  const boot = useCallback(async () => {
    setPhase('boot');
    setBootPct(0);
    setBootMsg('Requesting camera access...');

    // 1. Camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e: any) {
      setErrorMsg('Camera access denied. Allow camera and reload.');
      setPhase('error');
      return;
    }
    setBootPct(25);

    // 2. Load ORT
    setBootMsg('Loading ONNX Runtime WebGL engine...');
    try {
      const ort = await loadORT();
      ort.env.wasm.numThreads = 1;
      ortRef.current = ort;
    } catch (e) {
      setErrorMsg('Failed to load ONNX Runtime. Check your internet connection.');
      setPhase('error');
      return;
    }
    setBootPct(50);

    // 3. Download + load ONNX model
    setBootMsg('Downloading Ghibli style model (~8MB)...');
    try {
      const ort = ortRef.current;
      const modelUrl = 'http://localhost:8000/static/models/AnimeGANv2_Hayao.onnx';
      const opt = {
        executionProviders: ['webgl', 'wasm'],
        graphOptimizationLevel: 'all',
      };
      const session = await ort.InferenceSession.create(modelUrl, opt);
      sessionRef.current = session;
    } catch (e: any) {
      setErrorMsg(`Model load failed: ${e?.message || e}`);
      setPhase('error');
      return;
    }
    setBootPct(80);

    // 4. Load face-api
    setBootMsg('Loading face detection models...');
    try {
      faceApiRef.current = await loadFaceApi();
    } catch (_) {
      // face-api failing is non-critical — we just won't do smile detection
      console.warn('face-api failed to load; smile detection disabled.');
    }
    setBootPct(100);

    // Done
    setPhase('idle');
    startMirrorLoop();
    startDetectionLoop();
    startFpsMeter();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    boot();
    return () => {
      stopAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebind srcObject on every render so it never loses the stream
  useEffect(() => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => {});
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Mirror render loop (requestAnimationFrame)
  // ─────────────────────────────────────────────────────────────────────────
  const startMirrorLoop = useCallback(() => {
    const TARGET_MS = 1000 / 30; // 30 FPS cap to let GPU breathe

    const loop = async () => {
      const now = performance.now();
      const elapsed = now - lastFrameTime.current;

      const video   = videoRef.current;
      const canvas  = mirrorCanvasRef.current;
      const session = sessionRef.current;
      const ort     = ortRef.current;

      if (
        video &&
        canvas &&
        session &&
        ort &&
        !video.paused &&
        video.readyState >= 2 &&
        elapsed >= TARGET_MS
      ) {
        lastFrameTime.current = now;
        const w = canvas.width  = video.videoWidth  || 640;
        const h = canvas.height = video.videoHeight || 480;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Draw mirrored video onto offscreen temp canvas
          const tmp = document.createElement('canvas');
          tmp.width = w; tmp.height = h;
          const tc = tmp.getContext('2d')!;
          tc.save();
          tc.translate(w, 0);
          tc.scale(-1, 1);
          tc.drawImage(video, 0, 0, w, h);
          tc.restore();

          // Run style transfer if mirror mode
          if (phase === 'mirror' || phase === 'autocapture') {
            try {
              await runAnimeGAN(session, tmp, ctx, w, h, ort);
              fpsCountRef.current++;
            } catch (_) {
              // Fallback: just draw raw mirrored video
              ctx.drawImage(tmp, 0, 0);
            }
          } else {
            // Idle — draw soft-desaturated video as background hint
            ctx.filter = 'grayscale(80%) brightness(0.4)';
            ctx.drawImage(tmp, 0, 0);
            ctx.filter = 'none';
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [phase]);

  // Restart loop when phase changes so idle/mirror rendering changes
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (phase === 'idle' || phase === 'mirror' || phase === 'autocapture') {
      startMirrorLoop();
    }
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Detection loop (every 150ms) — face count + smile stability check
  // ─────────────────────────────────────────────────────────────────────────
  const startDetectionLoop = useCallback(() => {
    if (detectionTimer.current) clearInterval(detectionTimer.current);

    detectionTimer.current = setInterval(async () => {
      const video = videoRef.current;
      const fa    = faceApiRef.current;
      if (!video || video.paused || video.readyState < 2) return;

      let count = 0;
      let smileScore = 0;

      if (fa) {
        try {
          const opts = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.40 });
          const dets = await fa.detectAllFaces(video, opts).withFaceLandmarks(true);
          count = dets.length;

          if (count === 1) {
            // Smile detection via mouth openness (landmarks 48–67)
            const lm = dets[0].landmarks.positions;
            const mouthTop    = lm[62]?.y ?? 0; // upper lip bottom
            const mouthBottom = lm[66]?.y ?? 0; // lower lip top
            const mouthLeft   = lm[48]?.x ?? 0;
            const mouthRight  = lm[54]?.x ?? 0;
            const opening   = Math.abs(mouthBottom - mouthTop);
            const width     = Math.abs(mouthRight - mouthLeft);
            const ratio     = width > 0 ? opening / width : 0;
            // smile: wide & slightly open mouth
            const cornerLeft  = lm[48];
            const cornerRight = lm[54];
            const cornerUp    = lm[51];
            const upY = cornerUp?.y ?? 0;
            const leftY  = cornerLeft?.y  ?? 0;
            const rightY = cornerRight?.y ?? 0;
            const cornerLift = ((leftY + rightY) / 2) - upY;
            smileScore = Math.min(1, Math.max(0, (cornerLift / 15) * 0.6 + ratio * 0.4));
          }
        } catch (_) { /* ignore */ }
      }

      setFaceCount(count);

      // Phase transitions
      setPhase(prev => {
        if (count === 0 && (prev === 'mirror' || prev === 'autocapture')) return 'idle';
        if (count === 1 && prev === 'idle') return 'mirror';
        return prev;
      });

      // Smile auto-capture accumulation
      if (count === 1 && smileScore > 0.45) {
        smileTimer.current += 150;
        setSmilePct(Math.min(100, (smileTimer.current / 3000) * 100));
        if (smileTimer.current >= 3000) {
          smileTimer.current = 0;
          setSmilePct(0);
          triggerAutoCapture();
        }
      } else {
        smileTimer.current = Math.max(0, smileTimer.current - 100);
        setSmilePct(Math.max(0, (smileTimer.current / 3000) * 100));
      }
    }, 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // FPS meter
  // ─────────────────────────────────────────────────────────────────────────
  const startFpsMeter = useCallback(() => {
    if (fpsTimer.current) clearInterval(fpsTimer.current);
    fpsTimer.current = setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Auto capture: grab HQ frame → upload → backend HQ generation
  // Mirror continues running uninterrupted
  // ─────────────────────────────────────────────────────────────────────────
  const triggerAutoCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    setPhase('autocapture');
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
      // Send to backend HQ processing without blocking mirror
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      console.error('Auto-capture failed:', err.message);
    } finally {
      setPhase('mirror');
    }
  }, [uploadManual, onCaptured]);

  // ─────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (detectionTimer.current) clearInterval(detectionTimer.current);
    if (fpsTimer.current) clearInterval(fpsTimer.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Manual file upload
  // ─────────────────────────────────────────────────────────────────────────
  const handleFileUpload = async (file: File) => {
    try {
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-[#06060c] border border-white/5 shadow-2xl"
         style={{ aspectRatio: '16/9', minHeight: 320 }}>

      {/* ── Always-on video (hidden) — source for inference ── */}
      <video
        ref={videoRef}
        autoPlay playsInline muted
        className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
      />

      {/* ── Mirror canvas — the actual display ── */}
      <canvas
        ref={mirrorCanvasRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ display: (phase === 'idle' || phase === 'mirror' || phase === 'autocapture') ? 'block' : 'none' }}
      />

      {/* ── BOOT overlay ── */}
      <AnimatePresence>
        {phase === 'boot' && (
          <motion.div
            key="boot"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-[#06060c] z-30 p-8"
          >
            {/* Animated Ghibli orb */}
            <div className="relative mb-8">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400/30 via-cyan-400/20 to-purple-500/30 blur-xl animate-pulse absolute inset-0" />
              <div className="w-24 h-24 rounded-full border border-emerald-400/30 flex items-center justify-center relative">
                <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400/60 animate-spin" />
                <Sparkles className="w-8 h-8 text-emerald-300" />
              </div>
            </div>
            <h2 className="font-orbitron font-bold text-sm text-white tracking-widest mb-2">
              GHIBLI MIRROR
            </h2>
            <p className="text-emerald-400/80 text-xs font-mono tracking-wider mb-6 animate-pulse">
              {bootMsg}
            </p>
            {/* Progress bar */}
            <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 rounded-full"
                animate={{ width: `${bootPct}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <p className="text-white/20 text-[10px] font-mono mt-3">{bootPct}%</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ERROR overlay ── */}
      <AnimatePresence>
        {phase === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-[#06060c] z-30 p-8 text-center"
          >
            <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/40 flex items-center justify-center mb-4">
              <Camera className="w-7 h-7 text-red-400" />
            </div>
            <h3 className="font-orbitron text-sm text-red-400 tracking-widest mb-2">MIRROR OFFLINE</h3>
            <p className="text-gray-400 text-xs max-w-xs leading-relaxed mb-6">{errorMsg}</p>
            <button
              onClick={boot}
              className="font-orbitron text-xs tracking-widest border border-emerald-500/40 px-6 py-2.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            >
              RETRY
            </button>
            <div className="mt-4 text-[10px] text-gray-600">
              or{' '}
              <span
                className="text-cyan-400 underline cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                upload a photo
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── IDLE overlay — painted Ghibli scene ── */}
      <AnimatePresence>
        {phase === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 z-20 pointer-events-none"
          >
            {/* Dreamy Ghibli gradient sky */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(180deg, #1a1a3e 0%, #2d1b5e 30%, #4a2870 55%, #7c3d8a 75%, #b06090 90%, #d4806a 100%)',
              }}
            />
            {/* Stars */}
            {[...Array(40)].map((_, i) => (
              <div
                key={i}
                className="absolute rounded-full bg-white animate-pulse"
                style={{
                  width: Math.random() * 2 + 1,
                  height: Math.random() * 2 + 1,
                  top: `${Math.random() * 60}%`,
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 3}s`,
                  animationDuration: `${2 + Math.random() * 3}s`,
                  opacity: Math.random() * 0.7 + 0.3,
                }}
              />
            ))}
            {/* Ghibli moon */}
            <div
              className="absolute rounded-full"
              style={{
                width: 70, height: 70,
                top: '12%', right: '15%',
                background: 'radial-gradient(circle at 35% 35%, #fff9e6, #f5d78e)',
                boxShadow: '0 0 30px 10px rgba(245,215,142,0.25)',
              }}
            />
            {/* Rolling hills */}
            <svg className="absolute bottom-0 w-full" viewBox="0 0 800 200" preserveAspectRatio="none">
              <path d="M0,180 C100,120 200,160 300,140 C400,120 500,170 600,145 C700,120 750,155 800,140 L800,200 L0,200 Z" fill="#2d5016" />
              <path d="M0,195 C80,155 180,185 280,165 C380,145 480,185 580,168 C680,150 740,175 800,162 L800,200 L0,200 Z" fill="#1e3a0a" />
            </svg>
            {/* Floating totoro-spirit wisps */}
            {[...Array(5)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full bg-white/20 blur-sm"
                style={{
                  width: 12 + i * 4,
                  height: 12 + i * 4,
                  bottom: `${15 + i * 5}%`,
                  left: `${10 + i * 18}%`,
                }}
                animate={{ y: [-8, 8, -8] }}
                transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
              />
            ))}
            {/* Center message */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.div
                animate={{ y: [-4, 4, -4] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="text-center"
              >
                <p className="font-orbitron text-white/90 text-sm md:text-base tracking-widest mb-1 drop-shadow-lg">
                  ✨ Step in front of the camera
                </p>
                <p className="text-white/40 text-xs font-sans tracking-wider">
                  Your Ghibli portrait will appear instantly
                </p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MULTI-PERSON warning ── */}
      <AnimatePresence>
        {faceCount > 1 && phase === 'mirror' && (
          <motion.div
            key="multiperson"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-25 flex items-center justify-center pointer-events-none"
          >
            <div className="bg-amber-500/20 border border-amber-400/50 rounded-2xl px-6 py-4 text-center backdrop-blur-sm">
              <p className="font-orbitron text-amber-300 text-xs tracking-widest">
                👥 Please stand one person at a time
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Camera flash ── */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key="flash"
            initial={{ opacity: 1 }} animate={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0 bg-white z-50 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* ── HUD overlays (only in mirror mode) ── */}
      {(phase === 'mirror' || phase === 'autocapture') && (
        <>
          {/* Top-left: LIVE badge + FPS */}
          <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-[10px] font-orbitron text-emerald-400 tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
              LIVE
            </div>
            <div className="px-2 py-1 rounded-full bg-black/60 border border-white/10 text-[10px] font-mono text-white/50">
              {fps} FPS
            </div>
          </div>

          {/* Top-right: Ghibli label */}
          <div className="absolute top-3 right-3 z-20">
            <div className="px-2.5 py-1 rounded-full bg-black/60 border border-emerald-500/30 text-[10px] font-orbitron text-emerald-400/80 tracking-widest flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              GHIBLI MIRROR
            </div>
          </div>

          {/* Bottom: Smile capture ring */}
          {smilePct > 5 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1"
            >
              <div className="relative w-12 h-12">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                  <circle
                    cx="24" cy="24" r="20"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 20}`}
                    strokeDashoffset={`${2 * Math.PI * 20 * (1 - smilePct / 100)}`}
                    style={{ transition: 'stroke-dashoffset 0.15s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-sm">😊</div>
              </div>
              <p className="text-[9px] font-orbitron text-emerald-400/80 tracking-widest">
                {smilePct < 100 ? 'HOLD SMILE...' : 'CAPTURING!'}
              </p>
            </motion.div>
          )}
        </>
      )}

      {/* ── Auto-capture badge ── */}
      <AnimatePresence>
        {phase === 'autocapture' && (
          <motion.div
            key="autocap"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute bottom-16 inset-x-0 flex justify-center z-20"
          >
            <div className="px-4 py-2 rounded-full bg-emerald-500/20 border border-emerald-400/50 font-orbitron text-[10px] text-emerald-300 tracking-widest flex items-center gap-2">
              <Wifi className="w-3 h-3 animate-pulse" /> SAVING HIGH-QUALITY PORTRAIT...
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hidden upload input ── */}
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

      {/* ── Upload fallback button (bottom-right) ── */}
      {phase !== 'boot' && phase !== 'error' && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 hover:text-white hover:border-white/30 transition-colors"
        >
          <Upload className="w-3 h-3" />
          UPLOAD PHOTO
        </button>
      )}
    </div>
  );
};

export default CameraFeed;
