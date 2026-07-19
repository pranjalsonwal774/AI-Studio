/**
 * useCameraManager — Production-Grade Webcam Management Hook
 *
 * Subsystems:
 *  - PermissionManager  : checks + monitors browser camera permissions
 *  - DeviceMonitor      : enumerates cameras, listens for device changes
 *  - StreamManager      : opens / tears down MediaStream safely
 *  - RecoveryManager    : exponential-backoff retry (1s→2s→5s→10s, max 5)
 *  - HealthMonitor      : 2-second liveness watchdog, auto-restarts stalled stream
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CameraPhase =
  | 'checking'          // verifying HTTPS + permissions
  | 'requesting'        // calling getUserMedia
  | 'initializing'      // stream obtained, waiting for video readyState ≥ 3
  | 'ready'             // live, healthy
  | 'permission_denied' // NotAllowedError / SecurityError — user must grant
  | 'not_found'         // no camera device found
  | 'in_use'            // NotReadableError / AbortError — another app owns it
  | 'reconnecting'      // auto-retry in progress
  | 'disconnected'      // stream went dead, searching for device
  | 'https_required'    // HTTP context — cannot continue
  | 'error';            // unrecoverable

export interface CameraDevice {
  deviceId: string;
  label: string;
  facing: 'user' | 'environment' | 'unknown';
}

export interface CameraLog {
  ts: number;
  tag: string;
  msg: string;
}

export interface CameraManagerState {
  phase: CameraPhase;
  stream: MediaStream | null;
  devices: CameraDevice[];
  activeDeviceId: string | null;
  retryAttempt: number;     // 0 = not retrying
  maxRetries: number;
  nextRetryIn: number;      // seconds until next attempt
  errorMessage: string;
  logs: CameraLog[];
  // actions
  retryNow: () => void;
  switchCamera: (deviceId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES    = 5;
const RETRY_DELAYS   = [1, 2, 5, 10, 20]; // seconds
const HEALTH_INTERVAL = 2000;              // ms

const IDEAL_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width:     { ideal: 1920, min: 640 },
    height:    { ideal: 1080, min: 480 },
    frameRate: { ideal: 60,  min: 15 },
    facingMode: 'user',
  },
  audio: false,
};

const FALLBACK_CONSTRAINTS: MediaStreamConstraints = {
  video: true,
  audio: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseError(err: unknown): { phase: CameraPhase; message: string } {
  const e = err as DOMException;
  switch (e?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { phase: 'permission_denied', message: 'Camera permission denied. Click "Enable Camera" below.' };
    case 'SecurityError':
      return { phase: 'permission_denied', message: 'Camera blocked by browser security policy.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { phase: 'not_found', message: 'No camera found. Connect a webcam and try again.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { phase: 'in_use', message: 'Camera is in use by another application (Zoom, Teams, OBS…). Close it and retry.' };
    case 'AbortError':
      return { phase: 'in_use', message: 'Camera initialization aborted — another process may be using it.' };
    case 'OverconstrainedError':
      return { phase: 'error', message: 'Requested camera resolution is not supported. Trying lower quality…' };
    case 'InvalidStateError':
      return { phase: 'error', message: 'Camera is in an invalid state. The page may need a reload.' };
    default:
      return { phase: 'error', message: `Camera error: ${e?.message || String(err)}` };
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
}

async function enumerateDevices(): Promise<CameraDevice[]> {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs
      .filter(d => d.kind === 'videoinput')
      .map(d => ({
        deviceId: d.deviceId,
        label:    d.label || `Camera ${d.deviceId.slice(0, 6)}`,
        facing:   d.label.toLowerCase().includes('front') || d.label.toLowerCase().includes('user')
                    ? 'user'
                    : d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment')
                      ? 'environment'
                      : 'unknown',
      }));
  } catch {
    return [];
  }
}

async function checkPermission(): Promise<PermissionState | 'unknown'> {
  try {
    if (!navigator.permissions) return 'unknown';
    const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return result.state;
  } catch {
    return 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useCameraManager(
  videoRef: React.RefObject<HTMLVideoElement>
): CameraManagerState {

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase,          setPhase]          = useState<CameraPhase>('checking');
  const [stream,         setStream]         = useState<MediaStream | null>(null);
  const [devices,        setDevices]        = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [retryAttempt,   setRetryAttempt]   = useState(0);
  const [nextRetryIn,    setNextRetryIn]     = useState(0);
  const [errorMessage,   setErrorMessage]   = useState('');
  const [logs,           setLogs]           = useState<CameraLog[]>([]);

  // ── Refs (mutable, no re-render) ───────────────────────────────────────────
  const streamRef        = useRef<MediaStream | null>(null);
  const retryTimerRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const countdownRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const permQueryRef     = useRef<PermissionStatus | null>(null);
  const deviceChangeRef  = useRef(false);
  const mountedRef       = useRef(true);
  const retryCountRef    = useRef(0);
  const activeDeviceRef  = useRef<string | null>(null);

  // ── Logging ────────────────────────────────────────────────────────────────
  const log = useCallback((tag: string, msg: string) => {
    console.log(`[${tag}] ${msg}`);
    if (!mountedRef.current) return;
    setLogs(prev => [...prev.slice(-49), { ts: Date.now(), tag, msg }]);
  }, []);

  // ── Bind stream to video element ───────────────────────────────────────────
  const bindStream = useCallback(async (s: MediaStream): Promise<boolean> => {
    const v = videoRef.current;
    if (!v) return false;
    if (v.srcObject === s) return true;
    v.srcObject = s;
    v.muted = true;
    try {
      await v.play();
      return true;
    } catch (playErr: any) {
      // Autoplay blocked — try with user gesture hint
      log('Stream', `play() blocked: ${playErr.message}. Waiting for interaction...`);
      const resume = () => { v.play().catch(() => {}); document.removeEventListener('click', resume); };
      document.addEventListener('click', resume, { once: true });
      return true; // Optimistic — will play on first click
    }
  }, [videoRef, log]);

  // ── Stop health monitor ────────────────────────────────────────────────────
  const stopHealth = useCallback(() => {
    if (healthRef.current) { clearInterval(healthRef.current); healthRef.current = null; }
  }, []);

  // ── Stop retry timers ──────────────────────────────────────────────────────
  const stopRetry = useCallback(() => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current);  retryTimerRef.current = null; }
    if (countdownRef.current)  { clearInterval(countdownRef.current);  countdownRef.current  = null; }
  }, []);

  // ── Full cleanup ───────────────────────────────────────────────────────────
  const fullCleanup = useCallback(() => {
    stopHealth();
    stopRetry();
    stopStream(streamRef.current);
    streamRef.current = null;
    const v = videoRef.current;
    if (v) { v.srcObject = null; v.load(); }
  }, [stopHealth, stopRetry, videoRef]);

  // ── Main initialization ────────────────────────────────────────────────────
  const initialize = useCallback(async (deviceId?: string | null, isRetry = false) => {
    if (!mountedRef.current) return;

    // 1. HTTPS check
    if (typeof window !== 'undefined' && !window.isSecureContext &&
        window.location.protocol !== 'http:' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1') {
      log('Security', 'Not a secure context');
      setPhase('https_required');
      setErrorMessage('Camera requires HTTPS. Please open this app over a secure connection.');
      return;
    }

    // 2. mediaDevices API check
    if (!navigator?.mediaDevices?.getUserMedia) {
      log('Camera', 'getUserMedia not supported');
      setPhase('error');
      setErrorMessage('Your browser does not support camera access. Try Chrome or Firefox.');
      return;
    }

    log('Camera', 'Checking permissions...');
    setPhase('checking');

    // 3. Permission pre-check (non-blocking — some browsers don't support it)
    const perm = await checkPermission();
    log('Permission', `State: ${perm}`);
    if (perm === 'denied') {
      setPhase('permission_denied');
      setErrorMessage('Camera permission is blocked. Click the camera icon in your browser address bar to allow access.');
      return;
    }

    // 4. Enumerate devices
    const devList = await enumerateDevices();
    if (mountedRef.current) { setDevices(devList); }
    log('Device', `Found ${devList.length} camera(s)`);

    if (devList.length === 0 && perm !== 'granted') {
      // Might be no devices OR no permission to enumerate — attempt anyway
      log('Device', 'No cameras found yet — attempting getUserMedia to trigger permission');
    }

    // 5. Build constraints
    const targetId = deviceId ?? activeDeviceRef.current ?? devList[0]?.deviceId ?? null;
    const constraints: MediaStreamConstraints = {
      ...IDEAL_CONSTRAINTS,
      video: {
        ...(IDEAL_CONSTRAINTS.video as MediaTrackConstraints),
        ...(targetId ? { deviceId: { exact: targetId } } : {}),
      },
    };

    // 6. Stop previous stream
    stopStream(streamRef.current);
    streamRef.current = null;

    log('Stream', 'Requesting camera access...');
    setPhase('requesting');

    let newStream: MediaStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err1) {
      // Fallback: try without device constraint
      if (targetId) {
        try {
          log('Stream', 'Retrying with relaxed constraints...');
          newStream = await navigator.mediaDevices.getUserMedia(FALLBACK_CONSTRAINTS);
        } catch (err2) {
          const { phase: p, message: m } = parseError(err2);
          log('Stream', `Failed: ${m}`);
          if (!mountedRef.current) return;
          setPhase(p);
          setErrorMessage(m);
          if (p !== 'permission_denied' && p !== 'https_required' && p !== 'not_found') {
            scheduleRetry();
          }
          return;
        }
      } else {
        const { phase: p, message: m } = parseError(err1);
        log('Stream', `Failed: ${m}`);
        if (!mountedRef.current) return;
        setPhase(p);
        setErrorMessage(m);
        if (p !== 'permission_denied' && p !== 'https_required' && p !== 'not_found') {
          scheduleRetry();
        }
        return;
      }
    }

    if (!mountedRef.current) { stopStream(newStream); return; }

    // 7. Re-enumerate now that we have permission (labels become visible)
    const devListFull = await enumerateDevices();
    if (mountedRef.current) setDevices(devListFull);

    const track = newStream.getVideoTracks()[0];
    const settings = track?.getSettings();
    log('Camera', `Stream active — ${settings?.width}×${settings?.height} @ ${settings?.frameRate?.toFixed(0)}fps`);

    // 8. Bind to video element and wait for readyState ≥ HAVE_ENOUGH_DATA
    setPhase('initializing');
    log('Stream', 'Binding to video element...');

    streamRef.current = newStream;
    const usedDeviceId = settings?.deviceId ?? targetId;
    activeDeviceRef.current = usedDeviceId ?? null;
    if (mountedRef.current) {
      setActiveDeviceId(usedDeviceId ?? null);
      setStream(newStream);
    }

    await bindStream(newStream);

    // Wait for video to have enough data
    await new Promise<void>(resolve => {
      const v = videoRef.current;
      if (!v || v.readyState >= 3) { resolve(); return; }
      const onReady = () => { v.removeEventListener('canplay', onReady); resolve(); };
      v.addEventListener('canplay', onReady);
      setTimeout(resolve, 4000); // max 4s wait
    });

    if (!mountedRef.current) { stopStream(newStream); return; }

    // 9. Done — reset retry counter
    retryCountRef.current = 0;
    if (mountedRef.current) {
      setRetryAttempt(0);
      setNextRetryIn(0);
      setPhase('ready');
      setErrorMessage('');
    }

    log('Mirror', 'AI Mirror online ✓');

    // 10. Start health monitor
    startHealthMonitor();

    // 11. Handle stream ending (USB disconnect etc.)
    track?.addEventListener('ended', () => {
      log('Stream', 'Track ended — device disconnected');
      if (mountedRef.current) {
        setPhase('disconnected');
        setErrorMessage('Camera disconnected. Waiting for reconnect...');
        streamRef.current = null;
        setStream(null);
        scheduleRetry(true);
      }
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindStream, log, videoRef]);

  // ── Retry scheduler ────────────────────────────────────────────────────────
  const scheduleRetry = useCallback((isDisconnect = false) => {
    if (!mountedRef.current) return;
    if (retryCountRef.current >= MAX_RETRIES) {
      log('Recovery', 'Max retries reached — waiting for manual retry');
      setPhase('error');
      setErrorMessage('Could not connect to camera after multiple attempts. Click "Retry" to try again.');
      return;
    }

    const attempt = retryCountRef.current + 1;
    retryCountRef.current = attempt;
    const delay = RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];

    log('Recovery', `Retry ${attempt}/${MAX_RETRIES} in ${delay}s`);
    setRetryAttempt(attempt);
    setNextRetryIn(delay);
    setPhase('reconnecting');

    // Countdown display
    if (countdownRef.current) clearInterval(countdownRef.current);
    let remaining = delay;
    countdownRef.current = setInterval(() => {
      remaining--;
      if (mountedRef.current) setNextRetryIn(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
      }
    }, 1000);

    retryTimerRef.current = setTimeout(() => {
      if (mountedRef.current) initialize(activeDeviceRef.current, true);
    }, delay * 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log]);

  // ── Health monitor ─────────────────────────────────────────────────────────
  const startHealthMonitor = useCallback(() => {
    stopHealth();
    healthRef.current = setInterval(() => {
      const s = streamRef.current;
      const v = videoRef.current;
      if (!s || !v || !mountedRef.current) return;

      const tracks = s.getVideoTracks();
      const isActive = tracks.length > 0 && tracks[0].readyState === 'live';

      if (!isActive) {
        log('Health', 'Stream stalled — restarting');
        stopHealth();
        setPhase('disconnected');
        setErrorMessage('Camera stream stalled. Reconnecting...');
        streamRef.current = null;
        setStream(null);
        scheduleRetry(true);
        return;
      }

      // Check video is actually progressing (not frozen)
      if (v.readyState < 2 && v.srcObject) {
        log('Health', 'Video element stalled — rebinding');
        bindStream(s).catch(() => {});
      }
    }, HEALTH_INTERVAL);
  }, [stopHealth, videoRef, log, scheduleRetry, bindStream]);

  // ── Permission change listener ─────────────────────────────────────────────
  const watchPermission = useCallback(async () => {
    try {
      if (!navigator.permissions) return;
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      permQueryRef.current = status;
      status.onchange = () => {
        log('Permission', `Changed to: ${status.state}`);
        if (!mountedRef.current) return;
        if (status.state === 'granted') {
          log('Permission', 'Granted — auto-reconnecting');
          retryCountRef.current = 0;
          stopRetry();
          initialize(activeDeviceRef.current);
        } else if (status.state === 'denied') {
          stopHealth();
          setPhase('permission_denied');
          setErrorMessage('Camera access was revoked. Allow camera access in browser settings.');
          setStream(null);
          stopStream(streamRef.current);
          streamRef.current = null;
        }
      };
    } catch { /* browser may not support permission query */ }
  }, [initialize, log, stopHealth, stopRetry]);

  // ── Device change listener ─────────────────────────────────────────────────
  const watchDeviceChange = useCallback(() => {
    const handler = async () => {
      if (!mountedRef.current) return;
      log('Device', 'Device change detected');
      const newDevs = await enumerateDevices();
      if (mountedRef.current) setDevices(newDevs);

      // If we were in a failed state and a camera appeared — auto-reconnect
      const isFailedState = ['not_found', 'disconnected', 'error', 'reconnecting'].includes(
        // read current phase without stale closure — use ref trick via a DOM attr
        document.getElementById('camera-phase-probe')?.getAttribute('data-phase') ?? ''
      );
      if (isFailedState && newDevs.length > 0) {
        log('Device', 'New camera detected — reconnecting');
        retryCountRef.current = 0;
        stopRetry();
        initialize(newDevs[0].deviceId);
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, [initialize, log, stopRetry]);

  // ── Manual retry ───────────────────────────────────────────────────────────
  const retryNow = useCallback(() => {
    log('Recovery', 'Manual retry triggered');
    retryCountRef.current = 0;
    stopRetry();
    stopHealth();
    initialize(activeDeviceRef.current);
  }, [initialize, log, stopHealth, stopRetry]);

  // ── Switch camera ──────────────────────────────────────────────────────────
  const switchCamera = useCallback((deviceId: string) => {
    log('Device', `Switching to camera: ${deviceId}`);
    stopRetry();
    stopHealth();
    initialize(deviceId);
  }, [initialize, log, stopHealth, stopRetry]);

  // ── Mount / unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    const cleanupDevices = watchDeviceChange();
    watchPermission();
    initialize();

    return () => {
      mountedRef.current = false;
      fullCleanup();
      cleanupDevices?.();
      if (permQueryRef.current) permQueryRef.current.onchange = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    phase,
    stream,
    devices,
    activeDeviceId,
    retryAttempt,
    maxRetries: MAX_RETRIES,
    nextRetryIn,
    errorMessage,
    logs,
    retryNow,
    switchCamera,
  };
}
