import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Hash,
  Layers,
  ListChecks,
  Palette,
  Printer,
  Sparkles,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Annotation, Book, ReadingStatsDaily } from '../types/reader';
import {
  buildCsvExport,
  buildEpubBlob,
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
  triggerBlobDownload,
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
  label: string;
  ext: string;
  desc: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  {
    id: 'pdf',
    label: '矢量文字 PDF',
    ext: '.pdf',
    desc: 'A4 矢量排版、含 Mermaid 图表与表格',
    icon: FileText,
  },
  {
    id: 'md',
    label: 'Markdown 手账',
    ext: '.md',
    desc: '含 YAML 头、多级大纲与批注',
    icon: Hash,
  },
  {
    id: 'epub',
    label: 'EPUB 电子书',
    ext: '.epub',
    desc: '标准 EPUB 3 打包章节与图表',
    icon: BookOpen,
  },
  {
    id: 'csv',
    label: 'CSV 统计报表',
    ext: '.csv',
    desc: 'Excel / Notion 兼容结构化表',
    icon: FileSpreadsheet,
  },
  {
    id: 'json',
    label: 'JSON 结构数据',
    ext: '.json',
    desc: '大纲、书摘与统计结构化导出',
    icon: FileCode,
  },
  {
    id: 'html',
    label: 'HTML 网页手账',
    ext: '.html',
    desc: '独立单文件暖调排版与矢量图',
    icon: Layers,
  },
  {
    id: 'txt',
    label: 'TXT 纯文本',
    ext: '.txt',
    desc: '经典纯文本书摘与全文归档',
    icon: FileText,
  },
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

  // Pre-warm all Mermaid diagrams in the active book whenever modal opens or theme changes
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

  // Live jsPDF multi-page A4 vector preview (renders 100% of book pages to match exported PDF)
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

  const previewText = useMemo(() => {
    if (!isOpen) return '';
    const syncedConfig: ExportConfig = {
      ...config,
      includeAnnotations: Boolean(config.includeNotes || config.includeExcerpts),
    };
    if (config.format === 'md' || config.format === 'epub') {
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
        selectedChapterIds: syncedConfig.selectedChapterIds,
      });
    }
    return buildStyledHtmlDocument(activeBook, bookAnnotations, dailyStats, syncedConfig);
  }, [isOpen, config, activeBook, bookAnnotations, dailyStats, mermaidReadyTick]);

  if (!isOpen) return null;

  const triggerNotice = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 2800);
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
  };

  const handlePrimaryExport = async () => {
    const safeTitle = activeBook.title.replace(/[\\/:*?"<>|]/g, '');
    const syncedConfig: ExportConfig = {
      ...config,
      includeAnnotations: Boolean(config.includeNotes || config.includeExcerpts),
    };

    if (config.format === 'pdf') {
      triggerNotice('正在渲染全书 Mermaid 图表并生成矢量 PDF...');
      const result = await exportBookWithJsPdf(
        activeBook,
        bookAnnotations,
        dailyStats,
        syncedConfig
      );
      triggerNotice(`已完整导出 ${result.totalPages} 页 A4 矢量 PDF（含全部图表）`);
      return;
    }

    if (config.format === 'md') {
      const md = buildMarkdownExport(activeBook, bookAnnotations, dailyStats, syncedConfig);
      triggerFileDownload(`${safeTitle}-读书手账.md`, md, 'text/markdown');
      triggerNotice('已导出 Markdown (.md) 读书手账');
      return;
    }

    if (config.format === 'epub') {
      triggerNotice('正在渲染 Mermaid 矢量图表并打包 EPUB...');
      await warmUpMermaidDiagramsForContent(activeBook.content, syncedConfig.themeStyle);
      const epubBlob = buildEpubBlob(activeBook, bookAnnotations, dailyStats, syncedConfig);
      triggerBlobDownload(`${safeTitle}.epub`, epubBlob);
      triggerNotice('已打包导出标准 EPUB (.epub) 电子书（含图表与表格）');
      return;
    }

    if (config.format === 'csv') {
      const csv = buildCsvExport([activeBook], bookAnnotations, dailyStats);
      triggerFileDownload(`${safeTitle}-书摘统计报表.csv`, csv, 'text/csv');
      triggerNotice('已导出 CSV 结构化报表');
      return;
    }

    if (config.format === 'json') {
      const json = buildStructuredJsonExport([activeBook], bookAnnotations, dailyStats, syncedConfig);
      triggerFileDownload(`${safeTitle}-结构化归档.json`, json, 'application/json');
      triggerNotice('已导出 JSON 结构化数据');
      return;
    }

    if (config.format === 'html') {
      await warmUpMermaidDiagramsForContent(activeBook.content, syncedConfig.themeStyle);
      const html = buildStyledHtmlDocument(activeBook, bookAnnotations, dailyStats, syncedConfig);
      triggerFileDownload(`${safeTitle}-典藏手账.html`, html, 'text/html');
      triggerNotice('已导出 HTML 典藏网页手账（含内嵌 SVG 图表）');
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
      triggerFileDownload(`${safeTitle}-读书笔记.txt`, txt, 'text/plain');
      triggerNotice('已导出 TXT 读书笔记');
    }
  };

  const handleNativePrintPdf = async () => {
    const syncedConfig: ExportConfig = {
      ...config,
      includeAnnotations: Boolean(config.includeNotes || config.includeExcerpts),
    };
    triggerNotice('正在准备 100% 图表与全书矢量打印排版...');
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
      triggerNotice(`已唤起全书 ${fullResult.totalPages} 页 A4 矢量打印视图`);
      return;
    }
    const html = buildStyledHtmlDocument(activeBook, bookAnnotations, dailyStats, syncedConfig);
    printDocumentViaHiddenIframe(html);
    triggerNotice('已唤起无页眉原生矢量打印视图');
  };

  const handleCopyContent = async () => {
    try {
      await navigator.clipboard.writeText(previewText);
      triggerNotice('已复制导出内容至剪贴板');
    } catch {
      triggerNotice('复制失败，请直接点击下载');
    }
  };

  const estimatedSizeKb =
    config.format === 'pdf' && jsPdfPreview
      ? Math.max(48, jsPdfPreview.totalPages * 115)
      : Math.max(1, Math.round(new Blob([previewText]).size / 1024));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-xs sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl shadow-2xl lg:flex-row"
        style={{
          backgroundColor: 'var(--bg-page)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Control Column */}
        <div
          className="flex max-h-[46vh] w-full flex-col justify-between border-b p-4 sm:p-5 lg:max-h-none lg:w-96 lg:shrink-0 lg:border-r lg:border-b-0"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                <h2 className="font-display text-base font-semibold">PDF 与多格式导出工坊</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg lg:hidden"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Book Selector (if multiple books provided) */}
            {allBooks && allBooks.length > 1 && (
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  目标典藏书籍
                </label>
                <select
                  value={activeBook.id}
                  onChange={(e) => {
                    setSelectedBookId(e.target.value);
                    setConfig((prev) => ({ ...prev, selectedChapterIds: [] }));
                    setPdfPreviewPageIdx(0);
                  }}
                  className="h-9 w-full rounded-xl px-3 text-xs outline-none"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {allBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      《{b.title}》 ({b.totalChars.toLocaleString()} 字)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 7 Export Formats Grid */}
            <div>
              <div
                className="mb-1.5 flex items-center justify-between text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span>选择导出格式</span>
                <span className="font-mono-tabular text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  jsPDF 驱动
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {FORMAT_OPTIONS.map((fmt) => {
                  const Icon = fmt.icon;
                  const active = config.format === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setConfig((prev) => ({ ...prev, format: fmt.id }))}
                      className="flex items-start gap-2 rounded-xl p-2.5 text-left transition-all"
                      style={{
                        backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-page)',
                        color: active ? '#FFFFFF' : 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 text-xs font-semibold">
                          <span className="truncate">{fmt.label}</span>
                        </div>
                        <p
                          className="mt-0.5 truncate text-[10px]"
                          style={{
                            color: active ? 'rgba(255,255,255,0.82)' : 'var(--text-muted)',
                          }}
                        >
                          {fmt.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Granular Content Selection: 正文 / 笔记 / 书摘 / 大纲 / 统计 */}
            <div>
              <div
                className="mb-1.5 flex items-center justify-between text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span className="flex items-center gap-1.5">
                  <ListChecks className="h-3.5 w-3.5" />
                  <span>选择导出内容（正文 / 笔记 / 书摘）</span>
                </span>
              </div>

              {/* Primary 3 Core Dimensions: 正文, 笔记, 书摘 */}
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  {
                    key: 'includeFullText' as const,
                    label: '正文',
                    sub: `${(activeBook.totalChars / 1000).toFixed(1)}k字`,
                    checked: Boolean(config.includeFullText),
                  },
                  {
                    key: 'includeNotes' as const,
                    label: '笔记',
                    sub: `${notesCount} 篇感悟`,
                    checked: Boolean(config.includeNotes ?? config.includeAnnotations),
                  },
                  {
                    key: 'includeExcerpts' as const,
                    label: '书摘',
                    sub: `${bookAnnotations.length} 条金句`,
                    checked: Boolean(config.includeExcerpts ?? config.includeAnnotations),
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer flex-col justify-between rounded-xl p-2.5 text-xs transition-all"
                    style={{
                      backgroundColor: item.checked ? 'var(--accent-soft)' : 'var(--bg-page)',
                      border: item.checked
                        ? '1px solid var(--accent-primary)'
                        : '1px solid var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="font-semibold"
                        style={{
                          color: item.checked ? 'var(--accent-primary)' : 'var(--text-primary)',
                        }}
                      >
                        {item.label}
                      </span>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setConfig((prev) => {
                            const next = { ...prev, [item.key]: val };
                            next.includeAnnotations = Boolean(
                              next.includeNotes || next.includeExcerpts
                            );
                            return next;
                          });
                          setPdfPreviewPageIdx(0);
                        }}
                        className="h-3.5 w-3.5 accent-[#B4532A]"
                      />
                    </div>
                    <span
                      className="font-mono-tabular mt-1 text-[10px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {item.sub}
                    </span>
                  </label>
                ))}
              </div>

              {/* Auxiliary Dimensions: 章节大纲 & 阅读统计 */}
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {[
                  {
                    key: 'includeOutline' as const,
                    label: '章节大纲',
                    meta: `${bookChapters.length} 节`,
                  },
                  {
                    key: 'includeStats' as const,
                    label: '阅读统计',
                    meta: `${metrics.progressPct}%`,
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs"
                    style={{
                      backgroundColor: 'var(--bg-page)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div>
                      <span className="font-medium">{item.label}</span>
                      <span
                        className="font-mono-tabular ml-1 text-[10px]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {item.meta}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={config[item.key]}
                      onChange={(e) => {
                        setConfig((prev) => ({ ...prev, [item.key]: e.target.checked }));
                        setPdfPreviewPageIdx(0);
                      }}
                      className="h-3.5 w-3.5 accent-[#B4532A]"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Optional Chapter Range Filter */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>
                  章节范围：
                  <strong className="ml-1" style={{ color: 'var(--text-primary)' }}>
                    {config.selectedChapterIds.length === 0
                      ? `全部章节 (${bookChapters.length})`
                      : `已选 ${config.selectedChapterIds.length} / ${bookChapters.length} 章`}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => setShowChapterPicker((v) => !v)}
                  className="text-xs font-medium underline underline-offset-4"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {showChapterPicker ? '收起筛选' : '按章筛选'}
                </button>
              </div>

              {showChapterPicker && (
                <div
                  className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-xl p-2"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    className="mb-1 flex justify-between border-b pb-1 text-[11px]"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={() => setConfig((prev) => ({ ...prev, selectedChapterIds: [] }))}
                      style={{ color: 'var(--accent-primary)' }}
                    >
                      全选所有章节
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          selectedChapterIds: bookChapters[0] ? [bookChapters[0].id] : [],
                        }))
                      }
                      style={{ color: 'var(--text-muted)' }}
                    >
                      仅首章
                    </button>
                  </div>
                  {bookChapters.map((ch) => {
                    const checked =
                      config.selectedChapterIds.length === 0 ||
                      config.selectedChapterIds.includes(ch.id);
                    return (
                      <label
                        key={ch.id}
                        className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs hover:opacity-85"
                      >
                        <span className="truncate pr-2">
                          <span className="font-mono-tabular mr-1 text-[10px] opacity-60">
                            H{ch.level || 1}
                          </span>
                          {ch.title}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChapterSelection(ch.id)}
                          className="h-3.5 w-3.5 shrink-0 accent-[#B4532A]"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Theme Palette & Font Selector for Styled Formats */}
            {(config.format === 'pdf' ||
              config.format === 'html' ||
              config.format === 'epub') && (
              <div className="space-y-2.5">
                <div>
                  <div
                    className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Palette className="h-3.5 w-3.5" />
                    <span>纸张主题配色</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { id: 'parchment', label: '羊皮', hex: '#FBF7F0' },
                        { id: 'caramel', label: '焦糖', hex: '#F7EEDF' },
                        { id: 'espresso', label: '夜读', hex: '#211A15' },
                        { id: 'eink', label: '墨水', hex: '#F7F7F7' },
                      ] as { id: ExportThemeStyle; label: string; hex: string }[]
                    ).map((t) => {
                      const active = config.themeStyle === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setConfig((prev) => ({ ...prev, themeStyle: t.id }))}
                          className="flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium"
                          style={{
                            backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-page)',
                            color: active ? '#FFFFFF' : 'var(--text-primary)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full border border-black/20"
                            style={{ backgroundColor: t.hex }}
                          />
                          <span>{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {config.format === 'pdf' && (
                  <div>
                    <div
                      className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Type className="h-3.5 w-3.5" />
                      <span>PDF 典藏字体</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'serif', label: '人文宋体' },
                          { id: 'kaiti', label: '书房楷体' },
                          { id: 'sans', label: '现代黑体' },
                        ] as const
                      ).map((f) => {
                        const active = (config.fontStyle || 'serif') === f.id;
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => setConfig((prev) => ({ ...prev, fontStyle: f.id }))}
                            className="rounded-xl py-1.5 text-xs font-medium"
                            style={{
                              backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-page)',
                              color: active ? '#FFFFFF' : 'var(--text-primary)',
                              border: '1px solid var(--border-subtle)',
                            }}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Primary Action Footer */}
          <div className="mt-4 space-y-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
            {statusToast && (
              <div
                className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent-primary)',
                }}
              >
                <Check className="h-3.5 w-3.5" />
                <span>{statusToast}</span>
              </div>
            )}
            <div
              className="flex items-center justify-between text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              <span>
                {config.format === 'pdf' && jsPdfPreview
                  ? `jsPDF A4 预览共 ${jsPdfPreview.totalPages} 页`
                  : `包含 ${filteredChapters.length} 章 · ${bookAnnotations.length} 批注`}
              </span>
              <span className="font-mono-tabular">约 {estimatedSizeKb} KB</span>
            </div>
            <div className="flex gap-2">
              {config.format === 'pdf' ? (
                <button
                  type="button"
                  onClick={handleNativePrintPdf}
                  className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                  }}
                  title="调用浏览器打印视图"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>打印</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCopyContent}
                  className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-strong)',
                  }}
                  title="复制内容到剪贴板"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>复制</span>
                </button>
              )}
              <button
                type="button"
                onClick={handlePrimaryExport}
                className="flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-transform active:scale-[0.99]"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              >
                <Download className="h-4 w-4" />
                <span>
                  {config.format === 'pdf'
                    ? 'jsPDF 下载精美 PDF (.pdf)'
                    : `立即导出 ${FORMAT_OPTIONS.find((f) => f.id === config.format)?.ext}`}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: Live Document / jsPDF A4 Multi-Page Preview Pane */}
        <div
          className="flex flex-1 flex-col overflow-hidden"
          style={{ backgroundColor: 'var(--bg-canvas)' }}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5 sm:py-3"
            style={{
              backgroundColor: 'var(--bg-page)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
              <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-primary)' }} />
              <span className="shrink-0 font-semibold">
                {config.format === 'pdf'
                  ? 'jsPDF A4 书页排版实时预览'
                  : '实时排版与结构预览'}
              </span>
              <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>·</span>
              <span className="font-mono-tabular min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>
                《{activeBook.title}》
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {config.format === 'pdf' && jsPdfPreview && jsPdfPreview.totalPages > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPdfZoomFit((v) => !v)}
                    className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px]"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                    title={pdfZoomFit ? '切换至100%幅面预览' : '切换至自适应窗口'}
                  >
                    {pdfZoomFit ? (
                      <>
                        <ZoomIn className="h-3 w-3" />
                        <span>放大</span>
                      </>
                    ) : (
                      <>
                        <ZoomOut className="h-3 w-3" />
                        <span>适屏</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={pdfPreviewPageIdx <= 0}
                    onClick={() => setPdfPreviewPageIdx((p) => Math.max(0, p - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-35"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                    title="上一页"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-mono-tabular px-1.5 text-xs">
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
                    className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-35"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                    title="下一页"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="hidden h-7 w-7 items-center justify-center rounded-lg lg:flex"
                style={{ color: 'var(--text-muted)' }}
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {config.format === 'pdf' && jsPdfPreview ? (
              <div className="flex flex-col items-center gap-4">
                {/* Active A4 Page Sheet Preview */}
                <div
                  className={`overflow-hidden rounded-xl border transition-all ${
                    pdfZoomFit ? 'max-w-[440px]' : 'max-w-[660px]'
                  } w-full shadow-xl`}
                  style={{
                    borderColor: 'var(--border-strong)',
                    backgroundColor: 'var(--bg-page)',
                  }}
                >
                  {jsPdfPreview.pageDataUrls[pdfPreviewPageIdx] && (
                    <img
                      src={jsPdfPreview.pageDataUrls[pdfPreviewPageIdx]}
                      alt={`PDF 第 ${pdfPreviewPageIdx + 1} 页预览`}
                      className="block h-auto w-full select-none"
                    />
                  )}
                </div>

                {/* Multi-page Thumbnail Strip */}
                {jsPdfPreview.totalPages > 1 && (
                  <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-2">
                    {jsPdfPreview.pageDataUrls.map((url, idx) => {
                      const isCurrent = idx === pdfPreviewPageIdx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setPdfPreviewPageIdx(idx)}
                          className="group relative shrink-0 overflow-hidden rounded-lg border transition-transform"
                          style={{
                            width: '54px',
                            borderColor: isCurrent
                              ? 'var(--accent-primary)'
                              : 'var(--border-subtle)',
                            boxShadow: isCurrent
                              ? '0 0 0 2px var(--accent-primary)'
                              : 'none',
                          }}
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
                {previewText.length > 4200 && '\n\n…（预览已折叠后续正文，导出文件包含完整内容）'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

