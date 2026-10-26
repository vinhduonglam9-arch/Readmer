import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignJustify,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Columns2,
  Download,
  Eye,
  Feather,
  FileText,
  Flame,
  Gauge,
  Hash,
  Headphones,
  Image as ImageIcon,
  Indent,
  List,
  Loader2,
  Lock,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Printer,
  RotateCcw,
  ScrollText,
  Search,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Type,
  Unlock,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import {
  Annotation,
  Book,
  Chapter,
  CustomFont,
  HighlightColor,
  LayoutMode,
  MaxColumnWidth,
  ReaderSettings,
  ReaderTheme,
  ReadingStatsDaily,
} from '../types/reader';
import {
  detectInstalledLocalFonts,
  findChapterTitleAtOffset,
  findPageIndexForOffset,
  getMaxColumnWidthPx,
  getShortLocalFontLabel,
  InstalledSystemFont,
  paginateBookContent,
  queryBrowserLocalFonts,
  resolveReaderFontFamilyCss,
  VirtualPage,
} from '../core/paginationEngine';
import {
  DEFAULT_EXPORT_CONFIG,
  exportBookWithJsPdf,
  ExportConfig,
  ExportFormat,
  ExportThemeStyle,
  printDocumentViaHiddenIframe,
  renderJsPdfPages,
  warmUpCjkPdfFont,
} from '../core/exportEngine';
import {
  extractChapters,
  parseDocumentWithMarkdownIt,
  warmUpMermaidDiagramsForContent,
} from '../core/parserEngine';
import { DEFAULT_READER_SETTINGS } from '../core/storageEngine';
import {
  buildBlockSpeechText,
  EDGE_NEURAL_VOICES,
  getSortedLocalVoices,
  LocalVoiceOption,
  prefetchEdgeSpeech,
  synthesizeEdgeSpeechUrl,
} from '../core/ttsEngine';
import { ExportStudioModal } from './ExportStudioModal';
import { MarkdownBlockRenderer } from './MarkdownRenderer';
import { QuoteCardModal } from './QuoteCardModal';

const READER_THEME_OPTIONS: {
  id: ReaderTheme;
  label: string;
  fullTitle: string;
  icon: React.FC<{ className?: string }>;
  bgHex: string;
  textHex: string;
  accentHex: string;
}[] = [
  {
    id: 'cafe',
    label: '暖咖',
    fullTitle: '暖调纸张',
    icon: Sun,
    bgHex: '#FBF7F0',
    textHex: '#2C1E16',
    accentHex: '#B4532A',
  },
  {
    id: 'cream',
    label: '奶油',
    fullTitle: '午后奶油',
    icon: Coffee,
    bgHex: '#FAF3E6',
    textHex: '#3A2518',
    accentHex: '#C26A32',
  },
  {
    id: 'sandalwood',
    label: '宣纸',
    fullTitle: '古籍宣纸',
    icon: Feather,
    bgHex: '#F5EBDC',
    textHex: '#2F2014',
    accentHex: '#A83E26',
  },
  {
    id: 'candlelight',
    label: '烛光',
    fullTitle: '烛光暮读',
    icon: Flame,
    bgHex: '#2E221A',
    textHex: '#ECDCC8',
    accentHex: '#E08E45',
  },
  {
    id: 'night',
    label: '夜读',
    fullTitle: '夜间暗色',
    icon: Moon,
    bgHex: '#1C1613',
    textHex: '#E6DCD2',
    accentHex: '#D97724',
  },
  {
    id: 'eink',
    label: '墨水',
    fullTitle: '电子墨水',
    icon: Sparkles,
    bgHex: '#F5F5F0',
    textHex: '#111111',
    accentHex: '#111111',
  },
];

const FONT_SIZE_PRESETS = [
  { label: '小号', size: 15 },
  { label: '标准', size: 18 },
  { label: '舒适', size: 21 },
  { label: '大字', size: 24 },
] as const;

