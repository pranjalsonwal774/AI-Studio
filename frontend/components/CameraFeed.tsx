/**
 * CameraFeed.tsx — Ghibli Digital Mirror 2.0
 *
 * Pipeline:
 *   Hidden webcam → face-api.js landmark tracker (120ms) → motion refs
 *   requestAnimationFrame (60 FPS) reads refs, LERP's them, applies:
 *     1. Head rotation + translation transform on locked Ghibli portrait
 *     2. Eyelid close overlay (EAR blink detection)
 *     3. Mouth open overlay (mouth-opening ratio)
 *     4. Eyebrow raise/furrow (subtle region translate)
 *     5. Ambient Ghibli particle wisps
 *
 *  NO ONNX inference runs in the render loop.
 *  The Ghibli portrait is generated ONCE and locked for identity permanence.
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  Upload, Sparkles, Camera, RefreshCw,
  AlertCircle, Video, Terminal,
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
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.010));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    src.connect(g); g.connect(ctx.destination); src.start();
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// CDN loader — face-api.js only (no ONNX in render loop)
// ─────────────────────────────────────────────────────────────────────────────
async function loadFaceApi(): Promise<any> {
  if ((window as any).faceapi?.nets?.tinyFaceDetector?.isLoaded)
    return (window as any).faceapi;

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
// Expression overlay helpers — draw directly on the Ghibli canvas
// ─────────────────────────────────────────────────────────────────────────────

/** Draw closed eyelid arcs over the face bounding box. blend: 0=open 1=shut */
function drawClosedEyes(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  blend: number,
) {
  if (blend < 0.05) return;
  const { x, y, w, h } = box;

  // Approximate eye positions from face bounding box geometry
  const eyeY   = y + h * 0.36;
  const eyeH   = h * 0.07 * blend;
  const eyeW   = w * 0.18;
  const leftX  = x + w * 0.24;
  const rightX = x + w * 0.56;

  ctx.save();
  ctx.globalAlpha = Math.min(1, blend * 1.3);

  for (const ex of [leftX, rightX]) {
    // Skin fill
    ctx.fillStyle = '#deb990';
    ctx.beginPath();
    ctx.ellipse(ex + eyeW / 2, eyeY + eyeH / 2, eyeW / 2, Math.max(1, eyeH / 2), 0, 0, Math.PI * 2);
    ctx.fill();

    // Upper lash line (bezier arc)
    ctx.strokeStyle = '#2a1a12';
    ctx.lineWidth = Math.max(1, w * 0.007);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex, eyeY + eyeH * 0.5);
    ctx.bezierCurveTo(
      ex + eyeW * 0.25, eyeY - eyeH * 0.2,
      ex + eyeW * 0.75, eyeY - eyeH * 0.2,
      ex + eyeW,        eyeY + eyeH * 0.5,
    );
    ctx.stroke();
  }

  ctx.restore();
}

