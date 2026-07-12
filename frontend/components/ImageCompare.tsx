import React, { useState } from 'react';
import { Columns } from 'lucide-react';

interface ImageCompareProps {
  original: string;
  modified: string;
  heightClass?: string;
}

export const ImageCompare: React.FC<ImageCompareProps> = ({
  original,
  modified,
  heightClass = "aspect-[4/3] w-full"
}) => {
  const [sliderPosition, setSliderPosition] = useState<number>(50);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSliderPosition(Number(e.target.value));
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/5 select-none ${heightClass}`}>
      
      {/* Background/Base Image (Anime Modified) */}
      <img
        src={modified}
        alt="Anime Portrait Painting"
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />

      {/* Overlay Image (Original Capture) clipped dynamically */}
      <div 
        className="absolute inset-0 w-full h-full"
        style={{ clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)` }}
      >
        <img
          src={original}
          alt="Original WebCam Capture"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
        {/* Before label */}
        <span className="absolute bottom-4 left-4 z-20 font-orbitron text-[10px] tracking-widest bg-cyber-darker/80 border border-white/10 px-2 py-1 rounded text-gray-400">
          ORIGINAL
        </span>
      </div>

      {/* After label (on the right side) */}
      <span className="absolute bottom-4 right-4 z-20 font-orbitron text-[10px] tracking-widest bg-cyber-darker/80 border border-white/10 px-2 py-1 rounded text-cyber-neonBlue">
        ANIME ART
      </span>

      {/* Slide Handle Divider Bar */}
      <div 
        className="absolute top-0 bottom-0 z-30 w-[2px] bg-cyber-neonBlue pointer-events-none"
        style={{ left: `${sliderPosition}%` }}
      >
        {/* Blinking handle icon */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-cyber-darker border border-cyber-neonBlue flex items-center justify-center shadow-neon-blue">
          <Columns className="w-3.5 h-3.5 text-cyber-neonBlue" />
        </div>
      </div>

      {/* Interactive Range Input Overlay */}
      <input
        type="range"
        min="0"
        max="100"
        value={sliderPosition}
        onChange={handleSliderChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-40"
      />

    </div>
  );
};
export default ImageCompare;
