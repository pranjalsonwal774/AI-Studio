import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import { useApi } from '../hooks/useApi';
import { CameraFeed } from '../components/CameraFeed';
import { DesignPanel } from '../components/DesignPanel';
import { ImageCompare } from '../components/ImageCompare';
import {
  Printer, Download, QrCode, RotateCcw, Sparkles,
  CheckCircle, AlertCircle, X as XIcon, Camera,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';

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

  // Preset Configurations
  const [styles, setStyles]           = useState<any[]>([]);
  const [backgrounds, setBackgrounds] = useState<any[]>([]);
  const [activeStyle, setActiveStyle]           = useState<string>('Anime');
  const [activeBackground, setActiveBackground] = useState<string>('Cherry Blossoms');

  // Ghibli Avatar Generation spooler states
  const [avatarUrl, setAvatarUrl]                   = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<number>(0);
  const [generationStatus, setGenerationStatus]     = useState<string>('');

  // Main UI phase
  const [stage, setStage] = useState<'mirror' | 'result'>('mirror');
  const [activePhoto, setActivePhoto] = useState<any>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Action status indicators
  const [printing,  setPrinting]  = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [showQr,    setShowQr]    = useState(false);

  // Fetch styles and backgrounds
  useEffect(() => {
    fetchStyles().then(data => {
      setStyles(data);
      if (data.length > 0) setActiveStyle(data[0].id);
    }).catch(() => {});

    fetchBackgrounds().then(data => {
      setBackgrounds(data);
      if (data.length > 0) setActiveBackground(data[0].id);
    }).catch(() => {});
  }, [fetchStyles, fetchBackgrounds]);

  // Toast utilities
  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { ...t, id }]);
    setTimeout(() => removeToast(id), 6000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Generation Loop ──
  const startAvatarGeneration = useCallback(async (photoId: string) => {
    setGenerationProgress(5);
    setGenerationStatus('Registering portrait in booth spooler...');

    try {
      const task = await submitGeneration(photoId, activeStyle, activeBackground);
      const taskId = task.task_id;

      const timer = setInterval(async () => {
        try {
          const info = await pollTaskStatus(taskId);
          setGenerationProgress(info.progress);
          setGenerationStatus(info.status === 'processing' ? 'Running neural style models...' : info.status);

          if (info.status === 'completed') {
            clearInterval(timer);
            setAvatarUrl(info.anime_url);
            addToast({
              type: 'success',
              message: 'Ghibli avatar is live in the mirror!',
              animeUrl: info.upscaled_url || info.anime_url,
              photoId
            });
            confetti({
              particleCount: 70,
              spread: 60,
              origin: { y: 0.8 },
              colors: ['#34d399', '#60a5fa', '#a78bfa']
            });
          } else if (info.status === 'failed') {
            clearInterval(timer);
            addToast({ type: 'error', message: 'Model generation failed.' });
            resetMirrorState();
          }
        } catch (err) {
          clearInterval(timer);
          resetMirrorState();
        }
      }, 1000);
    } catch (err: any) {
      addToast({ type: 'error', message: 'Spooler failed: ' + err.message });
      resetMirrorState();
    }
  }, [submitGeneration, pollTaskStatus, activeStyle, activeBackground, addToast]);

  // Callback when face is detected and capture is generated
  const handlePhotoCaptured = useCallback(async (photoId: string, originalUrl: string) => {
    await startAvatarGeneration(photoId);
  }, [startAvatarGeneration]);

  const handleUploadManual = useCallback(async (file: File) => {
    return uploadManualCapture(file, activeStyle, activeBackground);
  }, [uploadManualCapture, activeStyle, activeBackground]);

  // Reset Mirror states when user leaves the frame
  const resetMirrorState = useCallback(() => {
    setAvatarUrl(null);
    setGenerationProgress(0);
    setGenerationStatus('');
  }, []);

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
    setActivePhoto({ id: photoId });
    setStage('result');
  }, []);

  const handlePrint = async () => {
    if (!activePhoto) return;
    setPrinting(true);
    try {
      await triggerPrint(activePhoto.id);
      confetti({ particleCount: 50, spread: 40, colors: ['#34d399', '#60a5fa'] });
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

  return (
    <>
      <Head>
        <title>Ghibli Mirror | AI Digital Portrait Studio</title>
        <meta name="description" content="A magical hand-painted Studio Ghibli mirror reflecting your exact expressions and movements in real-time." />
      </Head>

      {/* Toast Notification Stack */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map(t => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
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
                      alt="Ghibli Portrait"
                      className="w-15 h-15 object-cover rounded-lg border border-emerald-500/30"
                    />
                    <div className="flex flex-col gap-1 justify-center">
                      <button
                        onClick={() => t.photoId && viewFullResult(t.photoId)}
                        className="text-[9px] font-orbitron text-emerald-400 underline hover:text-emerald-300"
                      >
                        VIEW RESULT
                      </button>
                      <a
                        href={`http://localhost:8000${t.animeUrl}`}
                        download
                        className="text-[9px] font-orbitron text-cyan-400 underline hover:text-cyan-300"
                      >
                        DOWNLOAD
                      </a>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => removeToast(t.id)} className="text-white/30 hover:text-white/70 transition-colors mt-0.5">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto items-center">
        {/* Header */}
        <div className="text-center w-full">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-200 to-purple-300 font-orbitron drop-shadow-[0_0_20px_rgba(52,211,153,0.25)]">
            GHIBLI MIRROR 2.0
          </h1>
          <p className="text-xs md:text-sm text-gray-500 font-sans mt-2 tracking-wide max-w-md mx-auto leading-relaxed">
            Stand still for a second to lock your identity, and look into a magical live Ghibli portrait reflecting your movements.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {/* STAGE 1: Live Ghibli Mirror */}
          {stage === 'mirror' && (
            <motion.div
              key="stage-mirror"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="flex flex-col gap-6 w-full"
            >
              <CameraFeed
                style={activeStyle}
                background={activeBackground}
                avatarUrl={avatarUrl}
                generationProgress={generationProgress}
                generationStatus={generationStatus}
                onCaptured={handlePhotoCaptured}
                uploadManual={handleUploadManual}
                onFaceDetected={() => {}}
                onReset={resetMirrorState}
              />

              <DesignPanel
                styles={styles}
                backgrounds={backgrounds}
                selectedStyle={activeStyle}
                selectedBackground={activeBackground}
                onStyleSelect={setActiveStyle}
                onBackgroundSelect={setActiveBackground}
              />
            </motion.div>
          )}

          {/* STAGE 2: Painting Results & Printing Options */}
          {stage === 'result' && activePhoto && (
            <motion.div
              key="stage-result"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col md:flex-row gap-8 w-full"
            >
              <div className="flex-1 max-w-2xl bg-cyber-darker/20 rounded-3xl p-1">
                {activePhoto.anime_url || activePhoto.upscaled_url ? (
                  <ImageCompare
                    original={activePhoto.original_url}
                    modified={activePhoto.upscaled_url || activePhoto.anime_url}
                  />
                ) : (
                  <div className="aspect-video flex items-center justify-center text-gray-500 text-sm rounded-3xl bg-white/5">
                    Processing Portrait...
                  </div>
                )}
              </div>

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
