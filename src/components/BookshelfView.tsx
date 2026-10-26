import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckSquare,
  Download,
  Edit3,
  FileCode,
  FileSpreadsheet,
  FolderPlus,
  Grid3x3,
  Hash,
  Heart,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  Square,
  Tag,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { Annotation, Book, CoverPreset, ReadingStatsDaily } from '../types/reader';
import {
  buildBatchBooksMarkdown,
  buildCsvExport,
  buildEpubBlob,
  buildStructuredJsonExport,
  DEFAULT_EXPORT_CONFIG,
  triggerBlobDownload,
} from '../core/exportEngine';
import { triggerFileDownload } from '../core/parserEngine';
import { BookCoverArt } from './BookCoverArt';
import { ExportStudioModal } from './ExportStudioModal';

export type ShelfViewMode = 'large' | 'small' | 'detail';

interface BookshelfViewProps {
  books: Book[];
  annotations: Annotation[];
  dailyStats: ReadingStatsDaily[];
  dailyGoalMinutes: number;
  isPrivateSpaceMode?: boolean;
  onOpenBook: (bookId: string) => void;
  onImportFiles: (files: FileList) => void;
  onToggleFavorite: (bookId: string) => void;
  onDeleteBook: (bookId: string) => void;
  onUpdateBookMeta: (
    bookId: string,
    updates: { title: string; author: string; category: string; coverPreset: CoverPreset }
  ) => void;
  onToggleBookPrivacy?: (bookId: string) => void;
  onBatchToggleBookPrivacy?: (bookIds: string[]) => void;
  onEnterPrivateSpace?: () => void;
  onExitPrivateSpace?: () => void;
  onLockPrivateSpace?: () => void;
  onOpenVaultSettings?: () => void;
}

const COVER_PRESETS: { value: CoverPreset; label: string; hex: string }[] = [
  { value: 'terracotta', label: '赤陶', hex: '#8C3F23' },
  { value: 'walnut', label: '胡桃', hex: '#4A3525' },
  { value: 'espresso', label: '浓缩', hex: '#231A14' },
  { value: 'matcha', label: '抹茶', hex: '#3B4D3E' },
  { value: 'parchment', label: '羊皮', hex: '#DFD2BE' },
];

const SHELF_VIEW_STORAGE_KEY = 'roast-reed-shelf-view-mode';
const CUSTOM_CATEGORIES_STORAGE_KEY = 'shuge_custom_categories_v1';