/** Draw an open-mouth ellipse scaled by the mouth ratio */
function drawOpenMouth(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ratio: number,
) {
  if (ratio < 0.12) return;
  const { x, y, w, h } = box;

  const mx   = x + w * 0.36;
  const my   = y + h * 0.69;
  const mW   = w * 0.28;
  const mH   = h * 0.12 * Math.min(1, ratio * 1.4);

  ctx.save();

  // Lip fill
  ctx.fillStyle = '#c0614a';
  ctx.beginPath();
  ctx.ellipse(mx + mW / 2, my + mH / 2, mW / 2, mH / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.strokeStyle = '#2a1a12';
  ctx.lineWidth = Math.max(1, w * 0.005);
  ctx.stroke();

  // Teeth hint (top half, white)
  if (ratio > 0.25) {
    ctx.fillStyle = 'rgba(255,248,235,0.85)';
    ctx.beginPath();
    ctx.ellipse(mx + mW / 2, my + mH * 0.28, mW * 0.38, mH * 0.3, 0, 0, Math.PI);
    ctx.fill();
  }

  ctx.restore();
}

/** Draw raised/lowered eyebrow region by sampling from avatar */
function drawEyebrows(
  ctx: CanvasRenderingContext2D,
  avatar: HTMLImageElement,
  box: { x: number; y: number; w: number; h: number },
  lift: number, // negative = raised, positive = lowered
  imgW: number,
  imgH: number,
) {
  if (Math.abs(lift) < 0.005) return;
  const { x, y, w, h } = box;

  const browY  = y + h * 0.18;
  const browH  = h * 0.12;
  const browX  = x + w * 0.10;
  const browW  = w * 0.80;
  const shift  = lift * h * 4; // pixel shift

  ctx.save();
  // Erase original brow region then redraw shifted
  ctx.clearRect(browX, browY, browW, browH + Math.abs(shift) + 2);
  // Re-draw background patch (full portrait)
  ctx.drawImage(avatar, 0, 0, imgW, imgH);
  // Sample brow from portrait and shift it
  ctx.drawImage(
    avatar,
    browX, browY, browW, browH,
    browX, browY + shift, browW, browH,
  );
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghibli particle system
// ─────────────────────────────────────────────────────────────────────────────
const PARTICLE_COLORS = [
  'rgba(110,231,183,0.45)',
  'rgba(56,189,248,0.38)',
  'rgba(216,180,254,0.35)',
  'rgba(251,191,36,0.30)',
];

function initParticles(particles: Particle[], w: number, h: number) {
  if (particles.length > 0) return;
  for (let i = 0; i < 22; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -0.25 - Math.random() * 0.5,
      size: 1.5 + Math.random() * 3.5,
      alpha: 0.15 + Math.random() * 0.5,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    });
  }
}

