import React from 'react';
import { Loader2, Sparkles, Wand2, ShieldCheck, Eye, Paintbrush, Layers } from 'lucide-react';
import { motion } from 'framer-motion';

interface LoadingOverlayProps {
  progress: number;
  status: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  progress,
  status
}) => {
  
  // Decide which icon matches current step progress
  const getStepIcon = () => {
    if (progress < 25) return <Layers className="w-8 h-8 text-cyber-blue animate-pulse" />;
    if (progress < 60) return <Wand2 className="w-8 h-8 text-cyber-purple animate-bounce" />;
    if (progress < 90) return <Paintbrush className="w-8 h-8 text-pink-400 animate-spin" />;
    return <ShieldCheck className="w-8 h-8 text-emerald-400" />;
  };

  const stepDetails = () => {
    if (progress < 20) return "Preparing image for neural style transfer...";
    if (progress < 40) return "Running white balance and exposure correction...";
    if (progress < 65) return "AnimeGANv2 neural network transforming your portrait...";
    if (progress < 85) return "Applying style-specific colour grading and atmosphere...";
    return "Upscaling and sharpening final artwork...";
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#06060c]/90 backdrop-blur-md flex items-center justify-center p-6">
      
      {/* Mesh glow nodes behind loader */}
      <div className="absolute w-72 h-72 rounded-full bg-cyber-purple/10 blur-[100px] animate-pulse" />
      <div className="absolute w-72 h-72 rounded-full bg-cyber-blue/10 blur-[100px] animate-pulse delay-700" />

      {/* Laser horizontal scan line */}
      <div className="absolute top-0 bottom-0 left-0 right-0 z-10 w-full h-[2px] bg-gradient-to-r from-transparent via-cyber-neonBlue to-transparent shadow-neon-blue animate-scanline" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md glass-panel-glow border-cyber-purple/20 p-8 rounded-3xl text-center flex flex-col items-center"
      >
        {/* Futuristic glowing spin ring */}
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full border-2 border-white/5 flex items-center justify-center p-2">
            <div className="absolute inset-0 rounded-full border-t-2 border-cyber-neonBlue border-r-2 border-transparent animate-spin" />
            <div className="absolute inset-2 rounded-full border-b-2 border-cyber-neonPurple border-l-2 border-transparent animate-spin-reverse" />
            {getStepIcon()}
          </div>
          <Sparkles className="w-4 h-4 text-cyber-neonBlue absolute -top-1 -right-1 animate-ping" />
        </div>

        <h3 className="font-orbitron font-extrabold text-lg text-white tracking-widest uppercase mb-1">
          Synthesizing Artwork
        </h3>
        
        <p className="font-orbitron text-xs text-cyber-neonBlue tracking-wider animate-pulse mb-6">
          {progress}% COMPLETED
        </p>

        {/* Outer progress shell */}
        <div className="w-full h-2 bg-cyber-darker rounded-full border border-white/5 overflow-hidden p-[1px] mb-6">
          <div 
            className="h-full bg-gradient-to-r from-cyber-purple via-pink-500 to-cyber-neonBlue rounded-full shadow-neon-blue transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="text-gray-400 text-sm font-semibold tracking-wide">
          {status === 'processing' ? 'Running Model Inference...' : status}
        </div>
        
        <p className="text-xs text-gray-500 mt-2 italic max-w-xs">
          {stepDetails()}
        </p>

      </motion.div>
    </div>
  );
};
export default LoadingOverlay;