export const BookshelfView: React.FC<BookshelfViewProps> = ({
  books,
  annotations,
  dailyStats,
  dailyGoalMinutes,
  isPrivateSpaceMode = false,
  onOpenBook,
  onImportFiles,
  onToggleFavorite,
  onDeleteBook,
  onUpdateBookMeta,
  onToggleBookPrivacy,
  onBatchToggleBookPrivacy,
  onEnterPrivateSpace,
  onExitPrivateSpace,
  onLockPrivateSpace,
  onOpenVaultSettings,
}) => {
  const [viewMode, setViewMode] = useState<ShelfViewMode>(() => {
    try {
      const saved = localStorage.getItem(SHELF_VIEW_STORAGE_KEY);
      if (saved === 'large' || saved === 'small' || saved === 'detail') return saved;
    } catch {
      // ignore storage errors
    }
    return 'large';
  });

  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return ['文学', '历史', '技术', '随笔'];
  });
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryTag, setEditingCategoryTag] = useState<string | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [batchTargetCategory, setBatchTargetCategory] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'progress' | 'length'>('recent');
  const [isDragging, setIsDragging] = useState(false);

  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPreset, setEditPreset] = useState<CoverPreset>('terracotta');

  const [exportingBook, setExportingBook] = useState<Book | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<string[]>([]);
  const [batchToast, setBatchToast] = useState<string | null>(null);
  const [activeTouchMenuBookId, setActiveTouchMenuBookId] = useState<string | null>(null);
  const [confirmDeleteBookId, setConfirmDeleteBookId] = useState<string | null>(null);
  const confirmDeleteTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRequestDeleteBook = (bookId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteBookId === bookId) {
      if (confirmDeleteTimerRef.current) {
        window.clearTimeout(confirmDeleteTimerRef.current);
        confirmDeleteTimerRef.current = null;
      }
      setConfirmDeleteBookId(null);
      setActiveTouchMenuBookId(null);
      onDeleteBook(bookId);
    } else {
      setConfirmDeleteBookId(bookId);
      if (confirmDeleteTimerRef.current) {
        window.clearTimeout(confirmDeleteTimerRef.current);
      }
      confirmDeleteTimerRef.current = window.setTimeout(() => {
        setConfirmDeleteBookId((prev) => (prev === bookId ? null : prev));
      }, 3500);
    }
  };

  const handleCancelDeleteBook = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteTimerRef.current) {
      window.clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteTimerRef.current = null;
    }
    setConfirmDeleteBookId(null);
  };

  useEffect(() => {
    try {
      localStorage.setItem(SHELF_VIEW_STORAGE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_CATEGORIES_STORAGE_KEY, JSON.stringify(customCategories));
    } catch {
      // ignore
    }
  }, [customCategories]);

  const toggleSelectBookId = (bookId: string) => {
    setSelectedBookIds((prev) =>
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
    );
  };

  const categories = useMemo(() => {
    const set = new Set<string>(customCategories);
    books.forEach((b) => {
      if (b.category && b.category.trim()) set.add(b.category.trim());
    });
    return Array.from(set);
  }, [books, customCategories]);

  const handleAddCustomCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    if (!customCategories.includes(trimmed)) {
      setCustomCategories((prev) => [...prev, trimmed]);
    }
    setActiveFilter(trimmed);
    setNewCategoryName('');
    setIsAddingCategory(false);
  };

  const handleStartEditCategoryTag = (cat: string) => {
    setEditingCategoryTag(cat);
    setEditingCategoryValue(cat);
  };

  const handleConfirmRenameCategory = (oldCat: string) => {
    const newCat = editingCategoryValue.trim();
    if (!newCat || newCat === oldCat) {
      setEditingCategoryTag(null);
      setEditingCategoryValue('');
      return;
    }

    setCustomCategories((prev) => {
      const updated = prev.map((c) => (c === oldCat ? newCat : c));
      if (!updated.includes(newCat)) {
        updated.push(newCat);
      }
      return Array.from(new Set(updated));
    });

    books.forEach((book) => {
      if (book.category === oldCat) {
        onUpdateBookMeta(book.id, {
          title: book.title,
          author: book.author,
          category: newCat,
          coverPreset: book.coverPreset,
        });
      }
    });

    if (activeFilter === oldCat) {
      setActiveFilter(newCat);
    }
    if (editCategory.trim() === oldCat) {
      setEditCategory(newCat);
    }
    if (batchTargetCategory === oldCat) {
      setBatchTargetCategory(newCat);
    }

    setEditingCategoryTag(null);
    setEditingCategoryValue('');
    setBatchToast(`分类「${oldCat}」已修改为「${newCat}」`);
    setTimeout(() => setBatchToast(null), 2200);
  };

  const handleDeleteCustomCategory = (catToRemove: string) => {
    setCustomCategories((prev) => prev.filter((c) => c !== catToRemove));
    const fallbackCategory = catToRemove === '未分类' ? '默认' : '未分类';
    books.forEach((book) => {
      if (book.category === catToRemove) {
        onUpdateBookMeta(book.id, {
          title: book.title,
          author: book.author,
          category: fallbackCategory,
          coverPreset: book.coverPreset,
        });
      }
    });
    if (activeFilter === catToRemove) {
      setActiveFilter('all');
    }
    if (editCategory.trim() === catToRemove) {
      setEditCategory(fallbackCategory);
    }
    if (batchTargetCategory === catToRemove) {
      setBatchTargetCategory('');
    }
    setEditingCategoryTag(null);
    setEditingCategoryValue('');
    setBatchToast(`已删除分类「${catToRemove}」`);
    setTimeout(() => setBatchToast(null), 2200);
  };

  const handleQuickAssignBookCategory = (book: Book, newCat: string) => {
    if (!newCat.trim() || newCat === book.category) return;
    if (!customCategories.includes(newCat.trim())) {
      setCustomCategories((prev) => [...prev, newCat.trim()]);
    }
    onUpdateBookMeta(book.id, {
      title: book.title,
      author: book.author,
      category: newCat.trim(),
      coverPreset: book.coverPreset,
    });
  };

  const filteredBooks = useMemo(() => {
    const list = books.filter((book) => {
      const matchesSearch =
        !searchQuery.trim() ||
        book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        book.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
        book.category.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (activeFilter === 'all') return true;
      if (activeFilter === 'favorites') return book.isFavorite;
      if (activeFilter === 'reading') return book.currentOffset > 0;
      return book.category === activeFilter;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (sortBy === 'length') return b.totalChars - a.totalChars;
      if (sortBy === 'progress') {
        const pa = a.totalChars > 0 ? a.currentOffset / a.totalChars : 0;
        const pb = b.totalChars > 0 ? b.currentOffset / b.totalChars : 0;
        return pb - pa;
      }
      return b.lastReadAt - a.lastReadAt;
    });
  }, [books, searchQuery, activeFilter, sortBy]);

  const selectedBatchBooks = useMemo(
    () => books.filter((b) => selectedBookIds.includes(b.id)),
    [books, selectedBookIds]
  );

  const handleBatchAssignCategory = () => {
    const targetCat = batchTargetCategory.trim();
    if (!targetCat) return;
    const targets = selectedBatchBooks.length > 0 ? selectedBatchBooks : filteredBooks;
    if (targets.length === 0) return;

    if (!customCategories.includes(targetCat)) {
      setCustomCategories((prev) => [...prev, targetCat]);
    }

    targets.forEach((b) => {
      onUpdateBookMeta(b.id, {
        title: b.title,
        author: b.author,
        category: targetCat,
        coverPreset: b.coverPreset,
      });
    });

    setBatchToast(`已将 ${targets.length} 册归入「${targetCat}」`);
    setTimeout(() => setBatchToast(null), 3000);
  };

  const handleBatchExport = (type: 'md' | 'csv' | 'json' | 'epub') => {
    const targets = selectedBatchBooks.length > 0 ? selectedBatchBooks : filteredBooks;
    if (targets.length === 0) return;
    const targetIds = new Set(targets.map((b) => b.id));
    const targetAnns = annotations.filter((a) => targetIds.has(a.bookId));
    const dateTag = new Date().toISOString().slice(0, 10);

    if (type === 'md') {
      const md = buildBatchBooksMarkdown(targets, targetAnns, dailyStats);
      triggerFileDownload(`读书笔记合集-${targets.length}册-${dateTag}.md`, md, 'text/markdown');
      setBatchToast(`已导出 ${targets.length} 册 Markdown 合集`);
    } else if (type === 'csv') {
      const csv = buildCsvExport(targets, targetAnns, dailyStats);
      triggerFileDownload(`书摘统计报表-${targets.length}册-${dateTag}.csv`, csv, 'text/csv');
      setBatchToast(`已导出 ${targets.length} 册 CSV 报表`);
    } else if (type === 'json') {
      const json = buildStructuredJsonExport(
        targets,
        targetAnns,
        dailyStats,
        DEFAULT_EXPORT_CONFIG
      );
      triggerFileDownload(
        `书籍结构化数据-${targets.length}册-${dateTag}.json`,
        json,
        'application/json'
      );
      setBatchToast(`已导出 ${targets.length} 册 JSON 数据`);
    } else if (type === 'epub') {
      targets.forEach((b, idx) => {
        setTimeout(() => {
          const bAnns = annotations.filter((a) => a.bookId === b.id);
          const blob = buildEpubBlob(b, bAnns, dailyStats, DEFAULT_EXPORT_CONFIG);
          const safe = b.title.replace(/[\\/:*?"<>|]/g, '');
          triggerBlobDownload(`${safe}.epub`, blob);
        }, idx * 250);
      });
      setBatchToast(`已打包导出 ${targets.length} 册 EPUB 电子书`);
    }
    setTimeout(() => setBatchToast(null), 3200);
  };

  const mostRecentBook = useMemo(() => {
    if (books.length === 0) return null;
    return [...books].sort((a, b) => b.lastReadAt - a.lastReadAt)[0];
  }, [books]);

  const todayMinutes = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const todayEntry = dailyStats.find((s) => s.date === todayStr);
    return Math.round((todayEntry?.secondsRead || 0) / 60);
  }, [dailyStats]);

  const totalCharsInLibrary = useMemo(
    () => books.reduce((acc, b) => acc + b.totalChars, 0),
    [books]
  );

  const openEditModal = (book: Book, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBook(book);
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditCategory(book.category);
    setEditPreset(book.coverPreset);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBook || !editTitle.trim()) return;
    onUpdateBookMeta(editingBook.id, {
      title: editTitle.trim(),
      author: editAuthor.trim() || '佚名',
      category: editCategory.trim() || '未分类',
      coverPreset: editPreset,
    });
    setEditingBook(null);
  };

  const getBookProgressPct = (book: Book) =>
    book.totalChars > 0
      ? Math.min(100, Math.round((book.currentOffset / book.totalChars) * 100))
      : 0;

  return (
    <div
      className="mx-auto max-w-7xl px-4 py-6 sm:px-8"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onImportFiles(e.dataTransfer.files);
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.json"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onImportFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Minimalist Top Summary & Icon-Driven Action Bar */}
      <div
        className="flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-center"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            {isPrivateSpaceMode && (
              <Lock className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
            )}
            <h1 className="font-display text-xl font-semibold tracking-tight">
              {isPrivateSpaceMode ? '私密空间' : '书架'}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mostRecentBook && (
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span className="hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
                  最近
                </span>
                <button
                  type="button"
                  onClick={() => onOpenBook(mostRecentBook.id)}
                  className="max-w-[140px] truncate font-medium underline-offset-4 hover:underline sm:max-w-[180px]"
                  style={{ color: 'var(--text-primary)' }}
                  title={`继续阅读《${mostRecentBook.title}》`}
                >
                  《{mostRecentBook.title}》
                </button>
                <span
                  className="font-mono-tabular text-[11px]"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  {getBookProgressPct(mostRecentBook)}%
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenBook(mostRecentBook.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
                title={`继续阅读《${mostRecentBook.title}》`}
                aria-label="继续阅读"
              >
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {isPrivateSpaceMode ? (
            <div className="flex items-center gap-1.5">
              {onExitPrivateSpace && (
                <button
                  type="button"
                  onClick={onExitPrivateSpace}
                  className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="返回公开书架"
                  aria-label="返回公开书架"
                >
                  <BookOpen className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
                title="导入并加密至私密空间"
                aria-label="导入私密书籍"
              >
                <Plus className="h-4 w-4" />
              </button>
              {onOpenVaultSettings && (
                <button
                  type="button"
                  onClick={onOpenVaultSettings}
                  className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="私密空间安全设置"
                  aria-label="私密空间安全设置"
                >
                  <Shield className="h-4 w-4" />
                </button>
              )}
              {onLockPrivateSpace && (
                <button
                  type="button"
                  onClick={onLockPrivateSpace}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white transition-colors shrink-0"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                  title="立即锁定私密空间 (Ctrl/Cmd + Shift + L)"
                  aria-label="立即锁定私密空间"
                >
                  <Lock className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            onEnterPrivateSpace && (
              <button
                type="button"
                onClick={onEnterPrivateSpace}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
                title="进入独立私密空间 (Ctrl/Cmd + Shift + L)"
                aria-label="进入独立私密空间"
              >
                <Lock className="h-4 w-4" />
              </button>
            )
          )}
        </div>
      </div>

      {isDragging && (
        <div
          className="mt-4 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-xs font-medium"
          style={{
            borderColor: 'var(--accent-primary)',
            backgroundColor: 'var(--accent-soft)',
            color: 'var(--accent-primary)',
          }}
        >
          <Upload className="h-4 w-4" />
          <span>松开鼠标即可导入 TXT / Markdown / JSON 书籍</span>
        </div>
      )}

      {/* Primary Control Bar: Filters + Icon-Driven Search / Sort / Batch / Layout Switcher */}
      <section className="mt-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        {/* Category & Status Filter Tabs + Icon-Driven Category Creator */}
        <div className="flex flex-wrap items-center gap-1 overflow-x-auto pb-1 lg:pb-0">
          {[
            { id: 'all', label: `全部 (${books.length})` },
            { id: 'reading', label: '在读' },
            { id: 'favorites', label: '收藏' },
            ...categories.map((cat) => {
              const count = books.filter((b) => b.category === cat).length;
              return { id: cat, label: count > 0 ? `${cat} (${count})` : cat };
            }),
          ].map((tab) => {
            const active = activeFilter === tab.id;
            const isCustomCat =
              tab.id !== 'all' && tab.id !== 'reading' && tab.id !== 'favorites';
            const isEditingThisCat = isCustomCat && editingCategoryTag === tab.id;

            if (isEditingThisCat) {
              return (
                <div
                  key={tab.id}
                  className="flex h-8 items-center gap-1 rounded-lg px-1.5"
                  style={{
                    backgroundColor: 'var(--bg-page)',
                    border: '1px solid var(--accent-primary)',
                  }}
                >
                  <input
                    type="text"
                    autoFocus
                    value={editingCategoryValue}
                    onChange={(e) => setEditingCategoryValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirmRenameCategory(tab.id);
                      } else if (e.key === 'Escape') {
                        setEditingCategoryTag(null);
                        setEditingCategoryValue('');
                      }
                    }}
                    className="h-6 w-20 bg-transparent px-1 text-xs outline-none"
                    style={{ color: 'var(--text-primary)' }}
                    aria-label={`修改分类 ${tab.id}`}
                  />
                  <button
                    type="button"
                    onClick={() => handleConfirmRenameCategory(tab.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                    title="保存修改"
                    aria-label="保存分类修改"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCustomCategory(tab.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-red-500/10"
                    style={{ color: '#B44332' }}
                    title={`删除分类「${tab.id}」`}
                    aria-label={`删除分类 ${tab.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCategoryTag(null);
                      setEditingCategoryValue('');
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-80"
                    style={{ color: 'var(--text-muted)' }}
                    title="取消编辑"
                    aria-label="取消分类编辑"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            }

            return (
              <div key={tab.id} className="group/tab relative flex items-center">
                <button
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  onDoubleClick={() => {
                    if (isCustomCat) {
                      handleStartEditCategoryTag(tab.id);
                    }
                  }}
                  title={isCustomCat ? '单击筛选，双击修改或删除分类' : tab.label}
                  className="h-8 rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 select-none"
                  style={{
                    backgroundColor: active ? 'var(--bg-surface)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: active ? '1px solid var(--border-subtle)' : '1px solid transparent',
                  }}
                >
                  {tab.label}
                </button>
              </div>
            );
          })}

          {isAddingCategory ? (
            <form onSubmit={handleAddCustomCategory} className="flex items-center gap-1 pl-1">
              <input
                type="text"
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="新分类名…"
                className="h-8 w-24 rounded-lg px-2.5 text-xs outline-none"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--accent-primary)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="submit"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: 'var(--accent-primary)' }}
                title="确认新建分类"
                aria-label="确认新建分类"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingCategory(false);
                  setNewCategoryName('');
                }}
                className="flex h-8 w-7 items-center justify-center rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                title="取消"
                aria-label="取消"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsAddingCategory(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
              style={{
                color: 'var(--text-muted)',
                border: '1px dashed var(--border-subtle)',
              }}
              title="新建书籍分类"
              aria-label="新建书籍分类"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Right Controls: Search, Compact Sort, Icon Batch Button, Icon Layout Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-48 sm:flex-initial">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索书名或作者…"
              className="h-8 w-full rounded-lg pr-7 pl-8 text-xs outline-none"
              style={{
                backgroundColor: 'var(--bg-page)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded"
                style={{ color: 'var(--text-muted)' }}
                title="清空搜索"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div
            className="relative flex h-8 items-center rounded-lg px-2"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
            title="排序方式"
          >
            <ArrowUpDown
              className="pointer-events-none mr-1 h-3.5 w-3.5 shrink-0"
              style={{ color: 'var(--text-muted)' }}
            />
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'recent' | 'title' | 'progress' | 'length')
              }
              className="cursor-pointer bg-transparent text-xs outline-none"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="排序方式"
            >
              <option value="recent">最近阅读</option>
              <option value="progress">阅读进度</option>
              <option value="length">字数篇幅</option>
              <option value="title">书名排序</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setBatchMode((v) => !v);
              if (batchMode) setSelectedBookIds([]);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
            style={{
              backgroundColor: batchMode ? 'var(--accent-primary)' : 'var(--bg-page)',
              color: batchMode ? '#FFFFFF' : 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
            title={batchMode ? '退出批量管理' : '批量选择与分类管理'}
            aria-label={batchMode ? '退出批量管理' : '批量选择与分类管理'}
          >
            <CheckSquare className="h-4 w-4" />
          </button>

          {/* Pure Icon Segmented View Mode Switcher: 大图标 / 小图标 / 详细 */}
          <div
            className="flex items-center gap-0.5 rounded-lg p-0.5"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
            }}
            role="group"
            aria-label="书架布局切换"
          >
            {(
              [
                { id: 'large', label: '大图标视图', icon: LayoutGrid },
                { id: 'small', label: '小图标视图', icon: Grid3x3 },
                { id: 'detail', label: '详细列表视图', icon: List },
              ] as const
            ).map((mode) => {
              const Icon = mode.icon;
              const active = viewMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setViewMode(mode.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--bg-page)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  }}
                  title={mode.label}
                  aria-label={mode.label}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bookshelf Content Area */}
      <section className="mt-6">
        {filteredBooks.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded-xl py-16 text-center"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {isPrivateSpaceMode
                ? '私密空间暂无书籍，可点击下方按钮导入或在公开书架点击锁形图标移入'
                : '当前筛选下暂无书籍'}
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-white transition-transform active:scale-95"
              style={{ backgroundColor: 'var(--accent-primary)' }}
              title={isPrivateSpaceMode ? '导入加密书籍' : '导入本地书籍'}
              aria-label={isPrivateSpaceMode ? '导入加密书籍' : '导入本地书籍'}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : viewMode === 'large' ? (
          /* 1. 大图标视图 (Responsive Vertical Covers Grid with CSS Grid auto-fit) */
          <div
            className="grid gap-x-4 gap-y-7 sm:gap-x-6 sm:gap-y-8"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(clamp(130px, 20vw, 175px), 1fr))',
            }}
          >
            {filteredBooks.map((book) => {
              const progressPct = getBookProgressPct(book);
              const isSelectedForBatch = selectedBookIds.includes(book.id);

              return (
                <article
                  key={book.id}
                  onClick={() => {
                    if (batchMode) {
                      toggleSelectBookId(book.id);
                    } else {
                      onOpenBook(book.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setExportingBook(book);
                  }}
                  className="group relative flex min-w-0 cursor-pointer flex-col select-none touch-manipulation active:scale-[0.985] transition-transform duration-150"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <div
                    className="relative aspect-[3/4] w-full overflow-hidden rounded-r-xl rounded-l-[4px] transition-all duration-200 group-hover:-translate-y-1 shadow-xs"
                    style={{
                      outline:
                        batchMode && isSelectedForBatch
                          ? '2px solid var(--accent-primary)'
                          : 'none',
                      outlineOffset: '2px',
                    }}
                  >
                    <BookCoverArt
                      title={book.title}
                      author={book.author}
                      preset={book.coverPreset}
                      size="lg"
                      className="h-full w-full"
                    />

                    {/* Subtle bottom progress bar integrated into cover edge */}
                    <div
                      className="absolute right-0 bottom-0 left-0 h-1"
                      style={{ backgroundColor: 'rgba(0,0,0,0.22)' }}
                    >
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.max(progressPct, book.currentOffset > 0 ? 4 : 0)}%`,
                          backgroundColor: 'var(--accent-primary)',
                        }}
                      />
                    </div>

                    {/* Batch checkbox or Hover/Touch Quick Action Icon Dock */}
                    {batchMode ? (
                      <div
                        className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-md shadow-xs"
                        style={{
                          backgroundColor: isSelectedForBatch
                            ? 'var(--accent-primary)'
                            : 'var(--bg-page)',
                          color: isSelectedForBatch ? '#FFFFFF' : 'var(--text-muted)',
                        }}
                      >
                        {isSelectedForBatch ? (
                          <CheckSquare className="h-4 w-4" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </div>
                    ) : (
                      <div
                        className={`absolute top-1.5 right-1.5 flex max-w-[calc(100%-12px)] items-center justify-end gap-1 rounded-lg p-1 backdrop-blur-xs transition-opacity ${
                          confirmDeleteBookId === book.id ? 'flex-nowrap' : 'flex-wrap'
                        } ${
                          activeTouchMenuBookId === book.id || confirmDeleteBookId === book.id
                            ? 'opacity-100'
                            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
                        }`}
                        style={{
                          backgroundColor: 'rgba(251, 247, 240, 0.96)',
                          border: '1px solid var(--border-subtle)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {confirmDeleteBookId === book.id ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteBook(book.id, e)}
                              className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-md bg-[#B44332] px-2.5 text-xs font-medium text-white whitespace-nowrap shadow-xs transition-colors hover:bg-[#9E3828]"
                              title="再次点击确认永久移除"
                            >
                              <Trash2 className="h-3 w-3 shrink-0" />
                              <span>确认删除</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelDeleteBook}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5"
                              style={{ color: '#544032' }}
                              title="取消移除"
                              aria-label="取消移除"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            {onToggleBookPrivacy && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleBookPrivacy(book.id);
                                }}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:opacity-75"
                                style={{ color: '#2C1E16' }}
                                title={
                                  isPrivateSpaceMode
                                    ? '移出私密空间（解密还原至公开书架）'
                                    : '加密移入私密空间'
                                }
                              >
                                {isPrivateSpaceMode ? (
                                  <Unlock className="h-3.5 w-3.5" />
                                ) : (
                                  <Lock className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportingBook(book);
                              }}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:opacity-75"
                              style={{ color: '#2C1E16' }}
                              title="导出"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite(book.id);
                              }}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:opacity-75"
                              style={{
                                color: book.isFavorite ? '#B4532A' : '#544032',
                              }}
                              title="收藏"
                            >
                              <Heart
                                className="h-3.5 w-3.5"
                                fill={book.isFavorite ? 'currentColor' : 'none'}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openEditModal(book, e)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:opacity-75"
                              style={{ color: '#2C1E16' }}
                              title="编辑信息"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteBook(book.id, e)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors hover:text-red-600"
                              style={{ color: '#544032' }}
                              title="移除书籍"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Clean Unboxed Responsive Metadata */}
                  <div className="mt-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <h3
                        className="font-display truncate text-sm font-semibold leading-snug"
                        style={{ color: 'var(--text-primary)' }}
                        title={book.title}
                      >
                        {book.title}
                      </h3>
                      <div className="flex shrink-0 items-center gap-1">
                        {book.isFavorite && (
                          <Heart
                            className="h-3 w-3 shrink-0"
                            style={{ color: 'var(--accent-primary)' }}
                            fill="currentColor"
                          />
                        )}
                        {!batchMode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTouchMenuBookId((prev) =>
                                prev === book.id ? null : book.id
                              );
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded sm:opacity-60 hover:opacity-100"
                            style={{ color: 'var(--text-muted)' }}
                            title="展开快捷操作菜单"
                            aria-label="展开快捷操作菜单"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div
                      className="mt-1 flex items-center justify-between gap-1.5 text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <span className="truncate">{book.author}</span>
                        <span aria-hidden="true" className="shrink-0">
                          ·
                        </span>
                        <select
                          value={book.category}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleQuickAssignBookCategory(book, e.target.value);
                          }}
                          className="max-w-[68px] shrink-0 cursor-pointer truncate bg-transparent text-xs outline-none hover:underline"
                          style={{ color: 'var(--text-secondary)' }}
                          title="手工切换分类"
                        >
                          {categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isPrivateSpaceMode && onToggleBookPrivacy && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleBookPrivacy(book.id);
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:opacity-80"
                            style={{
                              backgroundColor: 'var(--accent-soft)',
                              color: 'var(--accent-primary)',
                            }}
                            title="转到公开书架（解密移出私密空间）"
                            aria-label="转到公开书架"
                          >
                            <Unlock className="h-3 w-3" />
                          </button>
                        )}
                        <span
                          className="font-mono-tabular shrink-0 text-[11px]"
                          style={{
                            color: progressPct > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
                          }}
                        >
                          {progressPct}%
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : viewMode === 'small' ? (
          /* 2. 小图标视图 (Dense & Compact CSS Grid auto-fit Book Grid) */
          <div
            className="grid gap-x-3 gap-y-5 sm:gap-x-4 sm:gap-y-6"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(clamp(88px, 14vw, 115px), 1fr))',
            }}
          >
            {filteredBooks.map((book) => {
              const progressPct = getBookProgressPct(book);
              const isSelectedForBatch = selectedBookIds.includes(book.id);

              return (
                <article
                  key={book.id}
                  onClick={() => {
                    if (batchMode) {
                      toggleSelectBookId(book.id);
                    } else {
                      onOpenBook(book.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setExportingBook(book);
                  }}
                  className="group relative flex min-w-0 cursor-pointer flex-col select-none touch-manipulation active:scale-[0.97] transition-transform duration-150"
                  style={{
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {/* Compact Cover with 3:4 Aspect Ratio */}
                  <div
                    className="relative aspect-[3/4] w-full overflow-hidden rounded-r-lg rounded-l-[3px] transition-all duration-200 group-hover:-translate-y-1 shadow-xs"
                    style={{
                      outline:
                        batchMode && isSelectedForBatch
                          ? '2px solid var(--accent-primary)'
                          : 'none',
                      outlineOffset: '2px',
                    }}
                  >
                    <BookCoverArt
                      title={book.title}
                      author={book.author}
                      preset={book.coverPreset}
                      size="sm"
                      className="h-full w-full"
                    />

                    {/* Integrated Slim Bottom Progress Line on Cover Edge */}
                    <div
                      className="absolute right-0 bottom-0 left-0 h-[2px]"
                      style={{ backgroundColor: 'rgba(0,0,0,0.22)' }}
                    >
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.max(progressPct, book.currentOffset > 0 ? 5 : 0)}%`,
                          backgroundColor: 'var(--accent-primary)',
                        }}
                      />
                    </div>

                    {/* Batch Selection Checkbox or Hover/Touch Action Dock */}
                    {batchMode ? (
                      <div
                        className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md shadow-xs"
                        style={{
                          backgroundColor: isSelectedForBatch
                            ? 'var(--accent-primary)'
                            : 'var(--bg-page)',
                          color: isSelectedForBatch ? '#FFFFFF' : 'var(--text-muted)',
                        }}
                      >
                        {isSelectedForBatch ? (
                          <CheckSquare className="h-3.5 w-3.5" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </div>
                    ) : (
                      <div
                        className={`absolute top-1 right-1 flex max-w-[calc(100%-8px)] items-center justify-end gap-0.5 rounded-md p-0.5 backdrop-blur-xs transition-opacity ${
                          confirmDeleteBookId === book.id ? 'flex-nowrap' : 'flex-wrap'
                        } ${
                          activeTouchMenuBookId === book.id || confirmDeleteBookId === book.id
                            ? 'opacity-100'
                            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
                        }`}
                        style={{
                          backgroundColor: 'rgba(251, 247, 240, 0.96)',
                          border: '1px solid var(--border-subtle)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {confirmDeleteBookId === book.id ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteBook(book.id, e)}
                              className="flex h-6 shrink-0 items-center justify-center rounded bg-[#B44332] px-1.5 text-[11px] font-medium text-white whitespace-nowrap shadow-xs transition-colors hover:bg-[#9E3828]"
                              title="再次点击确认永久移除"
                            >
                              <span>确认删除</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelDeleteBook}
                              className="flex h-6 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-black/5"
                              style={{ color: '#544032' }}
                              title="取消"
                              aria-label="取消"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </>
                        ) : (
                          <>
                            {onToggleBookPrivacy && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleBookPrivacy(book.id);
                                }}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:opacity-75"
                                style={{ color: '#2C1E16' }}
                                title={
                                  isPrivateSpaceMode
                                    ? '移出私密空间'
                                    : '加密移入私密空间'
                                }
                              >
                                {isPrivateSpaceMode ? (
                                  <Unlock className="h-3 w-3" />
                                ) : (
                                  <Lock className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite(book.id);
                              }}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:opacity-75"
                              style={{
                                color: book.isFavorite ? 'var(--accent-primary)' : '#544032',
                              }}
                              title="收藏"
                            >
                              <Heart
                                className="h-3 w-3"
                                fill={book.isFavorite ? 'currentColor' : 'none'}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportingBook(book);
                              }}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:opacity-75"
                              style={{ color: '#2C1E16' }}
                              title="导出"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openEditModal(book, e)}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:opacity-75"
                              style={{ color: '#2C1E16' }}
                              title="编辑"
                            >
                              <Edit3 className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteBook(book.id, e)}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:text-red-600"
                              style={{ color: '#544032' }}
                              title="移除书籍"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Compact Title & Metadata: Tightly paired with the cover */}
                  <div className="mt-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <h3
                        className="font-display line-clamp-2 text-xs font-semibold leading-snug tracking-tight"
                        style={{ color: 'var(--text-primary)' }}
                        title={book.title}
                      >
                        {book.title}
                      </h3>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {book.isFavorite && (
                          <Heart
                            className="mt-0.5 h-2.5 w-2.5 shrink-0"
                            style={{ color: 'var(--accent-primary)' }}
                            fill="currentColor"
                          />
                        )}
                        {!batchMode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTouchMenuBookId((prev) =>
                                prev === book.id ? null : book.id
                              );
                            }}
                            className="flex h-4 w-4 items-center justify-center rounded"
                            style={{ color: 'var(--text-muted)' }}
                            title="更多操作"
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div
                      className="mt-0.5 flex items-center justify-between gap-1 text-[10px] leading-tight"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span className="truncate" title={book.author}>
                        {book.author}
                      </span>
                      <span
                        className="font-mono-tabular shrink-0"
                        style={{
                          color: progressPct > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
                        }}
                      >
                        {progressPct}%
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* 3. 详细列表视图 (Responsive Detailed Structured Table / List View) */
          <div
            className="overflow-hidden rounded-xl border"
            style={{
              backgroundColor: 'var(--bg-page)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {/* Desktop Table Header */}
            <div
              className="hidden grid-cols-12 items-center gap-4 border-b px-4 py-2.5 text-[11px] font-medium md:grid"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-muted)',
              }}
            >
              <div className="col-span-4">书名 / 作者</div>
              <div className="col-span-2">分类 · 格式</div>
              <div className="col-span-2">篇幅 · 章节</div>
              <div className="col-span-2">阅读进度</div>
              <div className="col-span-2 text-right">操作</div>
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {filteredBooks.map((book) => {
                const progressPct = getBookProgressPct(book);
                const isSelectedForBatch = selectedBookIds.includes(book.id);
                const bookAnnsCount = annotations.filter((a) => a.bookId === book.id).length;

                return (
                  <div
                    key={book.id}
                    onClick={() => {
                      if (batchMode) {
                        toggleSelectBookId(book.id);
                      } else {
                        onOpenBook(book.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setExportingBook(book);
                    }}
                    className="group flex cursor-pointer flex-col gap-2.5 px-4 py-3 transition-colors hover:bg-black/[0.02] md:grid md:grid-cols-12 md:items-center md:gap-4"
                    style={{
                      backgroundColor:
                        batchMode && isSelectedForBatch ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    {/* Title, Cover Thumbnail & Author */}
                    <div className="flex min-w-0 items-center gap-3.5 md:col-span-4">
                      {batchMode && (
                        <span className="shrink-0" style={{ color: 'var(--accent-primary)' }}>
                          {isSelectedForBatch ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </span>
                      )}
                      <div className="h-14 w-10 shrink-0">
                        <BookCoverArt
                          title={book.title}
                          author={book.author}
                          preset={book.coverPreset}
                          size="xs"
                          className="h-full w-full"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3
                            className="font-display truncate text-sm font-semibold"
                            style={{ color: 'var(--text-primary)' }}
                            title={book.title}
                          >
                            {book.title}
                          </h3>
                          {book.isFavorite && (
                            <Heart
                              className="h-3 w-3 shrink-0"
                              style={{ color: 'var(--accent-primary)' }}
                              fill="currentColor"
                            />
                          )}
                        </div>
                        <div
                          className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <span className="truncate">{book.author}</span>
                          {/* Mobile-only compact metadata summary */}
                          <span className="flex items-center gap-1.5 md:hidden" style={{ color: 'var(--text-muted)' }}>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">
                              {(book.totalChars / 1000).toFixed(1)}k 字
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">{book.chapters.length} 章</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Desktop: Category & Format */}
                    <div
                      className="hidden items-center gap-1.5 text-xs md:col-span-2 md:flex"
                      style={{ color: 'var(--text-secondary)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <select
                        value={book.category}
                        onChange={(e) => handleQuickAssignBookCategory(book, e.target.value)}
                        className="max-w-[96px] cursor-pointer truncate rounded bg-transparent py-0.5 pr-1 text-xs font-medium outline-none hover:underline"
                        style={{ color: 'var(--text-secondary)' }}
                        title="点击手工调整书籍分类"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
                        ·
                      </span>
                      <span
                        className="font-mono-tabular uppercase"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {book.format}
                      </span>
                    </div>

                    {/* Desktop: Word Count & Chapters */}
                    <div
                      className="font-mono-tabular hidden items-center gap-1.5 text-xs md:col-span-2 md:flex"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <span>{(book.totalChars / 1000).toFixed(1)}k 字</span>
                      <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
                        ·
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {book.chapters.length} 章
                      </span>
                      {bookAnnsCount > 0 && (
                        <>
                          <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
                            ·
                          </span>
                          <span style={{ color: 'var(--accent-primary)' }}>
                            {bookAnnsCount} 批注
                          </span>
                        </>
                      )}
                    </div>

                    {/* Mobile + Desktop Bottom / Right Row: Category (Mobile) + Progress + Icon Actions */}
                    <div className="flex items-center justify-between gap-3 md:col-span-4 md:grid md:grid-cols-4 md:items-center md:gap-3">
                      {/* Mobile-only category selector */}
                      <div
                        className="flex items-center gap-1 text-xs md:hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={book.category}
                          onChange={(e) => handleQuickAssignBookCategory(book, e.target.value)}
                          className="cursor-pointer rounded bg-transparent py-0.5 text-xs font-medium outline-none"
                          style={{ color: 'var(--text-secondary)' }}
                          title="手工切换分类"
                        >
                          {categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Reading Progress */}
                      <div className="flex flex-1 items-center gap-2.5 md:col-span-2 md:pr-2">
                        <div
                          className="h-1.5 flex-1 overflow-hidden rounded-full"
                          style={{ backgroundColor: 'var(--bg-surface)' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(progressPct, book.currentOffset > 0 ? 4 : 0)}%`,
                              backgroundColor: 'var(--accent-primary)',
                            }}
                          />
                        </div>
                        <span
                          className="font-mono-tabular w-9 text-right text-xs"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {progressPct}%
                        </span>
                      </div>

                      {/* Icon Actions */}
                      <div
                        className="flex shrink-0 flex-nowrap items-center justify-end gap-1 md:col-span-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {confirmDeleteBookId === book.id ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteBook(book.id, e)}
                              className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-md bg-[#B44332] px-2.5 text-xs font-medium text-white whitespace-nowrap shadow-xs transition-colors hover:bg-[#9E3828]"
                              title="再次点击确认永久移除"
                            >
                              <Trash2 className="h-3 w-3 shrink-0" />
                              <span>确认删除</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelDeleteBook}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5"
                              style={{ color: 'var(--text-secondary)' }}
                              title="取消移除"
                              aria-label="取消移除"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            {onToggleBookPrivacy && (
                              <button
                                type="button"
                                onClick={() => onToggleBookPrivacy(book.id)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:opacity-80"
                                style={{ color: 'var(--text-muted)' }}
                                title={
                                  isPrivateSpaceMode
                                    ? '移出私密空间（解密还原至公开书架）'
                                    : '加密移入私密空间'
                                }
                              >
                                {isPrivateSpaceMode ? (
                                  <Unlock className="h-3.5 w-3.5" />
                                ) : (
                                  <Lock className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setExportingBook(book)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:opacity-80"
                              style={{ color: 'var(--text-muted)' }}
                              title="导出"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleFavorite(book.id)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:opacity-80"
                              style={{
                                color: book.isFavorite
                                  ? 'var(--accent-primary)'
                                  : 'var(--text-muted)',
                              }}
                              title="收藏"
                            >
                              <Heart
                                className="h-3.5 w-3.5"
                                fill={book.isFavorite ? 'currentColor' : 'none'}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => openEditModal(book, e)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:opacity-80"
                              style={{ color: 'var(--text-muted)' }}
                              title="编辑"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleRequestDeleteBook(book.id, e)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:text-red-600"
                              style={{ color: 'var(--text-muted)' }}
                              title="移除书籍"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Floating Multi-Book Batch Export & Categorization Bar (Icon-Driven) */}
      {batchMode && (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-2xl px-4 md:bottom-6">
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
            }}
          >
            <div className="flex items-center gap-2.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  if (selectedBookIds.length === filteredBooks.length) {
                    setSelectedBookIds([]);
                  } else {
                    setSelectedBookIds(filteredBooks.map((b) => b.id));
                  }
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title={selectedBookIds.length === filteredBooks.length ? '取消全选' : '全选当前'}
                aria-label={selectedBookIds.length === filteredBooks.length ? '取消全选' : '全选当前'}
              >
                {selectedBookIds.length === filteredBooks.length ? (
                  <CheckSquare className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                ) : (
                  <Square className="h-4 w-4" />
                )}
              </button>
              <span
                className="font-mono-tabular font-semibold"
                style={{ color: 'var(--accent-primary)' }}
              >
                已选 {selectedBookIds.length || filteredBooks.length} 册
              </span>
              {batchToast && (
                <span
                  className="flex items-center gap-1 font-medium"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  <Check className="h-3.5 w-3.5" />
                  {batchToast}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {/* Batch Manual Categorization Control */}
              <div
                className="flex h-8 items-center gap-1 rounded-xl px-2"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <Tag className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
                <select
                  value={batchTargetCategory}
                  onChange={(e) => setBatchTargetCategory(e.target.value)}
                  className="bg-transparent text-xs outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  title="选择目标分类"
                >
                  <option value="">移动至分类…</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!batchTargetCategory}
                  onClick={handleBatchAssignCategory}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-white disabled:opacity-40"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                  title="确认批量归类"
                  aria-label="确认批量归类"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>

              {(onBatchToggleBookPrivacy || onToggleBookPrivacy) && (
                <button
                  type="button"
                  onClick={() => {
                    const targetIds =
                      selectedBookIds.length > 0
                        ? selectedBookIds
                        : filteredBooks.map((b) => b.id);
                    if (targetIds.length === 0) return;
                    if (onBatchToggleBookPrivacy) {
                      onBatchToggleBookPrivacy(targetIds);
                    } else if (onToggleBookPrivacy) {
                      targetIds.forEach((id) => onToggleBookPrivacy(id));
                    }
                    setSelectedBookIds([]);
                    setBatchMode(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
                  style={{
                    backgroundColor: 'var(--accent-soft)',
                    border: '1px solid var(--accent-primary)',
                    color: 'var(--accent-primary)',
                  }}
                  title={
                    isPrivateSpaceMode
                      ? '将所选书籍解密转到公开书架'
                      : '将所选书籍加密移入私密空间'
                  }
                  aria-label={
                    isPrivateSpaceMode
                      ? '将所选书籍解密转到公开书架'
                      : '将所选书籍加密移入私密空间'
                  }
                >
                  {isPrivateSpaceMode ? (
                    <Unlock className="h-4 w-4" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => handleBatchExport('md')}
                className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="合并导出 Markdown 合集 (.md)"
                aria-label="导出 Markdown 合集"
              >
                <Hash className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
              </button>
              <button
                type="button"
                onClick={() => handleBatchExport('epub')}
                className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="批量打包 EPUB 电子书 (.epub)"
                aria-label="导出 EPUB 电子书"
              >
                <BookOpen className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
              </button>
              <button
                type="button"
                onClick={() => handleBatchExport('csv')}
                className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
                title="导出 CSV 结构化统计报表 (.csv)"
                aria-label="导出 CSV 报表"
              >
                <FileSpreadsheet
                  className="h-4 w-4"
                  style={{ color: 'var(--accent-primary)' }}
                />
              </button>
              <button
                type="button"
                onClick={() => handleBatchExport('json')}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-white transition-colors"
                style={{ backgroundColor: 'var(--accent-primary)' }}
                title="导出 JSON 结构化归档 (.json)"
                aria-label="导出 JSON 归档"
              >
                <FileCode className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Book Export Studio Modal */}
      {exportingBook && (
        <ExportStudioModal
          isOpen={Boolean(exportingBook)}
          onClose={() => setExportingBook(null)}
          book={exportingBook}
          allBooks={books}
          annotations={annotations}
          dailyStats={dailyStats}
        />
      )}

      {editingBook && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          onClick={() => setEditingBook(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5 shadow-xl"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">编辑书籍信息</span>
              <button
                type="button"
                onClick={() => setEditingBook(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ color: 'var(--text-muted)' }}
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-3 space-y-3">
              <input
                type="text"
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="书名"
                className="h-9 w-full rounded-xl px-3 text-sm outline-none"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />

              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                  placeholder="作者"
                  className="h-9 w-full rounded-xl px-3 text-sm outline-none"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
                <input
                  type="text"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  placeholder="输入或选择分类"
                  className="h-9 w-full rounded-xl px-3 text-sm outline-none"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              {/* Quick Category Selection Buttons (Double-click to edit or delete) */}
              {categories.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    归类：
                  </span>
                  {categories.map((cat) => {
                    const active = editCategory.trim() === cat;
                    const isEditingThisCat = editingCategoryTag === cat;

                    if (isEditingThisCat) {
                      return (
                        <div
                          key={cat}
                          className="flex h-6 items-center gap-0.5 rounded-lg px-1"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--accent-primary)',
                          }}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={editingCategoryValue}
                            onChange={(e) => setEditingCategoryValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleConfirmRenameCategory(cat);
                              } else if (e.key === 'Escape') {
                                setEditingCategoryTag(null);
                                setEditingCategoryValue('');
                              }
                            }}
                            className="h-5 w-16 bg-transparent px-1 text-[11px] outline-none"
                            style={{ color: 'var(--text-primary)' }}
                            aria-label={`修改分类 ${cat}`}
                          />
                          <button
                            type="button"
                            onClick={() => handleConfirmRenameCategory(cat)}
                            className="flex h-5 w-5 items-center justify-center rounded text-white"
                            style={{ backgroundColor: 'var(--accent-primary)' }}
                            title="保存分类修改"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomCategory(cat)}
                            className="flex h-5 w-5 items-center justify-center rounded"
                            style={{ color: '#B44332' }}
                            title={`删除分类「${cat}」`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCategoryTag(null);
                              setEditingCategoryValue('');
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded"
                            style={{ color: 'var(--text-muted)' }}
                            title="取消"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setEditCategory(cat)}
                        onDoubleClick={() => handleStartEditCategoryTag(cat)}
                        title="单击选择，双击修改或删除该分类"
                        className="rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors select-none"
                        style={{
                          backgroundColor: active ? 'var(--accent-primary)' : 'var(--bg-surface)',
                          color: active ? '#FFFFFF' : 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                {COVER_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setEditPreset(p.value)}
                    className="flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px]"
                    style={{
                      backgroundColor:
                        editPreset === p.value ? 'var(--bg-surface)' : 'transparent',
                      border:
                        editPreset === p.value
                          ? '1px solid var(--accent-primary)'
                          : '1px solid var(--border-subtle)',
                    }}
                    title={`${p.label}封面`}
                  >
                    <span
                      className="h-4 w-4 rounded-full"
                      style={{ backgroundColor: p.hex }}
                    />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                {onToggleBookPrivacy ? (
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = editingBook.id;
                      setEditingBook(null);
                      onToggleBookPrivacy(targetId);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--accent-primary)',
                    }}
                    title={
                      isPrivateSpaceMode
                        ? '转到公开书架（解密还原）'
                        : '加密移入私密空间'
                    }
                    aria-label={
                      isPrivateSpaceMode
                        ? '转到公开书架'
                        : '加密移入私密空间'
                    }
                  >
                    {isPrivateSpaceMode ? (
                      <Unlock className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                  title="保存修改"
                  aria-label="保存修改"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
