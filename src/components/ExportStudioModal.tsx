import React, { useEffect, useMemo, useState } from 'react';
import {
  AlignLeft,
  BarChart3,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Globe,
  Hash,
  ListFilter,
  ListTree,
  Loader2,
  MessageSquareQuote,
  Palette,
  Printer,
  Quote,
  RotateCcw,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Annotation, Book, ReadingStatsDaily } from '../types/reader';
import {
  buildCsvExport,
  buildMarkdownExport,
  buildStructuredJsonExport,
  buildStyledHtmlDocument,
  DEFAULT_EXPORT_CONFIG,
  exportBookWithJsPdf,
  ExportConfig,
  ExportFormat,
  ExportThemeStyle,
  getBookReadingMetrics,
  getFilteredChaptersForBook,
  printDocumentViaHiddenIframe,
  renderJsPdfPages,
  warmUpCjkPdfFont,
} from '../core/exportEngine';
import {
  buildTxtExport,
  extractChapters,
  triggerFileDownload,
  warmUpMermaidDiagramsForContent,
} from '../core/parserEngine';

interface ExportStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  allBooks?: Book[];
  annotations: Annotation[];
  dailyStats: ReadingStatsDaily[];
  initialFormat?: ExportFormat;
  initialConfig?: Partial<ExportConfig>;
}

const FORMAT_OPTIONS: {
  id: ExportFormat;
  shortLabel: string;
  ext: string;
  tooltip: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  {
    id: 'pdf',
    shortLabel: 'PDF',
    ext: '.pdf',
    tooltip: '矢量排版 PDF（A4 页眉页脚、含 Mermaid 图表与表格）',
    icon: FileText,
  },
  {
    id: 'md',
    shortLabel: 'MD',
    ext: '.md',
    tooltip: 'Markdown 读书手账（含 YAML 元数据、大纲与批注）',
    icon: Hash,
  },
  {
    id: 'html',
    shortLabel: 'HTML',
    ext: '.html',
    tooltip: '独立单文件暖调网页手账（内嵌 SVG 图表）',
    icon: Globe,
  },
  {
    id: 'txt',
    shortLabel: 'TXT',
    ext: '.txt',
    tooltip: '纯文本书摘与全文归档',
    icon: AlignLeft,
  },
  {
    id: 'csv',
    shortLabel: 'CSV',
    ext: '.csv',
    tooltip: 'Excel / Notion 兼容结构化书摘统计表',
    icon: FileSpreadsheet,
  },
  {
    id: 'json',
    shortLabel: 'JSON',
    ext: '.json',
    tooltip: '结构化 JSON 数据包（大纲、书摘与统计）',
    icon: Braces,
  },
];

const THEME_SWATCHES: {
  id: ExportThemeStyle;
  label: string;
  hex: string;
  ringHex: string;
}[] = [
  { id: 'parchment', label: '羊皮纸', hex: '#FBF7F0', ringHex: '#B4532A' },
  { id: 'caramel', label: '焦糖拿铁', hex: '#F2E3CE', ringHex: '#9A3F1C' },
  { id: 'espresso', label: '浓缩夜读', hex: '#211A15', ringHex: '#D97724' },
  { id: 'eink', label: '电子墨水', hex: '#F4F4F4', ringHex: '#222222' },
];

const FONT_PILLS: {
  id: 'serif' | 'kaiti' | 'sans';
  short: string;
  tooltip: string;
}[] = [
  { id: 'serif', short: '宋', tooltip: '人文宋体（衬线典藏）' },
  { id: 'kaiti', short: '楷', tooltip: '书房楷体（温润手书）' },
  { id: 'sans', short: '黑', tooltip: '现代黑体（清晰无衬线）' },
];

