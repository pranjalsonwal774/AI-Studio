/**
 * InitLoader.tsx — Per-subsystem loading progress display
 *
 * Shows exactly which component is loading/ready/failed.
 * Replaces the generic "Loading face tracking engine..." spinner.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Loader, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import type { Subsystems, SubStatus, InitStage, InitLog } from '../hooks/useInitMachine';

// ─────────────────────────────────────────────────────────────────────────────
// Sub-system row
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<SubStatus, { icon: React.ReactNode; color: string; label: string }> = {
  waiting:  { icon: <Clock className="w-3.5 h-3.5" />,       color: 'text-gray-600',    label: 'Waiting' },
  loading:  { icon: <Loader className="w-3.5 h-3.5 animate-spin" />, color: 'text-cyan-400', label: 'Loading...' },
  retrying: { icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />, color: 'text-amber-400', label: 'Retrying...' },
  ready:    { icon: <CheckCircle className="w-3.5 h-3.5" />,  color: 'text-emerald-400', label: 'Ready' },
  error:    { icon: <XCircle className="w-3.5 h-3.5" />,     color: 'text-red-400',     label: 'Failed' },
};

const SYSTEM_LABELS: Record<keyof Subsystems, string> = {
  camera:      'Camera',
  video:       'Video Signal',
  mediapipe:   'MediaPipe / AI',
  faceTracking:'Face Tracking',
  avatar:      'Ghibli Avatar',
  renderer:    'Renderer',
};

function SubsystemRow({
  name, status, isActive,
}: {
  name: keyof Subsystems;
  status: SubStatus;
  isActive: boolean;
}) {
  const cfg = STATUS_CFG[status];
  return (
    <motion.div
      layout
      className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-300 ${
        isActive ? 'bg-white/5 border border-white/8' : 'bg-transparent'
      }`}
    >
      <span className={`text-[10px] font-orbitron tracking-widest uppercase ${
        status === 'waiting' ? 'text-gray-600' : 'text-gray-300'
      }`}>
        {SYSTEM_LABELS[name]}
      </span>
      <span className={`flex items-center gap-1.5 text-[10px] font-mono ${cfg.color}`}>
        {cfg.icon}
        {cfg.label}
      </span>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage → which subsystem is "active" (currently being initialized)
// ─────────────────────────────────────────────────────────────────────────────
const STAGE_ACTIVE: Partial<Record<InitStage, keyof Subsystems>> = {
  camera_permission: 'camera',
  camera_init:       'camera',
  video_ready:       'video',
  model_loading:     'mediapipe',
  model_warmup:      'mediapipe',
  face_tracking:     'faceTracking',
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface InitLoaderProps {
  stage: InitStage;
  subsystems: Subsystems;
  progress: number;
  stageLabel: string;
  errorMessage: string | null;
  logs: InitLog[];
  onRetry: () => void;
  onFallback: () => void;
  showDiagnostics?: boolean;
  onToggleDiagnostics?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export const InitLoader: React.FC<InitLoaderProps> = ({
  stage,
  subsystems,
  progress,
  stageLabel,
  errorMessage,
  logs,
  onRetry,
  onFallback,
  showDiagnostics = false,
  onToggleDiagnostics,
}) => {
  const activeSystem = STAGE_ACTIVE[stage] ?? null;
  const isError      = stage === 'error';
  const isFallback   = stage === 'fallback';

  const SYSTEMS: (keyof Subsystems)[] = [
    'camera', 'video', 'mediapipe', 'faceTracking', 'avatar', 'renderer',
  ];

  return (
    <motion.div
      key="init-loader"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#05050a] z-40 p-5"
    >
      {/* ── Animated orb ── */}
      <div className="relative mb-5 w-16 h-16 shrink-0">
        <div className={`absolute inset-0 rounded-full blur-xl animate-pulse ${
          isError ? 'bg-red-500/20' : isFallback ? 'bg-amber-500/15' : 'bg-emerald-500/20'
        }`} />
        <div className={`absolute inset-0 rounded-full border ${
          isError ? 'border-red-500/30' : 'border-emerald-400/20'
        }`} />
        {!isError && (
          <div className={`absolute inset-0 rounded-full border-t-2 animate-spin ${
            isFallback ? 'border-amber-400' : 'border-emerald-400'
          }`} />
        )}
        <div className="absolute inset-0 flex items-center justify-center text-xl">
          {isError ? '⚠️' : isFallback ? '📷' : '✨'}
        </div>
      </div>

      {/* ── Title ── */}
      <h3 className={`font-orbitron font-bold text-xs tracking-widest uppercase mb-1 ${
        isError ? 'text-red-400' : 'text-white'
      }`}>
        {isError ? 'Initialization Failed'
          : isFallback ? 'Camera Ready (AI Unavailable)'
          : 'Starting AI Mirror'}
      </h3>

      {/* ── Current action label ── */}
      <p className={`text-[10px] font-mono tracking-wider mb-4 text-center max-w-[220px] leading-relaxed ${
        isError ? 'text-red-300' : 'text-emerald-400/80 animate-pulse'
      }`}>
        {isError ? (errorMessage ?? 'Unknown error') : stageLabel}
      </p>

      {/* ── Progress bar ── */}
      {!isError && (
        <div className="w-48 h-[3px] bg-white/5 rounded-full overflow-hidden mb-4">
          <motion.div
            className={`h-full rounded-full ${
              isFallback
                ? 'bg-amber-400'
                : 'bg-gradient-to-r from-emerald-400 to-cyan-400'
            }`}
            animate={{ width: `${Math.max(4, progress)}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        </div>
      )}

      {/* ── Subsystem checklist ── */}
      <div className="w-full max-w-[240px] flex flex-col gap-0.5 mb-4">
        {SYSTEMS.map(name => (
          <SubsystemRow
            key={name}
            name={name}
            status={subsystems[name]}
            isActive={activeSystem === name}
          />
        ))}
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-2">
        {isError && (
          <button
            onClick={onRetry}
            className="font-orbitron text-[9px] tracking-widest border border-emerald-500/50 hover:border-emerald-400 px-4 py-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          >
            RETRY
          </button>
        )}
        {(isError || stage === 'model_loading') && (
          <button
            onClick={onFallback}
            className="font-orbitron text-[9px] tracking-widest border border-white/15 hover:border-white/40 px-4 py-2 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            USE CAMERA ONLY
          </button>
        )}
      </div>

      {/* ── Diagnostics toggle ── */}
      <button
        onClick={onToggleDiagnostics}
        className="mt-4 text-[9px] font-mono text-gray-700 hover:text-gray-400 transition-colors"
      >
        {showDiagnostics ? '▲ HIDE LOGS' : '▼ SHOW LOGS'}
      </button>

      {/* ── Log console ── */}
      <AnimatePresence>
        {showDiagnostics && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 120, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full max-w-xs overflow-hidden mt-2"
          >
            <div className="h-[120px] overflow-y-auto bg-black/60 rounded-lg p-2 font-mono text-[8px] border border-white/5 flex flex-col gap-0.5">
              {logs.length === 0
                ? <span className="text-gray-700">No logs yet.</span>
                : [...logs].reverse().map((l, i) => (
                    <div key={i} className="flex gap-1.5">
                      <span className="text-gray-700 shrink-0">
                        {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
                      </span>
                      <span className={`shrink-0 ${
                        l.level === 'error' ? 'text-red-400'
                        : l.level === 'warn' ? 'text-amber-400'
                        : 'text-cyan-500'
                      }`}>
                        [{l.tag}]
                      </span>
                      <span className={
                        l.level === 'error' ? 'text-red-300'
                        : l.level === 'warn' ? 'text-amber-300/70'
                        : 'text-gray-400'
                      }>
                        {l.msg}
                      </span>
                    </div>
                  ))
              }
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DiagnosticsPanel — always-visible HUD overlay for debug mode
// ─────────────────────────────────────────────────────────────────────────────
interface DiagnosticsProps {
  stage: InitStage;
  subsystems: Subsystems;
  fps: number;
  faceCount: number;
  logs: InitLog[];
}

export const DiagnosticsPanel: React.FC<DiagnosticsProps> = ({
  stage, subsystems, fps, faceCount, logs,
}) => {
  const SYSTEMS: (keyof Subsystems)[] = [
    'camera', 'video', 'mediapipe', 'faceTracking', 'avatar', 'renderer',
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="absolute top-3 left-3 z-30 bg-black/80 border border-white/8 rounded-xl p-3 backdrop-blur-sm"
      style={{ minWidth: 180 }}
    >
      <p className="font-orbitron text-[8px] text-gray-500 tracking-widest uppercase mb-2">DIAGNOSTICS</p>

      {SYSTEMS.map(name => {
        const s = subsystems[name];
        const cfg = STATUS_CFG[s];
        return (
          <div key={name} className="flex items-center justify-between gap-3 mb-1">
            <span className="text-[9px] text-gray-500 font-orbitron tracking-wider">{SYSTEM_LABELS[name]}</span>
            <span className={`flex items-center gap-1 text-[9px] font-mono ${cfg.color}`}>
              {cfg.icon} {s}
            </span>
          </div>
        );
      })}

      <div className="border-t border-white/5 mt-2 pt-2 flex gap-3">
        <div className="text-[8px] font-mono text-gray-600">
          Stage: <span className="text-cyan-400">{stage}</span>
        </div>
        <div className="text-[8px] font-mono text-gray-600">
          Faces: <span className="text-emerald-400">{faceCount}</span>
        </div>
        <div className="text-[8px] font-mono text-gray-600">
          FPS: <span className="text-purple-400">{fps}</span>
        </div>
      </div>

      <div className="mt-2 max-h-16 overflow-y-auto">
        {logs.slice(-6).reverse().map((l, i) => (
          <div key={i} className={`text-[7px] font-mono leading-4 ${
            l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-amber-400' : 'text-gray-600'
          }`}>
            [{l.tag}] {l.msg}
          </div>
        ))}
      </div>
    </motion.div>
  );
};
