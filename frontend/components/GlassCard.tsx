import React from 'react';
import { motion } from 'framer-motion';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'blue' | 'purple' | 'pink' | 'none';
  onClick?: () => void;
  hoverGlow?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  glowColor = 'none',
  onClick,
  hoverGlow = false
}) => {
  const glowClasses = {
    blue: 'shadow-neon-blue border-cyber-blue/30',
    purple: 'shadow-neon-purple border-cyber-purple/30',
    pink: 'shadow-neon-pink border-cyber-neonPink/30',
    none: 'border-white/5'
  };

  const hoverEffect = hoverGlow && onClick ? {
    whileHover: { 
      scale: 1.02, 
      boxShadow: glowColor === 'none' 
        ? "0 10px 30px rgba(0, 240, 255, 0.15)"
        : undefined,
      borderColor: "rgba(0, 240, 255, 0.4)"
    },
    whileTap: { scale: 0.98 }
  } : {};

  return (
    <motion.div
      {...hoverEffect}
      onClick={onClick}
      className={`glass-panel rounded-2xl p-6 transition-all duration-300 ${onClick ? 'cursor-pointer' : ''} ${glowClasses[glowColor]} ${className}`}
    >
      {children}
    </motion.div>
  );
};
export default GlassCard;
