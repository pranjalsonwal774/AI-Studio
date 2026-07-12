import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useApi } from '../hooks/useApi';
import { CameraFeed } from '../components/CameraFeed';
import { DesignPanel } from '../components/DesignPanel';
import { ImageCompare } from '../components/ImageCompare';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { GlassCard } from '../components/GlassCard';
import { Printer, Download, QrCode, RotateCcw, Share2, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'framer-motion';

export default function Home() {
  const {
    fetchStyles,
    fetchBackgrounds,
    submitGeneration,
    pollTaskStatus,
    triggerPrint,
    triggerUpscale,
    uploadManualCapture
  } = useApi();

  // API Lists
  const [styles, setStyles] = useState<any[]>([]);
  const [backgrounds, setBackgrounds] = useState<any[]>([]);
  
  // Selection states
  const [activeStyle, setActiveStyle] = useState<string>('Anime');
  const [activeBackground, setActiveBackground] = useState<string>('Cherry Blossoms');

  // Portrait generation lifecycle states
  // 'idle' -> 'processing' -> 'result'
  const [stage, setStage] = useState<'idle' | 'processing' | 'result'>('idle');
  const [activePhoto, setActivePhoto] = useState<any>(null);
  
  // Processing values
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  
  // Action status indicators
  const [printing, setPrinting] = useState<boolean>(false);
  const [upscaling, setUpscaling] = useState<boolean>(false);
  const [showQrOverlay, setShowQrOverlay] = useState<boolean>(false);

  // Fetch presets on load
  useEffect(() => {
    fetchStyles().then(data => {
      setStyles(data);
      if (data.length > 0) setActiveStyle(data[0].id);
    });
    fetchBackgrounds().then(data => {
      setBackgrounds(data);
      if (data.length > 0) setActiveBackground(data[0].id);
    });
  }, [fetchStyles, fetchBackgrounds]);

  // Callback when photo is captured (via WS or Manual upload)
  const handlePhotoCaptured = async (photoId: string, originalUrl: string) => {
    setActivePhoto({ id: photoId, original_url: originalUrl });
    setStage('processing');
    setProgress(5);
    setStatusMessage('Captured portrait registered in booth spooler...');
    
    try {
      // 1. Submit Generation
      const task = await submitGeneration(photoId, activeStyle, activeBackground);
      
      // 2. Poll progress status
      pollTask(task.task_id);
    } catch (err: any) {
      alert("Generation setup failed: " + err.message);
      setStage('idle');
    }
  };

  // Polls task status until finished
  const pollTask = (taskId: string) => {
    const timer = setInterval(async () => {
      try {
        const taskInfo = await pollTaskStatus(taskId);
        
        setProgress(taskInfo.progress);
        setStatusMessage(taskInfo.status === 'processing' ? 'Running neural models...' : taskInfo.status);
        
        if (taskInfo.status === 'completed') {
          clearInterval(timer);
          
          // Hydrate photo parameters
          setActivePhoto((prev: any) => ({
            ...prev,
            anime_url: taskInfo.anime_url,
            upscaled_url: taskInfo.upscaled_url,
            processing_time_sec: taskInfo.processing_time_sec
          }));
          
          setStage('result');
          
          // Celebrate with high-end neon confetti
          confetti({
            particleCount: 150,
            spread: 80,
            origin: { y: 0.6 },
            colors: ['#bc34fa', '#00f0ff', '#ff007f']
          });
        } else if (taskInfo.status === 'failed') {
          clearInterval(timer);
          alert("Booths AI processing failed: " + (taskInfo.error || "Unknown GPU model error"));
          setStage('idle');
        }
      } catch (err) {
        clearInterval(timer);
        console.error("Polling error:", err);
        setStage('idle');
      }
    }, 1000);
  };

  const handlePrint = async () => {
    if (!activePhoto) return;
    setPrinting(true);
    try {
      await triggerPrint(activePhoto.id);
      confetti({
        particleCount: 50,
        spread: 40,
        colors: ['#00ff66', '#00f0ff']
      });
    } catch (err: any) {
      alert("Spooler error: " + err.message);
    } finally {
      setPrinting(false);
    }
  };

  const handleUpscale = async () => {
    if (!activePhoto) return;
    setUpscaling(true);
    try {
      const updated = await triggerUpscale(activePhoto.id, 4);
      setActivePhoto((prev: any) => ({
        ...prev,
        upscaled_url: updated.upscaled_url
      }));
    } catch (err: any) {
      alert("Super Resolution failed: " + err.message);
    } finally {
      setUpscaling(false);
    }
  };

  const handleUploadFile = async (file: File) => {
    return uploadManualCapture(file, activeStyle, activeBackground);
  };

  const restartStudio = () => {
    setStage('idle');
    setActivePhoto(null);
    setProgress(0);
    setStatusMessage('');
    setShowQrOverlay(false);
  };

  return (
    <>
      <Head>
        <title>Studio | AI Anime Portrait Studio</title>
        <meta name="description" content="Capture your portrait from a live camera and transform it into a stunning anime painting instantly." />
      </Head>

      <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto items-center">
        
        {/* Futuristic Welcome Header */}
        {stage !== 'processing' && (
          <div className="text-center w-full">
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-cyber-blue font-orbitron drop-shadow-[0_0_15px_rgba(0,240,255,0.2)]">
              ANIME PORTRAIT STUDIO
            </h1>
            <p className="text-xs md:text-sm text-gray-500 font-sans mt-2 tracking-wide max-w-md mx-auto leading-relaxed">
              Step in front of the camera, choose your illustration parameters, and watch neural models paint your anime portrait.
            </p>
          </div>
        )}

        {/* Stage Controller */}
        <AnimatePresence mode="wait">
          
          {/* STAGE 1: Standby Camera Feed & Style Panel */}
          {stage === 'idle' && (
            <motion.div
              key="stage-idle"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-8 w-full"
            >
              {/* Webcam viewport */}
              <CameraFeed
                style={activeStyle}
                background={activeBackground}
                onCaptured={handlePhotoCaptured}
                uploadManual={handleUploadFile}
              />
              
              {/* Select styles and background panel */}
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

          {/* STAGE 2: Scanning neural processor loading */}
          {stage === 'processing' && (
            <LoadingOverlay progress={progress} status={statusMessage} />
          )}

          {/* STAGE 3: Painting Results comparison & actions */}
          {stage === 'result' && activePhoto && (
            <motion.div
              key="stage-result"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col md:flex-row gap-8 w-full"
            >
              
              {/* Comparison slider viewer */}
              <div className="flex-1 max-w-2xl bg-cyber-darker/20 rounded-3xl p-1">
                <ImageCompare
                  original={activePhoto.original_url}
                  modified={activePhoto.upscaled_url || activePhoto.anime_url}
                />
              </div>

              {/* Action layout */}
              <div className="w-full md:w-80 flex flex-col justify-between p-8 rounded-3xl glass-panel-glow border-cyber-purple/20">
                <div>
                  <h3 className="font-orbitron font-extrabold text-base tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyber-purple to-cyber-neonBlue mb-1">
                    SYNTHESIS COMPLETE
                  </h3>
                  <p className="text-[10px] text-gray-500 font-mono tracking-widest uppercase">
                    PROCESSED IN {activePhoto.processing_time_sec?.toFixed(3)}s
                  </p>
                  <div className="w-12 h-[2px] bg-cyber-neonBlue rounded-full mt-4 mb-6" />

                  <div className="flex flex-col gap-3 text-xs">
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">STYLE OPTION</span>
                      <span className="text-gray-200 font-semibold">{activeStyle}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">ENVIRONMENT</span>
                      <span className="text-gray-200 font-semibold">{activeBackground}</span>
                    </div>
                  </div>
                </div>

                {/* Booth tools buttons */}
                <div className="flex flex-col gap-3 mt-8">
                  {/* Print trigger */}
                  <button
                    onClick={handlePrint}
                    disabled={printing}
                    className="w-full font-orbitron font-bold text-xs tracking-widest border border-cyber-purple/60 hover:border-cyber-neonPurple py-3.5 rounded-xl bg-cyber-purple/10 hover:bg-cyber-purple/25 text-white flex items-center justify-center gap-2 transition-all duration-300 shadow-neon-purple/10 shadow-sm"
                  >
                    <Printer className={`w-4.5 h-4.5 text-cyber-neonPurple ${printing ? 'animate-pulse' : ''}`} />
                    {printing ? 'SPOOLING PRINT...' : 'PRINT PHOTO'}
                  </button>

                  {/* 4x upscale option */}
                  {!activePhoto.upscaled_url && (
                    <button
                      onClick={handleUpscale}
                      disabled={upscaling}
                      className="w-full font-orbitron font-bold text-xs tracking-widest border border-cyber-blue/60 hover:border-cyber-neonBlue py-3.5 rounded-xl bg-cyber-blue/10 hover:bg-cyber-blue/25 text-white flex items-center justify-center gap-2 transition-all duration-300"
                    >
                      <Sparkles className={`w-4.5 h-4.5 text-cyber-neonBlue ${upscaling ? 'animate-spin' : ''}`} />
                      {upscaling ? 'UPGRADING HD...' : 'UPGRADE TO 4X HD'}
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {/* Dynamic phone QR link */}
                    <button
                      onClick={() => setShowQrOverlay(true)}
                      className="font-orbitron font-semibold text-[10px] tracking-widest border border-white/10 hover:border-cyber-neonBlue py-3 rounded-lg text-gray-400 hover:text-cyber-neonBlue flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <QrCode className="w-4 h-4" />
                      MOBILE SYNC
                    </button>

                    {/* Direct image download */}
                    <a
                      href={`http://localhost:8000/api/v1/download/file/anime/${activePhoto.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-orbitron font-semibold text-[10px] tracking-widest border border-white/10 hover:border-emerald-400 py-3 rounded-lg text-gray-400 hover:text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      DOWNLOAD
                    </a>
                  </div>

                  {/* Restart photo booth */}
                  <button
                    onClick={restartStudio}
                    className="w-full mt-4 font-orbitron text-xs tracking-wider border border-white/5 hover:border-white/20 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    RESTART CAPTURE
                  </button>
                </div>

              </div>

              {/* QR overlay modal screen */}
              <AnimatePresence>
                {showQrOverlay && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 bg-cyber-darker/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
                  >
                    <button
                      onClick={() => setShowQrOverlay(false)}
                      className="absolute top-6 right-6 p-2.5 rounded-full bg-cyber-darker border border-white/10 text-gray-400 hover:text-white"
                    >
                      <XIcon className="w-5 h-5" />
                    </button>
                    
                    <h4 className="font-orbitron font-bold text-sm tracking-widest text-white mb-2">
                      SCAN TO VIEW ON MOBILE
                    </h4>
                    <p className="text-xs text-gray-400 max-w-xs mb-8">
                      Scan this QR code using your phone camera to instantly view, save, and print this painting.
                    </p>
                    
                    <div className="p-3 rounded-2xl bg-white border border-cyber-neonBlue shadow-neon-blue">
                      <img
                        src={`http://localhost:8000/api/v1/download/qr/${activePhoto.id}?base_url=${window.location.origin}`}
                        alt="Mobile Scan QR"
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

// Simple internal X icon
const XIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);