export const ExportStudioModal: React.FC<ExportStudioModalProps> = ({
  isOpen,
  onClose,
  book,
  allBooks,
  annotations,
  dailyStats,
  initialFormat = 'pdf',
  initialConfig,
}) => {
  const [selectedBookId, setSelectedBookId] = useState<string>(book.id);
  const [config, setConfig] = useState<ExportConfig>({
    ...DEFAULT_EXPORT_CONFIG,
    format: initialFormat,
    ...initialConfig,
  });
  const [showChapterPicker, setShowChapterPicker] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const [pdfPreviewPageIdx, setPdfPreviewPageIdx] = useState<number>(0);
  const [pdfZoomFit, setPdfZoomFit] = useState<boolean>(true);
  const [mermaidReadyTick, setMermaidReadyTick] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      warmUpCjkPdfFont(initialConfig?.fontStyle || config.fontStyle || 'serif');
      setSelectedBookId(book.id);
      setConfig((prev) => ({
        ...prev,
        format: initialFormat,
        ...(initialConfig || {}),
      }));
      setPdfPreviewPageIdx(0);
    }
  }, [isOpen, book.id, initialFormat, initialConfig]);

  useEffect(() => {
    if (isOpen && config.format === 'pdf') {
      warmUpCjkPdfFont(config.fontStyle || 'serif');
    }
  }, [isOpen, config.format, config.fontStyle]);

  const activeBook = useMemo(() => {
    if (allBooks && allBooks.length > 0) {
      return allBooks.find((b) => b.id === selectedBookId) || book;
    }
    return book;
  }, [allBooks, selectedBookId, book]);

  // Pre-warm Mermaid diagrams in the active book when modal opens or theme changes
  useEffect(() => {
    if (!isOpen || !activeBook?.content) return;
    let cancelled = false;
    warmUpMermaidDiagramsForContent(activeBook.content, config.themeStyle)
      .then(() => {
        if (!cancelled) {
          setMermaidReadyTick((t) => t + 1);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeBook.id, activeBook.content, config.themeStyle]);

  const bookAnnotations = useMemo(
    () => annotations.filter((a) => a.bookId === activeBook.id),
    [annotations, activeBook.id]
  );

  const notesCount = useMemo(
    () => bookAnnotations.filter((a) => Boolean(a.noteText && a.noteText.trim())).length,
    [bookAnnotations]
  );

  const bookChapters = useMemo(() => {
    return activeBook.chapters && activeBook.chapters.length > 0
      ? activeBook.chapters
      : extractChapters(activeBook.content, activeBook.format);
  }, [activeBook]);

  const metrics = useMemo(
    () => getBookReadingMetrics(activeBook, dailyStats),
    [activeBook, dailyStats]
  );

  const filteredChapters = useMemo(
    () => getFilteredChaptersForBook(activeBook, config.selectedChapterIds),
    [activeBook, config.selectedChapterIds]
  );

  const jsPdfPreview = useMemo(() => {
    if (!isOpen || config.format !== 'pdf') {
      return null;
    }
    return renderJsPdfPages(activeBook, bookAnnotations, dailyStats, config, Infinity);
  }, [isOpen, config, activeBook, bookAnnotations, dailyStats, mermaidReadyTick]);

  useEffect(() => {
    if (jsPdfPreview && pdfPreviewPageIdx >= jsPdfPreview.totalPages) {
      setPdfPreviewPageIdx(Math.max(0, jsPdfPreview.totalPages - 1));
    }
  }, [jsPdfPreview, pdfPreviewPageIdx]);

  // Keyboard navigation inside modal (Esc to close, Left/Right for PDF preview pages)
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (config.format === 'pdf' && jsPdfPreview) {
        if (e.key === 'ArrowLeft') {
          setPdfPreviewPageIdx((p) => Math.max(0, p - 1));
        } else if (e.key === 'ArrowRight') {
          setPdfPreviewPageIdx((p) => Math.min(jsPdfPreview.totalPages - 1, p + 1));
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, config.format, jsPdfPreview]);

  const previewText = useMemo(() => {
    if (!isOpen || config.format === 'pdf') return '';
    const syncedConfig: ExportConfig = {
      ...config,
      includeAnnotations: Boolean(config.includeNotes || config.includeExcerpts),
    };
    if (config.format === 'md') {
      return buildMarkdownExport(activeBook, bookAnnotations, dailyStats, syncedConfig);
    }
    if (config.format === 'csv') {
      return buildCsvExport([activeBook], bookAnnotations, dailyStats).replace(/^\uFEFF/, '');
    }
    if (config.format === 'json') {
      return buildStructuredJsonExport([activeBook], bookAnnotations, dailyStats, syncedConfig);
    }
    if (config.format === 'txt') {
      return buildTxtExport(activeBook, bookAnnotations, {
        includeFullText: config.includeFullText,
        includeNotes: syncedConfig.includeNotes,
        includeExcerpts: syncedConfig.includeExcerpts,
        includeOutline: syncedConfig.includeOutline,
        includeStats: syncedConfig.includeStats,
        selectedChapterIds: syncedConfig.selectedChapterIds,
        dailyStats,
      });
    }
    return buildStyledHtmlDocument(activeBook, bookAnnotations, dailyStats, syncedConfig);
  }, [isOpen, config, activeBook, bookAnnotations, dailyStats, mermaidReadyTick]);

  if (!isOpen) return null;

  const triggerNotice = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 2600);
  };

  const toggleChapterSelection = (chId: string) => {
    setConfig((prev) => {
      const current =
        prev.selectedChapterIds.length === 0
          ? bookChapters.map((c) => c.id)
          : prev.selectedChapterIds;
      const exists = current.includes(chId);
      const next = exists ? current.filter((id) => id !== chId) : [...current, chId];
      return {
        ...prev,
        selectedChapterIds: next.length === bookChapters.length ? [] : next,
      };
    });
    setPdfPreviewPageIdx(0);
  };

  const handlePrimaryExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const safeTitle = activeBook.title.replace(/[\\/:*?"<>|]/g, '');
      const syncedConfig: ExportConfig = {
        ...config,
        includeAnnotations: Boolean(config.includeNotes || config.includeExcerpts),
      };

      if (config.format === 'pdf') {
        triggerNotice('正在生成矢量 PDF...');
        const result = await exportBookWithJsPdf(
          activeBook,
          bookAnnotations,
          dailyStats,
          syncedConfig
        );
        triggerNotice(`已导出 ${result.totalPages} 页 PDF`);
        return;
      }

      if (config.format === 'md') {
        const md = buildMarkdownExport(activeBook, bookAnnotations, dailyStats, syncedConfig);
        triggerFileDownload(`${safeTitle}-手账.md`, md, 'text/markdown');
        triggerNotice('已导出 .md');
        return;
      }

      if (config.format === 'csv') {
        const csv = buildCsvExport([activeBook], bookAnnotations, dailyStats);
        triggerFileDownload(`${safeTitle}-报表.csv`, csv, 'text/csv');
        triggerNotice('已导出 .csv');
        return;
      }

      if (config.format === 'json') {
        const json = buildStructuredJsonExport(
          [activeBook],
          bookAnnotations,
          dailyStats,
          syncedConfig
        );
        triggerFileDownload(`${safeTitle}-归档.json`, json, 'application/json');
        triggerNotice('已导出 .json');
        return;
      }

      if (config.format === 'html') {
        await warmUpMermaidDiagramsForContent(activeBook.content, syncedConfig.themeStyle);
        const html = buildStyledHtmlDocument(
          activeBook,
          bookAnnotations,
          dailyStats,
          syncedConfig
        );
        triggerFileDownload(`${safeTitle}-手账.html`, html, 'text/html');
        triggerNotice('已导出 .html');
        return;
      }

      if (config.format === 'txt') {
        const txt = buildTxtExport(activeBook, bookAnnotations, {
          includeFullText: config.includeFullText,
          includeNotes: syncedConfig.includeNotes,
          includeExcerpts: syncedConfig.includeExcerpts,
          includeOutline: syncedConfig.includeOutline,
          selectedChapterIds: syncedConfig.selectedChapterIds,
        });
        triggerFileDownload(`${safeTitle}-笔记.txt`, txt, 'text/plain');
        triggerNotice('已导出 .txt');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleNativePrintPdf = async () => {
    const syncedConfig: ExportConfig = {
      ...config,
      includeAnnotations: Boolean(config.includeNotes || config.includeExcerpts),
    };
    triggerNotice('正在唤起矢量打印...');
    await warmUpMermaidDiagramsForContent(activeBook.content, syncedConfig.themeStyle);
    if (config.format === 'pdf') {
      const fullResult = renderJsPdfPages(
        activeBook,
        bookAnnotations,
        dailyStats,
        syncedConfig,
        Infinity
      );
      printDocumentViaHiddenIframe(fullResult.vectorPrintHtml);
      return;
    }
    const html = buildStyledHtmlDocument(activeBook, bookAnnotations, dailyStats, syncedConfig);
    printDocumentViaHiddenIframe(html);
  };

  const handleCopyContent = async () => {
    try {
      const textToCopy =
        config.format === 'pdf'
          ? buildMarkdownExport(activeBook, bookAnnotations, dailyStats, {
              ...config,
              includeAnnotations: Boolean(config.includeNotes || config.includeExcerpts),
            })
          : previewText;
      await navigator.clipboard.writeText(textToCopy);
      setCopiedFlag(true);
      triggerNotice('已复制至剪贴板');
      setTimeout(() => setCopiedFlag(false), 1800);
    } catch {
      triggerNotice('复制失败');
    }
  };

  const estimatedSizeKb =
    config.format === 'pdf' && jsPdfPreview
      ? Math.max(48, jsPdfPreview.totalPages * 115)
      : Math.max(1, Math.round(new Blob([previewText]).size / 1024));

  const currentFormatMeta =
    FORMAT_OPTIONS.find((f) => f.id === config.format) || FORMAT_OPTIONS[0];

  const contentModules = [
    {
      key: 'includeFullText' as const,
      label: '正文',
      badge: `${(activeBook.totalChars / 1000).toFixed(0)}k`,
      tooltip: `包含书籍正文 (${activeBook.totalChars.toLocaleString()} 字)`,
      icon: FileText,
      active: Boolean(config.includeFullText),
    },
    {
      key: 'includeNotes' as const,
      label: '笔记',
      badge: `${notesCount}`,
      tooltip: `包含批注笔记 (${notesCount} 条感悟)`,
      icon: MessageSquareQuote,
      active: Boolean(config.includeNotes ?? config.includeAnnotations),
    },
    {
      key: 'includeExcerpts' as const,
      label: '书摘',
      badge: `${bookAnnotations.length}`,
      tooltip: `包含高亮书摘 (${bookAnnotations.length} 处划线)`,
      icon: Quote,
      active: Boolean(config.includeExcerpts ?? config.includeAnnotations),
    },
    {
      key: 'includeOutline' as const,
      label: '大纲',
      badge: `${bookChapters.length}`,
      tooltip: `包含章节目录 (${bookChapters.length} 节)`,
      icon: ListTree,
      active: Boolean(config.includeOutline),
    },
    {
      key: 'includeStats' as const,
      label: '统计',
      badge: `${metrics.progressPct}%`,
      tooltip: `包含阅读进度与用时统计 (${metrics.progressPct}%)`,
      icon: BarChart3,
      active: Boolean(config.includeStats),
    },
  ];

  const isAllModulesChecked = contentModules.every((m) => m.active);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-2.5 backdrop-blur-xs sm:p-5"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl shadow-2xl lg:h-[82vh] lg:flex-row"
        style={{
          backgroundColor: 'var(--bg-page)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Compact Icon-Driven Inspector Sidebar */}
        <div
          className="flex max-h-[48vh] w-full flex-col justify-between border-b p-4 lg:max-h-none lg:w-80 lg:shrink-0 lg:border-r lg:border-b-0"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
            {/* Compact Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor: 'var(--accent-soft)',
                    color: 'var(--accent-primary)',
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                </div>
                <h2 className="font-display text-sm font-semibold tracking-tight">导出工作台</h2>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfig({
                      ...DEFAULT_EXPORT_CONFIG,
                      format: config.format,
                    });
                    setPdfPreviewPageIdx(0);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:opacity-80"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="重置导出选项"
                  aria-label="重置导出选项"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-lg lg:hidden"
                  style={{ color: 'var(--text-muted)' }}
                  title="关闭 (Esc)"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Book Selector (only when invoked from studio with multiple books) */}
            {allBooks && allBooks.length > 1 && (
              <select
                value={activeBook.id}
                onChange={(e) => {
                  setSelectedBookId(e.target.value);
                  setConfig((prev) => ({ ...prev, selectedChapterIds: [] }));
                  setPdfPreviewPageIdx(0);
                }}
                className="h-9 w-full rounded-xl px-3 text-xs font-medium outline-none"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="切换导出书籍"
              >
                {allBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    《{b.title}》 ({(b.totalChars / 1000).toFixed(1)}k字)
                  </option>
                ))}
              </select>
            )}

            {/* 1. 6-Format Compact Icon Dock */}
            <div>
              <div
                className="mb-1.5 flex items-center justify-between text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                <span>格式</span>
                <span className="truncate max-w-[190px]" style={{ color: 'var(--text-secondary)' }}>
                  {currentFormatMeta.tooltip.split('（')[0]}
                </span>
              </div>
              <div
                className="grid grid-cols-6 gap-1 rounded-xl p-1"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                }}
                role="tablist"
                aria-label="选择导出格式"
              >
                {FORMAT_OPTIONS.map((fmt) => {
                  const Icon = fmt.icon;
                  const active = config.format === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setConfig((prev) => ({ ...prev, format: fmt.id }))}
                      className="flex flex-col items-center justify-center gap-1 rounded-lg py-2 transition-all"
                      style={{
                        backgroundColor: active ? 'var(--accent-primary)' : 'transparent',
                        color: active ? '#FFFFFF' : 'var(--text-secondary)',
                      }}
                      title={fmt.tooltip}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-mono-tabular text-[10px] font-semibold leading-none">
                        {fmt.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. 5-Dimension Icon Toggle Dock (正文 / 笔记 / 书摘 / 大纲 / 统计) */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span style={{ color: 'var(--text-muted)' }}>导出模块</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !isAllModulesChecked;
                    setConfig((prev) => ({
                      ...prev,
                      includeFullText: nextVal,
                      includeNotes: true,
                      includeExcerpts: true,
                      includeAnnotations: true,
                      includeOutline: nextVal,
                      includeStats: nextVal,
                    }));
                    setPdfPreviewPageIdx(0);
                  }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors"
                  style={{
                    color: 'var(--accent-primary)',
                    backgroundColor: 'var(--bg-page)',
                  }}
                  title={isAllModulesChecked ? '仅导出笔记与书摘' : '全选所有导出模块'}
                >
                  <CheckCheck className="h-3 w-3" />
                  <span>{isAllModulesChecked ? '仅书摘' : '全选'}</span>
                </button>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {contentModules.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setConfig((prev) => {
                          const next = { ...prev, [item.key]: !item.active };
                          next.includeAnnotations = Boolean(
                            next.includeNotes || next.includeExcerpts
                          );
                          return next;
                        });
                        setPdfPreviewPageIdx(0);
                      }}
                      className="relative flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 px-1 transition-all"
                      style={{
                        backgroundColor: item.active ? 'var(--accent-soft)' : 'var(--bg-page)',
                        color: item.active ? 'var(--accent-primary)' : 'var(--text-muted)',
                        border: item.active
                          ? '1px solid var(--accent-primary)'
                          : '1px solid var(--border-subtle)',
                      }}
                      title={item.tooltip}
                      aria-pressed={item.active}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="text-[11px] font-semibold leading-none">{item.label}</span>
                      <span className="font-mono-tabular text-[9px] opacity-75 leading-none">
                        {item.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Unified Swatch & Typography Row (For Styled Formats: PDF / HTML) */}
            {(config.format === 'pdf' || config.format === 'html') && (
              <div
                className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {/* Paper Swatches */}
                <div className="flex items-center gap-2" title="纸张配色">
                  <Palette
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <div className="flex items-center gap-1.5" role="radiogroup" aria-label="纸张配色">
                    {THEME_SWATCHES.map((t) => {
                      const active = config.themeStyle === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setConfig((prev) => ({ ...prev, themeStyle: t.id }))}
                          className="relative flex h-6 w-6 items-center justify-center rounded-full transition-transform active:scale-90"
                          style={{
                            backgroundColor: t.hex,
                            border: active
                              ? `2px solid ${t.ringHex}`
                              : '1px solid rgba(128,128,128,0.35)',
                            boxShadow: active ? `0 0 0 2px var(--bg-page)` : 'none',
                          }}
                          title={`纸张配色：${t.label}`}
                          aria-label={t.label}
                        >
                          {active && (
                            <Check
                              className="h-3 w-3"
                              style={{
                                color: t.id === 'espresso' ? '#F5E8C7' : '#2C1E16',
                              }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Font Compact Segmented Icon Pills (PDF only) */}
                {config.format === 'pdf' && (
                  <div
                    className="flex items-center gap-0.5 rounded-lg p-0.5"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                    role="radiogroup"
                    aria-label="PDF 字体"
                  >
                    <Type
                      className="mx-1 h-3 w-3 shrink-0"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    {FONT_PILLS.map((f) => {
                      const active = (config.fontStyle || 'serif') === f.id;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setConfig((prev) => ({ ...prev, fontStyle: f.id }))}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-semibold transition-colors"
                          style={{
                            backgroundColor: active ? 'var(--accent-primary)' : 'transparent',
                            color: active ? '#FFFFFF' : 'var(--text-secondary)',
                          }}
                          title={f.tooltip}
                          aria-label={f.tooltip}
                        >
                          {f.short}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 4. Compact Chapter Scope Filter Accordion */}
            <div
              className="rounded-xl"
              style={{
                backgroundColor: 'var(--bg-page)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <button
                type="button"
                onClick={() => setShowChapterPicker((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs"
                title="按章节范围筛选导出内容"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <ListFilter
                    className="h-3.5 w-3.5"
                    style={{ color: 'var(--accent-primary)' }}
                  />
                  <span>章节范围</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="font-mono-tabular text-[11px]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {config.selectedChapterIds.length === 0
                      ? `全部 (${bookChapters.length})`
                      : `${config.selectedChapterIds.length} / ${bookChapters.length}`}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      showChapterPicker ? 'rotate-180' : ''
                    }`}
                    style={{ color: 'var(--text-muted)' }}
                  />
                </span>
              </button>

              {showChapterPicker && (
                <div
                  className="border-t px-2.5 pt-1.5 pb-2"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setConfig((prev) => ({ ...prev, selectedChapterIds: [] }));
                        setPdfPreviewPageIdx(0);
                      }}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
                      style={{ color: 'var(--accent-primary)' }}
                      title="选中全部章节"
                    >
                      <CheckCheck className="h-3 w-3" />
                      <span>全选</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfig((prev) => ({
                          ...prev,
                          selectedChapterIds: bookChapters[0] ? [bookChapters[0].id] : [],
                        }));
                        setPdfPreviewPageIdx(0);
                      }}
                      className="rounded px-1.5 py-0.5"
                      style={{ color: 'var(--text-muted)' }}
                      title="仅选首章预览测试"
                    >
                      仅首章
                    </button>
                  </div>
                  <div className="max-h-28 space-y-0.5 overflow-y-auto pr-0.5">
                    {bookChapters.map((ch) => {
                      const checked =
                        config.selectedChapterIds.length === 0 ||
                        config.selectedChapterIds.includes(ch.id);
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => toggleChapterSelection(ch.id)}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs transition-colors hover:opacity-85"
                          style={{
                            backgroundColor: checked ? 'var(--accent-soft)' : 'transparent',
                            color: checked ? 'var(--text-primary)' : 'var(--text-muted)',
                          }}
                        >
                          <span className="truncate pr-2">
                            <span className="font-mono-tabular mr-1 text-[10px] opacity-60">
                              H{ch.level || 1}
                            </span>
                            {ch.title}
                          </span>
                          {checked && (
                            <Check
                              className="h-3 w-3 shrink-0"
                              style={{ color: 'var(--accent-primary)' }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Dock: Icon Actions + Primary Download CTA */}
          <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
            {statusToast ? (
              <div
                className="flex items-center justify-center gap-1.5 rounded-lg py-1 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent-primary)',
                }}
              >
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{statusToast}</span>
              </div>
            ) : (
              <div
                className="flex items-center justify-between text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                <span className="font-mono-tabular">
                  {config.format === 'pdf' && jsPdfPreview
                    ? `A4 · ${jsPdfPreview.totalPages} 页`
                    : `${filteredChapters.length} 章 · ${bookAnnotations.length} 批注`}
                </span>
                <span className="font-mono-tabular">~{estimatedSizeKb} KB</span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              {/* Icon-Only Secondary Action: Print */}
              {(config.format === 'pdf' || config.format === 'html') && (
                <button
                  type="button"
                  onClick={handleNativePrintPdf}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors hover:opacity-85"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                  }}
                  title="唤起系统原生矢量打印"
                  aria-label="打印"
                >
                  <Printer className="h-4 w-4" />
                </button>
              )}

              {/* Icon-Only Secondary Action: Copy to Clipboard */}
              <button
                type="button"
                onClick={handleCopyContent}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors hover:opacity-85"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  color: copiedFlag ? 'var(--accent-primary)' : 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
                title="复制导出内容到剪贴板"
                aria-label="复制内容"
              >
                {copiedFlag ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>

              {/* Primary Export Button */}
              <button
                type="button"
                disabled={isExporting}
                onClick={handlePrimaryExport}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-white transition-transform active:scale-[0.99] disabled:opacity-60 whitespace-nowrap"
                style={{ backgroundColor: 'var(--accent-primary)' }}
                title={`下载 ${currentFormatMeta.ext} 文件`}
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span>导出 {currentFormatMeta.shortLabel}</span>
                <span className="font-mono-tabular text-[11px] opacity-80">
                  ({currentFormatMeta.ext})
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Live Preview Canvas */}
        <div
          className="flex flex-1 flex-col overflow-hidden"
          style={{ backgroundColor: 'var(--bg-canvas)' }}
        >
          {/* Minimal Icon-Driven Preview Toolbar */}
          <div
            className="flex items-center justify-between gap-2 border-b px-4 py-2.5"
            style={{
              backgroundColor: 'var(--bg-page)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="font-medium truncate">《{activeBook.title}》</span>
              <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
                ·
              </span>
              <span
                className="font-mono-tabular shrink-0 text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                {currentFormatMeta.shortLabel} 实时预览
              </span>
            </div>

            {/* Pure Icon Toolbar on Right */}
            <div className="flex shrink-0 items-center gap-1">
              {config.format === 'pdf' && jsPdfPreview && jsPdfPreview.totalPages > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPdfZoomFit((v) => !v)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                    title={pdfZoomFit ? '放大预览幅面' : '自适应窗口大小'}
                    aria-label={pdfZoomFit ? '放大预览' : '适屏预览'}
                  >
                    {pdfZoomFit ? (
                      <ZoomIn className="h-3.5 w-3.5" />
                    ) : (
                      <ZoomOut className="h-3.5 w-3.5" />
                    )}
                  </button>

                  <div
                    className="mx-0.5 flex items-center rounded-lg p-0.5"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <button
                      type="button"
                      disabled={pdfPreviewPageIdx <= 0}
                      onClick={() => setPdfPreviewPageIdx((p) => Math.max(0, p - 1))}
                      className="flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-30"
                      title="上一页 (←)"
                      aria-label="上一页"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono-tabular px-2 text-[11px] font-medium">
                      {pdfPreviewPageIdx + 1} / {jsPdfPreview.totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={pdfPreviewPageIdx + 1 >= jsPdfPreview.totalPages}
                      onClick={() =>
                        setPdfPreviewPageIdx((p) =>
                          Math.min(jsPdfPreview.totalPages - 1, p + 1)
                        )
                      }
                      className="flex h-6 w-6 items-center justify-center rounded-md disabled:opacity-30"
                      title="下一页 (→)"
                      aria-label="下一页"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={onClose}
                className="ml-1 hidden h-7 w-7 items-center justify-center rounded-lg transition-colors hover:opacity-80 lg:flex"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-subtle)',
                }}
                title="关闭工作台 (Esc)"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Preview Viewport */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {config.format === 'pdf' && jsPdfPreview ? (
              <div className="flex flex-col items-center gap-4">
                <div
                  onDoubleClick={() => setPdfZoomFit((v) => !v)}
                  className={`overflow-hidden rounded-xl border transition-all cursor-zoom-in ${
                    pdfZoomFit ? 'max-w-[430px]' : 'max-w-[660px]'
                  } w-full shadow-xl`}
                  style={{
                    borderColor: 'var(--border-strong)',
                    backgroundColor: 'var(--bg-page)',
                  }}
                  title="双击切换缩放比例"
                >
                  {jsPdfPreview.pageDataUrls[pdfPreviewPageIdx] && (
                    <img
                      src={jsPdfPreview.pageDataUrls[pdfPreviewPageIdx]}
                      alt={`PDF 第 ${pdfPreviewPageIdx + 1} 页预览`}
                      className="block h-auto w-full select-none"
                    />
                  )}
                </div>

                {/* Compact Page Thumbnail Filmstrip */}
                {jsPdfPreview.totalPages > 1 && (
                  <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1">
                    {jsPdfPreview.pageDataUrls.map((url, idx) => {
                      const isCurrent = idx === pdfPreviewPageIdx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setPdfPreviewPageIdx(idx)}
                          className="group relative shrink-0 overflow-hidden rounded-lg border transition-transform"
                          style={{
                            width: '48px',
                            borderColor: isCurrent
                              ? 'var(--accent-primary)'
                              : 'var(--border-subtle)',
                            boxShadow: isCurrent
                              ? '0 0 0 2px var(--accent-primary)'
                              : 'none',
                          }}
                          title={`跳转至第 ${idx + 1} 页`}
                        >
                          <img
                            src={url}
                            alt={`第 ${idx + 1} 页缩略图`}
                            className="block h-auto w-full"
                          />
                          <span
                            className="font-mono-tabular absolute right-1 bottom-1 rounded px-1 text-[9px] font-semibold"
                            style={{
                              backgroundColor: isCurrent
                                ? 'var(--accent-primary)'
                                : 'rgba(0,0,0,0.55)',
                              color: '#FFFFFF',
                            }}
                          >
                            {idx + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : config.format === 'html' ? (
              <div
                className="mx-auto max-w-2xl overflow-hidden rounded-2xl border shadow-md"
                style={{
                  borderColor: 'var(--border-subtle)',
                  backgroundColor: '#FBF7F0',
                }}
              >
                <iframe
                  title="导出排版预览"
                  srcDoc={previewText}
                  className="h-[520px] w-full border-0"
                />
              </div>
            ) : (
              <div
                className="mx-auto max-w-2xl rounded-2xl p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              >
                {previewText.slice(0, 4200)}
                {previewText.length > 4200 &&
                  '\n\n…（预览已折叠后续正文，导出文件包含完整内容）'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
