import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  Camera,
  CameraOff,
  AlertTriangle,
  RefreshCw,
  Upload,
  User,
  Wind,
} from 'lucide-react';
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

type BoothPhase =
  | 'loading'      // camera initialising
  | 'permission'   // waiting for camera permission
  | 'error'        // camera error
  | 'waiting'      // camera live, no person detected
  | 'detected'     // person detected, running countdown
  | 'hold_still'   // person moved during countdown
  | 'capturing'    // flash + uploading
  | 'uploading';   // sending to backend

interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shutter sound (Web Audio API — no external file needed)
// ─────────────────────────────────────────────────────────────────────────────
function playShutterSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    // Click transient
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // High-pass to make it crisp
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 800;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    src.connect(hpf);
    hpf.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch (_) {
    // Ignore audio errors silently
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
}) => {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastFaceBoxRef = useRef<FaceBox | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [phase, setPhase] = useState<BoothPhase>('loading');
  const [cameraError, setCameraError] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(5);
  const [flashActive, setFlashActive] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);

  // ── Load face-api models ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        if ((window as any).faceapi?.nets?.tinyFaceDetector?.isLoaded) {
          if (!cancelled) setModelsReady(true);
          return;
        }

        if (!(window as any).faceapi) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement('script');
            s.src =
              'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.js';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('CDN load failed'));
            document.head.appendChild(s);
          });
        }

        const fa = (window as any).faceapi;
        const MODEL =
          'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
          fa.nets.tinyFaceDetector.loadFromUri(MODEL),
          fa.nets.faceLandmark68TinyNet.loadFromUri(MODEL),
        ]);

        if (!cancelled) {
          setModelsReady(true);
        }
      } catch (e) {
        console.warn('face-api load failed (non-critical):', e);
        if (!cancelled) setModelsReady(true); // still run without face tracking
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Camera helpers ────────────────────────────────────────────────────────

  const releaseCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    cancelAnimationFrame(animFrameRef.current);
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
    }
    lastFaceBoxRef.current = null;
  }, []);

  const enumerateDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === 'videoinput');
      setDevices(cams);
      return cams;
    } catch {
      return [];
    }
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      releaseCamera();
      setPhase('loading');
      setCameraError('');

      // First do a quick permission probe to get device labels
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        probe.getTracks().forEach((t) => t.stop());
      } catch (err: any) {
        const msg =
          err.name === 'NotAllowedError'
            ? 'Camera permission denied. Allow camera access in your browser and refresh.'
            : err.name === 'NotFoundError'
            ? 'No webcam found. Connect a camera and try again.'
            : `Camera error: ${err.message}`;
        setCameraError(msg);
        setPhase('error');
        return;
      }

      const cams = await enumerateDevices();
      const targetId = deviceId || selectedDeviceId || (cams[0]?.deviceId ?? '');
      if (targetId && !deviceId) setSelectedDeviceId(targetId);

      // Try the target device first, then fall back to others
      const order = targetId
        ? [targetId, ...cams.map((d) => d.deviceId).filter((id) => id !== targetId)]
        : cams.map((d) => d.deviceId);

      if (order.length === 0) order.push('');

      let started = false;
      for (const id of order) {
        try {
          const constraints: MediaStreamConstraints = {
            video: id
              ? {
                  deviceId: { exact: id },
                  width: { ideal: 1920, min: 640 },
                  height: { ideal: 1080, min: 480 },
                  frameRate: { ideal: 30 },
                }
              : { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
            audio: false,
          };

          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          streamRef.current = stream;

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }

          if (id) setSelectedDeviceId(id);
          setPhase('waiting');
          started = true;
          break;
        } catch (err: any) {
          console.warn(`Camera ${id} failed:`, err.message);
        }
      }

      if (!started) {
        setCameraError(
          'Could not open any webcam. Check connections and try again, or upload a photo.'
        );
        setPhase('error');
      }
    },
    [enumerateDevices, releaseCamera, selectedDeviceId]
  );

  // ── Auto-start on mount ───────────────────────────────────────────────────
  useEffect(() => {
    startCamera();
    return () => {
      releaseCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Bind stream whenever videoRef or stream changes ───────────────────────
  // This effect is the DEFINITIVE way to attach a stream to a video element.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  });

  // ── Countdown management ─────────────────────────────────────────────────

  const abortCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdown(5);
  }, []);

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    setPhase('capturing');
    setFlashActive(true);
    playShutterSound();
    setTimeout(() => setFlashActive(false), 300);

    await new Promise((r) => setTimeout(r, 150));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw mirrored (matches what user saw in preview)
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    setPhase('uploading');
    releaseCamera();

    try {
      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, 'image/jpeg', 0.95)
      );
      if (!blob) throw new Error('Canvas encode failed');
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      alert('Capture failed: ' + err.message);
      await startCamera();
    }
  }, [releaseCamera, uploadManual, onCaptured, startCamera]);

  const startCountdown = useCallback(
    (seconds: number) => {
      setCountdown(seconds);
      setPhase('detected');

      const tick = (remaining: number) => {
        if (remaining <= 0) {
          captureFrame();
          return;
        }
        setCountdown(remaining);
        countdownTimerRef.current = setTimeout(() => tick(remaining - 1), 1000);
      };

      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = setTimeout(() => tick(seconds - 1), 1000);
    },
    [captureFrame]
  );

  // ── Detection loop ────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'detected' && phase !== 'hold_still') return;
    
    const video = videoRef.current;
    const overlay = overlayCanvasRef.current;
    if (!video) return;

    let running = true;
    let consecutiveNoFace = 0;
    let consecutiveFace = 0;
    const FACE_CONFIRM_FRAMES = 3;   // frames needed to confirm face
    const FACE_LOST_FRAMES = 8;      // frames without face before reset
    const MOVE_THRESHOLD = 0.12;     // relative movement to trigger "hold still"

    const getCtx = () => {
      if (!overlay) return null;
      const rect = video.getBoundingClientRect();
      if (rect.width === 0) return null;
      overlay.width = rect.width;
      overlay.height = rect.height;
      return overlay.getContext('2d');
    };

    const detectLoop = async () => {
      if (!running || !video || video.paused || video.readyState < 2) {
        if (running) animFrameRef.current = requestAnimationFrame(detectLoop);
        return;
      }

      const oCtx = getCtx();
      if (oCtx) oCtx.clearRect(0, 0, overlay!.width, overlay!.height);

      const fa = (window as any).faceapi;
      const faceDetected = fa && modelsReady;

      let box: FaceBox | null = null;

      if (faceDetected) {
        try {
          const opts = new fa.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.45,
          });
          const det = await fa.detectSingleFace(video, opts);

          if (det) {
            const b = det.box;
            box = { x: b.x, y: b.y, w: b.width, h: b.height };
          }
        } catch {
          // ignore detection errors
        }
      } else {
        // Fallback: assume person present if stream is active (no face-api)
        box = {
          x: video.videoWidth * 0.2,
          y: video.videoHeight * 0.1,
          w: video.videoWidth * 0.6,
          h: video.videoHeight * 0.8,
        };
      }

      if (box) {
        consecutiveFace++;
        consecutiveNoFace = 0;

        // Draw guide frame on overlay canvas
        if (oCtx && overlay) {
          const scaleX = overlay.width / video.videoWidth;
          const scaleY = overlay.height / video.videoHeight;
          // Mirror the box
          const fx = (video.videoWidth - box.x - box.w) * scaleX;
          const fy = box.y * scaleY;
          const fw = box.w * scaleX;
          const fh = box.h * scaleY;
          const cl = Math.min(fw, fh) * 0.18;

          const isCountingDown = phase === 'detected';
          oCtx.strokeStyle = isCountingDown ? '#00ff88' : '#bc34fa';
          oCtx.lineWidth = 2.5;
          oCtx.shadowColor = isCountingDown ? 'rgba(0,255,136,0.5)' : 'rgba(188,52,250,0.5)';
          oCtx.shadowBlur = 10;

          // Corner brackets
          [ [fx, fy, cl, cl], [fx+fw-cl, fy, cl, cl], [fx, fy+fh-cl, cl, cl], [fx+fw-cl, fy+fh-cl, cl, cl] ]
            .forEach(([bx, by, lx, ly], i) => {
              oCtx.beginPath();
              if (i === 0) { oCtx.moveTo(bx, by+ly); oCtx.lineTo(bx, by); oCtx.lineTo(bx+lx, by); }
              if (i === 1) { oCtx.moveTo(bx, by); oCtx.lineTo(bx+lx, by); oCtx.lineTo(bx+lx, by+ly); }
              if (i === 2) { oCtx.moveTo(bx, by); oCtx.lineTo(bx, by+ly); oCtx.lineTo(bx+lx, by+ly); }
              if (i === 3) { oCtx.moveTo(bx, by); oCtx.lineTo(bx+lx, by); oCtx.lineTo(bx+lx, by+ly); }
              oCtx.stroke();
            });

          oCtx.shadowBlur = 0;
        }

        // Check stability (movement detection)
        const prev = lastFaceBoxRef.current;
        let moved = false;
        if (prev) {
          const dx = Math.abs(box.x - prev.x) / video.videoWidth;
          const dy = Math.abs(box.y - prev.y) / video.videoHeight;
          const dw = Math.abs(box.w - prev.w) / video.videoWidth;
          moved = dx + dy + dw > MOVE_THRESHOLD;
        }
        lastFaceBoxRef.current = box;

        if (moved && phase === 'detected') {
          // Person moved — pause countdown, show "Hold Still"
          abortCountdown();
          setPhase('hold_still');
          setFaceDetected(true);
          if (running) animFrameRef.current = requestAnimationFrame(detectLoop);
          return;
        }

        if (moved && phase === 'hold_still') {
          // Still moving
          setFaceDetected(true);
          if (running) animFrameRef.current = requestAnimationFrame(detectLoop);
          return;
        }

        setFaceDetected(true);

        // If enough consecutive frames with a stable face → start countdown
        if (consecutiveFace >= FACE_CONFIRM_FRAMES) {
          if (phase === 'waiting') {
            startCountdown(5);
          } else if (phase === 'hold_still') {
            // Person stabilised again — restart countdown
            startCountdown(5);
          }
        }
      } else {
        consecutiveFace = 0;
        consecutiveNoFace++;
        lastFaceBoxRef.current = null;

        if (consecutiveNoFace >= FACE_LOST_FRAMES) {
          setFaceDetected(false);
          if (phase === 'detected' || phase === 'hold_still') {
            abortCountdown();
            setPhase('waiting');
          }
        }

        // Still draw a subtle guide circle
        if (oCtx && overlay) {
          const cx = overlay.width / 2;
          const cy = overlay.height / 2;
          const r = Math.min(overlay.width, overlay.height) * 0.3;
          oCtx.strokeStyle = 'rgba(255,255,255,0.12)';
          oCtx.lineWidth = 1.5;
          oCtx.setLineDash([8, 12]);
          oCtx.beginPath();
          oCtx.arc(cx, cy, r, 0, Math.PI * 2);
          oCtx.stroke();
          oCtx.setLineDash([]);
        }
      }

      if (running) animFrameRef.current = requestAnimationFrame(detectLoop);
    };

    animFrameRef.current = requestAnimationFrame(detectLoop);
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [phase, modelsReady, startCountdown, abortCountdown]);

  // ── File upload handlers ───────────────────────────────────────────────────

  const handleFileUpload = async (file: File) => {
    releaseCamera();
    setPhase('uploading');
    try {
      const photo = await uploadManual(file);
      onCaptured(photo.id, photo.original_url);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
      await startCamera();
    }
  };

  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) await handleFileUpload(f);
  };

  // ── Countdown display ─────────────────────────────────────────────────────

  const countdownLabel = useMemo(() => {
    if (countdown <= 0) return '📸';
    return String(countdown);
  }, [countdown]);

  // ── Camera active? ────────────────────────────────────────────────────────
  const cameraLive = ['waiting', 'detected', 'hold_still'].includes(phase);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full">

      {/* ── Live Viewport ─────────────────────────────────────────────────── */}
      <div
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="relative flex-1 aspect-[4/3] rounded-2xl bg-cyber-darker border border-white/5 overflow-hidden shadow-inner"
      >

        {/* Video element always rendered — controlled by src */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          style={{ display: cameraLive ? 'block' : 'none' }}
        />

        {/* Overlay canvas */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 z-10 pointer-events-none scale-x-[-1]"
          style={{ display: cameraLive ? 'block' : 'none' }}
        />
        <canvas ref={hiddenCanvasRef} className="hidden" />

        {/* ── Phase overlays ────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">

          {/* Loading */}
          {phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-cyber-darker z-20"
            >
              <RefreshCw className="w-10 h-10 text-cyber-neonBlue animate-spin mb-3" />
              <p className="font-orbitron text-xs text-cyber-neonBlue tracking-widest animate-pulse">
                INITIALISING CAMERA...
              </p>
            </motion.div>
          )}

          {/* Permission / Error */}
          {phase === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-cyber-darker z-20"
            >
              <CameraOff className="w-14 h-14 text-red-500 mb-4" />
              <h3 className="font-orbitron font-bold text-sm text-red-400 mb-2">CAMERA ERROR</h3>
              <p className="text-gray-400 text-xs max-w-xs leading-relaxed mb-6">{cameraError}</p>

              <div className="flex flex-col gap-3 w-full max-w-xs">
                {devices.length > 0 && (
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="bg-cyber-dark border border-white/10 rounded-lg p-2.5 text-xs text-gray-300 outline-none font-orbitron"
                  >
                    {devices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => startCamera()}
                  className="font-orbitron text-xs font-bold border border-cyber-purple/60 px-6 py-3 rounded-lg bg-cyber-purple/10 hover:bg-cyber-purple/20 text-white flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> RETRY CAMERA
                </button>
                <div className="text-[10px] text-gray-600 flex items-center justify-center gap-1">
                  <Upload className="w-3 h-3" />
                  or{' '}
                  <span
                    onClick={() => fileInputRef.current?.click()}
                    className="text-cyber-neonBlue underline cursor-pointer"
                  >
                    upload a photo
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Uploading */}
          {phase === 'uploading' && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-cyber-darker/95 backdrop-blur-md flex flex-col items-center justify-center z-30"
            >
              <RefreshCw className="w-10 h-10 text-cyber-neonBlue animate-spin mb-3" />
              <p className="font-orbitron text-xs text-cyber-neonBlue tracking-widest animate-pulse">
                UPLOADING CAPTURE...
              </p>
            </motion.div>
          )}

        </AnimatePresence>

        {/* ── Countdown overlay ───────────────────────────────────────────── */}
        <AnimatePresence>
          {phase === 'detected' && (
            <motion.div
              key={`cd-${countdown}`}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1.1, opacity: 1 }}
              exit={{ scale: 1.8, opacity: 0 }}
              transition={{ duration: 0.55, ease: 'backOut' }}
              className="absolute inset-0 flex flex-col items-center justify-center z-20 pointer-events-none"
            >
              <div
                className="font-orbitron font-extrabold text-[96px] leading-none text-transparent bg-clip-text bg-gradient-to-tr from-cyber-purple via-pink-400 to-cyber-neonBlue"
                style={{ filter: 'drop-shadow(0 0 24px rgba(188,52,250,0.7))' }}
              >
                {countdownLabel}
              </div>
              <p className="mt-4 font-orbitron text-xs text-white/60 tracking-widest">
                {countdown > 0 ? 'HOLD STILL...' : 'CAPTURING!'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Hold Still warning ──────────────────────────────────────────── */}
        <AnimatePresence>
          {phase === 'hold_still' && (
            <motion.div
              key="hold-still"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute bottom-16 inset-x-0 flex justify-center z-20 pointer-events-none"
            >
              <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-400/50 rounded-full px-5 py-2">
                <Wind className="w-4 h-4 text-amber-400 animate-pulse" />
                <span className="font-orbitron text-xs font-bold text-amber-300 tracking-widest">
                  HOLD STILL
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Waiting — no person ─────────────────────────────────────────── */}
        <AnimatePresence>
          {phase === 'waiting' && !faceDetected && (
            <motion.div
              key="waiting-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-6 inset-x-0 flex justify-center z-20 pointer-events-none"
            >
              <div className="flex items-center gap-2 bg-cyber-darker/70 border border-white/10 rounded-full px-5 py-2">
                <User className="w-4 h-4 text-gray-400" />
                <span className="font-orbitron text-[10px] text-gray-400 tracking-widest">
                  STEP IN FRONT OF CAMERA
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Flash effect ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {flashActive && (
            <motion.div
              key="flash"
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 bg-white z-40"
            />
          )}
        </AnimatePresence>

        {/* ── Top-left status badge ──────────────────────────────────────── */}
        {cameraLive && (
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyber-darker/80 border border-white/10 text-[9px] font-orbitron tracking-widest text-cyber-neonBlue select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
            LIVE
          </div>
        )}

        {/* ── Top-right stop button ─────────────────────────────────────── */}
        {cameraLive && (
          <button
            onClick={() => { releaseCamera(); setPhase('error'); setCameraError('Camera stopped. Click Retry to reconnect.'); }}
            className="absolute top-4 right-4 z-20 p-2 rounded-full bg-cyber-darker/80 border border-white/10 hover:border-red-400 text-gray-400 hover:text-red-400 transition-colors"
            title="Stop camera"
          >
            <CameraOff className="w-4 h-4" />
          </button>
        )}

        {/* ── Camera switcher ────────────────────────────────────────────── */}
        {cameraLive && devices.length > 1 && (
          <div className="absolute bottom-4 left-4 z-20">
            <select
              value={selectedDeviceId}
              onChange={(e) => startCamera(e.target.value)}
              className="bg-cyber-darker/90 border border-white/10 rounded-lg p-1.5 text-[10px] text-gray-300 outline-none font-orbitron"
            >
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Scan line animation when counting down */}
        {phase === 'detected' && (
          <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
            <div className="absolute w-full h-[2px] bg-cyber-neonBlue/30 animate-scanline" />
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileUpload(f);
          }}
        />
      </div>

      {/* ── Info sidebar ──────────────────────────────────────────────────── */}
      <div className="w-full lg:w-64 flex flex-col gap-5 p-6 rounded-2xl glass-panel-glow border-cyber-purple/20">
        <div>
          <h3 className="font-orbitron font-bold text-xs tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 border-b border-white/5 pb-3">
            BOOTH STATUS
          </h3>

          <div className="flex flex-col gap-3 mt-4">
            <StatusRow label="Camera" ok={cameraLive} />
            <StatusRow label="Person Detected" ok={faceDetected} />
            <StatusRow label="Models Ready" ok={modelsReady} />
          </div>
        </div>

        {/* Phase description */}
        <div className="text-[10px] font-mono text-gray-500 leading-relaxed bg-cyber-darker/50 rounded-lg p-3 border border-white/5">
          {phase === 'loading' && 'Connecting to camera...'}
          {phase === 'waiting' && 'Waiting for you to step into frame. Stand in front of the camera.'}
          {phase === 'detected' && `Person detected! Capturing in ${countdown}s — hold your pose and smile!`}
          {phase === 'hold_still' && 'Movement detected! Hold perfectly still to resume countdown.'}
          {phase === 'capturing' && 'Capturing your portrait...'}
          {phase === 'uploading' && 'Uploading to AI engine...'}
          {phase === 'error' && cameraError}
        </div>

        {/* Upload fallback */}
        <div className="mt-auto">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full font-orbitron text-[10px] tracking-widest border border-white/10 hover:border-cyber-neonBlue py-2.5 rounded-lg text-gray-500 hover:text-cyber-neonBlue flex items-center justify-center gap-2 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            UPLOAD PHOTO INSTEAD
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Status row helper ─────────────────────────────────────────────────────────
const StatusRow: React.FC<{ label: string; ok: boolean }> = ({ label, ok }) => (
  <div className="flex items-center justify-between text-xs">
    <span className="text-gray-400 font-sans">{label}</span>
    <span
      className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-gray-700'}`}
    />
  </div>
);

export default CameraFeed;
