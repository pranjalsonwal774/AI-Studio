/**
 * CameraFeed.tsx — Ghibli Digital Mirror 2.0
 *
 * Initialization driven by useInitMachine — deterministic state machine
 * with per-stage timeouts, IDB model caching, and graceful fallback.
 *
 * Render loop — 60 FPS canvas transforms, zero ONNX per frame:
 *   1. Head rotation + translation (LERP)
 *   2. Blink eyelid overlay (EAR)
 *   3. Mouth open overlay (mouth ratio)
 *   4. Ambient Ghibli particle wisps
 */

import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import {
  Upload, Sparkles, Camera, RefreshCw,
  AlertCircle, Video, Terminal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInitMachine } from '../hooks/useInitMachine';
import { InitLoader, DiagnosticsPanel } from './InitLoader';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface CameraFeedProps {
  style: string;
  background: string;
  onCaptured: (photoId: string, originalUrl: string) => void;
  uploadManual: (file: File) => Promise<any>;
  avatarUrl: string | null;
  generationProgress: number;
  generationStatus: string;
  onFaceDetected: () => void;
  onReset: () => void;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number; alpha: number;
  color: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio — shutter click
// ─────────────────────────────────────────────────────────────────────────────
function playShutter() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++)
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.01));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    src.connect(g); g.connect(ctx.destination); src.start();
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Expression overlay helpers
// ─────────────────────────────────────────────────────────────────────────────
function drawClosedEyes(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  blend: number,
) {
  if (blend < 0.05) return;
  const { x, y, w, h } = box;
  const eyeY   = y + h * 0.36;
  const eyeH   = h * 0.07 * blend;
  const eyeW   = w * 0.18;
  const leftX  = x + w * 0.24;
  const rightX = x + w * 0.56;

  ctx.save();
  ctx.globalAlpha = Math.min(1, blend * 1.3);
  for (const ex of [leftX, rightX]) {
    ctx.fillStyle = '#deb990';
    ctx.beginPath();
    ctx.ellipse(ex + eyeW / 2, eyeY + eyeH / 2, eyeW / 2, Math.max(1, eyeH / 2), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a1a12';
    ctx.lineWidth = Math.max(1, w * 0.007);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex, eyeY + eyeH * 0.5);
    ctx.bezierCurveTo(ex + eyeW * 0.25, eyeY - eyeH * 0.2, ex + eyeW * 0.75, eyeY - eyeH * 0.2, ex + eyeW, eyeY + eyeH * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOpenMouth(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ratio: number,
) {
  if (ratio < 0.12) return;
  const { x, y, w, h } = box;
  const mx = x + w * 0.36;
  const my = y + h * 0.69;
  const mW = w * 0.28;
  const mH = h * 0.12 * Math.min(1, ratio * 1.4);
  ctx.save();
  ctx.fillStyle = '#c0614a';
  ctx.beginPath();
  ctx.ellipse(mx + mW / 2, my + mH / 2, mW / 2, mH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a1a12';
  ctx.lineWidth = Math.max(1, w * 0.005);
  ctx.stroke();
  if (ratio > 0.25) {
    ctx.fillStyle = 'rgba(255,248,235,0.85)';
    ctx.beginPath();
    ctx.ellipse(mx + mW / 2, my + mH * 0.28, mW * 0.38, mH * 0.3, 0, 0, Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Particle system
// ─────────────────────────────────────────────────────────────────────────────
const P_COLORS = [
  'rgba(110,231,183,0.45)', 'rgba(56,189,248,0.38)',
  'rgba(216,180,254,0.35)', 'rgba(251,191,36,0.30)',
];

function ensureParticles(p: Particle[], w: number, h: number) {
  if (p.length > 0) return;
  for (let i = 0; i < 22; i++) {
    p.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35, vy: -0.25 - Math.random() * 0.5,
      size: 1.5 + Math.random() * 3.5, alpha: 0.15 + Math.random() * 0.5,
      color: P_COLORS[Math.floor(Math.random() * P_COLORS.length)],
    });
  }
}

function tickParticles(p: Particle[], w: number, h: number) {
  for (const pt of p) {
    pt.x += pt.vx; pt.y += pt.vy;
    if (pt.y < 40) pt.alpha = Math.max(0, pt.alpha - 0.008);
    if (pt.y < 0 || pt.alpha <= 0) { pt.x = Math.random() * w; pt.y = h + 8; pt.alpha = 0.2 + Math.random() * 0.45; }
  }
}

function renderParticles(ctx: CanvasRenderingContext2D, p: Particle[], w: number, h: number) {
  ensureParticles(p, w, h);
  tickParticles(p, w, h);
  for (const pt of p) {
    ctx.save();
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fillStyle = pt.color; ctx.globalAlpha = pt.alpha;
    ctx.shadowBlur = 10; ctx.shadowColor = pt.color; ctx.fill();
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export const CameraFeed: React.FC<CameraFeedProps> = ({
  style, background,
  onCaptured, uploadManual,
  avatarUrl, generationProgress, generationStatus,
  onFaceDetected, onReset,
}) => {

  // ── DOM refs ──
  const videoRef         = useRef<HTMLVideoElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);

  // ── AI model ref (populated by init machine) ──
  const faceApiRef = useRef<any>(null);

  // ── Avatar image cache ──
  const avatarImageRef     = useRef<HTMLImageElement | null>(null);
  const avatarLoadedUrlRef = useRef<string | null>(null);

  // ── Face geometry lock ──
  const initialFaceBoxRef     = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const triggerCaptureOnceRef = useRef<boolean>(false);

  // ── Motion target refs (written by tracker, read by rAF) ──
  const tDxRef    = useRef(0);
  const tDyRef    = useRef(0);
  const tRollRef  = useRef(0);
  const tScaleRef = useRef(1);
  const tEARRef   = useRef(0.30);
  const tMouthRef = useRef(0);

  // ── Smoothed render refs (LERP'd in rAF) ──
  const rDxRef    = useRef(0);
  const rDyRef    = useRef(0);
  const rRollRef  = useRef(0);
  const rScaleRef = useRef(1);
  const rEARRef   = useRef(0.30);
  const rMouthRef = useRef(0);

  // ── Loop handles ──
  const rafRef            = useRef<number>(0);
  const detectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fpsTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const fpsCountRef       = useRef(0);

  // ── Particles ──
  const particlesRef = useRef<Particle[]>([]);

  // ── React state ──
  const [faceCount, setFaceCount]             = useState(0);
  const [fps, setFps]                         = useState(0);
  const [flash, setFlash]                     = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showCameraPicker, setShowCameraPicker] = useState(false);
  const [devices, setDevices]                 = useState<MediaDeviceInfo[]>([]);

  // ── Initialization state machine ──
  const init = useInitMachine(videoRef);

  // Machine stage derived flags
  const isBooting  = !['live_mirror', 'fallback', 'error'].includes(init.stage);
  const isLive     = init.stage === 'live_mirror' || init.stage === 'fallback';
  const isFallback = init.stage === 'fallback';
  const faceApiReady = init.stage === 'live_mirror';

  // ─────────────────────────────────────────────────────────────────────────
  // Grab face-api.js handle from window when machine reaches live_mirror
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (faceApiReady && (window as any).faceapi?.nets?.tinyFaceDetector?.isLoaded) {
      faceApiRef.current = (window as any).faceapi;
    }
  }, [faceApiReady]);

  // ─────────────────────────────────────────────────────────────────────────
  // Enumerate camera devices for switcher UI
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) return;
    navigator.mediaDevices.enumerateDevices()
      .then(ds => setDevices(ds.filter(d => d.kind === 'videoinput')))
      .catch(() => {});
  }, [isLive]);

  // ─────────────────────────────────────────────────────────────────────────
  // Load / cache avatar image
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!avatarUrl) { avatarImageRef.current = null; avatarLoadedUrlRef.current = null; return; }
    if (avatarUrl === avatarLoadedUrlRef.current) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { avatarImageRef.current = img; avatarLoadedUrlRef.current = avatarUrl; };
    img.onerror = () => console.error('[Avatar] Load failed:', avatarUrl);
    img.src = `http://localhost:8000${avatarUrl}`;
  }, [avatarUrl]);

  // ─────────────────────────────────────────────────────────────────────────
  // 60 FPS render loop
  // ─────────────────────────────────────────────────────────────────────────
  const startRenderLoop = useCallback(() => {
    const LM = 0.10; const LB = 0.40; const LO = 0.25; const LS = 0.10;

    const loop = () => {
      const video  = videoRef.current;
      const canvas = displayCanvasRef.current;
      if (!video || !canvas) { rafRef.current = requestAnimationFrame(loop); return; }

      const W = canvas.width  = video.videoWidth  || 640;
      const H = canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d')!;
      const avatar = avatarImageRef.current;

      if (avatar && initialFaceBoxRef.current) {
        // ── MIRROR MODE ──
        rDxRef.current    += (tDxRef.current    - rDxRef.current)    * LM;
        rDyRef.current    += (tDyRef.current    - rDyRef.current)    * LM;
        rRollRef.current  += (tRollRef.current  - rRollRef.current)  * LM;
        rScaleRef.current += (tScaleRef.current - rScaleRef.current) * LS;
        rEARRef.current   += (tEARRef.current   - rEARRef.current)   * LB;
        rMouthRef.current += (tMouthRef.current - rMouthRef.current) * LO;

        ctx.clearRect(0, 0, W, H);
        const pivX = W * 0.50;
        const pivY = H * 0.36;

        ctx.save();
        ctx.translate(pivX + rDxRef.current, pivY + rDyRef.current);
        ctx.rotate(rRollRef.current);
        ctx.scale(rScaleRef.current, rScaleRef.current);
        ctx.translate(-pivX, -pivY);
        ctx.drawImage(avatar, 0, 0, W, H);
        ctx.restore();

        const initBox = initialFaceBoxRef.current;
        const scaledBox = {
          x: initBox.x + rDxRef.current - (rScaleRef.current - 1) * pivX,
          y: initBox.y + rDyRef.current - (rScaleRef.current - 1) * pivY,
          w: initBox.w * rScaleRef.current,
          h: initBox.h * rScaleRef.current,
        };

        const blendBlink = Math.max(0, 1 - rEARRef.current / 0.22);
        if (blendBlink > 0.02) drawClosedEyes(ctx, scaledBox, blendBlink);
        if (rMouthRef.current > 0.10) drawOpenMouth(ctx, scaledBox, rMouthRef.current);
        renderParticles(ctx, particlesRef.current, W, H);
        fpsCountRef.current++;

      } else if (video.readyState >= 2) {
        // ── FALLBACK / AWAITING AVATAR — mirror-flipped camera ──
        const isMirrorMode = !isFallback;
        ctx.save();
        if (isMirrorMode) {
          // Show dim desaturated preview while avatar generates
          ctx.translate(W, 0); ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, W, H);
          ctx.restore();
          ctx.filter = 'grayscale(80%) brightness(0.30) blur(2px)';
          ctx.drawImage(canvas, 0, 0);
          ctx.filter = 'none';
        } else {
          // Fallback — show real camera clearly
          ctx.translate(W, 0); ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, W, H);
          ctx.restore();
        }
        fpsCountRef.current++;
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [isFallback]);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (isLive) startRenderLoop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [isLive, startRenderLoop]);

  // ─────────────────────────────────────────────────────────────────────────
  // Face tracking loop (120ms)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!faceApiReady || !faceApiRef.current) {
      setFaceCount(0);
      if (detectionTimerRef.current) clearInterval(detectionTimerRef.current);
      return;
    }

    const fa    = faceApiRef.current;
    const video = videoRef.current;
    if (!fa || !video) return;

    detectionTimerRef.current = setInterval(async () => {
      if (video.paused || video.readyState < 2) return;
      try {
        const opts = new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.42 });
        const dets = await fa.detectAllFaces(video, opts).withFaceLandmarks(true);
        const count = dets.length;
        setFaceCount(count);

        if (count === 0) {
          triggerCaptureOnceRef.current = false;
          initialFaceBoxRef.current     = null;
          tDxRef.current = 0; tDyRef.current = 0;
          tRollRef.current = 0; tScaleRef.current = 1;
          tEARRef.current = 0.30; tMouthRef.current = 0;
          onReset();
          return;
        }

        if (count !== 1) return;

        onFaceDetected();
        const det = dets[0];
        const box = det.detection.box;
        const lm  = det.landmarks.positions;

        if (!initialFaceBoxRef.current) {
          initialFaceBoxRef.current = { x: box.x, y: box.y, w: box.width, h: box.height };
        }

        if (!triggerCaptureOnceRef.current) {
          triggerCaptureOnceRef.current = true;
          silentlyCaptureAndSubmit();
        }

        // Pose deltas
        const initBox = initialFaceBoxRef.current;
        const curCx = box.x + box.width  / 2;
        const curCy = box.y + box.height / 2;
        const iniCx = initBox.x + initBox.w / 2;
        const iniCy = initBox.y + initBox.h / 2;
        tDxRef.current = (iniCx - curCx) * 1.6;
        tDyRef.current = (curCy - iniCy) * 1.6;

        const le = lm[36]; const re = lm[45];
        tRollRef.current = -Math.atan2(re.y - le.y, re.x - le.x);

        const curEyeD = Math.hypot(re.x - le.x, re.y - le.y);
        const iniEyeD = initBox.w * 0.46;
        tScaleRef.current = iniEyeD > 0 ? Math.max(0.7, Math.min(1.4, curEyeD / iniEyeD)) : 1;

        const eH = Math.abs((lm[37].y + lm[38].y) / 2 - (lm[41].y + lm[40].y) / 2);
        const eW = Math.abs(lm[39].x - lm[36].x);
        tEARRef.current = eW > 0 ? Math.max(0, Math.min(0.5, eH / eW)) : 0.3;

        const mH = Math.abs(lm[62].y - lm[66].y);
        const mW = Math.abs(lm[54].x - lm[48].x);
        tMouthRef.current = mW > 0 ? Math.max(0, Math.min(1, (mH / mW) * 1.8)) : 0;

      } catch (_) { /* ignore per-frame errors */ }
    }, 120);

    return () => { if (detectionTimerRef.current) clearInterval(detectionTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceApiReady, onFaceDetected, onReset]);

  // ─────────────────────────────────────────────────────────────────────────
  // FPS counter
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    fpsTimerRef.current = setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);
    return () => { if (fpsTimerRef.current) clearInterval(fpsTimerRef.current); };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Silent capture — one frame → backend Ghibli generation
  // ─────────────────────────────────────────────────────────────────────────
  const silentlyCaptureAndSubmit = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    playShutter();
    setFlash(true);
    setTimeout(() => setFlash(false), 320);

    try {
      const W = video.videoWidth  || 1280;
      const H = video.videoHeight || 720;
      const cap = document.createElement('canvas');
      cap.width = W; cap.height = H;
      const cc = cap.getContext('2d')!;
      cc.save(); cc.translate(W, 0); cc.scale(-1, 1);
      cc.drawImage(video, 0, 0, W, H);
      cc.restore();
      const blob: Blob | null = await new Promise(r => cap.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) return;
      const file  = new File([blob], 'mirror_capture.jpg', { type: 'image/jpeg' });
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      console.error('[Mirror] Capture failed:', err.message);
    }
  }, [uploadManual, onCaptured]);

  const handleFileUpload = useCallback(async (file: File) => {
    try {
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    }
  }, [uploadManual, onCaptured]);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived flags
  // ─────────────────────────────────────────────────────────────────────────
  const isGenerating = isLive && faceCount === 1 && !avatarUrl && !isFallback;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 w-full">

      {/* ── Viewport ── */}
      <div
        className="relative w-full rounded-2xl overflow-hidden bg-[#05050a] border border-white/5 shadow-2xl"
        style={{ aspectRatio: '16/9', minHeight: 320 }}
      >
        {/* Hidden video source */}
        <video
          ref={videoRef} autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none z-0"
        />

        {/* AI canvas — only visible output */}
        <canvas
          ref={displayCanvasRef}
          className="absolute inset-0 w-full h-full object-cover z-10"
        />

        {/* ── Init loading overlay ── */}
        <AnimatePresence>
          {isBooting && (
            <InitLoader
              stage={init.stage}
              subsystems={init.subsystems}
              progress={init.progress}
              stageLabel={init.stageLabel}
              errorMessage={init.errorMessage}
              logs={init.logs}
              onRetry={init.retry}
              onFallback={init.enterFallback}
              showDiagnostics={showDiagnostics}
              onToggleDiagnostics={() => setShowDiagnostics(d => !d)}
            />
          )}
        </AnimatePresence>

        {/* ── Diagnostics HUD (live) ── */}
        {isLive && showDiagnostics && (
          <DiagnosticsPanel
            stage={init.stage}
            subsystems={init.subsystems}
            fps={fps}
            faceCount={faceCount}
            logs={init.logs}
          />
        )}

        {/* ── Fallback banner ── */}
        <AnimatePresence>
          {isFallback && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute top-0 inset-x-0 z-30 bg-amber-500/90 backdrop-blur-sm px-3 py-1.5 flex items-center justify-center gap-2"
            >
              <AlertCircle className="w-3 h-3 text-amber-900" />
              <span className="font-orbitron text-[9px] text-amber-900 tracking-widest">
                AI MODELS UNAVAILABLE — SHOWING LIVE CAMERA (avatar will generate when ready)
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Portrait generation progress ── */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              key="gen-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.8 } }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a]/75 backdrop-blur-md z-25 p-6 text-center"
            >
              <div className="relative mb-6 w-20 h-20">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-500/30 via-cyan-400/15 to-purple-500/25 blur-xl animate-pulse" />
                <div className="absolute inset-0 rounded-full border border-emerald-400/25" />
                <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400 animate-spin" />
                <div className="absolute inset-[6px] rounded-full border-t border-purple-400/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '3s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-emerald-300 animate-pulse" />
                </div>
              </div>
              <h4 className="font-orbitron font-bold text-xs text-white tracking-widest mb-1.5">
                ✨ Creating Ghibli Portrait
              </h4>
              <p className="text-[9px] text-emerald-400/80 font-mono tracking-wider mb-4 animate-pulse max-w-xs">
                {generationStatus || 'Painting your portrait...'}
              </p>
              <div className="w-44 h-[3px] bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 rounded-full"
                  animate={{ width: `${Math.max(5, generationProgress)}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
              <p className="text-white/20 text-[8px] font-mono mt-1.5">{generationProgress}%</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Idle Ghibli night scene (camera live but no face) ── */}
        <AnimatePresence>
          {isLive && faceCount === 0 && !avatarUrl && !isFallback && (
            <motion.div
              key="idle-scene"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.7 }}
              className="absolute inset-0 z-20 pointer-events-none"
            >
              <div className="absolute inset-0" style={{
                background: 'linear-gradient(180deg,#0d0d20 0%,#1a0e36 25%,#2e1550 50%,#5a2860 72%,#86405e 88%,#a05a4a 100%)'
              }} />
              {[...Array(28)].map((_, i) => (
                <div key={i} className="absolute rounded-full bg-white animate-pulse" style={{
                  width: Math.random() * 1.8 + 0.6, height: Math.random() * 1.8 + 0.6,
                  top: `${Math.random() * 56}%`, left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 3}s`,
                  animationDuration: `${1.5 + Math.random() * 2}s`,
                  opacity: Math.random() * 0.6 + 0.35,
                }} />
              ))}
              <div className="absolute rounded-full" style={{
                width: 50, height: 50, top: '10%', right: '14%',
                background: 'radial-gradient(circle at 38% 38%, #fffbf0, #e8cc8a)',
                boxShadow: '0 0 28px 10px rgba(232,204,138,0.18)',
              }} />
              <svg className="absolute bottom-0 w-full" viewBox="0 0 800 200" preserveAspectRatio="none">
                <path d="M0,175 C100,120 210,160 310,140 C410,122 510,172 610,148 C710,122 755,158 800,142 L800,200 L0,200Z" fill="#1e3a0a" />
                <path d="M0,192 C80,158 185,188 285,168 C385,148 485,190 585,172 C685,155 742,180 800,165 L800,200 L0,200Z" fill="#12250a" />
              </svg>
              {[...Array(5)].map((_, i) => (
                <motion.div key={i}
                  className="absolute rounded-full bg-white/15 blur-[4px]"
                  style={{ width: 10 + i * 3, height: 10 + i * 3, bottom: `${12 + i * 7}%`, left: `${12 + i * 20}%` }}
                  animate={{ y: [-6, 6, -6] }}
                  transition={{ duration: 3.5 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.35 }}
                />
              ))}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.div
                  animate={{ y: [-3, 3, -3] }}
                  transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-center"
                >
                  <p className="font-orbitron text-white text-xs md:text-sm tracking-widest drop-shadow mb-1">
                    ✨ STEP IN FRONT OF THE CAMERA
                  </p>
                  <p className="text-white/35 text-[10px] tracking-wide">
                    Your Ghibli portrait will be created instantly
                  </p>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Capture flash ── */}
        <AnimatePresence>
          {flash && (
            <motion.div
              key="flash"
              initial={{ opacity: 0.85 }} animate={{ opacity: 0 }}
              transition={{ duration: 0.32 }}
              className="absolute inset-0 bg-white z-50 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* ── Live HUD ── */}
        {isLive && avatarUrl && (
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
          </>
        )}

        {/* ── Bottom actions ── */}
        {isLive && (
          <div className="absolute bottom-3 right-3 z-20 flex gap-2">
            <button
              onClick={() => setShowDiagnostics(d => !d)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 hover:text-white transition-colors"
            >
              <Terminal className="w-2.5 h-2.5" /> DIAG
            </button>
            {devices.length > 1 && (
              <button onClick={() => setShowCameraPicker(p => !p)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 hover:text-white transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" /> CAMERAS
              </button>
            )}
            <button onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 hover:text-white transition-colors"
            >
              <Upload className="w-2.5 h-2.5" /> UPLOAD
            </button>
          </div>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
      </div>

      {/* ── Camera switcher ── */}
      {showCameraPicker && devices.length > 1 && (
        <div className="w-full bg-[#0b0b14] border border-white/5 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-[10px] font-orbitron text-gray-400 tracking-widest uppercase mb-1">Choose Camera</p>
          {devices.map(d => (
            <button key={d.deviceId}
              onClick={() => { init.retry(); setShowCameraPicker(false); }}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-sans bg-white/5 border border-transparent text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CameraFeed;
