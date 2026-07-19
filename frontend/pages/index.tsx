import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useApi } from '../hooks/useApi';
import { CameraFeed } from '../components/CameraFeed';
import { DesignPanel } from '../components/DesignPanel';
import { ImageCompare } from '../components/ImageCompare';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { GlassCard } from '../components/GlassCard';
import {
  Printer, Download, QrCode, RotateCcw, Share2, Sparkles,
  CheckCircle, AlertCircle, X as XIcon, Camera,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// Toast types
// ─────────────────────────────────────────────────────────────────────────────
interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  animeUrl?: string;
  photoId?: string;
}

let toastCounter = 0;

export default function Home() {
  const {
    fetchStyles,
    fetchBackgrounds,
    submitGeneration,
    pollTaskStatus,
    triggerPrint,
    triggerUpscale,
    uploadManualCapture,
  } = useApi();

  // API Lists
  const [styles, setStyles]           = useState<any[]>([]);
  const [backgrounds, setBackgrounds] = useState<any[]>([]);

  // Style selection (keeps running regardless of stage)
  const [activeStyle, setActiveStyle]           = useState<string>('Anime');
  const [activeBackground, setActiveBackground] = useState<string>('Cherry Blossoms');

  // Main lifecycle stage
  // mirror: live Ghibli feed always visible
  // result: user chose to view full result (from toast CTA)
  const [stage, setStage] = useState<'mirror' | 'result'>('mirror');

  // Full-screen result photo (only entered via toast "View Result" CTA)
  const [activePhoto, setActivePhoto] = useState<any>(null);

  // Toasts for background auto-captures
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Action status indicators
  const [printing,  setPrinting]  = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [showQr,    setShowQr]    = useState(false);

  // ── Fetch presets ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStyles()
      .then((data: any[]) => {
        setStyles(data);
        if (data.length > 0) setActiveStyle(data[0].id);
      })
      .catch(() => {
        // API not ready yet — use defaults silently
      });
    fetchBackgrounds()
      .then((data: any[]) => {
        setBackgrounds(data);
        if (data.length > 0) setActiveBackground(data[0].id);
      })
      .catch(() => {});
  }, [fetchStyles, fetchBackgrounds]);

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => removeToast(id), 8000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Background generation task runner ─────────────────────────────────────
  const runBackgroundGeneration = useCallback(async (photoId: string) => {
    try {
      const task = await submitGeneration(photoId, activeStyle, activeBackground);
      const taskId = task.task_id;

      const poll = () => {
        const timer = setInterval(async () => {
          try {
            const info = await pollTaskStatus(taskId);
            if (info.status === 'completed') {
              clearInterval(timer);
              addToast({
                type: 'success',
                message: 'Ghibli portrait ready!',
                animeUrl: info.upscaled_url || info.anime_url,
                photoId,
              });
              confetti({
                particleCount: 80, spread: 60,
                origin: { y: 0.75 },
                colors: ['#10b981', '#34d399', '#6ee7b7'],
              });
            } else if (info.status === 'failed') {
              clearInterval(timer);
              addToast({ type: 'error', message: 'Portrait generation failed. Try again.' });
            }
          } catch (_) {
            clearInterval(timer);
          }
        }, 1000);
      };
      poll();
    } catch (err: any) {
      addToast({ type: 'error', message: 'Could not start generation: ' + err.message });
    }
  }, [submitGeneration, pollTaskStatus, activeStyle, activeBackground, addToast]);

  // ── CameraFeed callback: NON-BLOCKING ──────────────────────────────────────
  // Mirror stays live; generation runs silently in background.
  const handlePhotoCaptured = useCallback(async (photoId: string, originalUrl: string) => {
    addToast({ type: 'info', message: '📸 Portrait captured — generating Ghibli art…' });
    await runBackgroundGeneration(photoId);
  }, [runBackgroundGeneration, addToast]);

  // ── Upload wrapper compatible with CameraFeed's expected signature ─────────
  const handleUploadManual = useCallback(async (file: File) => {
    return uploadManualCapture(file, activeStyle, activeBackground);
  }, [uploadManualCapture, activeStyle, activeBackground]);

  // ── View full result (from toast) ─────────────────────────────────────────
  const viewFullResult = useCallback(async (photoId: string) => {
    try {
      const res = await fetch(`/api/v1/history`);
      if (res.ok) {
        const history = await res.json();
        const photo = history.find((p: any) => p.id === photoId);
        if (photo) {
          setActivePhoto(photo);
          setStage('result');
          return;
        }
      }
    } catch (_) {}
    // Fallback: just set photo id
    setActivePhoto({ id: photoId });
    setStage('result');
  }, []);

  // ── Actions in result view ────────────────────────────────────────────────
  const handlePrint = async () => {
    if (!activePhoto) return;
    setPrinting(true);
    try {
      await triggerPrint(activePhoto.id);
      confetti({ particleCount: 50, spread: 40, colors: ['#00ff66', '#00f0ff'] });
    } catch (err: any) {
      addToast({ type: 'error', message: 'Spooler error: ' + err.message });
    } finally { setPrinting(false); }
  };

  const handleUpscale = async () => {
    if (!activePhoto) return;
    setUpscaling(true);
    try {
      const updated = await triggerUpscale(activePhoto.id, 4);
      setActivePhoto((prev: any) => ({ ...prev, upscaled_url: updated.upscaled_url }));
    } catch (err: any) {
      addToast({ type: 'error', message: 'Super Resolution failed: ' + err.message });
    } finally { setUpscaling(false); }
  };

  const backToMirror = () => {
    setStage('mirror');
    setActivePhoto(null);
    setShowQr(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Ghibli Mirror | Real-Time AI Photo Booth</title>
        <meta name="description" content="Step in front of the camera and see yourself transformed into a living Studio Ghibli painting in real time." />
      </Head>

      {/* ── Toast Stack ── */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map(t => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className={`pointer-events-auto flex items-start gap-3 p-3 pr-4 rounded-2xl shadow-2xl border backdrop-blur-md max-w-xs
                ${t.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/40' :
                  t.type === 'error'   ? 'bg-red-950/90 border-red-500/40' :
                                         'bg-slate-900/90 border-white/10'}`}
            >
              <div className="mt-0.5">
                {t.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> :
                 t.type === 'error'   ? <AlertCircle className="w-4 h-4 text-red-400" /> :
                                        <Camera className="w-4 h-4 text-cyan-400 animate-pulse" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/90 font-sans leading-snug">{t.message}</p>
                {t.type === 'success' && t.animeUrl && (
                  <div className="flex gap-2 mt-2">
                    <img
                      src={`http://localhost:8000${t.animeUrl}`}
                      alt="Ghibli portrait"
                      className="w-16 h-16 object-cover rounded-lg border border-emerald-500/30"
                    />
                    <div className="flex flex-col gap-1.5 justify-center">
                      <button
                        onClick={() => t.photoId && viewFullResult(t.photoId)}
                        className="text-[10px] font-orbitron text-emerald-400 underline hover:text-emerald-300"
                      >
                        VIEW FULL RESULT
                      </button>
                      <a
                        href={`http://localhost:8000${t.animeUrl}`}
                        download
                        className="text-[10px] font-orbitron text-cyan-400 underline hover:text-cyan-300"
                      >
                        DOWNLOAD
                      </a>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => removeToast(t.id)}
                className="text-white/30 hover:text-white/70 transition-colors mt-0.5"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto items-center">

        {/* Header */}
        <div className="text-center w-full">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-200 to-purple-300 font-orbitron drop-shadow-[0_0_20px_rgba(52,211,153,0.2)]">
            GHIBLI MIRROR
          </h1>
          <p className="text-xs md:text-sm text-gray-500 font-sans mt-2 tracking-wide max-w-md mx-auto leading-relaxed">
            Step in front of the camera. See yourself as a living Studio Ghibli painting.
          </p>
        </div>

        <AnimatePresence mode="wait">

          {/* ── STAGE: Mirror (default, always live) ── */}
          {stage === 'mirror' && (
            <motion.div
              key="stage-mirror"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col gap-6 w-full"
            >
              <CameraFeed
                style={activeStyle}
                background={activeBackground}
                onCaptured={handlePhotoCaptured}
                uploadManual={handleUploadManual}
              />

              <DesignPanel
                styles={styles}
                backgrounds={backgrounds}
                selectedStyle={activeStyle}
                selectedBackground={activeBackground}
                onStyleSelect={setActiveStyle}
                onBackgroundSelect={setActiveBackground}
              />

              {/* Smile-to-capture hint */}
              <div className="flex items-center justify-center gap-2 text-[11px] text-gray-600 font-sans">
                <span className="text-base">😊</span>
                <span>Smile and hold still for <span className="text-emerald-500/80">3 seconds</span> to auto-capture a high-quality portrait</span>
              </div>
            </motion.div>
          )}

          {/* ── STAGE: Result (full-screen comparison) ── */}
          {stage === 'result' && activePhoto && (
            <motion.div
              key="stage-result"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col md:flex-row gap-8 w-full"
            >
              {/* Image comparison slider */}
              <div className="flex-1 max-w-2xl bg-cyber-darker/20 rounded-3xl p-1">
                {activePhoto.anime_url || activePhoto.upscaled_url ? (
                  <ImageCompare
                    original={activePhoto.original_url}
                    modified={activePhoto.upscaled_url || activePhoto.anime_url}
                  />
                ) : (
                  <div className="aspect-video flex items-center justify-center text-gray-500 text-sm rounded-3xl bg-white/5">
                    Processing portrait…
                  </div>
                )}
              </div>

              {/* Actions panel */}
              <div className="w-full md:w-80 flex flex-col justify-between p-8 rounded-3xl glass-panel-glow border-emerald-500/20">
                <div>
                  <h3 className="font-orbitron font-extrabold text-base tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 mb-1">
                    PORTRAIT COMPLETE
                  </h3>
                  <div className="w-12 h-[2px] bg-emerald-500 rounded-full mt-4 mb-6" />

                  <div className="flex flex-col gap-3 text-xs">
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">STYLE</span>
                      <span className="text-gray-200 font-semibold">{activeStyle}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">ENVIRONMENT</span>
                      <span className="text-gray-200 font-semibold">{activeBackground}</span>
                    </div>
                    {activePhoto.processing_time_sec && (
                      <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-gray-500 font-orbitron">PROCESSED IN</span>
                        <span className="text-gray-200 font-mono">{activePhoto.processing_time_sec.toFixed(2)}s</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 mt-8">
                  <button
                    onClick={handlePrint}
                    disabled={printing}
                    className="w-full font-orbitron font-bold text-xs tracking-widest border border-emerald-500/60 hover:border-emerald-400 py-3.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/25 text-white flex items-center justify-center gap-2 transition-all duration-300"
                  >
                    <Printer className={`w-4 h-4 text-emerald-400 ${printing ? 'animate-pulse' : ''}`} />
                    {printing ? 'SPOOLING...' : 'PRINT PORTRAIT'}
                  </button>

                  {!activePhoto.upscaled_url && (
                    <button
                      onClick={handleUpscale}
                      disabled={upscaling}
                      className="w-full font-orbitron font-bold text-xs tracking-widest border border-cyan-500/60 hover:border-cyan-400 py-3.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/25 text-white flex items-center justify-center gap-2 transition-all"
                    >
                      <Sparkles className={`w-4 h-4 text-cyan-400 ${upscaling ? 'animate-spin' : ''}`} />
                      {upscaling ? 'UPGRADING HD...' : 'UPGRADE TO 4K HD'}
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      onClick={() => setShowQr(true)}
                      className="font-orbitron font-semibold text-[10px] tracking-widest border border-white/10 hover:border-cyan-400 py-3 rounded-lg text-gray-400 hover:text-cyan-400 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <QrCode className="w-4 h-4" /> MOBILE SYNC
                    </button>
                    <a
                      href={`http://localhost:8000/api/v1/download/file/anime/${activePhoto.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-orbitron font-semibold text-[10px] tracking-widest border border-white/10 hover:border-emerald-400 py-3 rounded-lg text-gray-400 hover:text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Download className="w-4 h-4" /> DOWNLOAD
                    </a>
                  </div>

                  <button
                    onClick={backToMirror}
                    className="w-full mt-4 font-orbitron text-xs tracking-wider border border-white/5 hover:border-emerald-500/30 py-2.5 rounded-lg bg-white/5 hover:bg-emerald-500/10 text-gray-400 hover:text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" /> BACK TO MIRROR
                  </button>
                </div>
              </div>

              {/* QR overlay */}
              <AnimatePresence>
                {showQr && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 bg-cyber-darker/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
                  >
                    <button
                      onClick={() => setShowQr(false)}
                      className="absolute top-6 right-6 p-2.5 rounded-full bg-cyber-darker border border-white/10 text-gray-400 hover:text-white"
                    >
                      <XIcon className="w-5 h-5" />
                    </button>
                    <h4 className="font-orbitron font-bold text-sm tracking-widest text-white mb-2">
                      SCAN TO VIEW ON MOBILE
                    </h4>
                    <p className="text-xs text-gray-400 max-w-xs mb-8">
                      Scan this QR code to instantly view and save your portrait on your phone.
                    </p>
                    <div className="p-3 rounded-2xl bg-white border border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.3)]">
                      <img
                        src={`http://localhost:8000/api/v1/download/qr/${activePhoto.id}?base_url=${typeof window !== 'undefined' ? window.location.origin : ''}`}
                        alt="Mobile QR"
                        className="w-48 h-48"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </>
  );
}
