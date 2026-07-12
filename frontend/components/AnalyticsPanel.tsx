import React from 'react';
import { Camera, Users, Printer, Clock, BarChart2 } from 'lucide-react';
import { GlassCard } from './GlassCard';

interface AnalyticsData {
  total_photos: number;
  total_users: number;
  total_prints: number;
  avg_latency_ms: number;
  styles_distribution: Record<string, number>;
  backgrounds_distribution: Record<string, number>;
}

interface AnalyticsPanelProps {
  data: AnalyticsData;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ data }) => {
  
  // Find max count for style relative percentage rendering
  const maxStyleCount = Math.max(...Object.values(data.styles_distribution), 1);
  const maxBgCount = Math.max(...Object.values(data.backgrounds_distribution), 1);

  return (
    <div className="flex flex-col gap-8 w-full">
      
      {/* High-level counters grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        <GlassCard glowColor="purple" className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-cyber-purple/10 border border-cyber-purple/20">
            <Camera className="w-6 h-6 text-cyber-purple" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-orbitron">TOTAL PHOTOS</p>
            <p className="text-xl font-bold text-gray-100">{data.total_photos}</p>
          </div>
        </GlassCard>

        <GlassCard glowColor="blue" className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-cyber-blue/10 border border-cyber-blue/20">
            <Users className="w-6 h-6 text-cyber-blue" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-orbitron">TOTAL USERS</p>
            <p className="text-xl font-bold text-gray-100">{data.total_users}</p>
          </div>
        </GlassCard>

        <GlassCard glowColor="pink" className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-cyber-neonPink/10 border border-cyber-neonPink/20">
            <Printer className="w-6 h-6 text-cyber-neonPink" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-orbitron">TOTAL PRINTS</p>
            <p className="text-xl font-bold text-gray-100">{data.total_prints}</p>
          </div>
        </GlassCard>

        <GlassCard className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <Clock className="w-6 h-6 text-gray-300" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 font-orbitron">AVG PROCESS TIME</p>
            <p className="text-xl font-bold text-cyber-neonBlue font-mono">
              {(data.avg_latency_ms / 1000).toFixed(2)}s
            </p>
          </div>
        </GlassCard>

      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Style distribution chart representation */}
        <GlassCard>
          <h3 className="font-orbitron font-bold text-xs tracking-widest text-cyber-neonPurple mb-6 flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            POPULAR AESTHETICS STYLE
          </h3>
          <div className="flex flex-col gap-4">
            {Object.entries(data.styles_distribution).length === 0 ? (
              <p className="text-xs text-gray-500">No generation statistics available.</p>
            ) : (
              Object.entries(data.styles_distribution)
                .sort((a, b) => b[1] - a[1])
                .map(([styleName, count]) => {
                  const percent = (count / maxStyleCount) * 100;
                  return (
                    <div key={styleName} className="text-xs">
                      <div className="flex items-center justify-between font-orbitron text-gray-300 mb-1.5">
                        <span>{styleName}</span>
                        <span className="text-gray-500">{count} runs</span>
                      </div>
                      <div className="w-full h-2 bg-cyber-darker rounded-full overflow-hidden border border-white/5 p-[1px]">
                        <div 
                          className="h-full bg-gradient-to-r from-cyber-purple to-pink-500 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </GlassCard>

        {/* Environment distribution chart representation */}
        <GlassCard>
          <h3 className="font-orbitron font-bold text-xs tracking-widest text-cyber-neonBlue mb-6 flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            ENVIRONMENT ENVIRONMENT BACKDROP
          </h3>
          <div className="flex flex-col gap-4">
            {Object.entries(data.backgrounds_distribution).length === 0 ? (
              <p className="text-xs text-gray-500">No background replacement statistics available.</p>
            ) : (
              Object.entries(data.backgrounds_distribution)
                .sort((a, b) => b[1] - a[1])
                .map(([bgName, count]) => {
                  const percent = (count / maxBgCount) * 100;
                  return (
                    <div key={bgName} className="text-xs">
                      <div className="flex items-center justify-between font-orbitron text-gray-300 mb-1.5">
                        <span>{bgName}</span>
                        <span className="text-gray-500">{count} runs</span>
                      </div>
                      <div className="w-full h-2 bg-cyber-darker rounded-full overflow-hidden border border-white/5 p-[1px]">
                        <div 
                          className="h-full bg-gradient-to-r from-cyber-blue to-teal-400 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </GlassCard>

      </div>

    </div>
  );
};
export default AnalyticsPanel;
