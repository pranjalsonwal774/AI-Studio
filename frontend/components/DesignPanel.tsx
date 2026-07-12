import React from 'react';
import { GlassCard } from './GlassCard';
import { Palette, Landmark, Paintbrush, Moon, Sun, Layers } from 'lucide-react';
import { motion } from 'framer-motion';

interface StyleConfig {
  id: string;
  name: string;
  desc: string;
}

interface BackgroundConfig {
  id: string;
  name: string;
  desc: string;
}

interface DesignPanelProps {
  styles: StyleConfig[];
  backgrounds: BackgroundConfig[];
  selectedStyle: string;
  selectedBackground: string;
  onStyleSelect: (id: string) => void;
  onBackgroundSelect: (id: string) => void;
}

export const DesignPanel: React.FC<DesignPanelProps> = ({
  styles,
  backgrounds,
  selectedStyle,
  selectedBackground,
  onStyleSelect,
  onBackgroundSelect
}) => {

  // Style cards aesthetic mapping (inline visual representation)
  const styleGradients: Record<string, string> = {
    "Anime": "from-blue-500 via-indigo-600 to-cyber-purple",
    "Studio Ghibli inspired": "from-emerald-400 via-teal-600 to-amber-500",
    "Makoto Shinkai inspired": "from-cyan-400 via-sky-500 to-orange-400",
    "Cyberpunk": "from-fuchsia-600 via-purple-700 to-cyber-neonPink",
    "Watercolor": "from-indigo-300 via-sky-300 to-pink-300",
    "Manga": "from-gray-700 via-gray-900 to-black",
    "Comic": "from-red-500 via-yellow-500 to-cyber-blue",
    "Oil Painting": "from-amber-600 via-yellow-800 to-red-800"
  };

  const bgGradients: Record<string, string> = {
    "Cherry Blossoms": "from-pink-300 via-pink-400 to-purple-400",
    "Tokyo": "from-slate-900 via-indigo-950 to-indigo-900",
    "Cyber City": "from-cyber-darker via-purple-950 to-cyber-neonPink/20",
    "Temple": "from-orange-500 via-amber-600 to-yellow-800",
    "Beach": "from-cyan-400 via-sky-300 to-amber-100",
    "Castle": "from-slate-800 via-indigo-950 to-slate-900"
  };

  return (
    <div className="flex flex-col gap-8 w-full">
      
      {/* 1. Anime Style Carousel */}
      <div>
        <h3 className="font-orbitron font-bold text-sm tracking-widest text-cyber-neonPurple mb-4 flex items-center gap-2">
          <Palette className="w-4 h-4 text-cyber-purple animate-pulse" />
          CHOOSE ANIME STYLE
        </h3>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {styles.map((style) => {
            const isSelected = selectedStyle === style.id;
            return (
              <motion.div
                key={style.id}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onStyleSelect(style.id)}
                className={`relative rounded-xl p-[2px] cursor-pointer overflow-hidden transition-all duration-300 ${
                  isSelected 
                    ? 'shadow-neon-purple' 
                    : 'hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]'
                }`}
              >
                {/* Border flow gradient layer */}
                <div className={`absolute inset-0 bg-gradient-to-tr ${
                  isSelected 
                    ? 'from-cyber-purple via-pink-400 to-cyber-neonBlue animate-pulse' 
                    : 'from-white/5 to-white/5'
                }`} />

                {/* Main Card Content */}
                <div className="relative rounded-[10px] bg-cyber-dark p-4 h-full flex flex-col justify-between">
                  <div>
                    {/* Tiny styled color thumbnail */}
                    <div className={`w-full h-12 rounded-lg bg-gradient-to-r ${styleGradients[style.id] || 'from-indigo-900 to-cyber-purple'} mb-3 opacity-85`} />
                    <h4 className="font-orbitron text-xs font-bold text-gray-200 tracking-wider">
                      {style.name}
                    </h4>
                  </div>
                  <p className="text-[10px] text-gray-500 font-sans mt-1 leading-normal">
                    {style.desc}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* 2. Replacement Background Carousel */}
      <div>
        <h3 className="font-orbitron font-bold text-sm tracking-widest text-cyber-neonBlue mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyber-blue animate-pulse" />
          SELECT ENVIRONMENT BACKDROP
        </h3>
        
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          {backgrounds.map((bg) => {
            const isSelected = selectedBackground === bg.id;
            return (
              <motion.div
                key={bg.id}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onBackgroundSelect(bg.id)}
                className={`relative rounded-xl p-[1px] cursor-pointer overflow-hidden transition-all duration-300 ${
                  isSelected 
                    ? 'shadow-neon-blue' 
                    : 'hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]'
                }`}
              >
                {/* Border layer */}
                <div className={`absolute inset-0 bg-gradient-to-tr ${
                  isSelected 
                    ? 'from-cyber-blue to-teal-400' 
                    : 'from-white/5 to-white/5'
                }`} />

                <div className="relative rounded-[11px] bg-cyber-dark p-3 h-full flex flex-col justify-between text-center">
                  <div>
                    <div className={`w-full h-10 rounded-md bg-gradient-to-br ${bgGradients[bg.id] || 'from-slate-800 to-slate-900'} mb-2`} />
                    <h4 className="font-orbitron text-[10px] font-bold text-gray-300 tracking-wide truncate">
                      {bg.name}
                    </h4>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
export default DesignPanel;
