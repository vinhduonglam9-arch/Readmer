import React, { useRef, useState } from 'react';
import {
  AlignJustify,
  ArchiveRestore,
  BookOpen,
  Check,
  ChevronDown,
  DatabaseBackup,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Hash,
  Indent,
  Maximize2,
  Printer,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import {
  Annotation,
  Book,
  CustomFont,
  ReaderSettings,
  ReadingStatsDaily,
} from '../types/reader';
import {
  buildCsvExport,
  buildEpubBlob,
  buildMarkdownExport,
  buildStructuredJsonExport,
  buildStyledHtmlDocument,
  DEFAULT_EXPORT_CONFIG,
  exportBookWithJsPdf,
  ExportFormat,
  triggerBlobDownload,
} from '../core/exportEngine';
import {
  buildHtmlNotebookExport,
  buildTxtExport,
  triggerFileDownload,
  warmUpMermaidDiagramsForContent,
} from '../core/parserEngine';
import { exportFullLibraryFromIndexedDB } from '../core/storageEngine';
import {
  detectInstalledLocalFonts,
  getShortLocalFontLabel,
  InstalledSystemFont,
  queryBrowserLocalFonts,
  resolveReaderFontFamilyCss,
} from '../core/paginationEngine';
import { ExportStudioModal } from './ExportStudioModal';

interface TypographyDataViewProps {
  books: Book[];
  annotations: Annotation[];
  customFonts: CustomFont[];
  settings: ReaderSettings;
  dailyStats: ReadingStatsDaily[];
  onUpdateSettings: (partial: Partial<ReaderSettings>) => void;
  onUploadCustomFont: (file: File) => Promise<void>;
  onDeleteCustomFont: (fontId: string) => Promise<void>;
  onImportBackupFile: (file: File) => Promise<void>;
}

const BUILTIN_FONTS = [
  { id: 'serif-editorial', name: '人文衬线宋' },
  { id: 'sans-warm', name: '温润无衬线' },
  { id: 'kaiti-classic', name: '书房楷体' },
];

export const TypographyDataView: React.FC<TypographyDataViewProps> = ({
  books,
  annotations,
  customFonts,
  settings,
  dailyStats,
  onUpdateSettings,
  onUploadCustomFont,
  onDeleteCustomFont,
  onImportBackupFile,
}) => {
  const [selectedExportBookId, setSelectedExportBookId] = useState<string>(
    books[0]?.id || ''
  );
  const [includeFullTextInExport, setIncludeFullTextInExport] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [studioModalFormat, setStudioModalFormat] = useState<ExportFormat | null>(null);
  const [installedLocalFonts, setInstalledLocalFonts] = useState<InstalledSystemFont[]>(() =>
    detectInstalledLocalFonts()
  );
  const [localFontPickerOpen, setLocalFontPickerOpen] = useState(false);
  const [customLocalFontInput, setCustomLocalFontInput] = useState('');

  const fontInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const selectedBook = books.find((b) => b.id === selectedExportBookId) || books[0];

  const handleQuickExportFormat = async (format: ExportFormat) => {
    if (!selectedBook) return;
    const bookAnns = annotations.filter((a) => a.bookId === selectedBook.id);
    const safeTitle = selectedBook.title.replace(/[\\/:*?"<>|]/g, '');
    const cfg = {
      ...DEFAULT_EXPORT_CONFIG,
      format,
      includeFullText: includeFullTextInExport,
    };

    if (format === 'md') {
      const md = buildMarkdownExport(selectedBook, bookAnns, dailyStats, cfg);
      triggerFileDownload(`${safeTitle}-手账.md`, md, 'text/markdown');
      showToast('已导出 Markdown (.md) 手账');
    } else if (format === 'epub') {
      await warmUpMermaidDiagramsForContent(selectedBook.content, cfg.themeStyle);
      const blob = buildEpubBlob(selectedBook, bookAnns, dailyStats, {
        ...cfg,
        includeFullText: true,
      });
      triggerBlobDownload(`${safeTitle}.epub`, blob);
      showToast('已打包标准 EPUB (.epub) 电子书');
    } else if (format === 'pdf') {
      showToast('正在生成 A4 典藏 PDF 文件...');
      const res = await exportBookWithJsPdf(selectedBook, bookAnns, dailyStats, cfg);
      showToast(`已下载《${safeTitle}》(${res.totalPages} 页 PDF)`);
    } else if (format === 'csv') {
      const csv = buildCsvExport([selectedBook], bookAnns, dailyStats);
      triggerFileDownload(`${safeTitle}-报表.csv`, csv, 'text/csv');
      showToast('已导出 CSV 结构化报表');
    } else if (format === 'json') {
      const json = buildStructuredJsonExport([selectedBook], bookAnns, dailyStats, cfg);
      triggerFileDownload(`${safeTitle}-数据.json`, json, 'application/json');
      showToast('已导出 JSON 结构化数据');
    } else if (format === 'html') {
      await warmUpMermaidDiagramsForContent(selectedBook.content, cfg.themeStyle);
      const html = buildHtmlNotebookExport(selectedBook, bookAnns, includeFullTextInExport);
      triggerFileDownload(`${safeTitle}-手账.html`, html, 'text/html');
      showToast('已导出 HTML 手账');
    } else if (format === 'txt') {
      const txt = buildTxtExport(selectedBook, bookAnns, includeFullTextInExport);
      triggerFileDownload(`${safeTitle}-笔记.txt`, txt, 'text/plain');
      showToast('已导出 TXT 笔记');
    }
  };

  /**
   * One-click IndexedDB Full Library Backup ("一键备份书库")
   * Reads live IndexedDB stores and downloads a complete JSON package.
   */
  const handleOneClickIndexedDBBackup = async () => {
    setIsBackingUp(true);
    try {
      const payload = await exportFullLibraryFromIndexedDB();
      const dateTag = new Date().toISOString().slice(0, 10);
      triggerFileDownload(
        `roast-and-reed-indexeddb-backup-${dateTag}.json`,
        JSON.stringify(payload, null, 2),
        'application/json'
      );
      showToast(`已打包 IndexedDB 书库 (${payload.books.length} 册)`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const getFontFamilyStyle = (fontId: string): string => {
    return resolveReaderFontFamilyCss(fontId);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <input
        ref={fontInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            await onUploadCustomFont(file);
            showToast(`已载入字体：${file.name}`);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            await onImportBackupFile(file);
            showToast(`已恢复书库：${file.name}`);
            e.target.value = '';
          }
        }}
      />

      {statusMessage && (
        <div
          className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium text-white"
          style={{ backgroundColor: 'var(--accent-primary)' }}
        >
          <Check className="h-4 w-4" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Typography & Custom Fonts */}
        <div
          className="rounded-2xl p-5 lg:col-span-7"
          style={{
            backgroundColor: 'var(--bg-page)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Type className="h-5 w-5" style={{ color: 'var(--accent-primary)' }} />
              <h2 className="font-display text-base font-semibold">字型与排版</h2>
            </div>
            <button
              onClick={() => fontInputRef.current?.click()}
              className="flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--accent-primary)' }}
              title="上传 TTF / OTF / WOFF2 字体"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>导入字体</span>
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUILTIN_FONTS.map((f) => {
              const isSelected = settings.fontFamily === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    setLocalFontPickerOpen(false);
                    onUpdateSettings({ fontFamily: f.id });
                  }}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium transition-all"
                  style={{
                    backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                    border: isSelected
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-subtle)',
                  }}
                >
                  <span className="truncate">{f.name}</span>
                  {isSelected && (
                    <Check
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: 'var(--accent-primary)' }}
                    />
                  )}
                </button>
              );
            })}

            {/* 4th Slot: Local Installed System Font Selector */}
            {(() => {
              const isLocalSelected = settings.fontFamily.startsWith('local:');
              const shortLabel = getShortLocalFontLabel(settings.fontFamily, installedLocalFonts);
              return (
                <button
                  type="button"
                  onClick={() => {
                    const nextOpen = !localFontPickerOpen;
                    setLocalFontPickerOpen(nextOpen);
                    queryBrowserLocalFonts().then((list) => setInstalledLocalFonts(list));
                    if (!isLocalSelected && installedLocalFonts.length > 0) {
                      onUpdateSettings({
                        fontFamily: `local:${installedLocalFonts[0].family}`,
                      });
                    }
                  }}
                  className="flex items-center justify-between gap-1 rounded-xl px-3 py-2.5 text-xs font-medium transition-all"
                  style={{
                    backgroundColor: isLocalSelected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                    border: isLocalSelected
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-subtle)',
                  }}
                  title="选择本机已安装的系统字体"
                >
                  <span className="truncate">
                    {isLocalSelected ? `本地 · ${shortLabel}` : '本地已装字体'}
                  </span>
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0"
                    style={{
                      color: isLocalSelected ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}
                  />
                </button>
              );
            })()}

            {customFonts.map((cf) => {
              const isSelected = settings.fontFamily === cf.id;
              return (
                <div
                  key={cf.id}
                  onClick={() => {
                    setLocalFontPickerOpen(false);
                    onUpdateSettings({ fontFamily: cf.id });
                  }}
                  className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium transition-all"
                  style={{
                    backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                    border: isSelected
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-subtle)',
                  }}
                >
                  <span className="truncate">{cf.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustomFont(cf.id);
                    }}
                    className="rounded p-0.5 hover:text-red-600"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Expandable Local Installed Font Picker Panel */}
          {(localFontPickerOpen || settings.fontFamily.startsWith('local:')) && (
            <div
              className="mt-3 rounded-xl p-3 space-y-2.5"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                  本机已安装字体 ({installedLocalFonts.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    queryBrowserLocalFonts().then((list) => {
                      setInstalledLocalFonts(list);
                      showToast(`已读取 ${list.length} 款本机可用字体`);
                    });
                  }}
                  className="underline transition-opacity hover:opacity-80"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  扫描系统全部字体
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
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
                    placeholder="或直接输入本地字体名 (如: 微软雅黑)"
                    className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
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
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  >
                    应用
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Icon-Driven Sliders */}
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-surface)' }} title="字号">
              <Type className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                type="range"
                min={14}
                max={30}
                step={1}
                value={settings.fontSize}
                onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                className="flex-1 accent-[#B4532A]"
              />
              <span className="font-mono-tabular w-10 text-right text-xs font-semibold">
                {settings.fontSize}px
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-surface)' }} title="行高">
              <AlignJustify className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                type="range"
                min={1.4}
                max={2.2}
                step={0.05}
                value={settings.lineHeight}
                onChange={(e) => onUpdateSettings({ lineHeight: Number(e.target.value) })}
                className="flex-1 accent-[#B4532A]"
              />
              <span className="font-mono-tabular w-10 text-right text-xs font-semibold">
                {settings.lineHeight.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-surface)' }} title="段距">
              <span className="text-xs font-medium shrink-0" style={{ color: 'var(--text-muted)' }}>段距</span>
              <input
                type="range"
                min={8}
                max={32}
                step={2}
                value={settings.paragraphSpacing}
                onChange={(e) => onUpdateSettings({ paragraphSpacing: Number(e.target.value) })}
                className="flex-1 accent-[#B4532A]"
              />
              <span className="font-mono-tabular w-10 text-right text-xs font-semibold">
                {settings.paragraphSpacing}px
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-surface)' }} title="页边距">
              <Maximize2 className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input
                type="range"
                min={20}
                max={64}
                step={4}
                value={settings.pageMargin}
                onChange={(e) => onUpdateSettings({ pageMargin: Number(e.target.value) })}
                className="flex-1 accent-[#B4532A]"
              />
              <span className="font-mono-tabular w-10 text-right text-xs font-semibold">
                {settings.pageMargin}px
              </span>
            </div>

            <label
              className="flex cursor-pointer items-center justify-between rounded-xl p-3 text-xs font-medium sm:col-span-2"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              <span className="flex items-center gap-2">
                <Indent className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                <span>首行缩进 (2em 传统印刷规范)</span>
              </span>
              <input
                type="checkbox"
                checked={settings.indentFirstLine}
                onChange={(e) => onUpdateSettings({ indentFirstLine: e.target.checked })}
                className="h-4 w-4 accent-[#B4532A]"
              />
            </label>
          </div>

          {/* Live Typography Specimen */}
          <div
            className="paper-grain mt-5 rounded-xl p-4"
            style={{
              backgroundColor: 'var(--bg-canvas)',
              border: '1px solid var(--border-subtle)',
              fontFamily: getFontFamilyStyle(settings.fontFamily),
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              letterSpacing: `${settings.letterSpacing}em`,
            }}
          >
            <p style={{ textIndent: settings.indentFirstLine ? '2em' : '0' }}>
              红日初升，其道大光。河出伏流，一泻汪洋。潜龙腾渊，鳞爪飞扬。美哉我少年中国，与天不老！壮哉我中国少年，与国无疆！
            </p>
          </div>
        </div>

        {/* Right: One-Click IndexedDB Library Backup & Book Export */}
        <div className="space-y-5 lg:col-span-5">
          {/* Prominent One-Click IndexedDB Backup Card */}
          <div
            className="rounded-2xl p-5"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="h-5 w-5" style={{ color: 'var(--accent-primary)' }} />
                <h2 className="font-display text-base font-semibold">IndexedDB 跨端迁移</h2>
              </div>
              <span className="font-mono-tabular text-xs" style={{ color: 'var(--text-muted)' }}>
                {books.length} 册 · {annotations.length} 批注
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                onClick={handleOneClickIndexedDBBackup}
                disabled={isBackingUp}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-transform active:scale-[0.98]"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              >
                <DatabaseBackup className="h-4 w-4" />
                <span>一键备份书库</span>
              </button>

              <button
                onClick={() => backupInputRef.current?.click()}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <ArchiveRestore className="h-4 w-4" />
                <span>导入恢复 JSON</span>
              </button>
            </div>
          </div>

          {/* Multi-Format Book Export Card */}
          <div
            className="rounded-2xl p-5"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5" style={{ color: 'var(--accent-primary)' }} />
                <h2 className="font-display text-base font-semibold">多格式手账与电子书导出</h2>
              </div>
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={includeFullTextInExport}
                  onChange={(e) => setIncludeFullTextInExport(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#B4532A]"
                />
                <span>含全文</span>
              </label>
            </div>

            <select
              value={selectedExportBookId}
              onChange={(e) => setSelectedExportBookId(e.target.value)}
              className="mt-3 h-10 w-full rounded-xl px-3 text-xs outline-none"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  《{b.title}》
                </option>
              ))}
            </select>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                onClick={() => handleQuickExportFormat('md')}
                className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <Hash className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>MD</span>
              </button>
              <button
                onClick={() => handleQuickExportFormat('epub')}
                className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <BookOpen className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>EPUB</span>
              </button>
              <button
                onClick={() => handleQuickExportFormat('pdf')}
                className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <Printer className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>PDF</span>
              </button>
              <button
                onClick={() => handleQuickExportFormat('csv')}
                className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>CSV</span>
              </button>
              <button
                onClick={() => handleQuickExportFormat('html')}
                className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <FileCode className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>HTML</span>
              </button>
              <button
                onClick={() => handleQuickExportFormat('txt')}
                className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <FileText className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>TXT</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStudioModalFormat('pdf')}
              className="mt-2.5 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--accent-primary)' }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>打开定制导出工作台（自由勾选章节与实时预览）</span>
            </button>
          </div>
        </div>
      </div>

      {selectedBook && studioModalFormat && (
        <ExportStudioModal
          isOpen={Boolean(studioModalFormat)}
          onClose={() => setStudioModalFormat(null)}
          book={selectedBook}
          allBooks={books}
          annotations={annotations}
          dailyStats={dailyStats}
          initialFormat={studioModalFormat}
        />
      )}
    </div>
  );
};
