import React, { useState } from 'react';
import { GlassCard } from './GlassCard';
import { ImageCompare } from './ImageCompare';
import { Download, Printer, QrCode, X, Calendar, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface PhotoRecord {
  id: string;
  original_url: string;
  anime_url: string;
  upscaled_url?: string;
  style: string;
  background: string;
  printed: boolean;
  print_count: number;
  processing_time_sec: number;
  created_at: string;
}

interface PhotoGalleryProps {
  photos: PhotoRecord[];
  onPrint: (photoId: string) => Promise<any>;
  triggerUpscale?: (photoId: string, factor: number) => Promise<any>;
}

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({
  photos,
  onPrint,
  triggerUpscale
}) => {
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoRecord | null>(null);
  const [qrModalVisible, setQrModalVisible] = useState<boolean>(false);
  const [printing, setPrinting] = useState<boolean>(false);
  const [upscaling, setUpscaling] = useState<boolean>(false);

  const openPhotoDetails = (photo: PhotoRecord) => {
    setSelectedPhoto(photo);
  };

  const closePhotoDetails = () => {
    setSelectedPhoto(null);
    setQrModalVisible(false);
  };

  const handlePrint = async (photoId: string) => {
    setPrinting(true);
    try {
      const updated = await onPrint(photoId);
      if (selectedPhoto && selectedPhoto.id === photoId) {
        setSelectedPhoto(updated);
      }
    } catch (err: any) {
      alert("Print failed: " + err.message);
    } finally {
      setPrinting(false);
    }
  };

  const handleUpscale = async (photoId: string, factor: number) => {
    if (!triggerUpscale) return;
    setUpscaling(true);
    try {
      const updated = await triggerUpscale(photoId, factor);
      if (selectedPhoto && selectedPhoto.id === photoId) {
        setSelectedPhoto(updated);
      }
    } catch (err: any) {
      alert("Upscale failed: " + err.message);
    } finally {
      setUpscaling(false);
    }
  };

  return (
    <div className="w-full">
      {photos.length === 0 ? (
        <div className="text-center py-16 border border-white/5 rounded-2xl bg-cyber-card p-8">
          <Sparkles className="w-10 h-10 text-gray-600 mx-auto mb-3 animate-pulse" />
          <p className="text-gray-400 font-orbitron tracking-widest text-xs">NO CREATIONS RECORDED</p>
          <p className="text-gray-500 text-xs mt-1">Start captured portraits in the Studio to build your portfolio!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {photos.map((photo) => (
            <motion.div
              key={photo.id}
              whileHover={{ y: -5 }}
              className="rounded-2xl overflow-hidden bg-cyber-dark border border-white/5 cursor-pointer shadow-md hover:shadow-neon-purple/20 transition-all duration-300"
              onClick={() => openPhotoDetails(photo)}
            >
              {/* Image thumbnail container */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-cyber-darker">
                <img
                  src={photo.anime_url}
                  alt={photo.style}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
                <div className="absolute top-2 right-2 px-2.5 py-1 rounded bg-cyber-darker/80 border border-white/10 text-[9px] font-orbitron tracking-wider text-cyber-neonPurple">
                  {photo.style.toUpperCase()}
                </div>
              </div>
              
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 flex items-center gap-1 font-mono uppercase">
                    <Calendar className="w-3 h-3" />
                    {new Date(photo.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-[10px] text-cyber-neonBlue font-orbitron">
                    {photo.processing_time_sec.toFixed(1)}s
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Interactive Detail Modal Backdrop */}
      <AnimatePresence>
        {selectedPhoto && (
          <div className="fixed inset-0 z-50 bg-cyber-darker/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-4xl glass-panel-glow border-cyber-purple/20 rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-2xl"
            >
              {/* Close float button */}
              <button
                onClick={closePhotoDetails}
                className="absolute top-4 right-4 z-40 p-2 rounded-full bg-cyber-darker/80 border border-white/10 hover:border-cyber-neonPink text-gray-400 hover:text-cyber-neonPink transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Left Side: Comparison slider */}
              <div className="flex-1 p-6 md:p-8 flex items-center justify-center bg-cyber-darker/40">
                <ImageCompare
                  original={selectedPhoto.original_url}
                  modified={selectedPhoto.upscaled_url || selectedPhoto.anime_url}
                />
              </div>

              {/* Right Side: Portrait Info & Booth Actions */}
              <div className="w-full md:w-80 p-6 md:p-8 border-t md:border-t-0 md:border-l border-white/5 flex flex-col justify-between bg-cyber-dark/80">
                <div>
                  <h3 className="font-orbitron font-extrabold text-lg text-white tracking-widest uppercase mb-1">
                    PAINTING SUMMARY
                  </h3>
                  <div className="w-12 h-1 bg-cyber-neonPurple rounded-full mb-6" />

                  <div className="flex flex-col gap-4 text-xs">
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">STYLE PRESET</span>
                      <span className="text-gray-200 font-semibold">{selectedPhoto.style}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">ENVIRONMENT</span>
                      <span className="text-gray-200 font-semibold">{selectedPhoto.background}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">INFERENCE TIME</span>
                      <span className="text-cyber-neonBlue font-mono font-bold">
                        {selectedPhoto.processing_time_sec.toFixed(3)}s
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span className="text-gray-500 font-orbitron">PRINT COPIES</span>
                      <span className="text-gray-200 font-mono">{selectedPhoto.print_count}</span>
                    </div>
                  </div>
                </div>

                {/* Booth action tools grid */}
                <div className="flex flex-col gap-3 mt-8">
                  {/* Print portrait */}
                  <button
                    onClick={() => handlePrint(selectedPhoto.id)}
                    disabled={printing}
                    className="w-full font-orbitron font-bold text-xs tracking-widest border border-cyber-purple/60 hover:border-cyber-neonPurple py-3 rounded-xl bg-cyber-purple/10 hover:bg-cyber-purple/25 text-white flex items-center justify-center gap-2 transition-all duration-300 shadow-neon-purple/10 shadow-sm"
                  >
                    <Printer className={`w-4 h-4 text-cyber-neonPurple ${printing ? 'animate-pulse' : ''}`} />
                    {printing ? 'PRINTING PORTRAIT...' : 'PRINT PORTRAIT'}
                  </button>

                  {/* Dynamic HD Upscaling */}
                  {triggerUpscale && !selectedPhoto.upscaled_url && (
                    <button
                      onClick={() => handleUpscale(selectedPhoto.id, 4)}
                      disabled={upscaling}
                      className="w-full font-orbitron font-bold text-xs tracking-widest border border-cyber-blue/60 hover:border-cyber-neonBlue py-3 rounded-xl bg-cyber-blue/10 hover:bg-cyber-blue/25 text-white flex items-center justify-center gap-2 transition-all duration-300"
                    >
                      <Sparkles className={`w-4 h-4 text-cyber-neonBlue ${upscaling ? 'animate-spin' : ''}`} />
                      {upscaling ? 'ENHANCING HD...' : 'UPGRADE TO HD (4X)'}
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {/* Share QR Modal toggle */}
                    <button
                      onClick={() => setQrModalVisible(true)}
                      className="font-orbitron font-semibold text-[10px] tracking-widest border border-white/10 hover:border-cyber-neonBlue py-2.5 rounded-lg text-gray-400 hover:text-cyber-neonBlue flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      MOBILE SYNC
                    </button>

                    {/* Download link proxy */}
                    <a
                      href={`http://localhost:8000/api/v1/download/file/anime/${selectedPhoto.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-orbitron font-semibold text-[10px] tracking-widest border border-white/10 hover:border-emerald-400 py-2.5 rounded-lg text-gray-400 hover:text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      DOWNLOAD
                    </a>
                  </div>
                </div>

              </div>

              {/* Floating Mobile QR Overlay */}
              <AnimatePresence>
                {qrModalVisible && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 bg-cyber-darker/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
                  >
                    <button
                      onClick={() => setQrModalVisible(false)}
                      className="absolute top-4 right-4 p-2 rounded-full bg-cyber-darker border border-white/10 text-gray-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    
                    <h4 className="font-orbitron font-bold text-sm tracking-widest text-white mb-2">
                      SCAN FOR MOBILE VIEW
                    </h4>
                    <p className="text-xs text-gray-400 max-w-xs mb-6">
                      Scan this QR code with your mobile camera to view, print, and save the painting onto your phone instantly.
                    </p>
                    
                    {/* QR Code iframe stream */}
                    <div className="p-3 rounded-2xl bg-white border border-cyber-neonBlue shadow-neon-blue">
                      <img
                        src={`http://localhost:8000/api/v1/download/qr/${selectedPhoto.id}?base_url=${window.location.origin}`}
                        alt="Mobile Scan QR"
                        className="w-44 h-44"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
export default PhotoGallery;