interface ReaderViewProps {
  book: Book;
  annotations: Annotation[];
  customFonts: CustomFont[];
  settings: ReaderSettings;
  dailyStats: ReadingStatsDaily[];
  onBackToShelf: () => void;
  onUpdateBookOffset: (
    bookId: string,
    newOffset: number,
    secondsDelta?: number,
    charsDelta?: number
  ) => void;
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onAddAnnotation: (ann: Omit<Annotation, 'id' | 'createdAt'>) => void;
  onUpdateAnnotation?: (ann: Annotation) => void;
  onDeleteAnnotation: (annId: string) => void;
  onUploadCustomFont: (file: File) => Promise<void>;
  onLockVault?: () => void;
  onToggleBookPrivacy?: (bookId: string) => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  book,
  annotations,
  customFonts,
  settings,
  dailyStats,
  onBackToShelf,
  onUpdateBookOffset,
  onUpdateSettings,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onUploadCustomFont,
  onLockVault,
  onToggleBookPrivacy,
}) => {
  const [chromeVisible, setChromeVisible] = useState(true);
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'toc' | 'settings'>('none');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportInitialFormat, setExportInitialFormat] = useState<ExportFormat>('pdf');
  const [quickPdfConfig, setQuickPdfConfig] = useState<ExportConfig>({
    ...DEFAULT_EXPORT_CONFIG,
    format: 'pdf',
    includeFullText: true,
    includeNotes: true,
    includeExcerpts: true,
    includeOutline: true,
    includeStats: true,
    themeStyle: 'parchment',
    fontStyle: 'serif',
  });
  const [quickPdfFeedback, setQuickPdfFeedback] = useState<string | null>(null);
  const [quoteCardTarget, setQuoteCardTarget] = useState<{
    chapterTitle: string;
    selectedText: string;
    noteText?: string;
  } | null>(null);
  const [outlineOpen, setOutlineOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1180 : false
  );
  const [tocTab, setTocTab] = useState<'chapters' | 'annotations' | 'search'>('chapters');
  const [chapterSearch, setChapterSearch] = useState('');
  const [fullTextSearchQuery, setFullTextSearchQuery] = useState('');
  const [einkFlashing, setEinkFlashing] = useState(false);
  const [autoFlipProgress, setAutoFlipProgress] = useState(0);
  const [isAutoPausedByHover, setIsAutoPausedByHover] = useState(false);
  const [scrubberVisible, setScrubberVisible] = useState(false);
  const [installedLocalFonts, setInstalledLocalFonts] = useState<InstalledSystemFont[]>(() =>
    detectInstalledLocalFonts()
  );
  const [localFontPickerOpen, setLocalFontPickerOpen] = useState(false);
  const [customLocalFontInput, setCustomLocalFontInput] = useState('');
  const touchStartPos = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchSwipedRef = useRef(false);

  const [selectionState, setSelectionState] = useState<{
    text: string;
    offset: number;
    chapterTitle: string;
  } | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [selectedColor, setSelectedColor] = useState<HighlightColor>('amber');

  // Inspect / edit existing inline annotation popover
  const [activeInspectAnnotation, setActiveInspectAnnotation] = useState<Annotation | null>(null);
  const [editAnnNote, setEditAnnNote] = useState('');
  const [editAnnColor, setEditAnnColor] = useState<HighlightColor>('amber');

  // Reading position jump-back history pill state
  const [jumpBackState, setJumpBackState] = useState<{
    pageIndex: number;
    offset: number;
  } | null>(null);
  const jumpBackTimerRef = useRef<number | null>(null);

  const [viewportDim, setViewportDim] = useState<{
    viewportWidth: number;
    viewportHeight: number;
  }>({
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1280,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const readerCanvasRef = useRef<HTMLElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastTrackedOffsetRef = useRef<number>(book.currentOffset);

  const [mermaidContainerWidth, setMermaidContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? Math.min(600, window.innerWidth) : 600
  );
  const [forceMermaidTD, setForceMermaidTD] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  // Debounced window resize handler (80ms) so resizing or orientation changes don't thrash layout
  useEffect(() => {
    let timer: number | null = null;
    const handleResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setViewportDim({
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      }, 80);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Automatically parse hierarchical Markdown headings (#, ##, ###, ####) & chapters for the Outline
  const outlineHeadings: Chapter[] = useMemo(() => {
    const parsed = extractChapters(book.content, book.format);
    return parsed.length > 0 ? parsed : book.chapters;
  }, [book.content, book.format, book.chapters]);

  // Cache AST blocks separately from typography/viewport settings so font/margin/resize changes
  // skip Markdown-It AST re-parsing and run pagination in <5ms
  const parsedBlocks = useMemo(() => {
    return parseDocumentWithMarkdownIt(book.content);
  }, [book.content]);

  const isDesktopSplitOutline = outlineOpen && viewportDim.viewportWidth >= 1024;
  const effectiveCanvasWidth = isDesktopSplitOutline
    ? Math.max(320, viewportDim.viewportWidth - 272)
    : viewportDim.viewportWidth;

  const isSpreadMode =
    settings.layoutMode === 'paginated-double' &&
    effectiveCanvasWidth >= 920 &&
    viewportDim.viewportHeight >= 520;
  const isPaginated = settings.layoutMode !== 'scroll';
  const isSinglePage = !isSpreadMode;

  const virtualPages = useMemo(() => {
    return paginateBookContent(
      book.content,
      outlineHeadings,
      settings,
      {
        viewportWidth: effectiveCanvasWidth,
        viewportHeight: viewportDim.viewportHeight,
      },
      isSpreadMode,
      parsedBlocks
    );
  }, [
    book.content,
    outlineHeadings,
    settings,
    effectiveCanvasWidth,
    viewportDim.viewportHeight,
    isSpreadMode,
    parsedBlocks,
  ]);

  const pageStep = isSpreadMode ? 2 : 1;
  const totalPages = virtualPages.length;

  const [pageIndex, setPageIndex] = useState<number>(() => {
    const raw = findPageIndexForOffset(virtualPages, book.currentOffset);
    return isSpreadMode && raw % 2 === 1 ? Math.max(0, raw - 1) : raw;
  });

  useEffect(() => {
    const raw = findPageIndexForOffset(virtualPages, book.currentOffset);
    const aligned = isSpreadMode && raw % 2 === 1 ? Math.max(0, raw - 1) : raw;
    setPageIndex(Math.max(0, Math.min(virtualPages.length - 1, aligned)));
  }, [virtualPages.length, isSpreadMode, book.id]);

  // Restore scroll position when entering scroll mode or switching books in scroll mode
  useEffect(() => {
    if (isPaginated) return;
    const timer = window.setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const targetPage = virtualPages[pageIndex];
      const firstBlockOffset = targetPage?.paragraphs[0]?.startOffset;
      if (firstBlockOffset !== undefined) {
        const blockEl = container.querySelector<HTMLElement>(
          `[data-start-offset="${firstBlockOffset}"]`
        );
        if (blockEl) {
          blockEl.scrollIntoView({ behavior: 'auto', block: 'start' });
          return;
        }
      }
      if (book.totalChars > 0) {
        const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
        container.scrollTop = (book.currentOffset / book.totalChars) * maxScroll;
      }
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isPaginated, book.id]);

  // ResizeObserver for Mermaid containers inside ReaderView:
  // When observed container width < 300px, automatically switch Mermaid direction to TD (Top-Down)
  // and strictly clamp chart max-width to viewport width (100vw).
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const canvasEl = readerCanvasRef.current;
    if (!canvasEl) return;

    const updateFromObservedElements = (entries?: ResizeObserverEntry[]) => {
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const mermaidEls = Array.from(
        canvasEl.querySelectorAll<HTMLElement>('.reader-mermaid-container')
      );

      // Force max-width to viewport width on every Mermaid container in ReaderView
      mermaidEls.forEach((el) => {
        el.style.maxWidth = 'min(100%, 100vw)';
      });

      let measuredWidth = 0;
      if (entries && entries.length > 0) {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 0 && (measuredWidth === 0 || w < measuredWidth)) {
            measuredWidth = w;
          }
        }
      }

      if (measuredWidth <= 0) {
        const firstMermaid = mermaidEls[0];
        const colEl = canvasEl.querySelector<HTMLElement>('[data-reader-column="true"]');
        measuredWidth =
          firstMermaid?.clientWidth ||
          colEl?.clientWidth ||
          Math.max(180, canvasEl.clientWidth - settings.pageMargin * 2);
      }

      const clampedW = Math.min(measuredWidth, viewportW);
      if (clampedW > 0) {
        setMermaidContainerWidth(Math.round(clampedW));
        setForceMermaidTD(clampedW < 540 || viewportW < 640);
      }
    };

    const observer = new ResizeObserver((entries) => {
      updateFromObservedElements(entries);
    });

    observer.observe(canvasEl);
    const colEls = canvasEl.querySelectorAll<HTMLElement>('[data-reader-column="true"]');
    colEls.forEach((el) => observer.observe(el));
    const mermaidEls = canvasEl.querySelectorAll<HTMLElement>('.reader-mermaid-container');
    mermaidEls.forEach((el) => observer.observe(el));

    updateFromObservedElements();

    return () => observer.disconnect();
  }, [pageIndex, isSpreadMode, isPaginated, settings.pageMargin, viewportDim.viewportWidth]);

  const triggerEinkRefreshIfNeeded = useCallback(() => {
    if (settings.theme === 'eink' && settings.einkFlashRefresh) {
      setEinkFlashing(true);
      setTimeout(() => setEinkFlashing(false), 230);
    }
  }, [settings.theme, settings.einkFlashRefresh]);

  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;
  const isSpreadModeRef = useRef(isSpreadMode);
  isSpreadModeRef.current = isSpreadMode;

  const goToPageIndex = useCallback(
    (targetIdx: number) => {
      if (totalPages === 0) return;
      const clampedIdx = Math.max(0, Math.min(totalPages - 1, targetIdx));
      const alignedIdx =
        isSpreadMode && clampedIdx % 2 === 1 ? Math.max(0, clampedIdx - 1) : clampedIdx;
      const targetPage = virtualPages[alignedIdx];
      if (!targetPage) return;

      setPageIndex(alignedIdx);
      pageIndexRef.current = alignedIdx;
      triggerEinkRefreshIfNeeded();

      const charsDelta = Math.max(
        0,
        Math.min(1800, Math.abs(targetPage.startOffset - lastTrackedOffsetRef.current))
      );
      lastTrackedOffsetRef.current = targetPage.startOffset;
      onUpdateBookOffset(book.id, targetPage.startOffset, 0, charsDelta);
      setAutoFlipProgress(0);
    },
    [
      totalPages,
      isSpreadMode,
      virtualPages,
      triggerEinkRefreshIfNeeded,
      onUpdateBookOffset,
      book.id,
    ]
  );

  const recordJumpOrigin = useCallback(
    (fromPageIdx: number) => {
      const fromOffset = virtualPages[fromPageIdx]?.startOffset ?? book.currentOffset;
      setJumpBackState({ pageIndex: fromPageIdx, offset: fromOffset });
      if (jumpBackTimerRef.current) {
        window.clearTimeout(jumpBackTimerRef.current);
      }
      jumpBackTimerRef.current = window.setTimeout(() => {
        setJumpBackState(null);
      }, 9000);
    },
    [virtualPages, book.currentOffset]
  );

  // ============================================================================
  // Dual-Engine TTS (Microsoft Edge Neural TTS + Local Web Speech API) Controller
  // ============================================================================
  const [ttsBarOpen, setTtsBarOpen] = useState(false);
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [activeTtsBlockIdx, setActiveTtsBlockIdx] = useState<number | null>(null);
  const [localVoices, setLocalVoices] = useState<LocalVoiceOption[]>([]);
  const [ttsToast, setTtsToast] = useState<string | null>(null);

  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsSessionIdRef = useRef<number>(0);

  const ttsEngine = settings.ttsEngine || 'edge';
  const ttsEdgeVoice = settings.ttsEdgeVoice || 'zh-CN-XiaoxiaoNeural';
  const ttsVoiceURI = settings.ttsVoiceURI || '';
  const ttsRate = settings.ttsRate ?? 1.0;
  const ttsPitch = settings.ttsPitch ?? 1.0;

  // Flatten all narratable blocks across virtualPages with their pageIndex and pre-built speech text
  const narratableBlocks = useMemo(() => {
    const list: {
      block: VirtualPage['paragraphs'][number];
      pageIndex: number;
      speechText: string;
    }[] = [];
    virtualPages.forEach((vp, pIdx) => {
      vp.paragraphs.forEach((blk) => {
        const speechText = buildBlockSpeechText(blk);
        if (speechText && speechText.trim().length > 0) {
          list.push({
            block: blk,
            pageIndex: pIdx,
            speechText: speechText.trim(),
          });
        }
      });
    });
    return list;
  }, [virtualPages]);

  const activeTtsOffset = useMemo(() => {
    if (activeTtsBlockIdx === null || !narratableBlocks[activeTtsBlockIdx]) return null;
    return narratableBlocks[activeTtsBlockIdx].block.startOffset;
  }, [activeTtsBlockIdx, narratableBlocks]);

  // Load browser local voices & subscribe to voiceschanged
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const updateVoices = () => {
      const sorted = getSortedLocalVoices();
      setLocalVoices(sorted);
    };
    updateVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', updateVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', updateVoices);
    };
  }, []);

  const stopAllTtsPlayback = useCallback((resetActiveBlock = false) => {
    ttsSessionIdRef.current += 1;
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.onended = null;
      ttsAudioRef.current.onerror = null;
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = '';
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setTtsStatus('idle');
    if (resetActiveBlock) {
      setActiveTtsBlockIdx(null);
    }
  }, []);

  // Stop TTS cleanly on unmount or when switching books
  useEffect(() => {
    return () => {
      stopAllTtsPlayback(true);
    };
  }, [book.id, stopAllTtsPlayback]);

  // Scroll active paragraph into view or flip page automatically when activeTtsBlockIdx changes
  useEffect(() => {
    if (activeTtsBlockIdx === null) return;
    const item = narratableBlocks[activeTtsBlockIdx];
    if (!item) return;

    if (isPaginated) {
      const visibleStart = pageIndexRef.current;
      const visibleEnd = isSpreadModeRef.current ? visibleStart + 1 : visibleStart;
      if (item.pageIndex < visibleStart || item.pageIndex > visibleEnd) {
        goToPageIndex(item.pageIndex);
      }
      // Also ensure paragraph is visible inside column if column scrolls
      setTimeout(() => {
        const el = readerCanvasRef.current?.querySelector<HTMLElement>(
          `[data-start-offset="${item.block.startOffset}"]`
        );
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    } else {
      const el = scrollContainerRef.current?.querySelector<HTMLElement>(
        `[data-start-offset="${item.block.startOffset}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeTtsBlockIdx, narratableBlocks, isPaginated, goToPageIndex]);

  const speakBlockAtIndex = useCallback(
    async (
      targetIdx: number,
      overrideParams?: {
        engine?: 'edge' | 'local';
        edgeVoice?: string;
        localVoiceURI?: string;
        rate?: number;
        pitch?: number;
      }
    ) => {
      if (narratableBlocks.length === 0) return;
      if (targetIdx < 0 || targetIdx >= narratableBlocks.length) {
        stopAllTtsPlayback(false);
        return;
      }

      stopAllTtsPlayback(false);
      const currentSession = ttsSessionIdRef.current;
      const item = narratableBlocks[targetIdx];
      setActiveTtsBlockIdx(targetIdx);

      const useEngine = overrideParams?.engine ?? ttsEngine;
      const useEdgeVoice = overrideParams?.edgeVoice ?? ttsEdgeVoice;
      const useLocalURI = overrideParams?.localVoiceURI ?? ttsVoiceURI;
      const useRate = overrideParams?.rate ?? ttsRate;
      const usePitch = overrideParams?.pitch ?? ttsPitch;

      const speakWithLocalWebSpeech = () => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          setTtsToast('当前浏览器不支持 Web Speech API');
          setTtsStatus('idle');
          return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(item.speechText);
        utterance.rate = Math.max(0.5, Math.min(2.0, useRate));
        utterance.pitch = Math.max(0.5, Math.min(1.5, usePitch));

        const voices = getSortedLocalVoices();
        const matched =
          voices.find((v) => v.voice.voiceURI === useLocalURI)?.voice ||
          voices.find((v) => v.isChinese && v.isOfflineLocal)?.voice ||
          voices.find((v) => v.isChinese)?.voice ||
          voices[0]?.voice;

        if (matched) {
          utterance.voice = matched;
          utterance.lang = matched.lang;
        } else {
          utterance.lang = 'zh-CN';
        }

        utterance.onstart = () => {
          if (ttsSessionIdRef.current === currentSession) {
            setTtsStatus('playing');
          }
        };

        utterance.onend = () => {
          if (ttsSessionIdRef.current !== currentSession) return;
          if (targetIdx + 1 < narratableBlocks.length) {
            speakBlockAtIndex(targetIdx + 1, overrideParams);
          } else {
            setTtsStatus('idle');
          }
        };

        utterance.onerror = (ev) => {
          if (ev.error === 'interrupted' || ev.error === 'canceled') return;
          if (ttsSessionIdRef.current === currentSession) {
            setTtsStatus('idle');
          }
        };

        setTtsStatus('playing');
        window.speechSynthesis.speak(utterance);
      };

      if (useEngine === 'edge') {
        try {
          setTtsStatus('loading');
          const abortCtrl = new AbortController();
          ttsAbortRef.current = abortCtrl;

          const audioUrl = await synthesizeEdgeSpeechUrl(
            item.speechText,
            useEdgeVoice,
            useRate,
            usePitch,
            abortCtrl.signal
          );

          if (ttsSessionIdRef.current !== currentSession) return;

          // Pre-fetch next paragraph in background for zero-lag transition
          const nextItem = narratableBlocks[targetIdx + 1];
          if (nextItem) {
            prefetchEdgeSpeech(nextItem.speechText, useEdgeVoice, useRate, usePitch);
          }

          if (!ttsAudioRef.current) {
            ttsAudioRef.current = new Audio();
          }
          const audio = ttsAudioRef.current;
          audio.src = audioUrl;
          audio.onended = () => {
            if (ttsSessionIdRef.current !== currentSession) return;
            if (targetIdx + 1 < narratableBlocks.length) {
              speakBlockAtIndex(targetIdx + 1, overrideParams);
            } else {
              setTtsStatus('idle');
            }
          };
          audio.onerror = () => {
            if (ttsSessionIdRef.current !== currentSession) return;
            speakWithLocalWebSpeech();
          };

          await audio.play();
          if (ttsSessionIdRef.current === currentSession) {
            setTtsStatus('playing');
          }
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          if (ttsSessionIdRef.current !== currentSession) return;
          setTtsToast('在线微软语音连接受限，已无缝切换至本地离线语音');
          setTimeout(() => setTtsToast(null), 3500);
          speakWithLocalWebSpeech();
        }
      } else {
        speakWithLocalWebSpeech();
      }
    },
    [
      narratableBlocks,
      stopAllTtsPlayback,
      ttsEngine,
      ttsEdgeVoice,
      ttsVoiceURI,
      ttsRate,
      ttsPitch,
    ]
  );

  const findInitialBlockIdxForCurrentView = useCallback((): number => {
    if (
      activeTtsBlockIdx !== null &&
      narratableBlocks[activeTtsBlockIdx] &&
      Math.abs(narratableBlocks[activeTtsBlockIdx].pageIndex - pageIndex) <= 1
    ) {
      return activeTtsBlockIdx;
    }
    const foundOnCurrentPage = narratableBlocks.findIndex((b) => b.pageIndex >= pageIndex);
    return foundOnCurrentPage !== -1 ? foundOnCurrentPage : 0;
  }, [activeTtsBlockIdx, narratableBlocks, pageIndex]);

  const handleToggleTtsPlayPause = useCallback(() => {
    if (ttsStatus === 'playing') {
      if (ttsEngine === 'edge' && ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        setTtsStatus('paused');
      } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.pause();
        setTtsStatus('paused');
      }
      return;
    }

    if (ttsStatus === 'paused') {
      if (ttsEngine === 'edge' && ttsAudioRef.current && ttsAudioRef.current.src) {
        ttsAudioRef.current.play().catch(() => {
          const idx = findInitialBlockIdxForCurrentView();
          speakBlockAtIndex(idx);
        });
        setTtsStatus('playing');
      } else if (
        typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        window.speechSynthesis.paused
      ) {
        window.speechSynthesis.resume();
        setTtsStatus('playing');
      } else {
        const idx = findInitialBlockIdxForCurrentView();
        speakBlockAtIndex(idx);
      }
      return;
    }

    // Start from current page or active block
    const startIdx = findInitialBlockIdxForCurrentView();
    speakBlockAtIndex(startIdx);
  }, [ttsStatus, ttsEngine, findInitialBlockIdxForCurrentView, speakBlockAtIndex]);

  const handleJumpAndSpeakAtOffset = useCallback(
    (startOffset: number) => {
      const idx = narratableBlocks.findIndex((b) => b.block.startOffset === startOffset);
      if (idx !== -1) {
        setTtsBarOpen(true);
        speakBlockAtIndex(idx);
      }
    },
    [narratableBlocks, speakBlockAtIndex]
  );

  const syncTtsToPage = useCallback(
    (targetPageIdx: number) => {
      if (!ttsBarOpen || narratableBlocks.length === 0) return;
      const foundIdx = narratableBlocks.findIndex((b) => b.pageIndex >= targetPageIdx);
      const targetBlockIdx = foundIdx !== -1 ? foundIdx : narratableBlocks.length - 1;

      if (ttsStatus === 'playing' || ttsStatus === 'loading') {
        speakBlockAtIndex(targetBlockIdx);
      } else {
        stopAllTtsPlayback(false);
        setActiveTtsBlockIdx(targetBlockIdx);
      }
    },
    [ttsBarOpen, narratableBlocks, ttsStatus, speakBlockAtIndex, stopAllTtsPlayback]
  );

  const syncTtsToOffset = useCallback(
    (charOffset: number) => {
      if (!ttsBarOpen || narratableBlocks.length === 0) return;
      let foundIdx = narratableBlocks.findIndex((b) => b.block.startOffset >= charOffset);
      if (foundIdx === -1) {
        const targetPage = findPageIndexForOffset(virtualPages, charOffset);
        foundIdx = narratableBlocks.findIndex((b) => b.pageIndex >= targetPage);
      }
      const targetBlockIdx = foundIdx !== -1 ? foundIdx : 0;

      if (ttsStatus === 'playing' || ttsStatus === 'loading') {
        speakBlockAtIndex(targetBlockIdx);
      } else {
        stopAllTtsPlayback(false);
        setActiveTtsBlockIdx(targetBlockIdx);
      }
    },
    [ttsBarOpen, narratableBlocks, ttsStatus, virtualPages, speakBlockAtIndex, stopAllTtsPlayback]
  );

  const jumpToCharOffset = useCallback(
    (charOffset: number) => {
      const targetIdx = findPageIndexForOffset(virtualPages, charOffset);
      if (Math.abs(targetIdx - pageIndex) > 2) {
        recordJumpOrigin(pageIndex);
      }
      goToPageIndex(targetIdx);

      // In audiobook mode, sync speech position so it reads content immediately
      if (ttsBarOpen) {
        syncTtsToOffset(charOffset);
      }

      if (!isPaginated && scrollContainerRef.current && book.totalChars > 0) {
        const el = scrollContainerRef.current;
        const targetPage = virtualPages[targetIdx];
        const firstBlockOffset = targetPage?.paragraphs[0]?.startOffset;
        const blockEl =
          firstBlockOffset !== undefined
            ? el.querySelector<HTMLElement>(`[data-start-offset="${firstBlockOffset}"]`)
            : null;
        if (blockEl) {
          blockEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
          el.scrollTo({
            top: (charOffset / book.totalChars) * maxScroll,
            behavior: 'smooth',
          });
        }
      }
      if (viewportDim.viewportWidth < 1024) {
        setOutlineOpen(false);
      }
    },
    [
      virtualPages,
      pageIndex,
      recordJumpOrigin,
      goToPageIndex,
      ttsBarOpen,
      syncTtsToOffset,
      isPaginated,
      book.totalChars,
      viewportDim.viewportWidth,
    ]
  );

  const handleNextPage = useCallback(() => {
    if (!isPaginated) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollBy({
          top: viewportDim.viewportHeight * 0.75,
          behavior: 'smooth',
        });
      }
      return;
    }
    const nextIdx = pageIndex + pageStep;
    if (nextIdx < totalPages) {
      goToPageIndex(nextIdx);
      if (ttsBarOpen) {
        syncTtsToPage(nextIdx);
      }
    }
  }, [
    isPaginated,
    pageIndex,
    pageStep,
    totalPages,
    goToPageIndex,
    viewportDim.viewportHeight,
    ttsBarOpen,
    syncTtsToPage,
  ]);

  const handlePrevPage = useCallback(() => {
    if (!isPaginated) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollBy({
          top: -viewportDim.viewportHeight * 0.75,
          behavior: 'smooth',
        });
      }
      return;
    }
    const prevIdx = pageIndex - pageStep;
    if (prevIdx >= 0) {
      goToPageIndex(prevIdx);
      if (ttsBarOpen) {
        syncTtsToPage(prevIdx);
      }
    }
  }, [
    isPaginated,
    pageIndex,
    pageStep,
    goToPageIndex,
    viewportDim.viewportHeight,
    ttsBarOpen,
    syncTtsToPage,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      onUpdateBookOffset(book.id, book.currentOffset, 5, 0);
    }, 5000);
    return () => clearInterval(interval);
  }, [book.id, book.currentOffset, onUpdateBookOffset]);

  useEffect(() => {
    if (!settings.autoFlipEnabled || isAutoPausedByHover || activeDrawer !== 'none') {
      return;
    }

    if (!isPaginated) {
      let lastTime = performance.now();
      let animId: number;
      let accumulatedChars = 0;

      const stepScroll = (now: number) => {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        const container = scrollContainerRef.current;
        if (container) {
          const deltaPx = settings.autoScrollSpeed * dt;
          container.scrollTop += deltaPx;
          accumulatedChars += deltaPx * 0.4;
          const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
          const ratio = Math.min(1, container.scrollTop / maxScroll);
          const estimatedOffset = Math.floor(ratio * book.totalChars);
          if (accumulatedChars >= 60) {
            onUpdateBookOffset(book.id, estimatedOffset, 0, Math.round(accumulatedChars));
            accumulatedChars = 0;
          }
        }
        animId = requestAnimationFrame(stepScroll);
      };

      animId = requestAnimationFrame(stepScroll);
      return () => cancelAnimationFrame(animId);
    } else {
      const intervalMs = Math.max(3, settings.autoFlipPageInterval) * 1000;
      const tickMs = 100;
      const increment = (tickMs / intervalMs) * 100;

      const timer = setInterval(() => {
        setAutoFlipProgress((prev) => {
          if (prev + increment >= 100) {
            handleNextPage();
            return 0;
          }
          return prev + increment;
        });
      }, tickMs);

      return () => clearInterval(timer);
    }
  }, [
    settings.autoFlipEnabled,
    settings.autoScrollSpeed,
    settings.autoFlipPageInterval,
    isAutoPausedByHover,
    activeDrawer,
    isPaginated,
    book.id,
    book.totalChars,
    onUpdateBookOffset,
    handleNextPage,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F opens in-book full-text search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setExportMenuOpen(false);
        setActiveDrawer('toc');
        setTocTab('search');
        setTimeout(() => searchInputRef.current?.focus(), 60);
        return;
      }

      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrevPage();
      } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onUpdateSettings({ autoFlipEnabled: !settings.autoFlipEnabled });
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        onUpdateSettings({ fontSize: Math.max(14, settings.fontSize - 1) });
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        onUpdateSettings({ fontSize: Math.min(30, settings.fontSize + 1) });
      } else if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onUpdateSettings({ fontSize: 18 });
      } else if (e.key === 'Escape') {
        if (ttsSettingsOpen) {
          setTtsSettingsOpen(false);
        } else if (activeInspectAnnotation) {
          setActiveInspectAnnotation(null);
        } else if (activeDrawer !== 'none') {
          setActiveDrawer('none');
        } else if (selectionState) {
          setSelectionState(null);
        } else {
          onBackToShelf();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleNextPage,
    handlePrevPage,
    onUpdateSettings,
    settings.autoFlipEnabled,
    settings.fontSize,
    activeInspectAnnotation,
    activeDrawer,
    selectionState,
    onBackToShelf,
  ]);

  const activeOffset = isPaginated
    ? (virtualPages[pageIndex]?.startOffset ?? book.currentOffset)
    : book.currentOffset;

  const currentChapterTitle = useMemo(() => {
    return findChapterTitleAtOffset(outlineHeadings, activeOffset);
  }, [outlineHeadings, activeOffset]);

  const isCurrentPageBookmarked = useMemo(() => {
    const currentPage = virtualPages[pageIndex];
    if (!currentPage) return false;
    const endRange =
      virtualPages[pageIndex + (isSpreadMode ? 1 : 0)]?.endOffset || currentPage.endOffset;
    return annotations.some(
      (a) =>
        a.type === 'bookmark' &&
        a.charOffset >= currentPage.startOffset &&
        a.charOffset < endRange
    );
  }, [annotations, virtualPages, pageIndex, isSpreadMode]);

  const handleToggleBookmarkAtCurrentPage = () => {
    const currentPage = virtualPages[pageIndex];
    if (!currentPage) return;

    const endRange =
      virtualPages[pageIndex + (isSpreadMode ? 1 : 0)]?.endOffset || currentPage.endOffset;
    const existing = annotations.find(
      (a) =>
        a.type === 'bookmark' &&
        a.charOffset >= currentPage.startOffset &&
        a.charOffset < endRange
    );
    if (existing) {
      onDeleteAnnotation(existing.id);
      return;
    }

    const previewSnippet =
      currentPage.paragraphs[0]?.text.slice(0, 68) ||
      book.content.slice(currentPage.startOffset, currentPage.startOffset + 68);

    onAddAnnotation({
      bookId: book.id,
      type: 'bookmark',
      chapterTitle: currentChapterTitle,
      charOffset: currentPage.startOffset,
      selectedText: previewSnippet,
      noteText: '',
      color: 'caramel',
    });
  };

  const handleMouseUpSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (text.length < 2 || text.length > 600) return;

    // Pinpoint block start offset via [data-start-offset] attribute on paragraph DOM node
    const anchorEl =
      sel.anchorNode instanceof HTMLElement
        ? sel.anchorNode
        : sel.anchorNode?.parentElement || null;
    const blockEl = anchorEl?.closest<HTMLElement>('[data-start-offset]');
    const blockStartAttr = blockEl ? Number(blockEl.getAttribute('data-start-offset')) : NaN;

    const fallbackStart = virtualPages[pageIndex]?.startOffset ?? book.currentOffset;
    const searchOrigin = !Number.isNaN(blockStartAttr)
      ? Math.max(0, blockStartAttr - 40)
      : Math.max(0, fallbackStart - 500);

    const foundIdx = book.content.indexOf(text, searchOrigin);
    const finalOffset =
      foundIdx !== -1
        ? foundIdx
        : !Number.isNaN(blockStartAttr)
        ? blockStartAttr
        : fallbackStart;

    setActiveInspectAnnotation(null);
    setSelectionState({
      text,
      offset: finalOffset,
      chapterTitle: findChapterTitleAtOffset(outlineHeadings, finalOffset),
    });
    setNoteInput('');
  };

  const handleSaveHighlightNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectionState) return;
    onAddAnnotation({
      bookId: book.id,
      type: 'note',
      chapterTitle: selectionState.chapterTitle,
      charOffset: selectionState.offset,
      selectedText: selectionState.text,
      noteText: noteInput.trim(),
      color: selectedColor,
    });
    setSelectionState(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleSaveInspectAnnotationEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeInspectAnnotation || !onUpdateAnnotation) return;
    onUpdateAnnotation({
      ...activeInspectAnnotation,
      noteText: editAnnNote.trim(),
      color: editAnnColor,
    });
    setActiveInspectAnnotation(null);
  };

  const handleCanvasZoneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (touchSwipedRef.current) {
      touchSwipedRef.current = false;
      return;
    }
    if (activeInspectAnnotation) {
      setActiveInspectAnnotation(null);
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      return;
    }
    if (activeDrawer !== 'none') {
      setActiveDrawer('none');
      return;
    }
    if (exportMenuOpen) {
      setExportMenuOpen(false);
      return;
    }
    if (ttsSettingsOpen) {
      setTtsSettingsOpen(false);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratioX = clickX / rect.width;

    if (ratioX < 0.3) {
      if (scrubberVisible && viewportDim.viewportWidth < 768) {
        setScrubberVisible(false);
      }
      handlePrevPage();
    } else if (ratioX > 0.7) {
      if (scrubberVisible && viewportDim.viewportWidth < 768) {
        setScrubberVisible(false);
      }
      handleNextPage();
    } else {
      const nextVisible = !chromeVisible;
      setChromeVisible(nextVisible);
      if (viewportDim.viewportWidth < 768) {
        setScrubberVisible(nextVisible);
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') {
      return;
    }
    if (e.touches.length !== 1) return;
    touchStartPos.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
    touchSwipedRef.current = false;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    handleMouseUpSelection();
    if (!touchStartPos.current) return;
    if (e.changedTouches.length !== 1) {
      touchStartPos.current = null;
      return;
    }

    const start = touchStartPos.current;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const duration = Date.now() - start.time;
    touchStartPos.current = null;

    // Do not trigger page turn if user was selecting text
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      return;
    }

    const screenH = typeof window !== 'undefined' ? window.innerHeight : 800;

    // 1. Swipe up from bottom area to summon progress scrubber bar
    if (start.y > screenH * 0.6 && deltaY < -35 && absY > absX * 1.1 && duration < 700) {
      setScrubberVisible(true);
      touchSwipedRef.current = true;
      setTimeout(() => {
        touchSwipedRef.current = false;
      }, 350);
      return;
    }

    // 2. Swipe down to dismiss progress scrubber bar
    if (scrubberVisible && deltaY > 35 && absY > absX * 1.1 && duration < 700) {
      setScrubberVisible(false);
      touchSwipedRef.current = true;
      setTimeout(() => {
        touchSwipedRef.current = false;
      }, 350);
      return;
    }

    // 3. Swipe left (next page) or swipe right (prev page)
    if (isPaginated && absX > 38 && absX > absY * 1.25 && duration < 650) {
      touchSwipedRef.current = true;
      setTimeout(() => {
        touchSwipedRef.current = false;
      }, 350);
      if (deltaX < -38) {
        handleNextPage();
      } else if (deltaX > 38) {
        handlePrevPage();
      }
    }
  };

  const getFontFamilyCss = (fontId: string): string => {
    return resolveReaderFontFamilyCss(fontId);
  };

  const renderPageParagraphs = (page: VirtualPage | undefined) => {
    if (!page) {
      return (
        <div
          className="flex h-full items-center justify-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          — 卷末 —
        </div>
      );
    }

    return page.paragraphs.map((p, idx) => (
      <MarkdownBlockRenderer
        key={`${page.pageNumber}-${idx}`}
        block={p}
        settings={settings}
        annotations={annotations}
        searchHighlightQuery={fullTextSearchQuery}
        onSelectAnnotation={(ann) => {
          setSelectionState(null);
          setActiveInspectAnnotation(ann);
          setEditAnnNote(ann.noteText || '');
          setEditAnnColor(ann.color || 'amber');
        }}
        forceMermaidTD={forceMermaidTD}
        mermaidContainerWidth={mermaidContainerWidth}
        isLastBlock={idx === page.paragraphs.length - 1}
        isTtsActive={activeTtsOffset !== null && p.startOffset === activeTtsOffset}
        isTtsModeOpen={ttsBarOpen}
        onClickBlockForTts={handleJumpAndSpeakAtOffset}
      />
    ));
  };

  // Full-text search results across the entire book
  const fullTextSearchResults = useMemo(() => {
    const q = fullTextSearchQuery.trim();
    if (q.length < 1) return [];
    const lowerContent = book.content.toLowerCase();
    const lowerQ = q.toLowerCase();
    const results: {
      offset: number;
      snippet: string;
      chapterTitle: string;
      pageNumber: number;
    }[] = [];

    let pos = 0;
    while (pos < lowerContent.length && results.length < 60) {
      const idx = lowerContent.indexOf(lowerQ, pos);
      if (idx === -1) break;
      const snippetStart = Math.max(0, idx - 26);
      const snippetEnd = Math.min(book.content.length, idx + q.length + 38);
      const rawSnippet = book.content
        .slice(snippetStart, snippetEnd)
        .replace(/\s+/g, ' ')
        .trim();
      const pageIdx = findPageIndexForOffset(virtualPages, idx);
      results.push({
        offset: idx,
        snippet:
          (snippetStart > 0 ? '…' : '') +
          rawSnippet +
          (snippetEnd < book.content.length ? '…' : ''),
        chapterTitle: findChapterTitleAtOffset(outlineHeadings, idx),
        pageNumber: pageIdx + 1,
      });
      pos = idx + Math.max(1, q.length);
    }
    return results;
  }, [book.content, fullTextSearchQuery, virtualPages, outlineHeadings]);

  const maxColPx = getMaxColumnWidthPx(settings.maxColumnWidth);
  const singlePageMaxWidthCss =
    maxColPx !== null && maxColPx < 9000 ? `min(100%, ${maxColPx}px)` : '100%';

  const progressPct = useMemo(() => {
    if (isPaginated) {
      if (totalPages <= 1) return 100;
      const viewedEndPage = Math.min(totalPages, pageIndex + pageStep);
      return Math.min(100, Math.round((viewedEndPage / totalPages) * 100));
    }
    return book.totalChars > 0
      ? Math.min(100, Math.round((book.currentOffset / book.totalChars) * 100))
      : 0;
  }, [isPaginated, totalPages, pageIndex, pageStep, book.currentOffset, book.totalChars]);

  const filteredChapters = useMemo(() => {
    if (!chapterSearch.trim()) return outlineHeadings;
    return outlineHeadings.filter((ch) =>
      ch.title.toLowerCase().includes(chapterSearch.toLowerCase())
    );
  }, [outlineHeadings, chapterSearch]);

  const leftPage = virtualPages[pageIndex];
  const rightPage = isSpreadMode ? virtualPages[pageIndex + 1] : undefined;

  const canGoPrev = !isPaginated || pageIndex > 0;
  const canGoNext = !isPaginated || pageIndex + pageStep < totalPages;

  const notesWithThoughtsCount = useMemo(
    () => annotations.filter((a) => Boolean(a.noteText && a.noteText.trim())).length,
    [annotations]
  );

  const [quickMermaidTick, setQuickMermaidTick] = useState(0);

  // Sync PDF export theme & font style with the Reader's active display theme & font family
  useEffect(() => {
    const mappedTheme: ExportThemeStyle =
      settings.theme === 'night' || settings.theme === 'candlelight'
        ? 'espresso'
        : settings.theme === 'eink'
        ? 'eink'
        : settings.theme === 'cream' || settings.theme === 'sandalwood'
        ? 'caramel'
        : 'parchment';
    const mappedFont: 'serif' | 'kaiti' | 'sans' =
      settings.fontFamily === 'kaiti' ||
      settings.fontFamily === 'kaiti-classic' ||
      /kai|楷|隶/i.test(settings.fontFamily)
        ? 'kaiti'
        : settings.fontFamily === 'sans' ||
          settings.fontFamily === 'sans-warm' ||
          /hei|sans|yahei|pingfang|黑|雅|苹/i.test(settings.fontFamily)
        ? 'sans'
        : 'serif';
    setQuickPdfConfig((prev) => ({
      ...prev,
      themeStyle: mappedTheme,
      fontStyle: mappedFont,
    }));
    warmUpCjkPdfFont(mappedFont);
  }, [settings.theme, settings.fontFamily]);

  useEffect(() => {
    if (!book?.content) return;
    let cancelled = false;
    warmUpMermaidDiagramsForContent(book.content, quickPdfConfig.themeStyle)
      .then(() => {
        if (!cancelled) setQuickMermaidTick((t) => t + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exportMenuOpen, book.id, book.content, quickPdfConfig.themeStyle]);

  const quickPdfPreview = useMemo(() => {
    if (!exportMenuOpen) return null;
    warmUpCjkPdfFont(quickPdfConfig.fontStyle || 'serif');
    return renderJsPdfPages(book, annotations, dailyStats, quickPdfConfig, Infinity);
  }, [exportMenuOpen, book, annotations, dailyStats, quickPdfConfig, quickMermaidTick]);

  const handleQuickJsPdfDownload = async () => {
    const synced: ExportConfig = {
      ...quickPdfConfig,
      format: 'pdf',
      includeAnnotations: Boolean(quickPdfConfig.includeNotes || quickPdfConfig.includeExcerpts),
    };
    setQuickPdfFeedback('正在渲染全书 Mermaid 图表并生成矢量 PDF...');
    const res = await exportBookWithJsPdf(book, annotations, dailyStats, synced);
    setQuickPdfFeedback(`已完整生成 ${res.totalPages} 页矢量 PDF（含图表）`);
    setTimeout(() => setQuickPdfFeedback(null), 2600);
  };

  const handleQuickNativePrint = async () => {
    const synced: ExportConfig = {
      ...quickPdfConfig,
      format: 'pdf',
      includeAnnotations: Boolean(quickPdfConfig.includeNotes || quickPdfConfig.includeExcerpts),
    };
    setQuickPdfFeedback('正在准备全书图表与矢量打印排版...');
    await warmUpMermaidDiagramsForContent(book.content, synced.themeStyle);
    const fullResult = renderJsPdfPages(book, annotations, dailyStats, synced, Infinity);
    printDocumentViaHiddenIframe(fullResult.vectorPrintHtml);
    setQuickPdfFeedback(`已唤起全书 ${fullResult.totalPages} 页 A4 矢量打印`);
    setTimeout(() => setQuickPdfFeedback(null), 2600);
  };

  return (
    <div
      className={`relative flex h-screen w-screen flex-col overflow-hidden select-text ${
        einkFlashing ? 'eink-flash-anim' : ''
      }`}
      style={{ backgroundColor: 'var(--bg-page)', color: 'var(--text-primary)' }}
      onMouseEnter={() => {
        if (settings.autoFlipEnabled) setIsAutoPausedByHover(false);
      }}
    >
      <input
        ref={fontInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            await onUploadCustomFont(file);
            e.target.value = '';
          }
        }}
      />

      {/* Minimal Icon-Driven Top Floating Chrome */}
      <header
        className={`fixed top-0 right-0 left-0 z-30 flex h-13 items-center justify-between px-4 transition-all duration-200 sm:px-6 ${
          chromeVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-full opacity-0'
        }`}
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBackToShelf}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
            style={{
              backgroundColor: 'var(--bg-page)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            title="返回书架 (Esc)"
            aria-label="返回书架"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* Toggle Markdown Outline Sidebar Button (Shown on desktop/tablet; on mobile TOC drawer is used) */}
          <button
            onClick={() => setOutlineOpen((v) => !v)}
            className="hidden md:flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
            style={{
              backgroundColor: outlineOpen ? 'var(--accent-primary)' : 'var(--bg-page)',
              color: outlineOpen ? '#FFFFFF' : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            title="切换目录大纲侧栏 (#)"
            aria-label="切换目录大纲侧栏"
          >
            {outlineOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </button>

          {/* Book title text (hidden on mobile to preserve a clean, balanced, icon-only top bar) */}
          <div className="hidden md:flex min-w-0 items-center gap-1.5 pl-1">
            {book.isPrivate && (
              <Lock
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: 'var(--accent-primary)' }}
              />
            )}
            <h1 className="font-display truncate text-sm font-semibold">{book.title}</h1>
          </div>
        </div>

        {/* Direct In-Window Style, Font Size & Action Toolbar */}
        <div className="flex items-center gap-1.5">
          {book.isPrivate && onToggleBookPrivacy && (
            <button
              type="button"
              onClick={() => onToggleBookPrivacy(book.id)}
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
              style={{
                backgroundColor: 'var(--bg-page)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
              title="将本书解密转到公开书架"
              aria-label="转到公开书架"
            >
              <Unlock className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
            </button>
          )}
          {book.isPrivate && onLockVault && (
            <button
              type="button"
              onClick={onLockVault}
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
              style={{
                backgroundColor: 'var(--bg-page)',
                color: 'var(--accent-primary)',
                border: '1px solid var(--border-subtle)',
              }}
              title="立即锁定私密空间并返回公开书架 (Ctrl/Cmd + Shift + L)"
              aria-label="锁定私密空间"
            >
              <Lock className="h-4 w-4" />
            </button>
          )}

          {/* Direct In-Window Reading Style Switcher (Pure Icon 1-Click Theme Selection) */}
          <div
            className="hidden items-center gap-0.5 rounded-xl p-0.5 sm:flex"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
            role="group"
            aria-label="阅读窗口直接切换阅读风格"
          >
            {READER_THEME_OPTIONS.map((t) => {
              const Icon = t.icon;
              const active = settings.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onUpdateSettings({ theme: t.id })}
                  className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
                  style={{
                    backgroundColor: active ? 'var(--accent-primary)' : 'transparent',
                    color: active ? '#FFFFFF' : 'var(--text-secondary)',
                  }}
                  title={t.fullTitle}
                  aria-label={t.fullTitle}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          <button
            onClick={() => onUpdateSettings({ autoFlipEnabled: !settings.autoFlipEnabled })}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
            style={{
              backgroundColor: settings.autoFlipEnabled
                ? 'var(--accent-primary)'
                : 'var(--bg-page)',
              color: settings.autoFlipEnabled ? '#FFFFFF' : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            title={settings.autoFlipEnabled ? '暂停自动翻页 (F)' : '开启自动翻页 (F)'}
            aria-label="自动翻页"
          >
            {settings.autoFlipEnabled ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>

          {/* Top Toolbar Inline Read-Aloud / TTS Capsule (Never obscures book text) */}
          {!ttsBarOpen ? (
            <button
              type="button"
              onClick={() => {
                setExportMenuOpen(false);
                setActiveDrawer('none');
                setTtsBarOpen(true);
                if (ttsStatus === 'idle') {
                  const startIdx = findInitialBlockIdxForCurrentView();
                  speakBlockAtIndex(startIdx);
                }
              }}
              className="relative flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-all"
              style={{
                backgroundColor: 'var(--bg-page)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
              title="开启智能语音朗读（支持微软晓晓/云希角色语音与本地离线语音）"
              aria-label="智能语音朗读"
            >
              <Headphones className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="hidden sm:inline">听书</span>
            </button>
          ) : (
            <div
              className="flex h-9 items-center gap-0.5 rounded-xl p-1 sm:gap-1"
              style={{
                backgroundColor: 'var(--bg-page)',
                border: '1.5px solid var(--accent-primary)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                disabled={activeTtsBlockIdx === null || activeTtsBlockIdx <= 0}
                onClick={() => {
                  const current = activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                  if (current > 0) {
                    speakBlockAtIndex(current - 1);
                  }
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity disabled:opacity-30"
                style={{ color: 'var(--text-primary)' }}
                title="上一段"
                aria-label="上一段"
              >
                <SkipBack className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={handleToggleTtsPlayPause}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-white transition-transform active:scale-95"
                style={{ backgroundColor: 'var(--accent-primary)' }}
                title={ttsStatus === 'playing' ? '暂停朗读' : '开始/继续朗读'}
                aria-label={ttsStatus === 'playing' ? '暂停朗读' : '开始朗读'}
              >
                {ttsStatus === 'loading' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : ttsStatus === 'playing' ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </button>

              <button
                type="button"
                disabled={
                  activeTtsBlockIdx !== null &&
                  activeTtsBlockIdx >= narratableBlocks.length - 1
                }
                onClick={() => {
                  const current = activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                  if (current + 1 < narratableBlocks.length) {
                    speakBlockAtIndex(current + 1);
                  }
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity disabled:opacity-30"
                style={{ color: 'var(--text-primary)' }}
                title="下一段"
                aria-label="下一段"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>

              {/* Voice Character & Speed Dropdown Trigger */}
              <button
                type="button"
                onClick={() => {
                  setExportMenuOpen(false);
                  setActiveDrawer('none');
                  setTtsSettingsOpen((v) => !v);
                }}
                className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors"
                style={{
                  backgroundColor: ttsSettingsOpen
                    ? 'var(--accent-primary)'
                    : 'var(--bg-surface)',
                  color: ttsSettingsOpen ? '#FFFFFF' : 'var(--accent-primary)',
                }}
                title="选择微软角色声音 / 离线发音人及语速语调"
              >
                <span className="max-w-[56px] truncate sm:max-w-[76px]">
                  {ttsEngine === 'edge'
                    ? EDGE_NEURAL_VOICES.find((v) => v.id === ttsEdgeVoice)?.name.split(' · ')[0] ||
                      '晓晓'
                    : '本地'}
                </span>
                <span className="font-mono-tabular opacity-85">{ttsRate}x</span>
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${
                    ttsSettingsOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Stop & Exit TTS Button */}
              <button
                type="button"
                onClick={() => {
                  stopAllTtsPlayback(true);
                  setTtsSettingsOpen(false);
                  setTtsBarOpen(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:text-red-600"
                style={{ color: 'var(--text-muted)' }}
                title="停止朗读并退出听书"
                aria-label="停止并退出听书"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <button
            onClick={handleToggleBookmarkAtCurrentPage}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
            style={{
              backgroundColor: isCurrentPageBookmarked
                ? 'var(--accent-soft)'
                : 'var(--bg-page)',
              color: isCurrentPageBookmarked
                ? 'var(--accent-primary)'
                : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            title="书签"
            aria-label="书签"
          >
            <Bookmark
              className="h-4 w-4"
              fill={isCurrentPageBookmarked ? 'currentColor' : 'none'}
            />
          </button>

          {/* Top-Bar Export Dropdown Menu (PDF with Body / Notes / Excerpts & jsPDF Preview/Download) */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                setExportMenuOpen((v) => !v);
                setActiveDrawer('none');
              }}
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
              style={{
                backgroundColor:
                  exportMenuOpen || exportModalOpen ? 'var(--accent-primary)' : 'var(--bg-page)',
                color: exportMenuOpen || exportModalOpen ? '#FFFFFF' : 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
              title="导出菜单：选择正文、笔记或书摘并预览下载 PDF"
              aria-label="导出菜单"
            >
              <Download className="h-4 w-4" />
            </button>

            {exportMenuOpen && (
              <div
                className="absolute top-11 right-0 z-50 w-80 rounded-2xl p-3.5 shadow-2xl sm:w-88"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              >
                <div
                  className="flex items-center justify-between border-b pb-2.5"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                    <span className="font-display text-xs font-semibold">
                      jsPDF 精美排版导出菜单
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExportMenuOpen(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-lg"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Content Selection: 正文 / 笔记 / 书摘 */}
                <div className="mt-3">
                  <div
                    className="mb-1.5 flex items-center justify-between text-[11px] font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span>勾选 PDF 导出内容维度</span>
                    <span className="font-mono-tabular" style={{ color: 'var(--text-muted)' }}>
                      可多选组合
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      {
                        key: 'includeFullText' as const,
                        label: '正文',
                        meta: `${(book.totalChars / 1000).toFixed(1)}k字`,
                        checked: Boolean(quickPdfConfig.includeFullText),
                      },
                      {
                        key: 'includeNotes' as const,
                        label: '笔记',
                        meta: `${notesWithThoughtsCount} 篇`,
                        checked: Boolean(quickPdfConfig.includeNotes),
                      },
                      {
                        key: 'includeExcerpts' as const,
                        label: '书摘',
                        meta: `${annotations.length} 条`,
                        checked: Boolean(quickPdfConfig.includeExcerpts),
                      },
                    ].map((opt) => (
                      <label
                        key={opt.key}
                        className="flex cursor-pointer flex-col justify-between rounded-xl p-2 text-xs transition-all"
                        style={{
                          backgroundColor: opt.checked
                            ? 'var(--accent-soft)'
                            : 'var(--bg-surface)',
                          border: opt.checked
                            ? '1px solid var(--accent-primary)'
                            : '1px solid var(--border-subtle)',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="font-semibold"
                            style={{
                              color: opt.checked
                                ? 'var(--accent-primary)'
                                : 'var(--text-primary)',
                            }}
                          >
                            {opt.label}
                          </span>
                          <input
                            type="checkbox"
                            checked={opt.checked}
                            onChange={(e) => {
                              const val = e.target.checked;
                              setQuickPdfConfig((prev) => ({
                                ...prev,
                                [opt.key]: val,
                                includeAnnotations: Boolean(
                                  (opt.key === 'includeNotes' ? val : prev.includeNotes) ||
                                    (opt.key === 'includeExcerpts' ? val : prev.includeExcerpts)
                                ),
                              }));
                            }}
                            className="h-3.5 w-3.5 accent-[#B4532A]"
                          />
                        </div>
                        <span
                          className="font-mono-tabular mt-1 text-[10px]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {opt.meta}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Paper Theme Selector */}
                <div className="mt-2.5">
                  <div
                    className="mb-1 text-[11px] font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    PDF 典藏纸张配色
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        { id: 'parchment', label: '羊皮', hex: '#FBF7F0' },
                        { id: 'caramel', label: '焦糖', hex: '#F7EEDF' },
                        { id: 'espresso', label: '夜读', hex: '#211A15' },
                        { id: 'eink', label: '墨水', hex: '#F7F7F7' },
                      ] as { id: ExportThemeStyle; label: string; hex: string }[]
                    ).map((t) => {
                      const active = quickPdfConfig.themeStyle === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setQuickPdfConfig((prev) => ({ ...prev, themeStyle: t.id }))
                          }
                          className="flex items-center justify-center gap-1 rounded-lg py-1 text-[11px] font-medium"
                          style={{
                            backgroundColor: active
                              ? 'var(--accent-primary)'
                              : 'var(--bg-surface)',
                            color: active ? '#FFFFFF' : 'var(--text-primary)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <span
                            className="h-2 w-2 rounded-full border border-black/20"
                            style={{ backgroundColor: t.hex }}
                          />
                          <span>{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Mini A4 Preview Card */}
                {quickPdfPreview && quickPdfPreview.pageDataUrls[0] && (
                  <div
                    className="mt-2.5 flex items-center gap-3 rounded-xl p-2"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <img
                      src={quickPdfPreview.pageDataUrls[0]}
                      alt="PDF 首页实时排版预览"
                      className="h-20 w-14 shrink-0 rounded border object-cover shadow-xs"
                      style={{ borderColor: 'var(--border-strong)' }}
                    />
                    <div className="min-w-0 flex-1 space-y-1 text-[11px]">
                      <div className="font-semibold truncate">《{book.title}》A4 预检</div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        已勾选：
                        {[
                          quickPdfConfig.includeFullText ? '正文' : null,
                          quickPdfConfig.includeNotes ? '笔记' : null,
                          quickPdfConfig.includeExcerpts ? '书摘' : null,
                        ]
                          .filter(Boolean)
                          .join(' + ') || '仅封面'}
                      </div>
                      <div
                        className="font-mono-tabular text-[10px]"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        双击或点击下方按钮打开多页大图预览
                      </div>
                    </div>
                  </div>
                )}

                {quickPdfFeedback && (
                  <div
                    className="mt-2 flex items-center justify-center gap-1.5 rounded-lg py-1 text-[11px] font-medium"
                    style={{
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent-primary)',
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>{quickPdfFeedback}</span>
                  </div>
                )}

                {/* Primary Actions: Preview Studio & Direct Download */}
                <div className="mt-3 space-y-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setExportInitialFormat('pdf');
                      setExportMenuOpen(false);
                      setExportModalOpen(true);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-white transition-transform active:scale-[0.99]"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>精美 PDF 排版预览与下载</span>
                  </button>

                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={handleQuickJsPdfDownload}
                      className="flex items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-strong)',
                      }}
                      title="下载内嵌中文字体的矢量 PDF"
                    >
                      <Download className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                      <span>下载 .pdf</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleQuickNativePrint}
                      className="flex items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-strong)',
                      }}
                      title="唤起无页眉 A4 矢量打印"
                    >
                      <Printer className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                      <span>直接打印</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setExportInitialFormat('md');
                        setExportMenuOpen(false);
                        setExportModalOpen(true);
                      }}
                      className="flex items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>更多格式</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setExportMenuOpen(false);
              if (activeDrawer === 'toc' && tocTab === 'search') {
                setActiveDrawer('none');
              } else {
                setActiveDrawer('toc');
                setTocTab('search');
                setTimeout(() => searchInputRef.current?.focus(), 60);
              }
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
            style={{
              backgroundColor:
                activeDrawer === 'toc' && tocTab === 'search'
                  ? 'var(--accent-primary)'
                  : 'var(--bg-page)',
              color:
                activeDrawer === 'toc' && tocTab === 'search'
                  ? '#FFFFFF'
                  : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            title="全文检索 (Ctrl/Cmd + F)"
            aria-label="全文检索"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            onClick={() => {
              setExportMenuOpen(false);
              if (activeDrawer === 'toc' && tocTab !== 'search') {
                setActiveDrawer('none');
              } else {
                setActiveDrawer('toc');
                if (tocTab === 'search') setTocTab('chapters');
              }
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
            style={{
              backgroundColor:
                activeDrawer === 'toc' && tocTab !== 'search'
                  ? 'var(--accent-primary)'
                  : 'var(--bg-page)',
              color:
                activeDrawer === 'toc' && tocTab !== 'search'
                  ? '#FFFFFF'
                  : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            title="目录与批注列表"
            aria-label="目录与批注"
          >
            <List className="h-4 w-4" />
          </button>

          <button
            onClick={() => {
              setExportMenuOpen(false);
              setActiveDrawer(activeDrawer === 'settings' ? 'none' : 'settings');
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
            style={{
              backgroundColor:
                activeDrawer === 'settings' ? 'var(--accent-primary)' : 'var(--bg-page)',
              color: activeDrawer === 'settings' ? '#FFFFFF' : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            title="风格与字号排版"
            aria-label="风格与字号排版"
          >
            <Sliders className="h-4 w-4" />
          </button>
        </div>
      </header>



      {/* Workspace Row: Left Markdown Outline Sidebar + Right Reading Canvas */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Hierarchical Markdown Heading (# / ## / ###) Outline Sidebar */}
        {outlineOpen && (
          <>
            {/* Mobile backdrop when outline is open on narrow screens */}
            <div
              className="fixed inset-0 z-30 bg-black/35 backdrop-blur-xs lg:hidden"
              onClick={() => setOutlineOpen(false)}
            />
            <aside
              className="fixed top-0 bottom-0 left-0 z-40 flex w-68 shrink-0 flex-col border-r pt-14 pb-14 transition-all lg:static lg:z-20"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between border-b px-4 py-2.5"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Hash className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                  <span>目录大纲 ({outlineHeadings.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOutlineOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ color: 'var(--text-muted)' }}
                  title="收起大纲"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-3 pt-2.5">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    value={chapterSearch}
                    onChange={(e) => setChapterSearch(e.target.value)}
                    placeholder="筛选标题…"
                    className="h-8 w-full rounded-lg pr-2.5 pl-8 text-xs outline-none"
                    style={{
                      backgroundColor: 'var(--bg-page)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              </div>

              <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2.5 py-1">
                {filteredChapters.map((ch) => {
                  const isCurrent = ch.title === currentChapterTitle;
                  const level = ch.level || 1;
                  const indentPx = (level - 1) * 12;

                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => jumpToCharOffset(ch.startOffset)}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors"
                      style={{
                        paddingLeft: `${10 + indentPx}px`,
                        backgroundColor: isCurrent ? 'var(--bg-page)' : 'transparent',
                        color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                        fontWeight: isCurrent || level === 1 ? 600 : 400,
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="font-mono-tabular shrink-0 text-[10px] opacity-65"
                          style={{
                            color: isCurrent ? 'var(--accent-primary)' : 'var(--text-muted)',
                          }}
                        >
                          H{level}
                        </span>
                        <span className="truncate">{ch.title}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>
          </>
        )}

        {/* Main Immersive Book Canvas with Touch Swipe Support */}
        <main
          ref={readerCanvasRef}
          onClick={handleCanvasZoneClick}
          onMouseUp={handleMouseUpSelection}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`relative flex flex-1 w-full items-stretch justify-center overflow-hidden px-0 transition-all duration-200 ${
            chromeVisible ? 'pt-13 pb-0 md:pb-12' : 'py-0'
          }`}
        >
          {isPaginated ? (
            <div
              className="relative mx-auto flex h-full w-full max-w-none flex-col justify-between overflow-hidden rounded-none border-0 shadow-none transition-all duration-200"
              style={{
                maxWidth: '100%',
                backgroundColor: 'var(--bg-page)',
                border: 'none',
                boxShadow: 'none',
                padding: isSinglePage
                  ? `4px ${Math.max(10, Math.min(settings.pageMargin, Math.floor(effectiveCanvasWidth * 0.035)))}px`
                  : `6px ${Math.max(12, Math.min(settings.pageMargin, Math.floor(effectiveCanvasWidth * 0.03)))}px`,
              }}
            >
              {isSpreadMode && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 left-1/2 z-10 w-6 -translate-x-1/2"
                  style={{ background: 'var(--spine-gradient)' }}
                />
              )}

              {/* Top Minimal Running Header */}
              <div
                className="flex shrink-0 items-center justify-between gap-2 pb-0.5 text-[11px] opacity-75"
                style={{
                  color: 'var(--text-muted)',
                }}
              >
                <span className="min-w-0 truncate">{currentChapterTitle}</span>
                <span className="font-mono-tabular shrink-0">
                  {pageIndex + 1}
                  {isSpreadMode && rightPage ? `–${pageIndex + 2}` : ''} / {totalPages}
                </span>
              </div>

              {/* Book Text Columns: Full-width auto-centered layout in single-page mode */}
              <div
                key={pageIndex}
                className={`reader-page-settle my-0.5 grid min-h-0 flex-1 overflow-hidden ${
                  isSpreadMode
                    ? 'grid-cols-2 gap-5 lg:gap-8'
                    : 'mx-auto w-full max-w-full grid-cols-1'
                }`}
                style={{
                  maxWidth: isSinglePage ? singlePageMaxWidthCss : '100%',
                  fontFamily: getFontFamilyCss(settings.fontFamily),
                  fontSize: `${settings.fontSize}px`,
                  lineHeight: settings.lineHeight,
                  letterSpacing: `${settings.letterSpacing}em`,
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                }}
              >
                <div
                  data-reader-column="true"
                  className="min-w-0 w-full overflow-x-hidden overflow-y-auto pr-0.5 text-justify"
                >
                  {renderPageParagraphs(leftPage)}
                </div>
                {isSpreadMode && (
                  <div
                    data-reader-column="true"
                    className="min-w-0 w-full overflow-x-hidden overflow-y-auto pl-0.5 text-justify"
                  >
                    {renderPageParagraphs(rightPage)}
                  </div>
                )}
              </div>

              {/* Bottom Page Running Footer */}
              <div
                className="flex shrink-0 items-center justify-between pt-0.5 text-[11px] opacity-75"
                style={{
                  color: 'var(--text-muted)',
                }}
              >
                <span className="font-mono-tabular">
                  {pageIndex + 1} / {totalPages}
                </span>
                <span
                  className="font-mono-tabular font-medium"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {progressPct}%
                </span>
              </div>

              {settings.autoFlipEnabled && (
                <div
                  className="absolute right-0 bottom-0 left-0 h-1"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <div
                    className="h-full transition-all duration-100"
                    style={{
                      width: `${autoFlipProgress}%`,
                      backgroundColor: 'var(--accent-primary)',
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div
              ref={scrollContainerRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
                const ratio = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
                const newOffset = Math.floor(ratio * book.totalChars);
                const newPageIdx = findPageIndexForOffset(virtualPages, newOffset);
                if (newPageIdx !== pageIndex) {
                  setPageIndex(newPageIdx);
                }
                if (Math.abs(newOffset - book.currentOffset) > 120) {
                  const charsDelta = Math.max(
                    0,
                    Math.min(1800, Math.abs(newOffset - lastTrackedOffsetRef.current))
                  );
                  lastTrackedOffsetRef.current = newOffset;
                  onUpdateBookOffset(book.id, newOffset, 0, charsDelta);
                }
              }}
              onTouchStart={() => setIsAutoPausedByHover(true)}
              onTouchEnd={() => setIsAutoPausedByHover(false)}
              className="mx-auto h-full w-full max-w-none overflow-y-auto rounded-none border-0 shadow-none transition-colors"
              style={{
                maxWidth: '100%',
                backgroundColor: 'var(--bg-page)',
                border: 'none',
                boxShadow: 'none',
                padding: `12px ${Math.max(10, Math.min(settings.pageMargin, Math.floor(effectiveCanvasWidth * 0.035)))}px 64px`,
                fontFamily: getFontFamilyCss(settings.fontFamily),
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                letterSpacing: `${settings.letterSpacing}em`,
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              <div
                data-reader-column="true"
                className="mx-auto w-full text-justify"
                style={{ maxWidth: singlePageMaxWidthCss }}
              >
                {virtualPages.map((page) => (
                  <div key={page.pageNumber}>{renderPageParagraphs(page)}</div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Bottom Floating Scrubber Bar (Hidden by default on mobile, summonable via swipe-up from bottom) */}
      <footer
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`fixed right-0 bottom-0 left-0 z-30 flex flex-col justify-center px-4 py-2 transition-all duration-300 sm:px-6 sm:h-13 ${
          (viewportDim.viewportWidth >= 768 ? (chromeVisible || scrubberVisible) : scrubberVisible)
            ? 'translate-y-0 opacity-100 shadow-xl'
            : 'pointer-events-none translate-y-full opacity-0'
        }`}
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* Subtle mobile sheet pull handle */}
        <div
          className="mx-auto mb-1 h-1 w-8 rounded-full sm:hidden"
          style={{ backgroundColor: 'var(--border-strong)' }}
        />
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <span className="font-mono-tabular text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
            {isPaginated ? `${pageIndex + 1}/${totalPages}` : `${progressPct}%`}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, totalPages - 1)}
            value={pageIndex}
            onChange={(e) => {
              const target = Number(e.target.value);
              if (Math.abs(target - pageIndex) > 3 && !jumpBackState) {
                recordJumpOrigin(pageIndex);
              }
              goToPageIndex(target);
              if (ttsBarOpen) {
                syncTtsToPage(target);
              }
            }}
            className="h-2 flex-1 cursor-pointer accent-[#B4532A]"
          />
          <span
            className="font-mono-tabular text-xs font-medium shrink-0"
            style={{ color: 'var(--accent-primary)' }}
          >
            {progressPct}%
          </span>
          <button
            type="button"
            onClick={() => setScrubberVisible(false)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:hidden"
            style={{ color: 'var(--text-muted)' }}
            title="收起进度条"
            aria-label="收起进度条"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>

      {/* Subtle Toast Notification for TTS Engine Status */}
      {ttsToast && (
        <div className="pointer-events-none fixed top-15 left-1/2 z-50 -translate-x-1/2 px-4">
          <div
            className="rounded-xl px-3.5 py-1.5 text-xs font-medium shadow-lg"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-strong)',
              color: 'var(--accent-primary)',
            }}
          >
            {ttsToast}
          </div>
        </div>
      )}

      {/* Ultra-Compact Corner Margin Micro-Pill when Top Bar is Hidden during Immersion */}
      {ttsBarOpen && !chromeVisible && (
        <div
          className="fixed top-2 right-3 z-30 flex items-center gap-1 rounded-full px-2 py-1 shadow-md backdrop-blur-md transition-opacity opacity-75 hover:opacity-100"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleToggleTtsPlayPause}
            className="flex h-6 w-6 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: 'var(--accent-primary)' }}
            title={ttsStatus === 'playing' ? '暂停朗读' : '继续朗读'}
          >
            {ttsStatus === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : ttsStatus === 'playing' ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setChromeVisible(true);
              setTtsSettingsOpen(true);
            }}
            className="flex items-center gap-1 px-1.5 text-[11px] font-medium"
            style={{ color: 'var(--accent-primary)' }}
            title="展开顶部听书控制与角色设置"
          >
            <span>
              {ttsEngine === 'edge'
                ? EDGE_NEURAL_VOICES.find((v) => v.id === ttsEdgeVoice)?.name.split(' · ')[0] ||
                  '晓晓'
                : '本地'}
            </span>
            <span className="font-mono-tabular">{ttsRate}x</span>
          </button>
          <button
            type="button"
            onClick={() => {
              stopAllTtsPlayback(true);
              setTtsSettingsOpen(false);
              setTtsBarOpen(false);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full"
            style={{ color: 'var(--text-muted)' }}
            title="退出听书"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Top-Right Anchored Voice Character & Prosody Popover (Click-outside auto-dismisses) */}
      {ttsBarOpen && ttsSettingsOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setTtsSettingsOpen(false)}
        >
          <aside
            className="fixed top-14 right-3 z-50 flex max-h-[calc(100vh-4.5rem)] w-[364px] max-w-[calc(100vw-1.5rem)] flex-col space-y-3 overflow-y-auto rounded-2xl p-3.5 shadow-2xl sm:right-6 sm:p-4"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between gap-2 border-b pb-2.5"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-1.5">
                <Headphones className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="font-display text-xs font-semibold">
                  听书角色音色与语速设置
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTtsSettingsOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                title="收起设置面板（不中断朗读）"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Engine Switcher Tabs */}
            <div
              className="grid grid-cols-2 gap-1 rounded-xl p-1 text-xs"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  onUpdateSettings({ ttsEngine: 'edge' });
                  if (ttsStatus === 'playing' || ttsStatus === 'loading') {
                    const idx = activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                    speakBlockAtIndex(idx, { engine: 'edge' });
                  }
                }}
                className="rounded-lg py-1.5 text-[11px] font-medium transition-all"
                style={{
                  backgroundColor:
                    ttsEngine === 'edge' ? 'var(--accent-primary)' : 'transparent',
                  color: ttsEngine === 'edge' ? '#FFFFFF' : 'var(--text-secondary)',
                }}
              >
                微软神经网络角色 (在线)
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateSettings({ ttsEngine: 'local' });
                  if (ttsStatus === 'playing' || ttsStatus === 'loading') {
                    const idx = activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                    speakBlockAtIndex(idx, { engine: 'local' });
                  }
                }}
                className="rounded-lg py-1.5 text-[11px] font-medium transition-all"
                style={{
                  backgroundColor:
                    ttsEngine === 'local' ? 'var(--accent-primary)' : 'transparent',
                  color: ttsEngine === 'local' ? '#FFFFFF' : 'var(--text-secondary)',
                }}
              >
                系统原生语音 (本地离线)
              </button>
            </div>

            {/* Voice Selection Area */}
            <div>
              {ttsEngine === 'edge' ? (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      微软超拟真角色声音（选中后可点击空白处收起面板）
                    </span>
                    <span
                      className="font-mono-tabular font-medium"
                      style={{ color: 'var(--accent-primary)' }}
                    >
                      {EDGE_NEURAL_VOICES.find((v) => v.id === ttsEdgeVoice)?.name.split(' · ')[0] ||
                        '晓晓'}
                    </span>
                  </div>
                  <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
                    {EDGE_NEURAL_VOICES.map((v) => {
                      const active = ttsEdgeVoice === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            onUpdateSettings({ ttsEdgeVoice: v.id, ttsEngine: 'edge' });
                            if (ttsStatus === 'playing' || ttsStatus === 'loading') {
                              const idx =
                                activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                              speakBlockAtIndex(idx, { engine: 'edge', edgeVoice: v.id });
                            }
                          }}
                          className="flex flex-col items-start rounded-xl p-2 text-left transition-all"
                          style={{
                            backgroundColor: active
                              ? 'var(--accent-soft)'
                              : 'var(--bg-surface)',
                            border: active
                              ? '1.5px solid var(--accent-primary)'
                              : '1px solid var(--border-subtle)',
                          }}
                          title={v.description}
                        >
                          <div className="flex w-full items-center justify-between gap-1">
                            <span
                              className="truncate text-xs font-semibold"
                              style={{
                                color: active
                                  ? 'var(--accent-primary)'
                                  : 'var(--text-primary)',
                              }}
                            >
                              {v.name.split(' · ')[0]}
                            </span>
                            <span
                              className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: 'var(--bg-page)',
                                color: 'var(--accent-primary)',
                              }}
                            >
                              {v.badge}
                            </span>
                          </div>
                          <span
                            className="mt-0.5 line-clamp-1 text-[10px]"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {v.roleLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      本地系统内置发音人（断网可用，零数据外传）
                    </span>
                    <span className="font-mono-tabular text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {localVoices.length} 款可用
                    </span>
                  </div>
                  <select
                    value={ttsVoiceURI}
                    onChange={(e) => {
                      const nextUri = e.target.value;
                      onUpdateSettings({ ttsVoiceURI: nextUri, ttsEngine: 'local' });
                      if (ttsStatus === 'playing') {
                        const idx = activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                        speakBlockAtIndex(idx, {
                          engine: 'local',
                          localVoiceURI: nextUri,
                        });
                      }
                    }}
                    className="h-9 w-full rounded-xl px-3 text-xs outline-none"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <option value="">自动匹配最佳中文离线发音人（默认）</option>
                    {localVoices.map((lv) => (
                      <option key={lv.voice.voiceURI} value={lv.voice.voiceURI}>
                        {lv.isOfflineLocal ? '[本地离线] ' : '[浏览器内置] '}
                        {lv.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Rate (Speed) & Pitch Controls */}
            <div
              className="space-y-3 rounded-xl p-3"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {/* Speech Rate Control */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                    朗读语速 (Rate)
                  </span>
                  <span
                    className="font-mono-tabular font-semibold"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    {ttsRate.toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1')}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={ttsRate}
                  onChange={(e) => {
                    const nextRate = Number(e.target.value);
                    onUpdateSettings({ ttsRate: nextRate });
                    if (ttsStatus === 'playing') {
                      const idx = activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                      speakBlockAtIndex(idx, { rate: nextRate });
                    }
                  }}
                  className="w-full cursor-pointer accent-[#B4532A]"
                />
              </div>

              {/* Speech Pitch Control */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                    声音语调 (Pitch)
                  </span>
                  <span
                    className="font-mono-tabular font-semibold"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    {ttsPitch.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.1}
                  value={ttsPitch}
                  onChange={(e) => {
                    const nextPitch = Number(e.target.value);
                    onUpdateSettings({ ttsPitch: nextPitch });
                    if (ttsStatus === 'playing') {
                      const idx = activeTtsBlockIdx ?? findInitialBlockIdxForCurrentView();
                      speakBlockAtIndex(idx, { pitch: nextPitch });
                    }
                  }}
                  className="w-full cursor-pointer accent-[#B4532A]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span>💡 听书开启时，直接点击任意正文段落即可跳读</span>
              <button
                type="button"
                onClick={() => setTtsSettingsOpen(false)}
                className="font-medium underline"
                style={{ color: 'var(--accent-primary)' }}
              >
                收起
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Reading Position Jump-Back Pill */}
      {jumpBackState && jumpBackState.pageIndex !== pageIndex && (
        <div className="fixed bottom-16 left-4 z-40 sm:left-6">
          <div
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs shadow-lg transition-all"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                const originIdx = jumpBackState.pageIndex;
                const originOffset = jumpBackState.offset;
                setJumpBackState(null);
                goToPageIndex(originIdx);
                if (ttsBarOpen) {
                  syncTtsToPage(originIdx);
                }
                if (!isPaginated && scrollContainerRef.current && book.totalChars > 0) {
                  const el = scrollContainerRef.current;
                  const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
                  el.scrollTo({
                    top: (originOffset / book.totalChars) * maxScroll,
                    behavior: 'smooth',
                  });
                }
              }}
              className="flex items-center gap-1.5 font-medium hover:underline"
              style={{ color: 'var(--accent-primary)' }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="font-mono-tabular">
                返回跳前位置（第 {jumpBackState.pageIndex + 1} 页）
              </span>
            </button>
            <button
              type="button"
              onClick={() => setJumpBackState(null)}
              className="ml-1 flex h-5 w-5 items-center justify-center rounded"
              style={{ color: 'var(--text-muted)' }}
              title="忽略"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Interactive Inline Highlight Inspect / Edit Popover */}
      {activeInspectAnnotation && (
        <div
          className="fixed inset-x-0 bottom-16 z-50 mx-auto w-full max-w-sm px-4"
          onClick={(e) => e.stopPropagation()}
        >
          <form
            onSubmit={handleSaveInspectAnnotationEdit}
            className="rounded-2xl p-3.5 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-strong)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(
                  [
                    { id: 'amber', hex: '#D97724' },
                    { id: 'caramel', hex: '#B4532A' },
                    { id: 'sage', hex: '#5C8060' },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setEditAnnColor(c.id);
                      if (onUpdateAnnotation) {
                        onUpdateAnnotation({
                          ...activeInspectAnnotation,
                          color: c.id,
                          noteText: editAnnNote.trim(),
                        });
                      }
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: c.hex,
                      outline:
                        editAnnColor === c.id ? '2px solid var(--text-primary)' : 'none',
                      outlineOffset: '2px',
                    }}
                    title="切换荧光颜色"
                  />
                ))}
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  已划线批注
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onDeleteAnnotation(activeInspectAnnotation.id);
                    setActiveInspectAnnotation(null);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md hover:text-red-600"
                  style={{ color: 'var(--text-muted)' }}
                  title="删除该划线批注"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveInspectAnnotation(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-md"
                  style={{ color: 'var(--text-muted)' }}
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p
              className="mt-2 line-clamp-2 rounded-lg p-2 text-xs italic"
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
              }}
            >
              「{activeInspectAnnotation.selectedText}」
            </p>

            <div className="mt-2 flex gap-1.5">
              <input
                type="text"
                value={editAnnNote}
                onChange={(e) => setEditAnnNote(e.target.value)}
                placeholder="添加或修改批注想法…"
                className="h-8 flex-1 rounded-xl px-2.5 text-xs outline-none"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setQuoteCardTarget({
                    chapterTitle: activeInspectAnnotation.chapterTitle,
                    selectedText: activeInspectAnnotation.selectedText,
                    noteText: editAnnNote.trim(),
                  });
                }}
                className="flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--accent-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
                title="一键生成书摘分享长图（金句卡）"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                <span>金句卡</span>
              </button>
              {onUpdateAnnotation && (
                <button
                  type="submit"
                  className="h-8 rounded-xl px-3 text-xs font-medium text-white"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                >
                  更新
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Compact Text Selection Highlight Popover */}
      {selectionState && (
        <div className="fixed inset-x-0 bottom-16 z-50 mx-auto w-full max-w-sm px-4">
          <form
            onSubmit={handleSaveHighlightNote}
            className="rounded-2xl p-3.5 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-strong)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(
                  [
                    { id: 'amber', hex: '#D97724' },
                    { id: 'caramel', hex: '#B4532A' },
                    { id: 'sage', hex: '#5C8060' },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedColor(c.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: c.hex,
                      outline:
                        selectedColor === c.id ? '2px solid var(--text-primary)' : 'none',
                      outlineOffset: '2px',
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSelectionState(null)}
                className="flex h-7 w-7 items-center justify-center rounded-md"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p
              className="mt-2 line-clamp-2 rounded-lg p-2 text-xs italic"
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
              }}
            >
              「{selectionState.text}」
            </p>

            <div className="mt-2 flex gap-1.5">
              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="批注…"
                className="h-8 flex-1 rounded-xl px-2.5 text-xs outline-none"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setQuoteCardTarget({
                    chapterTitle: selectionState.chapterTitle,
                    selectedText: selectionState.text,
                    noteText: noteInput.trim(),
                  });
                }}
                className="flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--accent-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
                title="一键生成书摘分享长图（金句卡）"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                <span>金句卡</span>
              </button>
              <button
                type="submit"
                className="h-8 rounded-xl px-3 text-xs font-medium text-white"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Drawer 1: TOC, Annotations & Full-Text Search */}
      {activeDrawer === 'toc' && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-xs"
          onClick={() => setActiveDrawer('none')}
        >
          <aside
            className="flex h-full w-full max-w-sm flex-col p-4 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-page)',
              borderLeft: '1px solid var(--border-subtle)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div
                className="flex items-center gap-1 rounded-xl p-1"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              >
                <button
                  onClick={() => setTocTab('chapters')}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                  style={{
                    backgroundColor: tocTab === 'chapters' ? 'var(--bg-page)' : 'transparent',
                    color: tocTab === 'chapters' ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <List className="h-3.5 w-3.5" />
                  <span>目录 ({outlineHeadings.length})</span>
                </button>
                <button
                  onClick={() => setTocTab('annotations')}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                  style={{
                    backgroundColor:
                      tocTab === 'annotations' ? 'var(--bg-page)' : 'transparent',
                    color:
                      tocTab === 'annotations' ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  <span>批注 ({annotations.length})</span>
                </button>
                <button
                  onClick={() => {
                    setTocTab('search');
                    setTimeout(() => searchInputRef.current?.focus(), 50);
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                  style={{
                    backgroundColor: tocTab === 'search' ? 'var(--bg-page)' : 'transparent',
                    color: tocTab === 'search' ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>检索</span>
                </button>
              </div>

              <button
                onClick={() => setActiveDrawer('none')}
                className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {tocTab === 'chapters' ? (
              <>
                <div className="relative mt-3">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <input
                    type="text"
                    value={chapterSearch}
                    onChange={(e) => setChapterSearch(e.target.value)}
                    placeholder="检索章节…"
                    className="h-9 w-full rounded-xl pr-3 pl-8 text-xs outline-none"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  />
                </div>
                <div
                  className="mt-2 flex-1 divide-y overflow-y-auto"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {filteredChapters.map((ch) => {
                    const isCurrent = ch.title === currentChapterTitle;
                    const level = ch.level || 1;
                    return (
                      <button
                        key={ch.id}
                        onClick={() => {
                          jumpToCharOffset(ch.startOffset);
                          setActiveDrawer('none');
                        }}
                        className="flex w-full items-center justify-between py-2.5 text-left text-xs transition-colors"
                        style={{
                          paddingLeft: `${(level - 1) * 12}px`,
                          color: isCurrent ? 'var(--accent-primary)' : 'var(--text-primary)',
                          fontWeight: isCurrent || level === 1 ? 600 : 400,
                        }}
                      >
                        <span className="truncate pr-2">
                          <span className="font-mono-tabular mr-1.5 text-[10px] opacity-60">
                            H{level}
                          </span>
                          {ch.title}
                        </span>
                        <span
                          className="font-mono-tabular shrink-0 text-[11px]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {ch.wordCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : tocTab === 'annotations' ? (
              <>
                <div className="mt-3 flex justify-end gap-1.5">
                  <button
                    onClick={() => {
                      setActiveDrawer('none');
                      setExportModalOpen(true);
                    }}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--accent-primary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                    title="打开多格式导出中心"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>多格式导出</span>
                  </button>
                </div>

                <div className="mt-2 flex-1 space-y-2.5 overflow-y-auto">
                  {annotations.length === 0 ? (
                    <div
                      className="py-12 text-center text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      暂无记录
                    </div>
                  ) : (
                    annotations.map((ann) => (
                      <div
                        key={ann.id}
                        onClick={() => {
                          jumpToCharOffset(ann.charOffset);
                          setActiveDrawer('none');
                        }}
                        className="cursor-pointer rounded-xl p-3 transition-colors"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div
                          className="flex items-center justify-between text-[11px]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <span className="truncate">{ann.chapterTitle}</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setQuoteCardTarget({
                                  chapterTitle: ann.chapterTitle,
                                  selectedText: ann.selectedText,
                                  noteText: ann.noteText,
                                });
                              }}
                              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                              style={{
                                backgroundColor: 'var(--bg-page)',
                                color: 'var(--accent-primary)',
                              }}
                              title="生成书摘分享长图（金句卡）"
                            >
                              <ImageIcon className="h-3 w-3" />
                              <span>金句卡</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteAnnotation(ann.id);
                              }}
                              className="hover:text-red-600"
                              title="删除批注"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs italic">
                          「{ann.selectedText}」
                        </p>
                        {ann.noteText && (
                          <p
                            className="mt-1 text-xs font-medium"
                            style={{ color: 'var(--accent-primary)' }}
                          >
                            {ann.noteText}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              /* Full-Text Search Tab */
              <>
                <div className="relative mt-3">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={fullTextSearchQuery}
                    onChange={(e) => setFullTextSearchQuery(e.target.value)}
                    placeholder="输入关键词检索全书正文…"
                    className="h-9 w-full rounded-xl pr-8 pl-8 text-xs outline-none"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  {fullTextSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setFullTextSearchQuery('')}
                      className="absolute top-1/2 right-2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded"
                      style={{ color: 'var(--text-muted)' }}
                      title="清空检索词"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {fullTextSearchQuery.trim() && (
                  <div
                    className="mt-2 flex items-center justify-between text-[11px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span>匹配结果（正文已高亮显示）</span>
                    <span className="font-mono-tabular">
                      {fullTextSearchResults.length}
                      {fullTextSearchResults.length >= 60 ? '+' : ''} 处
                    </span>
                  </div>
                )}

                <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
                  {!fullTextSearchQuery.trim() ? (
                    <div
                      className="py-12 text-center text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      输入任意词句即可定位章节与页码（快捷键 Ctrl/Cmd + F）
                    </div>
                  ) : fullTextSearchResults.length === 0 ? (
                    <div
                      className="py-12 text-center text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      未找到包含「{fullTextSearchQuery}」的段落
                    </div>
                  ) : (
                    fullTextSearchResults.map((res, i) => (
                      <button
                        key={`${res.offset}-${i}`}
                        type="button"
                        onClick={() => {
                          jumpToCharOffset(res.offset);
                          if (viewportDim.viewportWidth < 768) {
                            setActiveDrawer('none');
                          }
                        }}
                        className="w-full rounded-xl p-3 text-left transition-colors hover:opacity-90"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div
                          className="flex items-center justify-between text-[11px]"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <span className="truncate pr-2 font-medium">{res.chapterTitle}</span>
                          <span
                            className="font-mono-tabular shrink-0"
                            style={{ color: 'var(--accent-primary)' }}
                          >
                            第 {res.pageNumber} 页
                          </span>
                        </div>
                        <p
                          className="mt-1 line-clamp-2 text-xs leading-relaxed"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {res.snippet}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {/* Non-Dimming Floating Appearance, Style & Typography Popover */}
      {activeDrawer === 'settings' && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setActiveDrawer('none')}
        >
          <aside
            className="fixed top-14 right-3 z-50 flex max-h-[calc(100vh-4.5rem)] w-[356px] max-w-[calc(100vw-1.5rem)] flex-col space-y-4 overflow-y-auto rounded-2xl p-4 shadow-2xl sm:right-6"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b pb-2.5"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="font-display text-xs font-semibold">
                  阅读风格与版心精调（实时预览）
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onUpdateSettings(DEFAULT_READER_SETTINGS)}
                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="恢复默认字号与排版设置"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>重置</span>
                </button>
                <button
                  onClick={() => setActiveDrawer('none')}
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ color: 'var(--text-muted)' }}
                  title="关闭面板 (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 1. Paper Style & Warmth Swatches */}
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                  阅读风格（纸张与光感）
                </span>
                <span className="text-[11px]" style={{ color: 'var(--accent-primary)' }}>
                  {READER_THEME_OPTIONS.find((t) => t.id === settings.theme)?.fullTitle}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {READER_THEME_OPTIONS.map((t) => {
                  const Icon = t.icon;
                  const active = settings.theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onUpdateSettings({ theme: t.id })}
                      className="flex items-center justify-between rounded-xl px-2.5 py-2 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: t.bgHex,
                        color: t.textHex,
                        border: active
                          ? `2px solid ${t.accentHex}`
                          : '1px solid rgba(128, 128, 128, 0.28)',
                        boxShadow: active ? '0 4px 12px rgba(0, 0, 0, 0.12)' : 'none',
                      }}
                      title={t.fullTitle}
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span>{t.label}</span>
                      </span>
                      <span
                        className="font-serif-editorial text-[11px] font-bold"
                        style={{ color: t.accentHex }}
                      >
                        {active ? '✓' : 'Aa'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {settings.theme === 'eink' && (
              <label
                className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              >
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  <span>墨水全刷效果</span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.einkFlashRefresh}
                  onChange={(e) => onUpdateSettings({ einkFlashRefresh: e.target.checked })}
                  className="h-4 w-4 accent-[#111111]"
                />
              </label>
            )}

            {/* 2. Font Size Stepper, Slider & Quick Presets */}
            <div
              className="space-y-2.5 rounded-xl p-3"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  <Type className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                  <span>字号大小</span>
                </span>
                <span
                  className="font-mono-tabular text-xs font-semibold"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {settings.fontSize} px
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ fontSize: Math.max(14, settings.fontSize - 1) })
                  }
                  disabled={settings.fontSize <= 14}
                  className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-colors disabled:opacity-35"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="减小字号 (-)"
                >
                  A-
                </button>
                <input
                  type="range"
                  min={14}
                  max={30}
                  step={1}
                  value={settings.fontSize}
                  onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                  className="flex-1 cursor-pointer accent-[#B4532A]"
                  title="拖动调节字号"
                />
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({ fontSize: Math.min(30, settings.fontSize + 1) })
                  }
                  disabled={settings.fontSize >= 30}
                  className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-colors disabled:opacity-35"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="增大字号 (+)"
                >
                  A+
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {FONT_SIZE_PRESETS.map((preset) => {
                  const active = settings.fontSize === preset.size;
                  return (
                    <button
                      key={preset.size}
                      type="button"
                      onClick={() => onUpdateSettings({ fontSize: preset.size })}
                      className="rounded-lg py-1 text-[11px] font-medium transition-colors"
                      style={{
                        backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-page)',
                        color: active ? '#FFFFFF' : 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {preset.label} {preset.size}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Font Family & Local Installed Font Selection */}
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                  正文字体
                </span>
                <button
                  onClick={() => fontInputRef.current?.click()}
                  className="rounded-lg px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--accent-primary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="导入字体文件 (.ttf/.otf/.woff2)"
                >
                  + 导入字体文件
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'serif-editorial', label: '宋体衬线' },
                  { id: 'sans-warm', label: '黑体无衬' },
                  { id: 'kaiti-classic', label: '书房楷体' },
                ].map((f) => {
                  const active = settings.fontFamily === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => {
                        setLocalFontPickerOpen(false);
                        onUpdateSettings({ fontFamily: f.id });
                      }}
                      className="min-h-[34px] truncate rounded-xl px-2.5 py-1 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-surface)',
                        color: active ? '#FFFFFF' : 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}

                {/* 4th Slot: Local Installed System Font Selector */}
                {(() => {
                  const isLocalActive = settings.fontFamily.startsWith('local:');
                  const shortName = getShortLocalFontLabel(
                    settings.fontFamily,
                    installedLocalFonts
                  );
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        const nextOpen = !localFontPickerOpen;
                        setLocalFontPickerOpen(nextOpen);
                        queryBrowserLocalFonts().then((list) => {
                          setInstalledLocalFonts(list);
                        });
                        if (!isLocalActive && installedLocalFonts.length > 0) {
                          onUpdateSettings({
                            fontFamily: `local:${installedLocalFonts[0].family}`,
                          });
                        }
                      }}
                      className="flex min-h-[34px] items-center justify-center gap-1 truncate rounded-xl px-2.5 py-1 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: isLocalActive
                          ? 'var(--accent-primary)'
                          : 'var(--bg-surface)',
                        color: isLocalActive ? '#FFFFFF' : 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                      title="选择本机已安装的系统字体"
                    >
                      <span className="truncate">
                        {isLocalActive ? `本地 · ${shortName}` : '本地已装字体'}
                      </span>
                      <ChevronDown className="h-3 w-3 shrink-0 opacity-80" />
                    </button>
                  );
                })()}

                {customFonts.map((cf) => {
                  const active = settings.fontFamily === cf.id;
                  return (
                    <button
                      key={cf.id}
                      onClick={() => {
                        setLocalFontPickerOpen(false);
                        onUpdateSettings({ fontFamily: cf.id });
                      }}
                      className="min-h-[34px] truncate rounded-xl px-2.5 py-1 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-surface)',
                        color: active ? '#FFFFFF' : 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {cf.name}
                    </button>
                  );
                })}
              </div>

              {/* Expandable Local Installed Font Picker Panel */}
              {(localFontPickerOpen || settings.fontFamily.startsWith('local:')) && (
                <div
                  className="mt-2 rounded-xl p-2.5 space-y-2"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      选择本地已安装字体 ({installedLocalFonts.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        queryBrowserLocalFonts().then((list) => setInstalledLocalFonts(list));
                      }}
                      className="underline transition-opacity hover:opacity-80"
                      style={{ color: 'var(--accent-primary)' }}
                      title="扫描并读取本机安装的全部系统字体"
                    >
                      刷新本机字库
                    </button>
                  </div>

                  <select
                    value={
                      settings.fontFamily.startsWith('local:')
                        ? settings.fontFamily.slice('local:'.length)
                        : installedLocalFonts[0]?.family || ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        onUpdateSettings({ fontFamily: `local:${val}` });
                      }
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
                    style={{
                      backgroundColor: 'var(--bg-page)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {installedLocalFonts.map((lf) => (
                      <option key={lf.family} value={lf.family}>
                        {lf.label}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={customLocalFontInput}
                      onChange={(e) => setCustomLocalFontInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customLocalFontInput.trim()) {
                          e.preventDefault();
                          const fam = customLocalFontInput.trim();
                          onUpdateSettings({ fontFamily: `local:${fam}` });
                          setCustomLocalFontInput('');
                        }
                      }}
                      placeholder="或输入本地字体名 (如: 微软雅黑 / 霞鹜文楷)"
                      className="min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px] outline-none"
                      style={{
                        backgroundColor: 'var(--bg-page)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const fam = customLocalFontInput.trim();
                        if (!fam) return;
                        onUpdateSettings({ fontFamily: `local:${fam}` });
                        setCustomLocalFontInput('');
                      }}
                      className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium text-white"
                      style={{ backgroundColor: 'var(--accent-primary)' }}
                    >
                      应用
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Layout Mode, Measure Width & Detailed Spacing */}
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'paginated-double', label: '双页', icon: Columns2 },
                    { id: 'paginated-single', label: '单页', icon: FileText },
                    { id: 'scroll', label: '滚屏', icon: ScrollText },
                  ] as { id: LayoutMode; label: string; icon: React.FC<{ className?: string }> }[]
                ).map((m) => {
                  const Icon = m.icon;
                  const active = settings.layoutMode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => onUpdateSettings({ layoutMode: m.id })}
                      className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-medium transition-all"
                      style={{
                        backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-surface)',
                        color: active ? '#FFFFFF' : 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                      title={m.label}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Single-Page / Scroll Measure Width Selector */}
              {isSinglePage && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                      单页版心宽度
                    </span>
                    <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {(settings.maxColumnWidth || 'standard') === 'narrow'
                        ? '680px'
                        : (settings.maxColumnWidth || 'standard') === 'standard'
                        ? '860px'
                        : (settings.maxColumnWidth || 'standard') === 'wide'
                        ? '1080px'
                        : '100%'}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'narrow', label: '窄版' },
                        { id: 'standard', label: '标准' },
                        { id: 'wide', label: '宽版' },
                        { id: 'full', label: '全宽' },
                      ] as { id: MaxColumnWidth; label: string }[]
                    ).map((mw) => {
                      const active = (settings.maxColumnWidth || 'standard') === mw.id;
                      return (
                        <button
                          key={mw.id}
                          type="button"
                          onClick={() => onUpdateSettings({ maxColumnWidth: mw.id })}
                          className="rounded-lg py-1.5 text-xs font-medium transition-colors"
                          style={{
                            backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-surface)',
                            color: active ? '#FFFFFF' : 'var(--text-primary)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          {mw.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sliders: Line Height, Paragraph Spacing, Letter Spacing, Page Margin */}
              <div
                className="space-y-2.5 rounded-xl p-3 text-xs"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-12 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    行距
                  </span>
                  <input
                    type="range"
                    min={1.4}
                    max={2.2}
                    step={0.05}
                    value={settings.lineHeight}
                    onChange={(e) => onUpdateSettings({ lineHeight: Number(e.target.value) })}
                    className="flex-1 cursor-pointer accent-[#B4532A]"
                  />
                  <span className="font-mono-tabular w-9 text-right">
                    {settings.lineHeight.toFixed(2)}
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="w-12 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    段距
                  </span>
                  <input
                    type="range"
                    min={8}
                    max={32}
                    step={2}
                    value={settings.paragraphSpacing}
                    onChange={(e) =>
                      onUpdateSettings({ paragraphSpacing: Number(e.target.value) })
                    }
                    className="flex-1 cursor-pointer accent-[#B4532A]"
                  />
                  <span className="font-mono-tabular w-9 text-right">
                    {settings.paragraphSpacing}px
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="w-12 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    字距
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={0.12}
                    step={0.01}
                    value={settings.letterSpacing}
                    onChange={(e) => onUpdateSettings({ letterSpacing: Number(e.target.value) })}
                    className="flex-1 cursor-pointer accent-[#B4532A]"
                  />
                  <span className="font-mono-tabular w-9 text-right">
                    {Math.round(settings.letterSpacing * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="w-12 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    页边距
                  </span>
                  <input
                    type="range"
                    min={16}
                    max={96}
                    step={4}
                    value={settings.pageMargin}
                    onChange={(e) => onUpdateSettings({ pageMargin: Number(e.target.value) })}
                    className="flex-1 cursor-pointer accent-[#B4532A]"
                  />
                  <span className="font-mono-tabular w-9 text-right">{settings.pageMargin}px</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label
                  className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <span className="flex items-center gap-1.5">
                    <Indent className="h-3.5 w-3.5" />
                    <span>首行缩进</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.indentFirstLine}
                    onChange={(e) => onUpdateSettings({ indentFirstLine: e.target.checked })}
                    className="h-4 w-4 accent-[#B4532A]"
                  />
                </label>

                <div
                  className="flex items-center justify-between rounded-xl px-3 py-2 text-xs"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <span className="flex items-center gap-1 font-mono-tabular">
                    <Gauge className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                    <span>
                      {isPaginated
                        ? `${settings.autoFlipPageInterval}s`
                        : `${settings.autoScrollSpeed}`}
                    </span>
                  </span>
                  <button
                    onClick={() => onUpdateSettings({ autoFlipEnabled: !settings.autoFlipEnabled })}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-white"
                    style={{
                      backgroundColor: settings.autoFlipEnabled
                        ? 'var(--accent-primary)'
                        : 'var(--text-muted)',
                    }}
                    title="开启/暂停自动翻页"
                  >
                    {settings.autoFlipEnabled ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Multi-Format & jsPDF Export Studio Modal */}
      <ExportStudioModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        book={book}
        annotations={annotations}
        dailyStats={dailyStats}
        initialFormat={exportInitialFormat}
        initialConfig={quickPdfConfig}
      />

      {/* Quote Share Card Studio Modal */}
      <QuoteCardModal
        isOpen={Boolean(quoteCardTarget)}
        onClose={() => setQuoteCardTarget(null)}
        initialConfig={{
          bookTitle: book.title,
          author: book.author,
          chapterTitle: quoteCardTarget?.chapterTitle || currentChapterTitle,
          selectedText: quoteCardTarget?.selectedText || '',
          noteText: quoteCardTarget?.noteText || '',
        }}
      />
    </div>
  );
};
