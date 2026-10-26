/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Coffee,
  Download,
  Feather,
  Flame,
  Library,
  Lock,
  Moon,
  Sliders,
  Sparkles,
  Sun,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import {
  Annotation,
  Book,
  BookFormat,
  CoverPreset,
  CustomFont,
  ReaderSettings,
  ReadingStatsDaily,
  VaultConfig,
} from './types/reader';
import {
  decodeFileBuffer,
  extractChapters,
  validateBackupJson,
} from './core/parserEngine';
import {
  DEFAULT_READER_SETTINGS,
  initializeLibraryStorage,
  recordReadingProgressDelta,
  removeAnnotation,
  removeBook,
  removeCustomFont,
  restoreFullLibraryBackup,
  saveAnnotation,
  saveBook,
  saveCustomFont,
  saveReaderSettings,
} from './core/storageEngine';
import {
  clearVaultSessionAuthorization,
  decryptAnnotationInMemory,
  decryptBookInMemory,
  encryptAnnotationForStorage,
  encryptBookForStorage,
  initializeVaultMasterPassword,
  loadVaultConfig,
  saveVaultConfig,
  stripAnnotationEncryptionToPublic,
  stripBookEncryptionToPublic,
  verifyVaultMasterPassword,
  warmUpVaultKey,
} from './core/cryptoEngine';
import { BookshelfView } from './components/BookshelfView';
import { ReaderView } from './components/ReaderView';
import { StatsView } from './components/StatsView';
import { TypographyDataView } from './components/TypographyDataView';
import {
  PrivacyShieldOverlay,
  VaultModalMode,
  VaultPasswordModal,
} from './components/VaultModals';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';

type AppTab = 'shelf' | 'reader' | 'stats' | 'studio';

