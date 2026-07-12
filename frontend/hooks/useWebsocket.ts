import { useEffect, useRef, useState, useCallback } from 'react';

export interface FaceAnalysisResult {
  event: 'frame-eval' | 'auto-capture';
  face_detected: boolean;
  box: [number, number, number, number] | null;
  blur_score: number;
  is_sharp: boolean;
  brightness: number;
  lighting_ok: boolean;
  centered: boolean;
  eyes_open: boolean;
  smile_detected: boolean;
  passed_all: boolean;
  streak: number;
  streak_percent: number;
  error: string | null;
  
  // Capture event fields
  photo_id?: string;
  original_url?: string;
  style?: string;
  background?: string;
}

export const useWebsocket = (
  activeStyle: string, 
  activeBackground: string,
  onAutoCapture: (data: any) => void
) => {
  const [socketStatus, setSocketStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [lastAnalysis, setLastAnalysis] = useState<FaceAnalysisResult | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const streamIntervalRef = useRef<number | null>(null);
  const isStreamingRef = useRef<boolean>(false);

  const styleRef = useRef(activeStyle);
  const bgRef = useRef(activeBackground);

  // Sync ref to avoid re-triggering interval loops
  useEffect(() => {
    styleRef.current = activeStyle;
    bgRef.current = activeBackground;
  }, [activeStyle, activeBackground]);

  const disconnectSocket = useCallback(() => {
    if (streamIntervalRef.current) {
      window.clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    isStreamingRef.current = false;
    setSocketStatus('closed');
  }, []);

  const connectSocket = useCallback(() => {
    disconnectSocket();
    setSocketStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Dynamic ws endpoint proxy path
    const wsUrl = `${protocol}//${window.location.hostname}:8000/ws/stream`;
    
    logger_debug(`Connecting to socket: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setSocketStatus('open');
      logger_debug("Socket connection established.");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as FaceAnalysisResult;
        setLastAnalysis(data);
        
        if (data.event === 'auto-capture') {
          logger_debug("Auto-capture trigger received!");
          onAutoCapture(data);
          // Stop sending frames
          if (streamIntervalRef.current) {
            window.clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = null;
          }
        }
      } catch (err) {
        console.error("Failed parsing message:", err);
      }
    };

    ws.onerror = (e) => {
      console.error("Socket encountered error:", e);
    };

    ws.onclose = () => {
      setSocketStatus('closed');
      logger_debug("Socket connection closed.");
    };
  }, [disconnectSocket, onAutoCapture]);

  const startSendingFrames = useCallback((
    videoElement: HTMLVideoElement,
    canvasElement: HTMLCanvasElement
  ) => {
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;

    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    // Stream at ~8 frames per second (every 120ms) to ensure smooth face-tracking without overwhelming network
    streamIntervalRef.current = window.setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
        // Draw current video frame to hidden canvas
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        
        // Export base64 string
        const base64Image = canvasElement.toDataURL('image/jpeg', 0.7); // 70% quality compression
        
        // Send payload
        const payload = {
          image: base64Image,
          style: styleRef.current,
          background: bgRef.current
        };
        
        wsRef.current.send(JSON.stringify(payload));
      }
    }, 125);
  }, []);

  const stopSendingFrames = useCallback(() => {
    if (streamIntervalRef.current) {
      window.clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    isStreamingRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      disconnectSocket();
    };
  }, [disconnectSocket]);

  return {
    socketStatus,
    lastAnalysis,
    connectSocket,
    disconnectSocket,
    startSendingFrames,
    stopSendingFrames
  };
};

function logger_debug(msg: string) {
  console.log(`[Websocket Hook] ${msg}`);
}