function stepParticles(particles: Particle[], w: number, h: number) {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.y < 40) p.alpha = Math.max(0, p.alpha - 0.008);
    if (p.y < 0 || p.alpha <= 0) {
      p.x = Math.random() * w; p.y = h + 8;
      p.alpha = 0.2 + Math.random() * 0.45;
    }
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], w: number, h: number) {
  initParticles(particles, w, h);
  stepParticles(particles, w, h);
  for (const p of particles) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.alpha;
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.color;
    ctx.fill();
    ctx.restore();
  }
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
  onReset,
}) => {

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const videoRef         = useRef<HTMLVideoElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);

  // ── AI / avatar refs ──────────────────────────────────────────────────────
  const faceApiRef          = useRef<any>(null);
  const avatarImageRef      = useRef<HTMLImageElement | null>(null);
  const avatarLoadedUrlRef  = useRef<string | null>(null);

  // ── Face geometry lock ────────────────────────────────────────────────────
  const initialFaceBoxRef     = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const triggerCaptureOnceRef = useRef<boolean>(false);

  // ── RAW TARGETS — written by face tracker (120 ms), read by rAF ───────────
  // Head pose
  const tDxRef    = useRef(0);   // translation X
  const tDyRef    = useRef(0);   // translation Y
  const tRollRef  = useRef(0);   // tilt angle (rad)
  const tScaleRef = useRef(1);   // zoom scale
  // Expressions
  const tEARRef   = useRef(0.30); // eye aspect ratio (0=closed, 0.30=normal)
  const tMouthRef = useRef(0);    // mouth openness ratio
  const tBrowRef  = useRef(0);    // brow lift (negative=raised)

  // ── SMOOTHED RENDER VALUES — LERP'd each rAF tick ─────────────────────────
  const rDxRef    = useRef(0);
  const rDyRef    = useRef(0);
  const rRollRef  = useRef(0);
  const rScaleRef = useRef(1);
  const rEARRef   = useRef(0.30);
  const rMouthRef = useRef(0);

  // ── rAF + timer handles ───────────────────────────────────────────────────
  const rafRef           = useRef<number>(0);
  const detectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fpsTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const fpsCountRef       = useRef(0);

  // ── Particles ────────────────────────────────────────────────────────────
  const particlesRef = useRef<Particle[]>([]);

  // ── React state ───────────────────────────────────────────────────────────
  const [aiState, setAiState]               = useState<'idle' | 'loading' | 'ready'>('idle');
  const [faceCount, setFaceCount]           = useState(0);
  const [fps, setFps]                       = useState(0);
  const [flash, setFlash]                   = useState(false);
  const [showConsole, setShowConsole]       = useState(false);
  const [showCameraPicker, setShowCameraPicker] = useState(false);

  // ── Camera manager (permission, retry, health, device) ───────────────────
  const camera = useCameraManager(videoRef);

  // ─────────────────────────────────────────────────────────────────────────
  // Load face-api.js AFTER camera is confirmed ready
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (camera.phase !== 'ready') {
      setAiState('idle');
      return;
    }
    setAiState('loading');
    loadFaceApi()
      .then(fa => { faceApiRef.current = fa; setAiState('ready'); })
      .catch(err => { console.error('[FaceAPI] Load failed:', err); });
  }, [camera.phase]);

  // ─────────────────────────────────────────────────────────────────────────
  // Load / cache Ghibli avatar image when URL changes
  // ─────────────────────────────────────────────────────────────────────────
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
    img.onerror = () => console.error('[Avatar] Failed to load:', avatarUrl);
    img.src = `http://localhost:8000${avatarUrl}`;
  }, [avatarUrl]);

  // ─────────────────────────────────────────────────────────────────────────
  // 60 FPS render loop — NO ONNX, just canvas transforms
  // ─────────────────────────────────────────────────────────────────────────
  const startMirrorLoop = useCallback(() => {
    // LERP constants
    const LM = 0.10; // head motion  — smooth & lag-free
    const LB = 0.40; // blink        — fast (feels natural)
    const LO = 0.25; // mouth open   — medium
    const LS = 0.10; // scale change — slow (avoids zoom jitter)

    const loop = () => {
      const video  = videoRef.current;
      const canvas = displayCanvasRef.current;
      if (!video || !canvas || video.paused || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const W = canvas.width  = video.videoWidth  || 640;
      const H = canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d')!;
      const avatar = avatarImageRef.current;

      // ── MIRROR MODE ───────────────────────────────────────────────────────
      if (avatar && initialFaceBoxRef.current) {

        // Advance LERP
        rDxRef.current    += (tDxRef.current    - rDxRef.current)    * LM;
        rDyRef.current    += (tDyRef.current    - rDyRef.current)    * LM;
        rRollRef.current  += (tRollRef.current  - rRollRef.current)  * LM;
        rScaleRef.current += (tScaleRef.current - rScaleRef.current) * LS;
        rEARRef.current   += (tEARRef.current   - rEARRef.current)   * LB;
        rMouthRef.current += (tMouthRef.current - rMouthRef.current) * LO;

        // HEAD LAYER — entire portrait moves with user's head
        ctx.clearRect(0, 0, W, H);
        const pivX = W * 0.50;
        const pivY = H * 0.36; // pivot near face centre

        ctx.save();
        ctx.translate(pivX + rDxRef.current, pivY + rDyRef.current);
        ctx.rotate(rRollRef.current);
        ctx.scale(rScaleRef.current, rScaleRef.current);
        ctx.translate(-pivX, -pivY);
        ctx.drawImage(avatar, 0, 0, W, H);
        ctx.restore();

        // EXPRESSION LAYERS — drawn at the transformed face box position
        const initBox = initialFaceBoxRef.current;
        const scaledBox = {
          x: initBox.x + rDxRef.current - (rScaleRef.current - 1) * pivX,
          y: initBox.y + rDyRef.current - (rScaleRef.current - 1) * pivY,
          w: initBox.w * rScaleRef.current,
          h: initBox.h * rScaleRef.current,
        };

        // Blink overlay (EAR < 0.22 = eyes shutting)
        const blendBlink = Math.max(0, 1 - rEARRef.current / 0.22);
        if (blendBlink > 0.02) {
          drawClosedEyes(ctx, scaledBox, blendBlink);
        }

        // Mouth open overlay
        if (rMouthRef.current > 0.10) {
          drawOpenMouth(ctx, scaledBox, rMouthRef.current);
        }

        // Ambient Ghibli particles
        drawParticles(ctx, particlesRef.current, W, H);

        fpsCountRef.current++;
      }

      // ── IDLE / AWAITING AVATAR — dim desaturated camera hint ─────────────
      else {
        const tmp = document.createElement('canvas');
        tmp.width = W; tmp.height = H;
        const tc = tmp.getContext('2d')!;
        tc.save(); tc.translate(W, 0); tc.scale(-1, 1);
        tc.drawImage(video, 0, 0, W, H);
        tc.restore();

        ctx.filter = 'grayscale(85%) brightness(0.30) blur(3px)';
        ctx.drawImage(tmp, 0, 0);
        ctx.filter = 'none';
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []); // All live data via refs — no stale-closure risk

  // Start / restart loop when camera phase changes
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (camera.phase === 'ready') startMirrorLoop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [camera.phase, startMirrorLoop]);

  // ─────────────────────────────────────────────────────────────────────────
  // Face landmark tracking — 120 ms polling
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (camera.phase !== 'ready' || aiState !== 'ready') {
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
          // User left — full reset
          triggerCaptureOnceRef.current = false;
          initialFaceBoxRef.current     = null;
          tDxRef.current    = 0;  tDyRef.current    = 0;
          tRollRef.current  = 0;  tScaleRef.current = 1;
          tEARRef.current   = 0.30; tMouthRef.current = 0;
          onReset();
          return;
        }

        if (count !== 1) return; // multi-person — skip frame

        onFaceDetected();
        const det = dets[0];
        const box = det.detection.box;
        const lm  = det.landmarks.positions;

        // ── Lock initial face geometry once ──
        if (!initialFaceBoxRef.current) {
          initialFaceBoxRef.current = {
            x: box.x, y: box.y, w: box.width, h: box.height,
          };
        }

        // ── Trigger single silent capture for backend generation ──
        if (!triggerCaptureOnceRef.current) {
          triggerCaptureOnceRef.current = true;
          silentlyCaptureAndSubmit();
        }

        // ── Compute pose deltas relative to locked geometry ──
        const initBox = initialFaceBoxRef.current;

        // Translation
        const curCx = box.x + box.width  / 2;
        const curCy = box.y + box.height / 2;
        const iniCx = initBox.x + initBox.w / 2;
        const iniCy = initBox.y + initBox.h / 2;
        tDxRef.current = (iniCx - curCx) * 1.6;
        tDyRef.current = (curCy - iniCy) * 1.6;

        // Roll (tilt)
        const le = lm[36]; const re = lm[45];
        tRollRef.current = -Math.atan2(re.y - le.y, re.x - le.x);

        // Scale (distance-based zoom)
        const curEyeD = Math.hypot(re.x - le.x, re.y - le.y);
        const iniEyeD = initBox.w * 0.46; // empirical: eyes span ~46% of face width
        tScaleRef.current = iniEyeD > 0 ? Math.max(0.7, Math.min(1.4, curEyeD / iniEyeD)) : 1;

        // Eye Aspect Ratio — blink detection
        const eH = Math.abs((lm[37].y + lm[38].y) / 2 - (lm[41].y + lm[40].y) / 2);
        const eW = Math.abs(lm[39].x - lm[36].x);
        tEARRef.current = eW > 0 ? Math.max(0, Math.min(0.5, eH / eW)) : 0.3;

        // Mouth openness
        const mH = Math.abs(lm[62].y - lm[66].y);
        const mW = Math.abs(lm[54].x - lm[48].x);
        tMouthRef.current = mW > 0 ? Math.max(0, Math.min(1, (mH / mW) * 1.8)) : 0;

      } catch (_) { /* ignore detection frame errors */ }
    }, 120);

    return () => {
      if (detectionTimerRef.current) clearInterval(detectionTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.phase, aiState, onFaceDetected, onReset]);

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
  // Silent capture — grabs one frame, uploads to backend for Ghibli generation
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
      // Mirror the frame (front camera flip)
      cc.save(); cc.translate(W, 0); cc.scale(-1, 1);
      cc.drawImage(video, 0, 0, W, H);
      cc.restore();

      const blob: Blob | null = await new Promise(r => cap.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) return;
      const file  = new File([blob], 'mirror_capture.jpg', { type: 'image/jpeg' });
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      console.error('[Mirror] Silent capture failed:', err.message);
    }
  }, [uploadManual, onCaptured]);

  // ─────────────────────────────────────────────────────────────────────────
  // Manual file upload fallback
  // ─────────────────────────────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (file: File) => {
    try {
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    }
  }, [uploadManual, onCaptured]);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived UI flags
  // ─────────────────────────────────────────────────────────────────────────
  const isCameraBusy  = ['checking', 'requesting', 'initializing'].includes(camera.phase);
  const isCameraError = [
    'permission_denied', 'not_found', 'in_use',
    'disconnected', 'https_required', 'error',
  ].includes(camera.phase);

  const currentDevice = useMemo(
    () => camera.devices.find(d => d.deviceId === camera.activeDeviceId),
    [camera.devices, camera.activeDeviceId],
  );

  const isGenerating = camera.phase === 'ready' && aiState === 'ready'
    && faceCount === 1 && !avatarUrl;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Phase probe for devicechange handler */}
      <div id="camera-phase-probe" className="hidden" data-phase={camera.phase} />

      {/* ── Viewport ── */}
      <div
        className="relative w-full rounded-2xl overflow-hidden bg-[#05050a] border border-white/5 shadow-2xl"
        style={{ aspectRatio: '16/9', minHeight: 320 }}
      >
        {/* Hidden video source */}
        <video
          ref={videoRef}
          autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none z-0"
        />

        {/* Live AI canvas — the only visible output */}
        <canvas
          ref={displayCanvasRef}
          className="absolute inset-0 w-full h-full object-cover z-10"
        />

        {/* ── Camera connecting (boot) ── */}
        <AnimatePresence>
          {isCameraBusy && (
            <motion.div
              key="cam-boot"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-40 p-6"
            >
              <div className="relative mb-6 w-16 h-16">
                <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-emerald-400" />
                </div>
              </div>
              <h3 className="font-orbitron text-xs tracking-widest text-white uppercase mb-3">
                Connecting Camera
              </h3>
              <div className="w-32 h-[2px] bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 animate-pulse" style={{ width: '65%' }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Camera reconnecting ── */}
        <AnimatePresence>
          {camera.phase === 'reconnecting' && (
            <motion.div
              key="cam-reconnect"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a]/92 backdrop-blur-sm z-40 p-6 text-center"
            >
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mb-4" />
              <h4 className="font-orbitron text-xs text-cyan-300 tracking-widest uppercase mb-1">RECONNECTING CAMERA</h4>
              <p className="text-[10px] font-mono text-gray-400 mb-1">Attempt {camera.retryAttempt} of {camera.maxRetries}</p>
              <p className="text-[9px] font-mono text-gray-600">Next attempt in {camera.nextRetryIn}s</p>
              <button onClick={camera.retryNow}
                className="mt-5 font-orbitron text-[9px] tracking-widest border border-cyan-500/40 hover:border-cyan-400 px-4 py-2 rounded-lg text-cyan-400 hover:bg-cyan-500/10 transition-colors"
              >
                RECONNECT NOW
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Camera error ── */}
        <AnimatePresence>
          {isCameraError && (
            <motion.div
              key="cam-error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-40 p-8 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>

              {camera.phase === 'permission_denied' ? (
                <>
                  <h3 className="font-orbitron text-xs text-white tracking-widest uppercase mb-2">Allow Camera Access</h3>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed mb-6">
                    This mirror requires camera access. Click Enable Camera to try again.
                  </p>
                  <button onClick={camera.retryNow}
                    className="font-orbitron text-xs tracking-widest bg-emerald-500 hover:bg-emerald-400 px-6 py-3 rounded-xl text-white font-bold transition-all shadow-[0_4px_16px_rgba(16,185,129,0.25)]"
                  >
                    ENABLE CAMERA
                  </button>
                </>
              ) : camera.phase === 'https_required' ? (
                <>
                  <h3 className="font-orbitron text-xs text-red-400 tracking-widest uppercase mb-2">HTTPS Required</h3>
                  <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
                    Camera access requires a secure HTTPS connection.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="font-orbitron text-xs text-white tracking-widest uppercase mb-2">
                    {camera.phase === 'disconnected' ? 'CAMERA DISCONNECTED' : 'CAMERA OFFLINE'}
                  </h3>
                  <p className="text-xs text-gray-400 max-w-sm leading-relaxed mb-5">{camera.errorMessage}</p>
                  <div className="flex gap-3">
                    <button onClick={camera.retryNow}
                      className="font-orbitron text-xs tracking-widest border border-white/15 hover:border-white/40 px-5 py-2.5 rounded-lg text-white hover:bg-white/5 transition-colors"
                    >RETRY</button>
                    <button onClick={() => fileInputRef.current?.click()}
                      className="font-orbitron text-xs tracking-widest border border-emerald-500/40 hover:border-emerald-400 px-5 py-2.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                    >UPLOAD PHOTO</button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── AI tracker initializing ── */}
        <AnimatePresence>
          {camera.phase === 'ready' && aiState === 'loading' && (
            <motion.div
              key="ai-load"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a]/80 backdrop-blur-md z-30 p-6 text-center"
            >
              <div className="relative mb-5 w-14 h-14">
                <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-emerald-300 animate-pulse" />
                </div>
              </div>
              <h4 className="font-orbitron text-xs text-white tracking-widest uppercase mb-1">Starting AI Mirror</h4>
              <p className="text-[10px] text-emerald-400 font-mono tracking-wider animate-pulse">
                Loading face tracking engine...
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Portrait generation — ONLY loading allowed ── */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              key="gen-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.8 } }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-30 p-6 text-center"
            >
              {/* Animated orb */}
              <div className="relative mb-8 w-24 h-24">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-500/30 via-cyan-400/15 to-purple-500/25 blur-xl animate-pulse" />
                <div className="absolute inset-0 rounded-full border border-emerald-400/25" />
                <div className="absolute inset-0 rounded-full border-t-2 border-emerald-400 animate-spin" />
                <div className="absolute inset-[6px] rounded-full border-t border-purple-400/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '3s' }} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-emerald-300 animate-pulse" />
                </div>
              </div>

              <h4 className="font-orbitron font-bold text-sm text-white tracking-widest mb-2">
                ✨ Creating your Ghibli portrait
              </h4>
              <p className="text-[10px] text-emerald-400/80 font-mono tracking-wider mb-6 animate-pulse max-w-xs">
                {generationStatus || 'Analyzing your features and painting your portrait...'}
              </p>

              {/* Progress bar */}
              <div className="w-52 h-[3px] bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 rounded-full"
                  animate={{ width: `${Math.max(5, generationProgress)}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
              <p className="text-white/20 text-[9px] font-mono mt-2">{generationProgress}%</p>
              <p className="text-white/20 text-[8px] font-sans mt-4 max-w-xs leading-relaxed">
                Your portrait is being generated once and locked permanently.
                <br />You will never see the raw camera feed.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Idle Ghibli painted scene (no face) ── */}
        <AnimatePresence>
          {camera.phase === 'ready' && aiState === 'ready' && faceCount === 0 && !avatarUrl && (
            <motion.div
              key="idle-scene"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.7 }}
              className="absolute inset-0 z-20 pointer-events-none"
            >
              {/* Gradient sky */}
              <div className="absolute inset-0" style={{
                background: 'linear-gradient(180deg,#0d0d20 0%,#1a0e36 25%,#2e1550 50%,#5a2860 72%,#86405e 88%,#a05a4a 100%)'
              }} />

              {/* Stars */}
              {[...Array(30)].map((_, i) => (
                <div key={i} className="absolute rounded-full bg-white animate-pulse" style={{
                  width: Math.random() * 1.8 + 0.6, height: Math.random() * 1.8 + 0.6,
                  top: `${Math.random() * 58}%`, left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 3}s`,
                  animationDuration: `${1.5 + Math.random() * 2}s`,
                  opacity: Math.random() * 0.6 + 0.35,
                }} />
              ))}

              {/* Moon */}
              <div className="absolute rounded-full" style={{
                width: 52, height: 52, top: '10%', right: '14%',
                background: 'radial-gradient(circle at 38% 38%, #fffbf0, #e8cc8a)',
                boxShadow: '0 0 28px 10px rgba(232,204,138,0.20)',
              }} />

              {/* Hills */}
              <svg className="absolute bottom-0 w-full" viewBox="0 0 800 200" preserveAspectRatio="none">
                <path d="M0,175 C100,120 210,160 310,140 C410,122 510,172 610,148 C710,122 755,158 800,142 L800,200 L0,200Z" fill="#1e3a0a" />
                <path d="M0,192 C80,158 185,188 285,168 C385,148 485,190 585,172 C685,155 742,180 800,165 L800,200 L0,200Z" fill="#12250a" />
              </svg>

              {/* Floating wisps */}
              {[...Array(5)].map((_, i) => (
                <motion.div key={i}
                  className="absolute rounded-full bg-white/15 blur-[4px]"
                  style={{ width: 10 + i * 3, height: 10 + i * 3, bottom: `${12 + i * 7}%`, left: `${12 + i * 20}%` }}
                  animate={{ y: [-6, 6, -6] }}
                  transition={{ duration: 3.5 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.35 }}
                />
              ))}

              {/* Prompt */}
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
              initial={{ opacity: 0.9 }} animate={{ opacity: 0 }}
              transition={{ duration: 0.32 }}
              className="absolute inset-0 bg-white z-50 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* ── HUD — only when avatar is live ── */}
        {camera.phase === 'ready' && avatarUrl && (
          <>
            {/* LIVE badge + FPS */}
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-orbitron text-emerald-400 tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                LIVE
              </div>
              <div className="px-2 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-mono text-white/50">
                {fps} FPS
              </div>
            </div>

            {/* Camera label */}
            {currentDevice && (
              <div className="absolute top-3 right-3 z-20">
                <div className="px-2.5 py-1 rounded-full bg-black/60 border border-white/10 text-[9px] font-orbitron text-gray-400 tracking-wider flex items-center gap-1">
                  <Video className="w-3 h-3 text-emerald-400" />
                  {currentDevice.label.length > 22
                    ? `${currentDevice.label.slice(0, 20)}…`
                    : currentDevice.label}
                </div>
              </div>
            )}
          </>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
        />

        {/* Action bar — bottom right */}
        {!isCameraBusy && camera.phase !== 'https_required' && (
          <div className="absolute bottom-3 right-3 z-20 flex gap-2">
            {camera.devices.length > 1 && (
              <button onClick={() => setShowCameraPicker(!showCameraPicker)}
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
      </div>

      {/* ── Camera picker panel ── */}
      {showCameraPicker && camera.devices.length > 1 && (
        <div className="w-full bg-[#0b0b14] border border-white/5 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-[10px] font-orbitron text-gray-400 tracking-widest uppercase mb-1">Choose Camera</p>
          {camera.devices.map(d => (
            <button key={d.deviceId}
              onClick={() => { camera.switchCamera(d.deviceId); setShowCameraPicker(false); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-sans flex items-center justify-between transition-colors ${
                d.deviceId === camera.activeDeviceId
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                  : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span>{d.label}</span>
              {d.deviceId === camera.activeDeviceId && (
                <span className="text-[9px] font-orbitron text-emerald-400 font-bold uppercase tracking-wider">ACTIVE</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Diagnostic terminal ── */}
      <div className="w-full bg-[#08080f] border border-white/5 rounded-xl p-3 flex flex-col gap-2">
        <button onClick={() => setShowConsole(!showConsole)}
          className="w-full flex items-center justify-between text-[10px] font-orbitron text-gray-400 hover:text-white tracking-widest uppercase select-none"
        >
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            DIAGNOSTIC LOGS
          </span>
          <span className="text-gray-600">{showConsole ? 'HIDE' : 'SHOW'}</span>
        </button>

        {showConsole && (
          <div className="w-full max-h-44 overflow-y-auto bg-black/60 rounded-lg p-2 font-mono text-[9px] text-gray-400 flex flex-col gap-1 border border-white/5">
            {camera.logs.length === 0
              ? <span className="text-gray-600">No log entries yet.</span>
              : camera.logs.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-gray-600 shrink-0">[{new Date(l.ts).toLocaleTimeString()}]</span>
                    <span className="text-cyan-400 shrink-0">[{l.tag}]</span>
                    <span className="text-gray-300">{l.msg}</span>
                  </div>
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraFeed;