const COVER_ROTATION: CoverPreset[] = [
  'terracotta',
  'walnut',
  'espresso',
  'matcha',
  'parchment',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('shelf');
  // Raw books & annotations from IndexedDB (private items remain encrypted in this array)
  const [books, setBooks] = useState<Book[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [dailyStats, setDailyStats] = useState<ReadingStatsDaily[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showIOSInstallModal, setShowIOSInstallModal] = useState(false);

  // Private Vault & Session Memory State (CryptoKey and decrypted maps live purely in RAM)
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(() => loadVaultConfig());
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);
  const [isPrivateSpaceMode, setIsPrivateSpaceMode] = useState(false);
  const [decryptedBooksMap, setDecryptedBooksMap] = useState<Record<string, Book>>({});
  const [decryptedAnnsMap, setDecryptedAnnsMap] = useState<Record<string, Annotation>>({});

  // Vault Modal & Pending Action State
  const [vaultModalOpen, setVaultModalOpen] = useState(false);
  const [vaultModalMode, setVaultModalMode] = useState<VaultModalMode>('unlock');
  const [pendingBookIdsToEncrypt, setPendingBookIdsToEncrypt] = useState<string[]>([]);
  const [pendingEnterPrivateSpace, setPendingEnterPrivateSpace] = useState(false);

  // Window Blur & Auto-Lock Privacy Shield State
  const [isWindowBlurred, setIsWindowBlurred] = useState(false);
  const [isShieldLockedInPlace, setIsShieldLockedInPlace] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const isFileDialogOpenRef = useRef(false);
  const fileDialogTimerRef = useRef<number | null>(null);

  const markFileDialogOpen = useCallback(() => {
    isFileDialogOpenRef.current = true;
    setIsWindowBlurred(false);
    if (fileDialogTimerRef.current) {
      clearTimeout(fileDialogTimerRef.current);
    }
    // Safety fallback: auto-clear after 90 seconds if OS file picker is cancelled without events
    fileDialogTimerRef.current = window.setTimeout(() => {
      isFileDialogOpenRef.current = false;
    }, 90000);
  }, []);

  const markFileDialogClosed = useCallback(() => {
    isFileDialogOpenRef.current = false;
    setIsWindowBlurred(false);
    if (fileDialogTimerRef.current) {
      clearTimeout(fileDialogTimerRef.current);
      fileDialogTimerRef.current = null;
    }
  }, []);

  const globalFileInputRef = useRef<HTMLInputElement>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();

  const showNotice = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Helper: Decrypt all private books and annotations in parallel into session memory
  const hydratePrivateVaultIntoMemory = useCallback(
    async (key: CryptoKey, rawBooks: Book[], rawAnnotations: Annotation[]) => {
      const t0 = performance.now();
      const privateBooks = rawBooks.filter((b) => b.isPrivate);
      const privateAnns = rawAnnotations.filter((a) => a.isPrivate);

      const [decBooks, decAnns] = await Promise.all([
        Promise.all(
          privateBooks.map((b) => decryptBookInMemory(b, key).catch(() => b))
        ),
        Promise.all(
          privateAnns.map((a) => decryptAnnotationInMemory(a, key).catch(() => a))
        ),
      ]);

      const nextBooksMap: Record<string, Book> = {};
      decBooks.forEach((b) => {
        nextBooksMap[b.id] = b;
      });

      const nextAnnsMap: Record<string, Annotation> = {};
      decAnns.forEach((a) => {
        nextAnnsMap[a.id] = a;
      });

      vaultKeyRef.current = key;
      setDecryptedBooksMap(nextBooksMap);
      setDecryptedAnnsMap(nextAnnsMap);
      setIsVaultUnlocked(true);
      setIsShieldLockedInPlace(false);
      setIsWindowBlurred(false);
      lastActivityRef.current = Date.now();

      const elapsedMs = Math.max(1, Math.round(performance.now() - t0));
      return { elapsedMs, count: decBooks.length };
    },
    []
  );

  useEffect(() => {
    initializeLibraryStorage().then((data) => {
      setBooks(data.books);
      setAnnotations(data.annotations);
      setCustomFonts(data.customFonts);
      setDailyStats(data.dailyStats);
      setSettings(data.settings);
      const firstPublic = data.books.find((b) => !b.isPrivate);
      if (firstPublic) {
        setActiveBookId(firstPublic.id);
      }
      setIsLoaded(true);

      // Background Argon2id key warm-up for instant 0ms Private Space rendering if session authorized
      warmUpVaultKey().then((warmedKey) => {
        if (warmedKey) {
          hydratePrivateVaultIntoMemory(warmedKey, data.books, data.annotations);
        }
      });
    });
  }, [hydratePrivateVaultIntoMemory]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Immediately wipe in-memory key and plaintext maps
  const wipeSessionMemoryAndLock = useCallback(
    (exitToPublicShelf: boolean) => {
      vaultKeyRef.current = null;
      clearVaultSessionAuthorization();
      setIsVaultUnlocked(false);
      setDecryptedBooksMap({});
      setDecryptedAnnsMap({});
      setIsWindowBlurred(false);

      if (exitToPublicShelf) {
        setIsShieldLockedInPlace(false);
        setIsPrivateSpaceMode(false);
        setActiveTab('shelf');
        const firstPublic = books.find((b) => !b.isPrivate);
        setActiveBookId(firstPublic?.id || null);
      } else {
        setIsShieldLockedInPlace(true);
      }
    },
    [books]
  );

  const handleLockVaultAndExit = useCallback(() => {
    wipeSessionMemoryAndLock(true);
    showNotice('私密空间已安全锁定');
  }, [wipeSessionMemoryAndLock, showNotice]);

  // Derived lists for Public vs Private Space
  const publicBooks = useMemo(() => books.filter((b) => !b.isPrivate), [books]);
  const publicAnnotations = useMemo(
    () => annotations.filter((a) => !a.isPrivate),
    [annotations]
  );

  const unlockedPrivateBooks = useMemo(() => {
    if (!isVaultUnlocked) return [];
    return books
      .filter((b) => b.isPrivate)
      .map((b) => decryptedBooksMap[b.id] || b)
      .sort((a, b) => b.lastReadAt - a.lastReadAt);
  }, [books, isVaultUnlocked, decryptedBooksMap]);

  const unlockedPrivateAnnotations = useMemo(() => {
    if (!isVaultUnlocked) return [];
    return annotations
      .filter((a) => a.isPrivate)
      .map((a) => decryptedAnnsMap[a.id] || a);
  }, [annotations, isVaultUnlocked, decryptedAnnsMap]);

  // Active book resolution (supports both public and unlocked private books)
  const activeBook = useMemo(() => {
    if (!activeBookId) return publicBooks[0] || null;
    const raw = books.find((b) => b.id === activeBookId);
    if (!raw) return publicBooks[0] || null;
    if (raw.isPrivate) {
      return isVaultUnlocked ? decryptedBooksMap[raw.id] || null : raw;
    }
    return raw;
  }, [activeBookId, books, publicBooks, isVaultUnlocked, decryptedBooksMap]);

  // Check if user is currently inside a sensitive private context
  const isPrivateContextActive =
    isPrivateSpaceMode || Boolean(activeTab === 'reader' && activeBook?.isPrivate);

  // Window Blur / Tab Visibility / Idle Auto-Lock Protection
  useEffect(() => {
    if (!isPrivateContextActive) {
      setIsWindowBlurred(false);
      setIsShieldLockedInPlace(false);
      return;
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // If native OS file chooser is active, do not lock or blur!
        if (isFileDialogOpenRef.current) {
          return;
        }
        if (vaultConfig?.lockOnTabHidden ?? true) {
          wipeSessionMemoryAndLock(false);
        } else if (vaultConfig?.blurOnWindowBlur ?? true) {
          setIsWindowBlurred(true);
        }
      }
    };

    const handleWindowBlur = () => {
      // If user opened native file chooser dialog, window loses focus legitimately - ignore blur!
      if (isFileDialogOpenRef.current) {
        return;
      }
      if (vaultConfig?.blurOnWindowBlur ?? true) {
        setIsWindowBlurred(true);
      }
    };

    const handleWindowFocus = () => {
      lastActivityRef.current = Date.now();
      if (isFileDialogOpenRef.current) {
        // Small delay allowing input change/cancel events to fire before releasing file dialog immunity
        setTimeout(() => {
          markFileDialogClosed();
        }, 500);
      }
    };

    const recordUserActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const handleFileInputClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        (target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'file') ||
        target?.closest('button[title*="导入"]') ||
        target?.closest('button[aria-label*="导入"]')
      ) {
        markFileDialogOpen();
      }
    };

    const handleFileInputFinished = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'file') {
        markFileDialogClosed();
      }
    };

    document.addEventListener('click', handleFileInputClick, true);
    document.addEventListener('change', handleFileInputFinished, true);
    document.addEventListener('cancel', handleFileInputFinished, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('mousemove', recordUserActivity, { passive: true });
    window.addEventListener('keydown', recordUserActivity, { passive: true });
    window.addEventListener('touchstart', recordUserActivity, { passive: true });
    window.addEventListener('wheel', recordUserActivity, { passive: true });

    const idleMinutes = vaultConfig?.autoLockMinutes ?? 5;
    const idleCheckTimer = setInterval(() => {
      if (!vaultKeyRef.current || idleMinutes <= 0 || isFileDialogOpenRef.current) return;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= idleMinutes * 60 * 1000) {
        wipeSessionMemoryAndLock(false);
      }
    }, 5000);

    return () => {
      document.removeEventListener('click', handleFileInputClick, true);
      document.removeEventListener('change', handleFileInputFinished, true);
      document.removeEventListener('cancel', handleFileInputFinished, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('mousemove', recordUserActivity);
      window.removeEventListener('keydown', recordUserActivity);
      window.removeEventListener('touchstart', recordUserActivity);
      window.removeEventListener('wheel', recordUserActivity);
      clearInterval(idleCheckTimer);
    };
  }, [
    isPrivateContextActive,
    vaultConfig,
    wipeSessionMemoryAndLock,
    markFileDialogOpen,
    markFileDialogClosed,
  ]);

  // Encrypt a public book and move it into the Private Vault
  const executeEncryptBookToVault = useCallback(
    async (bookId: string, key: CryptoKey) => {
      const target = books.find((b) => b.id === bookId);
      if (!target || target.isPrivate) return;

      const plaintextBook: Book = { ...target, isPrivate: true };
      const encryptedBook = await encryptBookForStorage(plaintextBook, key);
      await saveBook(encryptedBook);

      const targetAnns = annotations.filter((a) => a.bookId === bookId);
      const encryptedAnns: Annotation[] = [];
      const decryptedAnnsForMap: Record<string, Annotation> = {};

      for (const ann of targetAnns) {
        const plainAnn: Annotation = { ...ann, isPrivate: true };
        decryptedAnnsForMap[ann.id] = plainAnn;
        const encAnn = await encryptAnnotationForStorage(plainAnn, key);
        await saveAnnotation(encAnn);
        encryptedAnns.push(encAnn);
      }

      setBooks((prev) => prev.map((b) => (b.id === bookId ? encryptedBook : b)));
      setAnnotations((prev) =>
        prev.map((a) => {
          const match = encryptedAnns.find((ea) => ea.id === a.id);
          return match || a;
        })
      );

      setDecryptedBooksMap((prev) => ({ ...prev, [bookId]: plaintextBook }));
      setDecryptedAnnsMap((prev) => ({ ...prev, ...decryptedAnnsForMap }));

      if (activeBookId === bookId && !isPrivateSpaceMode) {
        const nextPublic = books.find((b) => !b.isPrivate && b.id !== bookId);
        setActiveBookId(nextPublic?.id || null);
      }

      showNotice(`《${target.title}》已使用 AES-256-GCM 加密移入私密空间`);
    },
    [books, annotations, activeBookId, isPrivateSpaceMode, showNotice]
  );

  // Automatically keep decryptedBooksMap and decryptedAnnsMap in sync when vault is unlocked
  useEffect(() => {
    if (!isVaultUnlocked || !vaultKeyRef.current) return;
    const key = vaultKeyRef.current;
    const missingBooks = books.filter(
      (b) => b.isPrivate && b.encryptedPayload && !decryptedBooksMap[b.id]
    );
    const missingAnns = annotations.filter(
      (a) => a.isPrivate && a.encryptedPayload && !decryptedAnnsMap[a.id]
    );
    if (missingBooks.length === 0 && missingAnns.length === 0) return;

    Promise.all([
      Promise.all(missingBooks.map((b) => decryptBookInMemory(b, key).catch(() => b))),
      Promise.all(missingAnns.map((a) => decryptAnnotationInMemory(a, key).catch(() => a))),
    ]).then(([decBooks, decAnns]) => {
      if (decBooks.length > 0) {
        setDecryptedBooksMap((prev) => {
          const next = { ...prev };
          decBooks.forEach((db) => {
            next[db.id] = db;
          });
          return next;
        });
      }
      if (decAnns.length > 0) {
        setDecryptedAnnsMap((prev) => {
          const next = { ...prev };
          decAnns.forEach((da) => {
            next[da.id] = da;
          });
          return next;
        });
      }
    });
  }, [books, annotations, isVaultUnlocked, decryptedBooksMap, decryptedAnnsMap]);

  // Decrypt one or multiple private books and restore them to the Public Bookshelf
  const executeDecryptBooksToPublic = useCallback(
    async (bookIds: string[]) => {
      if (bookIds.length === 0) return;
      const key = vaultKeyRef.current || (await warmUpVaultKey());
      const restoredBooksMap: Record<string, Book> = {};
      const restoredAnnsMap: Record<string, Annotation> = {};
      const restoredTitles: string[] = [];

      for (const bookId of bookIds) {
        const rawBook = books.find((b) => b.id === bookId);
        let decrypted: Book | undefined = decryptedBooksMap[bookId];

        if ((!decrypted || (!decrypted.content && rawBook?.encryptedPayload)) && rawBook) {
          if (rawBook.encryptedPayload && key) {
            try {
              decrypted = await decryptBookInMemory(rawBook, key);
            } catch {
              decrypted = undefined;
            }
          } else if (!rawBook.encryptedPayload) {
            decrypted = rawBook;
          }
        }

        if (!decrypted) continue;

        const publicBook = stripBookEncryptionToPublic(decrypted);
        if (!publicBook.chapters || publicBook.chapters.length === 0) {
          publicBook.chapters = extractChapters(publicBook.content, publicBook.format);
        }
        publicBook.totalChars = publicBook.content.length;

        await saveBook(publicBook);
        restoredBooksMap[bookId] = publicBook;
        restoredTitles.push(publicBook.title);

        const targetAnns = annotations.filter((a) => a.bookId === bookId);
        for (const rawAnn of targetAnns) {
          let plainAnn = decryptedAnnsMap[rawAnn.id] || rawAnn;
          if (!plainAnn.selectedText && rawAnn.encryptedPayload && key) {
            try {
              plainAnn = await decryptAnnotationInMemory(rawAnn, key);
            } catch {
              // ignore
            }
          }
          const pubAnn = stripAnnotationEncryptionToPublic(plainAnn);
          await saveAnnotation(pubAnn);
          restoredAnnsMap[pubAnn.id] = pubAnn;
        }
      }

      const restoredIds = Object.keys(restoredBooksMap);
      if (restoredIds.length === 0) return;

      setBooks((prev) => prev.map((b) => restoredBooksMap[b.id] || b));
      setAnnotations((prev) => prev.map((a) => restoredAnnsMap[a.id] || a));
      setDecryptedBooksMap((prev) => {
        const next = { ...prev };
        restoredIds.forEach((id) => delete next[id]);
        return next;
      });
      setDecryptedAnnsMap((prev) => {
        const next = { ...prev };
        Object.keys(restoredAnnsMap).forEach((id) => delete next[id]);
        return next;
      });

      setActiveBookId(restoredIds[0]);

      if (restoredTitles.length === 1) {
        showNotice(`《${restoredTitles[0]}》已解密转到公开书架`);
      } else {
        showNotice(`已将 ${restoredTitles.length} 册书籍解密转到公开书架`);
      }
    },
    [books, annotations, decryptedBooksMap, decryptedAnnsMap, showNotice]
  );

  const handleToggleBookPrivacy = useCallback(
    (bookId: string) => {
      const target = books.find((b) => b.id === bookId);
      if (!target) return;

      if (target.isPrivate) {
        // Restore from Private Space to Public Shelf
        executeDecryptBooksToPublic([bookId]);
        return;
      }

      // Moving from Public Shelf to Private Space
      if (!vaultConfig?.isInitialized) {
        setPendingBookIdsToEncrypt([bookId]);
        setPendingEnterPrivateSpace(false);
        setVaultModalMode('setup');
        setVaultModalOpen(true);
        return;
      }

      if (vaultKeyRef.current && isVaultUnlocked) {
        executeEncryptBookToVault(bookId, vaultKeyRef.current);
      } else {
        setPendingBookIdsToEncrypt([bookId]);
        setPendingEnterPrivateSpace(false);
        setVaultModalMode('unlock');
        setVaultModalOpen(true);
      }
    },
    [
      books,
      vaultConfig,
      isVaultUnlocked,
      executeDecryptBooksToPublic,
      executeEncryptBookToVault,
    ]
  );

  const handleBatchToggleBookPrivacy = useCallback(
    async (bookIds: string[]) => {
      if (bookIds.length === 0) return;
      if (isPrivateSpaceMode) {
        await executeDecryptBooksToPublic(bookIds);
        return;
      }

      // Batch encrypt public books into Private Space
      if (!vaultConfig?.isInitialized) {
        setPendingBookIdsToEncrypt(bookIds);
        setPendingEnterPrivateSpace(false);
        setVaultModalMode('setup');
        setVaultModalOpen(true);
        return;
      }

      const key = vaultKeyRef.current || (await warmUpVaultKey());
      if (key && isVaultUnlocked) {
        for (const id of bookIds) {
          await executeEncryptBookToVault(id, key);
        }
      } else {
        setPendingBookIdsToEncrypt(bookIds);
        setPendingEnterPrivateSpace(false);
        setVaultModalMode('unlock');
        setVaultModalOpen(true);
      }
    },
    [
      isPrivateSpaceMode,
      vaultConfig,
      isVaultUnlocked,
      executeDecryptBooksToPublic,
      executeEncryptBookToVault,
    ]
  );

  const handleEnterPrivateSpace = useCallback(() => {
    if (!vaultConfig?.isInitialized) {
      setPendingEnterPrivateSpace(true);
      setPendingBookIdsToEncrypt([]);
      setVaultModalMode('setup');
      setVaultModalOpen(true);
      return;
    }

    // Session Memory Zero-Latency Open: if already unlocked in RAM, switch in 0ms
    if (vaultKeyRef.current && isVaultUnlocked) {
      setIsPrivateSpaceMode(true);
      setActiveTab('shelf');
      return;
    }

    setPendingEnterPrivateSpace(true);
    setPendingBookIdsToEncrypt([]);
    setVaultModalMode('unlock');
    setVaultModalOpen(true);
  }, [vaultConfig, isVaultUnlocked]);

  // Global keyboard shortcut: Ctrl/Cmd + Shift + L to toggle Private Space / Instant Lock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (isPrivateSpaceMode || (activeTab === 'reader' && activeBook?.isPrivate)) {
          handleLockVaultAndExit();
        } else {
          handleEnterPrivateSpace();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isPrivateSpaceMode,
    activeTab,
    activeBook?.isPrivate,
    handleLockVaultAndExit,
    handleEnterPrivateSpace,
  ]);

  const handleSetupMasterPassword = useCallback(
    async (
      password: string,
      hint: string,
      policy: {
        autoLockMinutes: number;
        lockOnTabHidden: boolean;
        blurOnWindowBlur: boolean;
      }
    ) => {
      const { config, key } = await initializeVaultMasterPassword(password, hint, policy);
      setVaultConfig(config);
      await hydratePrivateVaultIntoMemory(key, books, annotations);
      setVaultModalOpen(false);

      if (pendingBookIdsToEncrypt.length > 0) {
        for (const id of pendingBookIdsToEncrypt) {
          await executeEncryptBookToVault(id, key);
        }
        setPendingBookIdsToEncrypt([]);
      }
      if (pendingEnterPrivateSpace) {
        setIsPrivateSpaceMode(true);
        setActiveTab('shelf');
        setPendingEnterPrivateSpace(false);
        showNotice('私密空间已启用');
      }
    },
    [
      books,
      annotations,
      hydratePrivateVaultIntoMemory,
      pendingBookIdsToEncrypt,
      pendingEnterPrivateSpace,
      executeEncryptBookToVault,
      showNotice,
    ]
  );

  const handleUnlockVault = useCallback(
    async (password: string): Promise<boolean> => {
      if (!vaultConfig) return false;
      const key = await verifyVaultMasterPassword(password, vaultConfig);
      if (!key) return false;

      const { elapsedMs } = await hydratePrivateVaultIntoMemory(key, books, annotations);
      setVaultModalOpen(false);

      if (pendingBookIdsToEncrypt.length > 0) {
        for (const id of pendingBookIdsToEncrypt) {
          await executeEncryptBookToVault(id, key);
        }
        setPendingBookIdsToEncrypt([]);
      }
      if (pendingEnterPrivateSpace) {
        setIsPrivateSpaceMode(true);
        setActiveTab('shelf');
        setPendingEnterPrivateSpace(false);
        showNotice(`私密空间已解锁（${elapsedMs}ms）`);
      }
      return true;
    },
    [
      vaultConfig,
      books,
      annotations,
      hydratePrivateVaultIntoMemory,
      pendingBookIdsToEncrypt,
      pendingEnterPrivateSpace,
      executeEncryptBookToVault,
      showNotice,
    ]
  );

  const handleUpdateVaultSettings = useCallback(
    async (
      policy: {
        autoLockMinutes: number;
        lockOnTabHidden: boolean;
        blurOnWindowBlur: boolean;
      },
      passwordChange?: {
        currentPassword: string;
        newPassword: string;
        newHint: string;
      }
    ): Promise<{ ok: boolean; message?: string }> => {
      if (!vaultConfig) return { ok: false, message: '私密空间尚未初始化' };

      if (passwordChange) {
        const verifiedOldKey = await verifyVaultMasterPassword(
          passwordChange.currentPassword,
          vaultConfig
        );
        if (!verifiedOldKey) {
          return { ok: false, message: '当前主密码验证失败' };
        }

        const { config: newConfig, key: newKey } = await initializeVaultMasterPassword(
          passwordChange.newPassword,
          passwordChange.newHint,
          policy
        );

        // Re-encrypt all private books and annotations with the new key
        const updatedBooks: Book[] = [];
        for (const b of books) {
          if (b.isPrivate) {
            const plainBook =
              decryptedBooksMap[b.id] || (await decryptBookInMemory(b, verifiedOldKey));
            const reEnc = await encryptBookForStorage(plainBook, newKey);
            await saveBook(reEnc);
            updatedBooks.push(reEnc);
          } else {
            updatedBooks.push(b);
          }
        }

        const updatedAnns: Annotation[] = [];
        for (const a of annotations) {
          if (a.isPrivate) {
            const plainAnn =
              decryptedAnnsMap[a.id] || (await decryptAnnotationInMemory(a, verifiedOldKey));
            const reEnc = await encryptAnnotationForStorage(plainAnn, newKey);
            await saveAnnotation(reEnc);
            updatedAnns.push(reEnc);
          } else {
            updatedAnns.push(a);
          }
        }

        vaultKeyRef.current = newKey;
        setVaultConfig(newConfig);
        setBooks(updatedBooks);
        setAnnotations(updatedAnns);
        showNotice('主密码已更新并完成全量重加密');
        return { ok: true };
      }

      const updatedConfig: VaultConfig = {
        ...vaultConfig,
        ...policy,
        updatedAt: Date.now(),
      };
      saveVaultConfig(updatedConfig);
      setVaultConfig(updatedConfig);
      showNotice('安全策略已保存');
      return { ok: true };
    },
    [vaultConfig, books, annotations, decryptedBooksMap, decryptedAnnsMap, showNotice]
  );

  const handleUpdateSettings = useCallback((partial: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveReaderSettings(next);
      return next;
    });
  }, []);

  const handleOpenBook = useCallback(
    (bookId: string) => {
      const now = Date.now();
      setActiveBookId(bookId);
      setActiveTab('reader');

      const target = books.find((b) => b.id === bookId);
      if (target?.isPrivate && vaultKeyRef.current) {
        const plain = decryptedBooksMap[bookId];
        if (plain) {
          const updatedPlain = { ...plain, lastReadAt: now };
          setDecryptedBooksMap((prev) => ({ ...prev, [bookId]: updatedPlain }));
          encryptBookForStorage(updatedPlain, vaultKeyRef.current).then((enc) => {
            saveBook(enc);
            setBooks((prev) => prev.map((b) => (b.id === bookId ? enc : b)));
          });
        }
        return;
      }

      setBooks((prev) =>
        prev.map((b) => {
          if (b.id !== bookId) return b;
          const updated = { ...b, lastReadAt: now };
          saveBook(updated);
          return updated;
        })
      );
    },
    [books, decryptedBooksMap]
  );

  const handleUpdateBookOffset = useCallback(
    async (bookId: string, newOffset: number, secondsDelta = 0, charsDelta = 0) => {
      const now = Date.now();
      const target = books.find((b) => b.id === bookId);

      if (target?.isPrivate) {
        // Zero-latency in-memory state update for 60fps reading
        setDecryptedBooksMap((prev) => {
          const currentPlain = prev[bookId];
          if (!currentPlain) return prev;
          const updatedPlain: Book = {
            ...currentPlain,
            currentOffset: Math.max(0, Math.min(currentPlain.totalChars, newOffset)),
            lastReadAt: now,
            readingTimeSeconds: currentPlain.readingTimeSeconds + secondsDelta,
          };
          if (vaultKeyRef.current) {
            encryptBookForStorage(updatedPlain, vaultKeyRef.current).then((enc) => {
              saveBook(enc);
              setBooks((bList) => bList.map((b) => (b.id === bookId ? enc : b)));
            });
          }
          return { ...prev, [bookId]: updatedPlain };
        });

        // Record anonymized daily reading stats for private books so daily goals stay accurate
        if (secondsDelta > 0 || charsDelta > 0) {
          setDailyStats((prevStats) => {
            recordReadingProgressDelta(prevStats, 'private-vault', secondsDelta, charsDelta).then(
              (updatedList) => setDailyStats(updatedList)
            );
            return prevStats;
          });
        }
        return;
      }

      setBooks((prev) =>
        prev.map((b) => {
          if (b.id !== bookId) return b;
          const updated: Book = {
            ...b,
            currentOffset: Math.max(0, Math.min(b.totalChars, newOffset)),
            lastReadAt: now,
            readingTimeSeconds: b.readingTimeSeconds + secondsDelta,
          };
          saveBook(updated);
          return updated;
        })
      );

      if (secondsDelta > 0 || charsDelta > 0) {
        setDailyStats((prevStats) => {
          recordReadingProgressDelta(prevStats, bookId, secondsDelta, charsDelta).then(
            (updatedList) => setDailyStats(updatedList)
          );
          return prevStats;
        });
      }
    },
    [books]
  );

  const handleImportFiles = useCallback(
    async (fileList: FileList) => {
      markFileDialogClosed();
      const importedTitles: string[] = [];

      // Guarantee vault key retrieval if importing in private space mode
      let keyForPrivate = vaultKeyRef.current;
      if (isPrivateSpaceMode && !keyForPrivate) {
        keyForPrivate = await warmUpVaultKey();
        if (keyForPrivate) {
          vaultKeyRef.current = keyForPrivate;
          setIsVaultUnlocked(true);
          setIsShieldLockedInPlace(false);
        }
      }
      const importAsPrivate = Boolean(isPrivateSpaceMode && keyForPrivate);

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const lowerName = file.name.toLowerCase();

        if (lowerName.endsWith('.json')) {
          const text = await file.text();
          const backup = validateBackupJson(text);
          if (backup) {
            await restoreFullLibraryBackup(backup);
            const refreshed = await initializeLibraryStorage();
            setBooks(refreshed.books);
            setAnnotations(refreshed.annotations);
            setDailyStats(refreshed.dailyStats);
            setSettings(refreshed.settings);
            if (vaultKeyRef.current) {
              await hydratePrivateVaultIntoMemory(
                vaultKeyRef.current,
                refreshed.books,
                refreshed.annotations
              );
            }
            showNotice(`已恢复 ${refreshed.books.length} 册书籍`);
            continue;
          }
        }

        const buffer = await file.arrayBuffer();
        const { text, encoding } = decodeFileBuffer(buffer);
        if (!text.trim()) continue;

        const format: BookFormat =
          lowerName.endsWith('.md') || lowerName.endsWith('.markdown') ? 'md' : 'txt';
        const cleanTitle = file.name
          .replace(/\.(txt|md|markdown)$/i, '')
          .replace(/^[《【]|[》】]$/g, '');
        const chapters = extractChapters(text, format);
        const preset = COVER_ROTATION[(books.length + i) % COVER_ROTATION.length];

        const newBook: Book = {
          id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: cleanTitle || '未命名手稿',
          author: '本地典藏',
          category: format === 'md' ? 'Markdown' : '书卷',
          format,
          encoding,
          coverPreset: preset,
          content: text,
          totalChars: text.length,
          chapters,
          currentOffset: 0,
          isFavorite: false,
          addedAt: Date.now(),
          lastReadAt: Date.now(),
          readingTimeSeconds: 0,
          isPrivate: importAsPrivate,
        };

        if (importAsPrivate && keyForPrivate) {
          const encryptedBook = await encryptBookForStorage(newBook, keyForPrivate);
          await saveBook(encryptedBook);
          setDecryptedBooksMap((prev) => ({ ...prev, [newBook.id]: newBook }));
          setBooks((prev) => [encryptedBook, ...prev]);
        } else {
          await saveBook(newBook);
          setBooks((prev) => [newBook, ...prev]);
        }

        setActiveBookId(newBook.id);
        importedTitles.push(newBook.title);
      }

      setIsWindowBlurred(false);
      setIsShieldLockedInPlace(false);

      if (importedTitles.length > 0) {
        showNotice(
          importAsPrivate
            ? `已加密导入私密空间：《${importedTitles.join('》《')}》`
            : `已导入《${importedTitles.join('》《')}》`
        );
      }
    },
    [books.length, isPrivateSpaceMode, markFileDialogClosed, showNotice]
  );

  const handleToggleFavorite = useCallback(
    (bookId: string) => {
      const target = books.find((b) => b.id === bookId);
      if (target?.isPrivate && vaultKeyRef.current) {
        const plain = decryptedBooksMap[bookId];
        if (!plain) return;
        const updatedPlain = { ...plain, isFavorite: !plain.isFavorite };
        setDecryptedBooksMap((prev) => ({ ...prev, [bookId]: updatedPlain }));
        encryptBookForStorage(updatedPlain, vaultKeyRef.current).then((enc) => {
          saveBook(enc);
          setBooks((prev) => prev.map((b) => (b.id === bookId ? enc : b)));
        });
        return;
      }

      setBooks((prev) =>
        prev.map((b) => {
          if (b.id !== bookId) return b;
          const updated = { ...b, isFavorite: !b.isFavorite };
          saveBook(updated);
          return updated;
        })
      );
    },
    [books, decryptedBooksMap]
  );

  const handleDeleteBook = useCallback(
    async (bookId: string) => {
      await removeBook(bookId);
      setDecryptedBooksMap((prev) => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
      setBooks((prev) => {
        const remaining = prev.filter((b) => b.id !== bookId);
        if (activeBookId === bookId) {
          const fallback = remaining.find((b) => !b.isPrivate);
          setActiveBookId(fallback?.id || null);
        }
        return remaining;
      });
      setAnnotations((prev) => prev.filter((a) => a.bookId !== bookId));
      showNotice('已移除');
    },
    [activeBookId, showNotice]
  );

  const handleUpdateBookMeta = useCallback(
    (
      bookId: string,
      updates: { title: string; author: string; category: string; coverPreset: CoverPreset }
    ) => {
      const target = books.find((b) => b.id === bookId);
      if (target?.isPrivate && vaultKeyRef.current) {
        const plain = decryptedBooksMap[bookId];
        if (!plain) return;
        const updatedPlain = { ...plain, ...updates };
        setDecryptedBooksMap((prev) => ({ ...prev, [bookId]: updatedPlain }));
        encryptBookForStorage(updatedPlain, vaultKeyRef.current).then((enc) => {
          saveBook(enc);
          setBooks((prev) => prev.map((b) => (b.id === bookId ? enc : b)));
        });
        showNotice('已加密保存');
        return;
      }

      setBooks((prev) =>
        prev.map((b) => {
          if (b.id !== bookId) return b;
          const updated = { ...b, ...updates };
          saveBook(updated);
          return updated;
        })
      );
      showNotice('已保存');
    },
    [books, decryptedBooksMap, showNotice]
  );

  const handleAddAnnotation = useCallback(
    (annData: Omit<Annotation, 'id' | 'createdAt'>) => {
      const targetBook = books.find((b) => b.id === annData.bookId);
      const isPrivateBook = Boolean(targetBook?.isPrivate);

      const newAnn: Annotation = {
        ...annData,
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        isPrivate: isPrivateBook,
      };

      if (isPrivateBook && vaultKeyRef.current) {
        setDecryptedAnnsMap((prev) => ({ ...prev, [newAnn.id]: newAnn }));
        encryptAnnotationForStorage(newAnn, vaultKeyRef.current).then((encAnn) => {
          saveAnnotation(encAnn);
          setAnnotations((prev) => [encAnn, ...prev]);
        });
        return;
      }

      saveAnnotation(newAnn);
      setAnnotations((prev) => [newAnn, ...prev]);
    },
    [books]
  );

  const handleUpdateAnnotation = useCallback(
    (updatedAnn: Annotation) => {
      const targetBook = books.find((b) => b.id === updatedAnn.bookId);
      const isPrivateBook = Boolean(targetBook?.isPrivate || updatedAnn.isPrivate);

      if (isPrivateBook && vaultKeyRef.current) {
        setDecryptedAnnsMap((prev) => ({ ...prev, [updatedAnn.id]: updatedAnn }));
        encryptAnnotationForStorage(updatedAnn, vaultKeyRef.current).then((encAnn) => {
          saveAnnotation(encAnn);
          setAnnotations((prev) => prev.map((a) => (a.id === updatedAnn.id ? encAnn : a)));
        });
        return;
      }

      saveAnnotation(updatedAnn);
      setAnnotations((prev) => prev.map((a) => (a.id === updatedAnn.id ? updatedAnn : a)));
    },
    [books]
  );

  const handleDeleteAnnotation = useCallback((annId: string) => {
    removeAnnotation(annId);
    setDecryptedAnnsMap((prev) => {
      const next = { ...prev };
      delete next[annId];
      return next;
    });
    setAnnotations((prev) => prev.filter((a) => a.id !== annId));
  }, []);

  const handleUploadCustomFont = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      const cleanName = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
      const fontId = `custom-font-${Date.now()}`;
      const newFont: CustomFont = {
        id: fontId,
        name: cleanName,
        fileName: file.name,
        format: file.name.split('.').pop() || 'ttf',
        data: buffer,
        addedAt: Date.now(),
      };
      await saveCustomFont(newFont);
      setCustomFonts((prev) => [...prev, newFont]);
      handleUpdateSettings({ fontFamily: fontId });
    },
    [handleUpdateSettings]
  );

  const handleDeleteCustomFont = useCallback(
    async (fontId: string) => {
      await removeCustomFont(fontId);
      setCustomFonts((prev) => prev.filter((f) => f.id !== fontId));
      if (settings.fontFamily === fontId) {
        handleUpdateSettings({ fontFamily: 'serif-editorial' });
      }
    },
    [settings.fontFamily, handleUpdateSettings]
  );

  const handleImportBackupFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const backup = validateBackupJson(text);
      if (!backup) {
        showNotice('无效备份文件');
        return;
      }
      await restoreFullLibraryBackup(backup);
      const refreshed = await initializeLibraryStorage();
      setBooks(refreshed.books);
      setAnnotations(refreshed.annotations);
      setDailyStats(refreshed.dailyStats);
      setSettings(refreshed.settings);
      if (vaultKeyRef.current) {
        await hydratePrivateVaultIntoMemory(
          vaultKeyRef.current,
          refreshed.books,
          refreshed.annotations
        );
      }
      showNotice(`已恢复 ${refreshed.books.length} 册书籍`);
    },
    [showNotice, hydratePrivateVaultIntoMemory]
  );

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <BookOpen className="h-6 w-6 animate-pulse" style={{ color: 'var(--accent-primary)' }} />
      </div>
    );
  }

  // Reader View with DOM-level Privacy Shield when reading a private book
  if (activeTab === 'reader' && activeBook) {
    const isReadingPrivateBook = Boolean(activeBook.isPrivate);
    const isLockedDuringPrivateRead =
      isReadingPrivateBook && (!isVaultUnlocked || isShieldLockedInPlace);
    const bookAnnotations = isReadingPrivateBook
      ? unlockedPrivateAnnotations.filter((a) => a.bookId === activeBook.id)
      : publicAnnotations.filter((a) => a.bookId === activeBook.id);

    return (
      <>
        {/* Only mount plaintext ReaderView DOM if unlocked */}
        {!isLockedDuringPrivateRead && (
          <ReaderView
            book={activeBook}
            annotations={bookAnnotations}
            customFonts={customFonts}
            settings={settings}
            dailyStats={dailyStats}
            onBackToShelf={() => setActiveTab('shelf')}
            onUpdateBookOffset={handleUpdateBookOffset}
            onUpdateSettings={handleUpdateSettings}
            onAddAnnotation={handleAddAnnotation}
            onUpdateAnnotation={handleUpdateAnnotation}
            onDeleteAnnotation={handleDeleteAnnotation}
            onUploadCustomFont={handleUploadCustomFont}
            onLockVault={isReadingPrivateBook ? handleLockVaultAndExit : undefined}
            onToggleBookPrivacy={handleToggleBookPrivacy}
          />
        )}

        {isReadingPrivateBook && (
          <PrivacyShieldOverlay
            isLocked={isLockedDuringPrivateRead}
            isWindowBlurred={isWindowBlurred}
            passwordHint={vaultConfig?.passwordHint}
            onUnlock={handleUnlockVault}
            onDismissBlur={() => setIsWindowBlurred(false)}
            onLockNow={() => wipeSessionMemoryAndLock(false)}
            onExitToPublicShelf={handleLockVaultAndExit}
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-12">
      <input
        ref={globalFileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.json"
        className="hidden"
        onClick={markFileDialogOpen}
        onChange={(e) => {
          markFileDialogClosed();
          if (e.target.files && e.target.files.length > 0) {
            handleImportFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Minimalist Single-Row Top Bar */}
      <header
        className="sticky top-0 z-30 border-b px-4 sm:px-8"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex h-13 max-w-7xl items-center justify-between gap-6">
          <div className="flex items-center gap-8">
            <a
              href="#shelf"
              onClick={(e) => {
                e.preventDefault();
                setIsPrivateSpaceMode(false);
                setActiveTab('shelf');
              }}
              className="font-display flex items-center gap-2 text-base font-semibold tracking-tight whitespace-nowrap shrink-0"
              style={{ color: 'var(--text-primary)' }}
            >
              <BookOpen className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
              <span>书阁</span>
            </a>

            <nav className="hidden md:flex items-center gap-6 text-xs font-medium">
              {(
                [
                  { id: 'shelf', label: '书架' },
                  { id: 'reader', label: '阅读', disabled: !activeBook },
                  { id: 'stats', label: '统计' },
                  { id: 'studio', label: '设置' },
                ] as const
              ).map((item) => {
                const isActive =
                  activeTab === item.id && !(item.id === 'shelf' && isPrivateSpaceMode);
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (item.id === 'reader' && !activeBook) return;
                      if (item.id === 'shelf') {
                        setIsPrivateSpaceMode(false);
                      }
                      setActiveTab(item.id);
                    }}
                    className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
                      isActive ? 'font-semibold underline underline-offset-8' : 'hover:opacity-80'
                    }`}
                    style={{
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    {item.label}
                  </a>
                );
              })}

              <a
                href="#private-vault"
                onClick={(e) => {
                  e.preventDefault();
                  handleEnterPrivateSpace();
                }}
                className={`flex items-center gap-1 py-1 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'shelf' && isPrivateSpaceMode
                    ? 'font-semibold underline underline-offset-8'
                    : 'hover:opacity-80'
                }`}
                style={{
                  color:
                    activeTab === 'shelf' && isPrivateSpaceMode
                      ? 'var(--accent-primary)'
                      : 'var(--text-secondary)',
                }}
                title="私密 (Ctrl/Cmd + Shift + L)"
              >
                <Lock className="h-3 w-3" />
                <span>私密</span>
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {toastMessage && (
              <span
                className="hidden sm:inline text-xs font-medium pr-1"
                style={{ color: 'var(--accent-primary)' }}
              >
                {toastMessage}
              </span>
            )}

            {/* Compact Theme Switcher */}
            <div
              className="flex items-center gap-0.5 rounded-lg p-0.5"
              style={{
                backgroundColor: 'var(--bg-page)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {(
                [
                  { id: 'cafe', title: '暖调纸张', icon: Sun },
                  { id: 'cream', title: '午后奶油', icon: Coffee },
                  { id: 'sandalwood', title: '古籍宣纸', icon: Feather },
                  { id: 'candlelight', title: '烛光暮读', icon: Flame },
                  { id: 'night', title: '夜间暗色', icon: Moon },
                  { id: 'eink', title: '电子墨水', icon: Sparkles },
                ] as const
              ).map((t) => {
                const Icon = t.icon;
                const active = settings.theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleUpdateSettings({ theme: t.id })}
                    className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                    style={{
                      backgroundColor: active ? 'var(--accent-primary)' : 'transparent',
                      color: active ? '#FFFFFF' : 'var(--text-secondary)',
                    }}
                    title={t.title}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>

            {!isInstalled && (isInstallable || isIOS) && (
              <button
                type="button"
                onClick={() => {
                  if (isInstallable) install();
                  else if (isIOS) setShowIOSInstallModal(true);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0"
                style={{
                  backgroundColor: 'var(--bg-page)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
                title="安装离线应用"
                aria-label="安装离线应用"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                markFileDialogOpen();
                globalFileInputRef.current?.click();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white transition-colors shrink-0"
              style={{ backgroundColor: 'var(--accent-primary)' }}
              title={
                isPrivateSpaceMode
                  ? '导入并加密至私密空间'
                  : '导入 TXT / Markdown / JSON'
              }
              aria-label={isPrivateSpaceMode ? '加密导入书籍' : '导入书籍'}
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Bookshelf (Public Shelf OR Unlocked Private Space) */}
      {activeTab === 'shelf' && (
        <>
          {!(isPrivateSpaceMode && (!isVaultUnlocked || isShieldLockedInPlace)) && (
            <BookshelfView
              books={isPrivateSpaceMode ? unlockedPrivateBooks : publicBooks}
              annotations={
                isPrivateSpaceMode ? unlockedPrivateAnnotations : publicAnnotations
              }
              dailyStats={dailyStats}
              dailyGoalMinutes={settings.dailyGoalMinutes}
              isPrivateSpaceMode={isPrivateSpaceMode}
              onOpenBook={handleOpenBook}
              onImportFiles={handleImportFiles}
              onToggleFavorite={handleToggleFavorite}
              onDeleteBook={handleDeleteBook}
              onUpdateBookMeta={handleUpdateBookMeta}
              onToggleBookPrivacy={handleToggleBookPrivacy}
              onBatchToggleBookPrivacy={handleBatchToggleBookPrivacy}
              onEnterPrivateSpace={handleEnterPrivateSpace}
              onExitPrivateSpace={() => setIsPrivateSpaceMode(false)}
              onLockPrivateSpace={handleLockVaultAndExit}
              onOpenVaultSettings={() => {
                setVaultModalMode('settings');
                setVaultModalOpen(true);
              }}
            />
          )}

          {isPrivateSpaceMode && (
            <PrivacyShieldOverlay
              isLocked={!isVaultUnlocked || isShieldLockedInPlace}
              isWindowBlurred={isWindowBlurred}
              passwordHint={vaultConfig?.passwordHint}
              onUnlock={handleUnlockVault}
              onDismissBlur={() => setIsWindowBlurred(false)}
              onLockNow={() => wipeSessionMemoryAndLock(false)}
              onExitToPublicShelf={handleLockVaultAndExit}
            />
          )}
        </>
      )}

      {activeTab === 'stats' && (
        <StatsView
          books={publicBooks}
          annotations={publicAnnotations}
          dailyStats={dailyStats}
          dailyGoalMinutes={settings.dailyGoalMinutes}
          onUpdateDailyGoal={(minutes) => handleUpdateSettings({ dailyGoalMinutes: minutes })}
          onOpenBook={handleOpenBook}
        />
      )}

      {activeTab === 'studio' && (
        <TypographyDataView
          books={publicBooks}
          annotations={publicAnnotations}
          customFonts={customFonts}
          settings={settings}
          dailyStats={dailyStats}
          onUpdateSettings={handleUpdateSettings}
          onUploadCustomFont={handleUploadCustomFont}
          onDeleteCustomFont={handleDeleteCustomFont}
          onImportBackupFile={handleImportBackupFile}
        />
      )}

      {/* Vault Master Password Setup / Unlock / Security Policy Modal */}
      <VaultPasswordModal
        isOpen={vaultModalOpen}
        mode={vaultModalMode}
        vaultConfig={vaultConfig}
        pendingActionLabel={
          pendingBookIdsToEncrypt.length > 0
            ? `验证主密码后将 ${pendingBookIdsToEncrypt.length} 册书籍加密移入私密空间`
            : '验证主密码后进入独立私密空间（当前会话免密秒开）'
        }
        onClose={() => {
          setVaultModalOpen(false);
          setPendingBookIdsToEncrypt([]);
          setPendingEnterPrivateSpace(false);
        }}
        onSetupMasterPassword={handleSetupMasterPassword}
        onUnlockVault={handleUnlockVault}
        onUpdateVaultSettings={handleUpdateVaultSettings}
      />

      {/* Mobile Icon Bottom Navigation Bar */}
      <nav
        className="fixed right-0 bottom-0 left-0 z-30 grid h-13 grid-cols-5 items-center border-t md:hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <button
          onClick={() => {
            setIsPrivateSpaceMode(false);
            setActiveTab('shelf');
          }}
          className="flex min-h-[44px] items-center justify-center"
          style={{
            color:
              activeTab === 'shelf' && !isPrivateSpaceMode
                ? 'var(--accent-primary)'
                : 'var(--text-muted)',
          }}
          title="书架"
        >
          <Library className="h-5 w-5" />
        </button>
        <button
          onClick={() => {
            if (activeBook) setActiveTab('reader');
          }}
          className="flex min-h-[44px] items-center justify-center"
          style={{ color: 'var(--text-muted)' }}
          title="阅读"
        >
          <BookOpen className="h-5 w-5" />
        </button>
        <button
          onClick={handleEnterPrivateSpace}
          className="flex min-h-[44px] items-center justify-center"
          style={{
            color:
              activeTab === 'shelf' && isPrivateSpaceMode
                ? 'var(--accent-primary)'
                : 'var(--text-muted)',
          }}
          title="私密"
        >
          <Lock className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className="flex min-h-[44px] items-center justify-center"
          style={{
            color: activeTab === 'stats' ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}
          title="统计"
        >
          <BarChart3 className="h-5 w-5" />
        </button>
        <button
          onClick={() => setActiveTab('studio')}
          className="flex min-h-[44px] items-center justify-center"
          style={{
            color: activeTab === 'studio' ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}
          title="设置"
        >
          <Sliders className="h-5 w-5" />
        </button>
      </nav>

      {!isOnline && (
        <div
          className="fixed bottom-16 left-4 z-50 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-white shadow-lg md:bottom-4"
          style={{ backgroundColor: 'var(--accent-primary)' }}
          title="离线模式"
        >
          <WifiOff className="h-4 w-4" />
        </div>
      )}

      {showIOSInstallModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowIOSInstallModal(false)}
        >
          <div
            className="w-full max-w-xs rounded-2xl p-5 shadow-xl"
            style={{
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Download className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
              <button onClick={() => setShowIOSInstallModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Safari 分享按钮 → 添加到主屏幕
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
