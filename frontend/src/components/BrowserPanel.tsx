import React, { useRef, useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Globe, 
  MonitorOff,
  Keyboard,
  ExternalLink,
  Minimize2,
  Move
} from 'lucide-react';
import { useChatStore } from '../store/useChatStore';

export const BrowserPanel: React.FC<{ isMini?: boolean }> = ({ isMini = false }) => {
  const {
    browserUrl,
    isBrowserActive,
    isBrowserLoading,
    frameLatency,
    sendBrowserAction,
    isBrowserUnplugged,
    toggleBrowserUnplugged,
    browserWidth,
    browserHeight,
    rightPanelCollapsed,
    toggleRightPanel,
    setRightPanelTab,
    registerFrameCanvas,
  } = useChatStore();

  // ── Canvas refs ───────────────────────────────────────────────────────────────
  // canvasElRef: plain MutableRef used for DOM access (coordinate math, wheel listener)
  // canvasRef:   callback ref passed to <canvas ref={...}> — fires precisely when the
  //              element enters/leaves the DOM, even under conditional rendering.
  //              (useRef + useEffect([], []) fires on component mount which may be
  //               before the canvas is rendered when isBrowserActive=false)
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const lastCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wheelListenerRef = useRef<((e: WheelEvent) => void) | null>(null);
  const mouseStopTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentCoords = useRef<{ x: number; y: number } | null>(null);

  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (lastCanvasRef.current && wheelListenerRef.current) {
      lastCanvasRef.current.removeEventListener('wheel', wheelListenerRef.current);
      registerFrameCanvas(lastCanvasRef.current, 'unregister');
    }

    if (mouseStopTimeout.current) {
      clearTimeout(mouseStopTimeout.current);
      mouseStopTimeout.current = null;
    }

    canvasElRef.current = canvas;
    lastCanvasRef.current = canvas;

    if (canvas) {
      registerFrameCanvas(canvas, 'register');

      const handleWheel = (e: WheelEvent) => {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        if (cx < 0 || cy < 0 || cx > rect.width || cy > rect.height) return;

        e.preventDefault();
        e.stopPropagation();

        const natW = browserWidth || canvas.width || 1280;
        const natH = browserHeight || canvas.height || 800;
        const x = Math.round((cx / rect.width) * natW);
        const y = Math.round((cy / rect.height) * natH);
        sendBrowserAction({ type: 'wheel', deltaX: Math.round(e.deltaX), deltaY: Math.round(e.deltaY), x, y });
      };

      wheelListenerRef.current = handleWheel;
      canvas.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      wheelListenerRef.current = null;
    }
  }, [registerFrameCanvas, browserWidth, browserHeight, sendBrowserAction]);

  const containerRef = useRef<HTMLDivElement>(null);
  
  const [navUrl, setNavUrl] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  // Floating window position & size local states to ensure fast rendering during drag/resize
  const [winRect, setWinRect] = useState({ x: 200, y: 150, width: 850, height: 580 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ width: 0, height: 0, mouseX: 0, mouseY: 0 });

  // Refs for fast event handling (avoid stale closures)
  const lastMouseMoveTime = useRef(0);

  // Sync address bar URL when current page changes
  useEffect(() => {
    if (browserUrl) {
      setNavUrl(browserUrl);
    }
  }, [browserUrl]);

  // ── Coordinate Translation ─────────────────────────────────────────────────
  // The wrapping div has the exact aspect ratio of the browser viewport, and
  // the img uses object-contain inside that div. Since aspect ratios match,
  // the image fills the div exactly — no letterboxing math needed.
  // We simply scale CSS pixel offsets to native browser pixel space.
  const getCoordinates = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!canvasElRef.current) return null;
    const rect = canvasElRef.current.getBoundingClientRect();

    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    // Reject out-of-bounds (can happen during fast mouse movement)
    if (clickX < 0 || clickY < 0 || clickX > rect.width || clickY > rect.height) {
      return null;
    }

    const natW = browserWidth || canvasElRef.current.width || 1280;
    const natH = browserHeight || canvasElRef.current.height || 800;

    const x = Math.round((clickX / rect.width) * natW);
    const y = Math.round((clickY / rect.height) * natH);

    return { x, y };
  }, [browserWidth, browserHeight]);


  // Redirect keyboard focus to canvas container when clicking neutral panel areas
  const handlePanelClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('input, button, select, textarea, [role="button"]')) {
      containerRef.current?.focus();
    }
  };

  // ── Drag Handler (header interaction) ─────────────────────────────────────
  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, form, select')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - winRect.x, y: e.clientY - winRect.y });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setWinRect(prev => ({ ...prev, x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y }));
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // ── Resize Handler ─────────────────────────────────────────────────────────
  const startResize = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsResizing(true);
    setResizeStart({ width: winRect.width, height: winRect.height, mouseX: e.clientX, mouseY: e.clientY });
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      setWinRect(prev => ({
        ...prev,
        width: Math.max(500, resizeStart.width + (e.clientX - resizeStart.mouseX)),
        height: Math.max(380, resizeStart.height + (e.clientY - resizeStart.mouseY)),
      }));
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeStart]);

  // ── URL Navigation ─────────────────────────────────────────────────────────
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!navUrl.trim()) return;
    sendBrowserAction({ type: 'navigate', url: navUrl.trim() });
  };

  // ── Canvas Mouse Handlers ──────────────────────────────────────────────────

  const handleImageMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Focus the container for keyboard capture
    containerRef.current?.focus();
    if (e.button !== 0) return;
    e.preventDefault();

    const coords = getCoordinates(e.clientX, e.clientY);
    if (!coords) return;

    // Single-click = mousedown + instant mouseup at same coords.
    // This fires immediately on press (no waiting for user to release),
    // giving a snappy click feel. The 30ms gap is enough for Puppeteer
    // to register a proper click sequence without feeling like a double-click.
    sendBrowserAction({ type: 'mousedown', x: coords.x, y: coords.y, button: 'left' });
    setTimeout(() => {
      sendBrowserAction({ type: 'mouseup', x: coords.x, y: coords.y, button: 'left' });
    }, 30);
  };

  const handleImageMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Clear any pending mouse stop timeout
    if (mouseStopTimeout.current) {
      clearTimeout(mouseStopTimeout.current);
    }

    // Throttle moves to 150ms AND filter by distance (at least 25 pixels away from last sent coords)
    const now = Date.now();
    if (now - lastMouseMoveTime.current >= 150) {
      const coords = getCoordinates(clientX, clientY);
      if (coords) {
        let shouldSend = false;
        if (!lastSentCoords.current) {
          shouldSend = true;
        } else {
          const dx = coords.x - lastSentCoords.current.x;
          const dy = coords.y - lastSentCoords.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= 25) {
            shouldSend = true;
          }
        }

        if (shouldSend) {
          lastMouseMoveTime.current = now;
          lastSentCoords.current = coords;
          sendBrowserAction({ type: 'mousemove', x: coords.x, y: coords.y });
        }
      }
    }

    // Dispatch a final mousemove event with precise coordinates after movement stops
    mouseStopTimeout.current = setTimeout(() => {
      mouseStopTimeout.current = null;
      const coords = getCoordinates(clientX, clientY);
      if (coords) {
        lastSentCoords.current = coords;
        sendBrowserAction({ type: 'mousemove', x: coords.x, y: coords.y });
      }
    }, 100);
  };

  // ── Keyboard Handlers ──────────────────────────────────────────────────────
  // We block the keys we forward to avoid page-level scroll/nav interference.
  const BLOCK_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ' ', 'Tab', 'Backspace', 'Delete', 'Enter',
    'PageUp', 'PageDown', 'Home', 'End',
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (BLOCK_KEYS.has(e.key)) e.preventDefault();
    sendBrowserAction({ type: 'keydown', key: e.key });
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    sendBrowserAction({ type: 'keyup', key: e.key });
  };

  // ── Offline state ──────────────────────────────────────────────────────────
  if (!isBrowserActive) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[350px] p-8 text-center bg-[#090D16] border border-border-dark/40 rounded-2xl select-none">
        <MonitorOff className="w-10 h-10 text-text-muted/40 mb-3 animate-pulse" />
        <h3 className="text-sm font-bold text-text-main font-heading mb-1.5">Browser Offline</h3>
        <p className="text-xs text-text-muted max-w-xs leading-relaxed">
          Ask the agent to perform web tasks (e.g. search or browse websites) to activate the real-time screen stream.
        </p>
      </div>
    );
  }

  const getHostname = (urlStr: string | null) => {
    if (!urlStr) return 'Web Browser';
    try {
      const formatted = /^https?:\/\//i.test(urlStr) ? urlStr : `https://${urlStr}`;
      return new URL(formatted).hostname;
    } catch {
      return urlStr;
    }
  };

  // ── Shared browser body ────────────────────────────────────────────────────
  const browserBody = (
    <div 
      onClick={handlePanelClick}
      className="flex flex-col h-full bg-[#070A13] text-text-main flex-1 overflow-hidden select-none"
    >
      {isMini ? (
        /* Mini Browser Toolbar */
        <div 
          onMouseDown={isBrowserUnplugged ? startDrag : undefined}
          className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-[#141A29] border-b border-border-dark/80 select-none ${
            isBrowserUnplugged ? 'cursor-move' : ''
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="text-[10px] font-bold text-text-main font-heading truncate">
              {getHostname(browserUrl)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => sendBrowserAction({ type: 'back' })}
              className="p-1 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded transition-all"
              title="Back"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => sendBrowserAction({ type: 'reload' })}
              className="p-1 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded transition-all"
              title="Reload"
            >
              <RotateCw className="w-3 h-3" />
            </button>
            <button
              onClick={() => {
                setRightPanelTab('browser');
                if (rightPanelCollapsed) toggleRightPanel();
              }}
              className="p-1 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded transition-all flex items-center gap-0.5 text-[9px] font-semibold border border-border-dark/50 px-1.5"
              title="Expand to Workspace"
            >
              <Minimize2 className="w-3 h-3" />
              <span>Dock</span>
            </button>
            <button
              onClick={toggleBrowserUnplugged}
              className="p-1 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded transition-all flex items-center gap-0.5 text-[9px] font-semibold border border-border-dark/50 px-1.5"
              title="Popout Window"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Popout</span>
            </button>
          </div>
        </div>
      ) : (
        /* Full Browser Toolbar */
        <div 
          onMouseDown={isBrowserUnplugged ? startDrag : undefined}
          className={`flex items-center gap-2 px-3 py-2 bg-[#141A29] border-b border-border-dark/80 select-none ${
            isBrowserUnplugged ? 'cursor-move' : ''
          }`}
        >
          {isBrowserUnplugged && <Move className="w-3.5 h-3.5 text-text-muted mr-1 opacity-70 shrink-0" />}
          
          {/* Navigation Buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => sendBrowserAction({ type: 'back' })}
              className="p-1 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded-lg active:scale-95 transition-all"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => sendBrowserAction({ type: 'forward' })}
              className="p-1 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded-lg active:scale-95 transition-all"
              title="Forward"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => sendBrowserAction({ type: 'reload' })}
              className="p-1 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded-lg active:scale-95 transition-all"
              title="Reload"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Address Bar */}
          <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center gap-1.5 px-3 py-1 bg-[#0F1420] border border-border-dark/70 rounded-lg focus-within:border-primary/60 transition-all">
            <Globe className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              type="text"
              value={navUrl}
              onChange={(e) => setNavUrl(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-xs text-text-main font-mono placeholder:text-text-muted/50"
              placeholder="Type URL and hit Enter..."
            />
          </form>

          {/* Popout / Dock toggle */}
          <button
            onClick={toggleBrowserUnplugged}
            className="p-1.5 text-text-muted hover:text-text-main hover:bg-[#1E293B] rounded-lg active:scale-95 transition-all flex items-center gap-1 text-[11px] font-semibold border border-border-dark/50 px-2.5 shrink-0"
            title={isBrowserUnplugged ? 'Dock Browser inside Panel' : 'Popout Browser Window'}
          >
            {isBrowserUnplugged ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Dock</span>
              </>
            ) : (
              <>
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Popout</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Screen Canvas Container */}
      <div 
        ref={containerRef}
        tabIndex={0}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={`flex-1 flex items-center justify-center overflow-hidden bg-black focus:outline-none relative ${
          isFocused ? 'ring-1 ring-primary/40' : ''
        }`}
      >
        {/* Aspect-ratio wrapper that exactly matches the remote viewport */}
        <div 
          className="relative w-full h-full flex items-center justify-center"
        >
          <div
            style={{
              aspectRatio: `${browserWidth || 1280} / ${browserHeight || 800}`,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
            className="relative"
          >
            {/* Stream Canvas — GPU-accelerated via createImageBitmap */}
            <canvas
              ref={canvasRef}
              className="w-full h-full object-fill cursor-crosshair border border-border-dark/30 shadow-lg rounded"
              style={{ display: 'block' }}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onContextMenu={(e) => e.preventDefault()}
            />

            {/* Page Loading Overlay */}
            {isBrowserLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070A13]/80 backdrop-blur-sm rounded pointer-events-none z-10">
                <div className="flex flex-col items-center gap-3">
                  {/* Spinner */}
                  <div className="relative w-8 h-8">
                    <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                  </div>
                  {/* Loading bar */}
                  <div className="w-32 h-0.5 bg-border-dark/60 rounded-full overflow-hidden">
                    <div className="h-full bg-primary/70 rounded-full animate-[loading-bar_1.4s_ease-in-out_infinite]" />
                  </div>
                  <span className="text-[10px] text-text-muted font-mono">Loading page...</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Floating Focus Badge */}
        <div className={`absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border backdrop-blur transition-all duration-300 pointer-events-none ${
          isFocused 
            ? 'bg-primary/20 border-primary/40 text-primary' 
            : 'bg-card/75 border-border-dark text-text-muted opacity-80'
        }`}>
          <Keyboard className="w-3.5 h-3.5" />
          <span>{isFocused ? 'Keyboard Active' : 'Click to Focus'}</span>
        </div>

        {/* Latency Badge */}
        {isBrowserActive && frameLatency > 0 && (() => {
          const ms = frameLatency;
          const isGood   = ms < 80;
          const isOk     = ms < 200;
          // const isBad = ms >= 200
          const color = isGood
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
            : isOk
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
            : 'bg-red-500/15 border-red-500/40 text-red-400';
          const dot = isGood
            ? 'bg-emerald-400'
            : isOk
            ? 'bg-amber-400'
            : 'bg-red-400 animate-pulse';
          return (
            <div className={`absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold border backdrop-blur pointer-events-none transition-all duration-500 ${color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              <span>{ms}ms</span>
              <span className="opacity-60">{isGood ? '▸ fast' : isOk ? '▸ ok' : '▸ slow'}</span>
            </div>
          );
        })()}
      </div>
    </div>
  );

  // Floating (unplugged) variant — rendered in a portal
  if (isBrowserUnplugged) {
    return ReactDOM.createPortal(
      <div 
        style={{
          position: 'fixed',
          left: `${winRect.x}px`,
          top: `${winRect.y}px`,
          width: `${winRect.width}px`,
          height: `${winRect.height}px`,
          zIndex: 99999,
        }}
        className="flex flex-col bg-[#070A13] border-2 border-border-dark rounded-2xl overflow-hidden shadow-2xl relative select-none ring-2 ring-primary/10"
      >
        {browserBody}

        {/* Resize Handle */}
        <div 
          onMouseDown={startResize}
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize flex items-end justify-end p-0.5 group z-50"
          title="Drag to Resize"
        >
          <svg className="w-3.5 h-3.5 text-text-muted/40 group-hover:text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="20" y1="6" x2="6" y2="20" />
            <line x1="20" y1="12" x2="12" y2="20" />
            <line x1="20" y1="17" x2="17" y2="20" />
          </svg>
        </div>
      </div>,
      document.body
    );
  }

  // Docked variant
  return (
    <div className="w-full h-full flex flex-col min-h-[350px] relative">
      {browserBody}
    </div>
  );
};

export default BrowserPanel;
