import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckSquare,
  Code2,
  Copy,
  Info,
  Lightbulb,
  Maximize2,
  RotateCcw,
  Sparkles,
  Square,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Annotation, ReaderSettings, ReaderTheme } from '../types/reader';
import { PageBlock } from '../core/paginationEngine';
import { renderInlineMarkdown, renderMermaidDiagram } from '../core/parserEngine';

export function useMermaidGestures(options: {
  minScale?: number;
  maxScale?: number;
  doubleTapScale?: number;
  contentWidth?: number;
  contentHeight?: number;
} = {}) {
  const {
    minScale = 0.5,
    maxScale = 4.0,
    doubleTapScale = 1.85,
    contentWidth = 500,
    contentHeight = 300,
  } = options;

  const [scale, setScale] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panRef = useRef(pan);
  panRef.current = pan;

  const initialPinchDistRef = useRef(0);
  const initialScaleRef = useRef(1.0);
  const initialPanRef = useRef({ x: 0, y: 0 });
  const initialMidpointRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const isPinchingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const lastTapPosRef = useRef({ x: 0, y: 0 });

  const isMouseDownRef = useRef(false);
  const mouseStartRef = useRef({ x: 0, y: 0 });

  const resetZoom = useCallback(() => {
    setScale(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback((step = 0.25) => {
    setScale((s) => Math.min(maxScale, Number((s + step).toFixed(2))));
  }, [maxScale]);

  const zoomOut = useCallback((step = 0.25) => {
    setScale((s) => {
      const next = Math.max(minScale, Number((s - step).toFixed(2)));
      if (next <= 1.05) setPan({ x: 0, y: 0 });
      return next;
    });
  }, [minScale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const clamp = (x: number, y: number, s: number) => {
      const maxX = Math.max(160, Math.round((contentWidth * s) * 0.75));
      const maxY = Math.max(120, Math.round((contentHeight * s) * 0.75));
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    };

    const onTouchStart = (e: TouchEvent) => {
      // 2-finger pinch
      if (e.touches.length === 2) {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        initialPinchDistRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialScaleRef.current = scaleRef.current;
        initialPanRef.current = { ...panRef.current };
        initialMidpointRef.current = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        isPinchingRef.current = true;
        isDraggingRef.current = false;
        setIsInteracting(true);
        return;
      }

      // Single touch
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const now = Date.now();
        const timeDiff = now - lastTapTimeRef.current;
        const dist = Math.hypot(
          touch.clientX - lastTapPosRef.current.x,
          touch.clientY - lastTapPosRef.current.y
        );

        // Double-tap zoom / reset detection (<320ms, <30px)
        if (timeDiff < 320 && dist < 30) {
          e.stopPropagation();
          if (e.cancelable) e.preventDefault();
          lastTapTimeRef.current = 0;
          if (scaleRef.current > 1.1) {
            setScale(1.0);
            setPan({ x: 0, y: 0 });
          } else {
            setScale(doubleTapScale);
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const clamped = clamp(
              Number(((cx - touch.clientX) * 0.7).toFixed(1)),
              Number(((cy - touch.clientY) * 0.7).toFixed(1)),
              doubleTapScale
            );
            setPan(clamped);
          }
          return;
        }

        lastTapTimeRef.current = now;
        lastTapPosRef.current = { x: touch.clientX, y: touch.clientY };

        // If diagram is zoomed in, single finger drag pans the diagram
        if (scaleRef.current > 1.05) {
          e.stopPropagation();
          dragStartRef.current = { x: touch.clientX, y: touch.clientY };
          initialPanRef.current = { ...panRef.current };
          isDraggingRef.current = true;
          setIsInteracting(true);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // Handle pinch zoom
      if (e.touches.length === 2 && isPinchingRef.current) {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (initialPinchDistRef.current > 0) {
          const factor = dist / initialPinchDistRef.current;
          const nextScale = Math.max(
            minScale,
            Math.min(maxScale, Number((initialScaleRef.current * factor).toFixed(2)))
          );
          const midX = (t1.clientX + t2.clientX) / 2;
          const midY = (t1.clientY + t2.clientY) / 2;
          const deltaX = midX - initialMidpointRef.current.x;
          const deltaY = midY - initialMidpointRef.current.y;
          const clamped = clamp(
            initialPanRef.current.x + deltaX,
            initialPanRef.current.y + deltaY,
            nextScale
          );
          setScale(nextScale);
          setPan(clamped);
        }
        return;
      }

      // Handle pan while zoomed
      if (e.touches.length === 1 && isDraggingRef.current && scaleRef.current > 1.05) {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
        const touch = e.touches[0];
        const dx = touch.clientX - dragStartRef.current.x;
        const dy = touch.clientY - dragStartRef.current.y;
        const clamped = clamp(
          initialPanRef.current.x + dx,
          initialPanRef.current.y + dy,
          scaleRef.current
        );
        setPan(clamped);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinchingRef.current = false;
      }
      if (e.touches.length === 0) {
        isDraggingRef.current = false;
        setIsInteracting(false);
        if (scaleRef.current <= 1.05) {
          setPan({ x: 0, y: 0 });
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      // Support trackpad pinch gesture (e.ctrlKey) and Ctrl+wheel
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.08 : 0.92;
        setScale((s) => {
          const next = Math.max(minScale, Math.min(maxScale, Number((s * factor).toFixed(2))));
          if (next <= 1.05) setPan({ x: 0, y: 0 });
          return next;
        });
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (scaleRef.current > 1.05 && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        isMouseDownRef.current = true;
        mouseStartRef.current = { x: e.clientX, y: e.clientY };
        initialPanRef.current = { ...panRef.current };
        setIsInteracting(true);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isMouseDownRef.current && scaleRef.current > 1.05) {
        e.preventDefault();
        e.stopPropagation();
        const dx = e.clientX - mouseStartRef.current.x;
        const dy = e.clientY - mouseStartRef.current.y;
        const clamped = clamp(
          initialPanRef.current.x + dx,
          initialPanRef.current.y + dy,
          scaleRef.current
        );
        setPan(clamped);
      }
    };

    const onMouseUp = () => {
      if (isMouseDownRef.current) {
        isMouseDownRef.current = false;
        setIsInteracting(false);
      }
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (scaleRef.current > 1.1) {
        setScale(1.0);
        setPan({ x: 0, y: 0 });
      } else {
        setScale(doubleTapScale);
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clamped = clamp(
          Number(((cx - e.clientX) * 0.7).toFixed(1)),
          Number(((cy - e.clientY) * 0.7).toFixed(1)),
          doubleTapScale
        );
        setPan(clamped);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('dblclick', onDblClick);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('dblclick', onDblClick);
    };
  }, [minScale, maxScale, doubleTapScale, contentWidth, contentHeight]);

  return {
    scale,
    pan,
    isInteracting,
    containerRef,
    setScale,
    setPan,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}

const MermaidFullscreenModal: React.FC<{
  svgHtml: string;
  naturalWidth: number;
  naturalHeight: number;
  onClose: () => void;
}> = ({ svgHtml, naturalWidth, naturalHeight, onClose }) => {
  const {
    scale,
    pan,
    isInteracting,
    containerRef: modalViewportRef,
    zoomIn,
    zoomOut,
    resetZoom,
  } = useMermaidGestures({
    minScale: 0.4,
    maxScale: 5.0,
    doubleTapScale: 2.0,
    contentWidth: naturalWidth || 600,
    contentHeight: naturalHeight || 300,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const fitWidth =
    typeof window !== 'undefined'
      ? Math.min(window.innerWidth - 48, naturalWidth || 800)
      : 800;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-md select-none"
      onClick={onClose}
    >
      {/* Top Bar */}
      <div
        className="flex items-center justify-between border-b px-4 py-3 text-white/90"
        style={{
          borderColor: 'rgba(255,255,255,0.12)',
          backgroundColor: 'rgba(20,20,20,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="font-mono-tabular text-xs font-semibold tracking-wider text-white">
            MERMAID 全屏交互
          </span>
          <span className="hidden sm:inline-block text-[11px] text-white/40">|</span>
          <span className="hidden sm:inline-block text-xs text-white/70">
            双指捏合缩放 · 拖拽平移 · 双击缩放
          </span>
          <span className="font-mono-tabular rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-amber-300">
            {Math.round(scale * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => zoomOut(0.25)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/80 hover:bg-white/20 active:scale-95 transition-all"
            title="缩小"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className={`flex h-8 items-center gap-1 px-2.5 rounded-lg text-xs font-medium transition-all active:scale-95 ${
              scale !== 1.0 || pan.x !== 0 || pan.y !== 0
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
            title="还原原始大小"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">还原</span>
          </button>
          <button
            type="button"
            onClick={() => zoomIn(0.25)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/80 hover:bg-white/20 active:scale-95 transition-all"
            title="放大"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="mx-1 h-4 w-px bg-white/20" />
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-red-500/80 active:scale-95 transition-colors"
            title="关闭 (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Fullscreen Interactive Canvas */}
      <div
        ref={modalViewportRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
        style={{
          touchAction: 'none',
          cursor: isInteracting ? 'grabbing' : 'grab',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isInteracting ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
            willChange: isInteracting ? 'transform' : 'auto',
          }}
        >
          <div
            className="md-mermaid-svg-host flex items-center justify-center"
            style={{
              width: `${fitWidth}px`,
              maxWidth: 'none',
            }}
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        </div>

        {/* Mobile touch gesture badge at bottom */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/70 backdrop-blur-xs sm:hidden">
          双指捏合缩放 · 单指拖拽 · 双击还原
        </div>
      </div>
    </div>
  );
};

export const MermaidBlock: React.FC<{
  code: string;
  theme: ReaderTheme;
  forceTopDown?: boolean;
  parentContainerWidth?: number;
}> = ({ code, theme, forceTopDown = false, parentContainerWidth }) => {
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({
    width: 560,
    height: 200,
  });
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [renderCount, setRenderCount] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  const isMobile =
    (typeof window !== 'undefined' && window.innerWidth < 640) ||
    (parentContainerWidth !== undefined && parentContainerWidth < 540);
  const effectiveForceTD = Boolean(
    forceTopDown ||
      isMobile ||
      (parentContainerWidth !== undefined && parentContainerWidth < 540)
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    const renderDiagram = async () => {
      try {
        const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const liveW = containerRef.current?.clientWidth || parentContainerWidth || 560;
        const clampedWidth = Math.min(liveW, viewportW);
        const shouldUseTD = Boolean(forceTopDown || isMobile || clampedWidth < 540);

        const result = await renderMermaidDiagram(code, theme, clampedWidth, shouldUseTD);
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setSvgHtml(result.svg);
          setNaturalSize({
            width: result.naturalWidth,
            height: result.naturalHeight,
          });
          setRenderError(null);
          setLoading(false);
        }
      } catch (err) {
        if (isMountedRef.current && currentRequestId === requestIdRef.current) {
          setRenderError(err instanceof Error ? err.message : 'Mermaid 语法解析失败');
          setLoading(false);
        }
      }
    };

    renderDiagram();
  }, [code, theme, forceTopDown, isMobile, parentContainerWidth, renderCount]);

  const viewportMaxW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const containerWidthPx = containerRef.current?.clientWidth || parentContainerWidth || 560;
  const targetFitWidth = Math.max(160, Math.min(containerWidthPx, viewportMaxW) - 24);

  // Gesture zoom and pan hook for inline viewer
  const {
    scale,
    pan,
    isInteracting,
    containerRef: gestureViewportRef,
    zoomIn,
    zoomOut,
    resetZoom,
  } = useMermaidGestures({
    minScale: 0.5,
    maxScale: 3.5,
    doubleTapScale: 1.85,
    contentWidth: targetFitWidth,
    contentHeight: Math.round(
      targetFitWidth * ((naturalSize.height || 200) / (naturalSize.width || 560))
    ),
  });

  return (
    <div
      ref={containerRef}
      data-mermaid-direction={effectiveForceTD ? 'TD' : 'auto'}
      className="reader-mermaid-container my-3 w-full max-w-full overflow-hidden rounded-xl transition-colors"
      style={{
        width: '100%',
        maxWidth: 'min(100%, 100vw)',
        boxSizing: 'border-box',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 4px 14px -4px rgba(44, 30, 22, 0.08)',
        fontSize: '13px',
        lineHeight: 1.35,
        letterSpacing: '0px',
        textIndent: '0px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-1.5 border-b px-3 py-1.5 text-xs"
        style={{
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="font-mono-tabular text-[11px] font-medium">MERMAID</span>
          {effectiveForceTD && (
            <span
              className="font-mono-tabular rounded px-1 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-primary)',
              }}
              title="容器宽度较窄，已自动切换为 TD 垂直排列"
            >
              TD
            </span>
          )}
          <span
            className="font-mono-tabular text-[10px] font-medium"
            style={{
              color: scale > 1.05 ? 'var(--accent-primary)' : 'inherit',
            }}
          >
            {Math.round(scale * 100)}%
          </span>
          {scale > 1.05 && (
            <span
              className="hidden sm:inline-block font-mono-tabular text-[10px]"
              style={{ color: 'var(--text-muted)' }}
            >
              (可拖拽平移)
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => zoomOut(0.2)}
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ color: 'var(--text-muted)' }}
            title="缩小"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
            style={{
              color:
                scale !== 1.0 || pan.x !== 0 || pan.y !== 0
                  ? 'var(--accent-primary)'
                  : 'var(--text-muted)',
              backgroundColor:
                scale !== 1.0 || pan.x !== 0 || pan.y !== 0
                  ? 'var(--accent-soft)'
                  : 'transparent',
            }}
            title="还原大小与位置"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => zoomIn(0.2)}
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ color: 'var(--text-muted)' }}
            title="放大 (亦可双指捏合或双击)"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{
              backgroundColor: showRaw ? 'var(--accent-primary)' : 'transparent',
              color: showRaw ? '#FFFFFF' : 'var(--text-muted)',
            }}
            title="源码"
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsZoomed(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ color: 'var(--text-muted)' }}
            title="全屏交互查看"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {showRaw ? (
        <pre
          className="font-mono-tabular overflow-x-auto p-3 text-xs leading-relaxed"
          style={{ color: 'var(--text-primary)' }}
        >
          <code>{code}</code>
        </pre>
      ) : renderError ? (
        <div className="p-3 text-xs space-y-2">
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-400 font-medium">
            <span>图表解析失败: {renderError}</span>
            <button
              type="button"
              onClick={() => setRenderCount((c) => c + 1)}
              className="flex items-center gap-1 rounded px-2 py-0.5 underline cursor-pointer hover:opacity-80"
            >
              <RotateCcw className="h-3 w-3" />
              <span>重新加载</span>
            </button>
          </div>
          <pre
            className="font-mono-tabular overflow-x-auto p-2.5 rounded-lg text-[11px] leading-relaxed"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
            }}
          >
            <code>{code}</code>
          </pre>
        </div>
      ) : loading && !svgHtml ? (
        <div
          className="flex h-24 items-center justify-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          <span>图表绘制中...</span>
        </div>
      ) : (
        <div
          ref={gestureViewportRef}
          className="relative flex w-full items-center justify-center overflow-hidden p-2.5 sm:p-3.5 select-none"
          style={{
            maxWidth: '100vw',
            boxSizing: 'border-box',
            touchAction: scale > 1.05 ? 'none' : 'pan-y',
            cursor: scale > 1.05 ? (isInteracting ? 'grabbing' : 'grab') : 'default',
          }}
          title={scale > 1.05 ? '单指或鼠标拖拽平移，双击还原' : '双指捏合或双击可手势放大'}
        >
          <div
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isInteracting ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
              willChange: isInteracting ? 'transform' : 'auto',
            }}
          >
            <div
              className="md-mermaid-svg-host"
              style={{
                width: `${targetFitWidth}px`,
                maxWidth: 'none',
              }}
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          </div>

          {/* Quick Floating Reset Badge when zoomed in */}
          {scale > 1.05 && (
            <button
              type="button"
              onClick={resetZoom}
              className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium shadow-md transition-all hover:opacity-90 active:scale-95"
              style={{
                backgroundColor: 'var(--bg-card)',
                color: 'var(--accent-primary)',
                border: '1px solid var(--border-subtle)',
              }}
              title="双击或点击还原"
            >
              <RotateCcw className="h-3 w-3" />
              <span>还原 ({Math.round(scale * 100)}%)</span>
            </button>
          )}
        </div>
      )}

      {isZoomed && (
        <MermaidFullscreenModal
          svgHtml={svgHtml}
          naturalWidth={naturalSize.width}
          naturalHeight={naturalSize.height}
          onClose={() => setIsZoomed(false)}
        />
      )}
    </div>
  );
};

export const CodeBlockView: React.FC<{
  code: string;
  lang?: string;
  isContinuation?: boolean;
  isLastBlock?: boolean;
}> = ({ code, lang, isContinuation, isLastBlock = false }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className={`overflow-hidden rounded-xl ${isLastBlock ? 'mt-2 mb-0' : 'my-2.5'}`}
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        letterSpacing: '0px',
        textIndent: '0px',
        lineHeight: 1.55,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-1.5 text-[11px]"
        style={{
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        <span className="font-mono-tabular uppercase">
          {lang || 'text'}
          {isContinuation ? ' (续)' : ''}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
          style={{ color: copied ? 'var(--accent-primary)' : 'var(--text-muted)' }}
          title="复制代码"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre
        className="font-mono-tabular overflow-x-auto p-3.5 text-xs leading-relaxed"
        style={{ color: 'var(--text-primary)' }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Safely wraps target substring inside HTML text nodes (skipping HTML tags `<...>`)
 */
function wrapTextNodesInHtml(
  html: string,
  targetPhrase: string,
  replacer: (matched: string) => string
): string {
  const cleanPhrase = targetPhrase.trim();
  if (!cleanPhrase || cleanPhrase.length < 2) return html;
  const regex = new RegExp(`(<[^>]+>)|(${escapeRegExp(cleanPhrase)})`, 'gi');
  return html.replace(regex, (fullMatch, htmlTag, textMatch) => {
    if (htmlTag) return htmlTag;
    if (textMatch) return replacer(textMatch);
    return fullMatch;
  });
}

function decorateHtmlWithInlineHighlights(
  baseHtml: string,
  blockText: string,
  annotations: Annotation[] | undefined,
  searchQuery?: string
): string {
  let result = baseHtml;

  if (annotations && annotations.length > 0) {
    // Sort longer selections first so longer highlights wrap cleanly
    const relevantAnns = annotations
      .filter((a) => a.type === 'note' && a.selectedText && a.selectedText.trim().length >= 2)
      .sort((a, b) => b.selectedText.length - a.selectedText.length);

    for (const ann of relevantAnns) {
      const rawSel = ann.selectedText.trim();
      // Match either full selectedText (if within this block) or the overlapping slice
      let candidate = '';
      if (blockText.includes(rawSel)) {
        candidate = rawSel;
      } else {
        // Check if paragraph contains a substantial segment (e.g. split paragraph across pages)
        const probe = rawSel.slice(0, Math.min(48, rawSel.length)).trim();
        if (probe.length >= 4 && blockText.includes(probe)) {
          candidate = probe;
        }
      }

      if (candidate) {
        const hasNoteClass = ann.noteText?.trim() ? ' reader-inline-mark-has-note' : '';
        const tooltip = ann.noteText?.trim()
          ? `批注：${escapeAttr(ann.noteText.trim())}（点击查看或编辑）`
          : '点击编辑高亮、添加批注或生成金句卡';
        result = wrapTextNodesInHtml(
          result,
          candidate,
          (matched) =>
            `<mark class="reader-inline-mark reader-inline-mark-${ann.color}${hasNoteClass}" data-ann-id="${escapeAttr(
              ann.id
            )}" title="${tooltip}">${matched}</mark>`
        );
      }
    }
  }

  if (searchQuery && searchQuery.trim().length >= 1) {
    const q = searchQuery.trim();
    result = wrapTextNodesInHtml(
      result,
      q,
      (matched) => `<mark class="reader-search-mark">${matched}</mark>`
    );
  }

  return result;
}

export const MarkdownBlockRenderer: React.FC<{
  block: PageBlock;
  settings: ReaderSettings;
  highlightBg?: string;
  annotations?: Annotation[];
  searchHighlightQuery?: string;
  onSelectAnnotation?: (ann: Annotation) => void;
  forceMermaidTD?: boolean;
  mermaidContainerWidth?: number;
  isLastBlock?: boolean;
  isTtsActive?: boolean;
  isTtsModeOpen?: boolean;
  onClickBlockForTts?: (startOffset: number) => void;
}> = ({
  block,
  settings,
  highlightBg = 'transparent',
  annotations,
  searchHighlightQuery,
  onSelectAnnotation,
  forceMermaidTD = false,
  mermaidContainerWidth,
  isLastBlock = false,
  isTtsActive = false,
  isTtsModeOpen = false,
  onClickBlockForTts,
}) => {
  const handleInlineMarkClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const markEl = target.closest?.('[data-ann-id]') as HTMLElement | null;
    if (markEl && annotations && onSelectAnnotation) {
      const annId = markEl.getAttribute('data-ann-id');
      const found = annotations.find((a) => a.id === annId);
      if (found) {
        e.stopPropagation();
        onSelectAnnotation(found);
        return;
      }
    }
    if (isTtsModeOpen && onClickBlockForTts) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        return;
      }
      // If the mouse click lands in the outer page-turn zones of the reading canvas (left 28% or right 28%),
      // allow the click event to bubble to handleCanvasZoneClick so mouse users can effortlessly turn pages!
      const canvasEl = target.closest('main');
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        const ratioX = (e.clientX - rect.left) / rect.width;
        if (ratioX < 0.28 || ratioX > 0.72) {
          return;
        }
      }
      e.stopPropagation();
      onClickBlockForTts(block.startOffset);
    }
  };

  const ttsWrapperStyle: React.CSSProperties | undefined = isTtsActive
    ? {
        backgroundColor:
          settings.theme === 'night' || settings.theme === 'candlelight'
            ? 'rgba(217, 119, 36, 0.16)'
            : 'rgba(180, 83, 42, 0.11)',
        boxShadow: 'inset 3px 0 0 0 var(--accent-primary)',
        borderRadius: '8px',
        paddingLeft: '8px',
        paddingRight: '6px',
        paddingTop: '2px',
        paddingBottom: '2px',
        transition: 'background-color 0.25s ease, box-shadow 0.25s ease',
      }
    : isTtsModeOpen
    ? {
        cursor: 'pointer',
      }
    : undefined;

  const renderInnerBlock = () => {
    switch (block.type) {
      case 'heading': {
        const level = block.level || 2;
        const scale = level === 1 ? 1.36 : level === 2 ? 1.22 : 1.1;
        const rawHtml = block.html || renderInlineMarkdown(block.text);
        const decoratedHtml = decorateHtmlWithInlineHighlights(
          rawHtml,
          block.text,
          annotations,
          searchHighlightQuery
        );
        return (
          <h2
            data-start-offset={block.startOffset}
            onClick={handleInlineMarkClick}
            className="font-display font-semibold tracking-tight"
            style={{
              fontSize: `${Math.round(settings.fontSize * scale)}px`,
              marginTop: `${Math.round(settings.paragraphSpacing * 0.85)}px`,
              marginBottom: `${Math.round(settings.paragraphSpacing * 0.75)}px`,
              color: 'var(--text-primary)',
              textIndent: '0px',
              textWrap: 'balance',
              ...ttsWrapperStyle,
            }}
            title={isTtsModeOpen ? '点击从此处开始朗读' : undefined}
            dangerouslySetInnerHTML={{
              __html: decoratedHtml,
            }}
          />
        );
      }

      case 'mermaid':
        return (
          <div
            data-start-offset={block.startOffset}
            style={ttsWrapperStyle}
            onClick={isTtsModeOpen ? handleInlineMarkClick : undefined}
            title={isTtsModeOpen ? '点击朗读此图表摘要' : undefined}
          >
            <MermaidBlock
              code={block.text}
              theme={settings.theme}
              forceTopDown={forceMermaidTD}
              parentContainerWidth={mermaidContainerWidth}
            />
          </div>
        );

      case 'code':
        return (
          <div
            data-start-offset={block.startOffset}
            style={ttsWrapperStyle}
            onClick={isTtsModeOpen ? handleInlineMarkClick : undefined}
            title={isTtsModeOpen ? '点击朗读此代码块摘要' : undefined}
          >
            <CodeBlockView
              code={block.text}
              lang={block.lang}
              isContinuation={block.isContinuation}
              isLastBlock={isLastBlock}
            />
          </div>
        );

      case 'table': {
        if (block.html) {
          return (
            <div
              data-start-offset={block.startOffset}
              className={isLastBlock ? 'mt-2 mb-0' : 'my-2.5'}
              style={{ textIndent: '0px', ...ttsWrapperStyle }}
              onClick={(e) => {
                if (isTtsModeOpen) {
                  handleInlineMarkClick(e);
                } else {
                  e.stopPropagation();
                }
              }}
              title={isTtsModeOpen ? '点击朗读此表格摘要' : undefined}
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          );
        }
        const headers = block.tableHeaders || [];
        const rows = block.tableRows || [];
        const align = block.tableAlign || [];
        return (
          <div
            data-start-offset={block.startOffset}
            className={`reader-md-table-wrap overflow-x-auto rounded-xl ${
              isLastBlock ? 'mt-2 mb-0' : 'my-2.5'
            }`}
            style={{ textIndent: '0px', ...ttsWrapperStyle }}
            onClick={(e) => {
              if (isTtsModeOpen) {
                handleInlineMarkClick(e);
              } else {
                e.stopPropagation();
              }
            }}
            title={isTtsModeOpen ? '点击朗读此表格摘要' : undefined}
          >
            <table className="reader-md-table w-full border-collapse text-left text-xs sm:text-sm">
              <thead className="reader-md-thead">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className="reader-md-th px-3.5 py-2.5 font-semibold"
                      style={{ textAlign: align[i] || 'left' }}
                      dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(h) }}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="reader-md-tbody">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="reader-md-tr">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className="reader-md-td tabular-nums px-3.5 py-2"
                        style={{ textAlign: align[cIdx] || 'left' }}
                        dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(cell) }}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'blockquote': {
        const alertMatch = block.text.match(
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*)$/i
        );
        const alertType = alertMatch ? alertMatch[1].toUpperCase() : null;
        const bodyText = alertMatch ? alertMatch[2] : block.text;

        const AlertIcon =
          alertType === 'TIP'
            ? Lightbulb
            : alertType === 'IMPORTANT'
            ? Sparkles
            : alertType === 'WARNING' || alertType === 'CAUTION'
            ? AlertTriangle
            : Info;

        const decoratedQuoteHtml = decorateHtmlWithInlineHighlights(
          renderInlineMarkdown(bodyText),
          bodyText,
          annotations,
          searchHighlightQuery
        );

        return (
          <blockquote
            data-start-offset={block.startOffset}
            onClick={handleInlineMarkClick}
            className={`rounded-xl p-3.5 text-[0.95em] ${isLastBlock ? 'mt-2 mb-0' : 'my-2.5'}`}
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              textIndent: '0px',
              ...ttsWrapperStyle,
            }}
            title={isTtsModeOpen ? '点击从此处开始朗读' : undefined}
          >
            {alertType && (
              <div
                className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"
                style={{ color: 'var(--accent-primary)', textIndent: '0px' }}
              >
                <AlertIcon className="h-3.5 w-3.5" />
                <span>{alertType}</span>
              </div>
            )}
            <div
              className="leading-relaxed italic"
              style={{ textIndent: '0px' }}
              dangerouslySetInnerHTML={{ __html: decoratedQuoteHtml }}
            />
          </blockquote>
        );
      }

      case 'list': {
        const items = block.listItems || [];
        const ListTag = block.ordered ? 'ol' : 'ul';
        const isTaskList = items.some((item) => item.task);
        return (
          <ListTag
            data-start-offset={block.startOffset}
            onClick={handleInlineMarkClick}
            start={block.ordered ? (block.start || 1) : undefined}
            className={`space-y-1.5 ${isLastBlock ? 'mt-1.5 mb-0' : 'my-2'} ${
              isTaskList
                ? 'list-none pl-1'
                : block.ordered
                ? 'list-decimal pl-6'
                : 'list-disc pl-6'
            }`}
            style={{
              marginBottom: isLastBlock ? '0px' : `${Math.round(settings.paragraphSpacing * 0.7)}px`,
              color: 'var(--text-primary)',
              textIndent: '0px',
              ...ttsWrapperStyle,
            }}
            title={isTtsModeOpen ? '点击从此处开始朗读' : undefined}
          >
            {items.map((item, idx) => {
              const itemHtml = decorateHtmlWithInlineHighlights(
                item.html || renderInlineMarkdown(item.text),
                item.text,
                annotations,
                searchHighlightQuery
              );
              if (item.task) {
                return (
                  <li
                    key={idx}
                    className="flex list-none items-start gap-2.5 text-left"
                    style={{ textIndent: '0px' }}
                  >
                    <span className="mt-0.5 flex shrink-0 items-center justify-center">
                      {item.checked ? (
                        <CheckSquare
                          className="h-4.5 w-4.5"
                          style={{ color: 'var(--accent-primary)' }}
                        />
                      ) : (
                        <Square
                          className="h-4.5 w-4.5"
                          style={{ color: 'var(--text-muted)' }}
                        />
                      )}
                    </span>
                    <span
                      className="flex-1 leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: itemHtml,
                      }}
                    />
                  </li>
                );
              }
              return (
                <li
                  key={idx}
                  className="leading-relaxed text-left"
                  style={{ textIndent: '0px' }}
                  dangerouslySetInnerHTML={{
                    __html: itemHtml,
                  }}
                />
              );
            })}
          </ListTag>
        );
      }

      case 'hr':
        return (
          <hr
            className="my-4 border-t"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        );

      case 'paragraph':
      default: {
        const baseHtml = block.html || renderInlineMarkdown(block.text);
        const decoratedHtml = decorateHtmlWithInlineHighlights(
          baseHtml,
          block.text,
          annotations,
          searchHighlightQuery
        );
        return (
          <p
            data-start-offset={block.startOffset}
            onClick={handleInlineMarkClick}
            className="rounded-xs transition-colors [&_a]:underline [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_strong]:font-semibold"
            style={{
              marginBottom: isLastBlock ? '0px' : `${settings.paragraphSpacing}px`,
              textIndent: settings.indentFirstLine && !block.isContinuation ? '2em' : '0',
              backgroundColor: highlightBg,
              textAlign: 'justify',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              ...ttsWrapperStyle,
            }}
            title={isTtsModeOpen ? '点击从此处开始朗读' : undefined}
            dangerouslySetInnerHTML={{
              __html: decoratedHtml,
            }}
          />
        );
      }
    }
  };

  return renderInnerBlock();
};
