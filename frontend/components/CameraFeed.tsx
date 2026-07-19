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
  Video,
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
  avatarUrl: string | null;            // Completed Ghibli portrait URL
  generationProgress: number;          // 0-100 progress of backend model
  generationStatus: string;            // Text status from backend spooler
  onFaceDetected: () => void;          // Callback when face is first locked
  onReset: () => void;                 // Callback when user leaves
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export const CameraFeed: React.FC<CameraFeedProps> = ({
  style,
  background,
  onCaptured,
  uploadManual,
  avatarUrl,
  generationProgress,
  generationStatus,
  onFaceDetected,
  onReset
}) => {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef          = useRef<HTMLVideoElement>(null);
  const displayCanvasRef  = useRef<HTMLCanvasElement>(null);
  const fileInputRef      = useRef<HTMLInputElement>(null);
  const faceApiRef        = useRef<any>(null);
  const rafRef            = useRef<number>(0);
  const detectionTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Avatar Loading Cache Refs
  const avatarImageRef    = useRef<HTMLImageElement | null>(null);
  const avatarLoadedUrlRef = useRef<string | null>(null);

  // Face Landmarks Geometry Lock Refs
  const initialFaceBoxRef = useRef<{ x: number, y: number, w: number, h: number } | null>(null);
  const initialLandmarksRef = useRef<any>(null);
  const triggerCaptureOnceRef = useRef<boolean>(false);

  // Smooth Interpolation State Refs
  const currentDxRef      = useRef(0);
  const currentDyRef      = useRef(0);
  const currentRollRef    = useRef(0);
  const currentScaleRef   = useRef(1);
  const currentEARRef     = useRef(0.3); // Eye Aspect Ratio
  const currentMouthRatioRef = useRef(0);

  // ── Interaction States ────────────────────────────────────────────────────
  const [faceCount, setFaceCount]   = useState(0);
  const [fps, setFps]               = useState(0);
  const [showConsole, setShowConsole] = useState(false);
  const [showCameraPicker, setShowCameraPicker] = useState(false);
  const [aiState, setAiState]       = useState<'idle' | 'loading' | 'ready'>('idle');

  const fpsCountRef = useRef(0);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Camera Management Hook
  const camera = useCameraManager(videoRef);

  // Ghibli ambient particles
  const particlesRef = useRef<Particle[]>([]);

  // ── Load face-api model once camera is active ─────────────────────────────
  useEffect(() => {
    if (camera.phase !== 'ready') {
      setAiState('idle');
      return;
    }
    setAiState('loading');
    loadFaceApi().then((fa) => {
      faceApiRef.current = fa;
      setAiState('ready');
    }).catch(err => {
      console.error('Face detector load failed:', err);
    });
  }, [camera.phase]);

  // ── Load Ghibli Avatar Image once generated ──────────────────────────────
  useEffect(() => {
    if (!avatarUrl) {
      avatarImageRef.current = null;
      avatarLoadedUrlRef.current = null;
      return;
    }
    if (avatarUrl === avatarLoadedUrlRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      avatarImageRef.current = img;
      avatarLoadedUrlRef.current = avatarUrl;
    };
    img.src = `http://localhost:8000${avatarUrl}`;
  }, [avatarUrl]);

  // ── Ghibli particles initialization ──
  const initParticles = (w: number, h: number) => {
    if (particlesRef.current.length > 0) return;
    const colors = ['rgba(110, 231, 183, 0.4)', 'rgba(56, 189, 248, 0.35)', 'rgba(216, 180, 254, 0.3)'];
    for (let i = 0; i < 20; i++) {
      particlesRef.current.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -0.3 - Math.random() * 0.5,
        size: 2 + Math.random() * 4,
        alpha: 0.1 + Math.random() * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  };

  const drawParticles = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    initParticles(w, h);
    particlesRef.current.forEach(p => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 2 * Math.PI);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.restore();

      // move
      p.x += p.vx;
      p.y += p.vy;
      // fade out near top
      if (p.y < 50) p.alpha = Math.max(0, p.alpha - 0.01);
      // recycle
      if (p.y < 0 || p.alpha <= 0) {
        p.x = Math.random() * w;
        p.y = h + 10;
        p.vy = -0.3 - Math.random() * 0.5;
        p.alpha = 0.2 + Math.random() * 0.5;
      }
    });
  };

  // ── Render loop (HTML5 Canvas morphing) ──
  const startMirrorLoop = useCallback(() => {
    const loop = () => {
      const video = videoRef.current;
      const canvas = displayCanvasRef.current;
      const avatar = avatarImageRef.current;

      if (video && canvas && !video.paused && video.readyState >= 2) {
        const w = canvas.width  = video.videoWidth  || 640;
        const h = canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d')!;

        // 1. Render Ghibli Mirror Mode (If avatar is loaded)
        if (avatar && initialFaceBoxRef.current) {
          ctx.drawImage(avatar, 0, 0, w, h);

          // Extract face box dimensions
          const box = initialFaceBoxRef.current;
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;

          // Apply head movements with linear interpolation (smoothing)
          ctx.save();
          ctx.translate(cx, cy);
          ctx.translate(currentDxRef.current, currentDyRef.current);
          ctx.rotate(currentRollRef.current);
          ctx.scale(currentScaleRef.current, currentScaleRef.current);
          ctx.translate(-cx, -cy);

          // Draw morphed Ghibli Face Layer
          ctx.drawImage(avatar, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);

          // Eye Blinking Animation (Lightweight Vector Warp)
          const ear = currentEARRef.current;
          if (ear < 0.21) {
            // Draw Ghibli Hand-painted Closed Eyelids over eye regions
            const eyeYOffset = box.h * 0.38;
            const eyeW = box.w * 0.12;
            const eyeH = box.h * 0.05;

            // Left Eye
            const lex = box.x + box.w * 0.32;
            const ley = box.y + eyeYOffset;
            ctx.fillStyle = '#ebd5bb'; // matches average Ghibli skin tone
            ctx.fillRect(lex - 2, ley - 2, eyeW + 4, eyeH + 4);
            ctx.beginPath();
            ctx.ellipse(lex + eyeW / 2, ley + eyeH / 2, eyeW / 2, 1.5, 0, 0, Math.PI);
            ctx.strokeStyle = '#2d1f18'; // dark sketch lines
            ctx.lineWidth = 2.2;
            ctx.stroke();

            // Right Eye
            const rex = box.x + box.w * 0.56;
            const rey = box.y + eyeYOffset;
            ctx.fillStyle = '#ebd5bb';
            ctx.fillRect(rex - 2, rey - 2, eyeW + 4, eyeH + 4);
            ctx.beginPath();
            ctx.ellipse(rex + eyeW / 2, rey + eyeH / 2, eyeW / 2, 1.5, 0, 0, Math.PI);
            ctx.strokeStyle = '#2d1f18';
            ctx.lineWidth = 2.2;
            ctx.stroke();
          }

          // Mouth expression warp
          const mouthRatio = currentMouthRatioRef.current;
          if (mouthRatio > 0.35) {
            const mx = box.x + box.w * 0.41;
            const my = box.y + box.h * 0.70;
            const mw = box.w * 0.18;
            const mh = box.h * 0.06;

            // Draw cartoonish open mouth
            ctx.fillStyle = '#ebd5bb';
            ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
            ctx.fillStyle = '#a04838'; // red interior
            ctx.beginPath();
            ctx.ellipse(mx + mw / 2, my + mh / 2, mw / 2, mh * (mouthRatio * 1.2), 0, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#2d1f18';
            ctx.lineWidth = 1.8;
            ctx.stroke();
          }

          ctx.restore();

          // Ambient magical effects
          drawParticles(ctx, w, h);
          fpsCountRef.current++;
        }
        // 2. Render Idle Scenery (No avatar loaded, desaturated grayscale preview)
        else {
          const tmp = document.createElement('canvas');
          tmp.width = w; tmp.height = h;
          const tc = tmp.getContext('2d')!;
          tc.save(); tc.translate(w, 0); tc.scale(-1, 1);
          tc.drawImage(video, 0, 0, w, h);
          tc.restore();

          ctx.filter = 'grayscale(80%) brightness(0.35) blur(2px)';
          ctx.drawImage(tmp, 0, 0);
          ctx.filter = 'none';
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [aiReady]);

  // Restart loop on mount
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (camera.phase === 'ready') {
      startMirrorLoop();
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [camera.phase, startMirrorLoop]);

  // ── Face Tracking Logic ──
  useEffect(() => {
    if (camera.phase !== 'ready' || aiState !== 'ready') {
      setFaceCount(0);
      return;
    }

    const fa = faceApiRef.current;
    const video = videoRef.current;
    if (!fa || !video) return;

    detectionTimer.current = setInterval(async () => {
      if (video.paused || video.readyState < 2) return;

      try {
        const opts = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.40 });
        const dets = await fa.detectAllFaces(video, opts).withFaceLandmarks(true);
        const count = dets.length;
        setFaceCount(count);

        if (count === 0) {
          // Reset when user leaves
          triggerCaptureOnceRef.current = false;
          initialFaceBoxRef.current = null;
          initialLandmarksRef.current = null;
          onReset();
        } else if (count === 1) {
          onFaceDetected();
          const det = dets[0];
          const box = det.detection.box;
          const lm = det.landmarks.positions;

          // Lock initial face geometry on first step-in
          if (!initialFaceBoxRef.current) {
            initialFaceBoxRef.current = {
              x: box.x,
              y: box.y,
              w: box.width,
              h: box.height
            };
            initialLandmarksRef.current = lm;
          }

          // Trigger backend generation once
          if (!triggerCaptureOnceRef.current) {
            triggerCaptureOnceRef.current = true;
            silentlyCaptureAndSubmit();
          }

          // Real-time delta tracking relative to the locked initial coordinates
          const initBox = initialFaceBoxRef.current;
          const initLm = initialLandmarksRef.current;
          if (initBox && initLm) {
            // DX/DY Translation
            const currentCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            const initCenter = { x: initBox.x + initBox.w / 2, y: initBox.y + initBox.h / 2 };
            const targetDx = (initCenter.x - currentCenter.x) * 1.5; // multiplier enhances movement
            const targetDy = (currentCenter.y - initCenter.y) * 1.5;

            // Roll rotation
            const initLeftEye = initLm[36];
            const initRightEye = initLm[45];
            const currentLeftEye = lm[36];
            const currentRightEye = lm[45];
            const initAngle = Math.atan2(initRightEye.y - initLeftEye.y, initRightEye.x - initLeftEye.x);
            const currentAngle = Math.atan2(currentRightEye.y - currentLeftEye.y, currentRightEye.x - currentLeftEye.x);
            const targetRoll = initAngle - currentAngle;

            // Distance scaling
            const initEyeDist = Math.hypot(initRightEye.x - initLeftEye.x, initRightEye.y - initLeftEye.y);
            const currentEyeDist = Math.hypot(currentRightEye.x - currentLeftEye.x, currentRightEye.y - currentLeftEye.y);
            const targetScale = initEyeDist > 0 ? currentEyeDist / initEyeDist : 1;

            // Eye Aspect Ratio (Eyelid blink tracking)
            const leftEyeY = Math.abs((lm[37].y + lm[38].y) / 2 - (lm[41].y + lm[40].y) / 2);
            const leftEyeX = Math.abs(lm[39].x - lm[36].x);
            const targetEAR = leftEyeX > 0 ? leftEyeY / leftEyeX : 0.3;

            // Mouth Open Ratio
            const mouthY = Math.abs(lm[62].y - lm[66].y);
            const mouthX = Math.abs(lm[54].x - lm[48].x);
            const targetMouthRatio = mouthX > 0 ? mouthY / mouthX : 0;

            // Linear Interpolation (smoothing / anti-jitter)
            const LERP_FACTOR = 0.28;
            currentDxRef.current += (targetDx - currentDxRef.current) * LERP_FACTOR;
            currentDyRef.current += (targetDy - currentDyRef.current) * LERP_FACTOR;
            currentRollRef.current += (targetRoll - currentRollRef.current) * LERP_FACTOR;
            currentScaleRef.current += (targetScale - currentScaleRef.current) * LERP_FACTOR;
            currentEARRef.current += (targetEAR - currentEARRef.current) * 0.4; // blink is faster
            currentMouthRatioRef.current += (targetMouthRatio - currentMouthRatioRef.current) * LERP_FACTOR;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }, 120);

    return () => {
      if (detectionTimer.current) clearInterval(detectionTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.phase, aiState, onFaceDetected, onReset]);

  // ── Capture and submit ──
  const silentlyCaptureAndSubmit = async () => {
    const video = videoRef.current;
    if (!video) return;

    playShutter();
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
      console.error('Silently capture failed:', err);
    }
  };

  // ── FPS Timer ──
  useEffect(() => {
    fpsTimerRef.current = setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);
    return () => {
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
    };
  }, []);

  const handleFileUpload = async (file: File) => {
    try {
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    }
  };

  const isCameraBusy = ['checking', 'requesting', 'initializing'].includes(camera.phase);
  const isCameraError = ['permission_denied', 'not_found', 'in_use', 'disconnected', 'https_required', 'error'].includes(camera.phase);

  const currentFacingDevice = useMemo(() => {
    return camera.devices.find(d => d.deviceId === camera.activeDeviceId);
  }, [camera.devices, camera.activeDeviceId]);

  return (
    <div className="flex flex-col gap-4 w-full">
      <div id="camera-phase-probe" className="hidden" data-phase={camera.phase} />

      <div
        className="relative w-full rounded-2xl overflow-hidden bg-[#05050a] border border-white/5 shadow-2xl transition-all duration-500"
        style={{ aspectRatio: '16/9', minHeight: 320 }}
      >
        {/* Hidden video track element */}
        <video
          ref={videoRef}
          autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none z-0"
        />

        {/* Morphing avatar canvas viewport */}
        <canvas
          ref={displayCanvasRef}
          className="absolute inset-0 w-full h-full object-cover z-10"
        />

        {/* ── 1. Smart Camera Connecting Overlay ── */}
        <AnimatePresence>
          {isCameraBusy && (
            <motion.div
              key="camera-connecting"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-40 p-6"
            >
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center relative animate-pulse">
                  <Camera className="w-6 h-6 text-emerald-400" />
                  <div className="absolute inset-0 rounded-full border-2 border-t-emerald-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                </div>
              </div>
              <h3 className="font-orbitron font-bold text-xs tracking-widest text-white uppercase mb-2">Connecting Camera</h3>
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
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a]/90 backdrop-blur-sm z-40 p-6 text-center"
            >
              <div className="w-12 h-12 rounded-full border border-cyan-500/20 bg-cyan-500/5 flex items-center justify-center mb-4">
                <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
              </div>
              <h4 className="font-orbitron text-xs text-cyan-300 tracking-widest uppercase mb-1">RECONNECTING CAMERA</h4>
              <p className="text-[10px] font-mono text-gray-400 mb-3">Attempt {camera.retryAttempt} of 5</p>
              <p className="text-[9px] font-mono text-gray-500">Next attempt in {camera.nextRetryIn}s...</p>
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
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-40 p-8 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>

              {camera.phase === 'permission_denied' ? (
                <>
                  <h3 className="font-orbitron text-xs text-white tracking-widest uppercase mb-2">Allow Camera Access</h3>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed mb-6">Camera permission is blocked. Click Enable Camera to check again.</p>
                  <button
                    onClick={camera.retryNow}
                    className="font-orbitron text-xs tracking-widest bg-emerald-500 hover:bg-emerald-400 px-6 py-3 rounded-xl text-white font-bold transition-all"
                  >
                    ENABLE CAMERA
                  </button>
                </>
              ) : camera.phase === 'https_required' ? (
                <>
                  <h3 className="font-orbitron text-xs text-red-400 tracking-widest uppercase mb-2">HTTPS connection required</h3>
                  <p className="text-xs text-gray-500 max-w-sm leading-relaxed">Camera streams require a secure HTTPS connection.</p>
                </>
              ) : (
                <>
                  <h3 className="font-orbitron text-xs text-white tracking-widest uppercase mb-2">{camera.phase === 'disconnected' ? 'CAMERA DISCONNECTED' : 'CAMERA OFFLINE'}</h3>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed mb-6">{camera.errorMessage}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={camera.retryNow}
                      className="font-orbitron text-xs tracking-widest border border-white/10 hover:border-white/30 px-5 py-2.5 rounded-lg text-white hover:bg-white/5 transition-colors"
                    >
                      RETRY
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 4. AI Pipeline Initialization Loading Screen ── */}
        <AnimatePresence>
          {camera.phase === 'ready' && aiState === 'loading' && (
            <motion.div
              key="ai-loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-30 p-6 text-center"
            >
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full border border-emerald-400/20 flex items-center justify-center relative">
                  <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400 animate-spin" />
                  <Sparkles className="w-6 h-6 text-emerald-300 animate-pulse" />
                </div>
              </div>
              <h4 className="font-orbitron font-bold text-xs text-white tracking-widest uppercase mb-1">Connecting AI Mirror</h4>
              <p className="text-[10px] text-emerald-400 font-mono tracking-wider animate-pulse mb-6">Loading face alignment engines...</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 5. Full-Screen Portrait Generation Loading Overlay ── */}
        <AnimatePresence>
          {camera.phase === 'ready' && aiState === 'ready' && faceCount === 1 && !avatarUrl && (
            <motion.div
              key="generation-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-30 p-6 text-center"
            >
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500/20 via-cyan-400/10 to-purple-500/20 blur-xl animate-pulse absolute inset-0" />
                <div className="w-20 h-20 rounded-full border border-emerald-400/30 flex items-center justify-center relative">
                  <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400 animate-spin" />
                  <Sparkles className="w-8 h-8 text-emerald-300 animate-pulse" />
                </div>
              </div>
              <h4 className="font-orbitron font-bold text-xs text-white tracking-widest uppercase mb-2">
                ✨ Creating your Studio Ghibli portrait...
              </h4>
              <p className="text-[10px] text-emerald-400 font-mono tracking-wider mb-6 animate-pulse">
                {generationStatus || 'Synthesizing neural features...'}
              </p>
              {/* Progress bar */}
              <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                  animate={{ width: `${generationProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-white/20 text-[9px] font-mono mt-3">{generationProgress}%</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 6. Idle Landscape Overlay (No Face Detected) ── */}
        <AnimatePresence>
          {camera.phase === 'ready' && aiState === 'ready' && faceCount === 0 && (
            <motion.div
              key="idle-scene"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 z-20 pointer-events-none"
            >
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(180deg, #12122b 0%, #1e1240 30%, #32194c 55%, #582960 75%, #7e4368 90%, #9e5d4d 100%)',
                }}
              />
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
                    Portrait rendering starts automatically
                  </p>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 7. Flash Overlay ── */}
        <AnimatePresence>
          {flash && (
            <motion.div
              key="flash-shutter"
              initial={{ opacity: 1 }} animate={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0 bg-white z-50 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* ── 8. Active HUD Overlays (Only when camera is ready & avatar is active) ── */}
        {camera.phase === 'ready' && avatarUrl && (
          <>
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-orbitron text-emerald-400 tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                LIVE
              </div>
              <div className="px-2 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-mono text-white/50">
                {fps} FPS
              </div>
            </div>

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
          </>
        )}

        {/* Hidden upload inputs */}
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

        {/* Action Toggle Bar */}
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

      {/* Camera switcher panel */}
      {showCameraPicker && camera.devices.length > 1 && (
        <div className="w-full bg-[#0b0b14] border border-white/5 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-[10px] font-orbitron text-gray-400 tracking-widest uppercase mb-1">Choose Camera Device</p>
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

      {/* Structured Terminal Console */}
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
