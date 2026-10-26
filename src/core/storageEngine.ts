import {
  Annotation,
  Book,
  CustomFont,
  FullLibraryBackup,
  ReaderSettings,
  ReadingStatsDaily,
} from '../types/reader';
import { INITIAL_SAMPLE_BOOKS } from './sampleBooks';

const DB_NAME = 'roast_reed_db';
const DB_VERSION = 1;

const STORE_BOOKS = 'books';
const STORE_ANNOTATIONS = 'annotations';
const STORE_FONTS = 'custom_fonts';
const STORE_STATS = 'daily_stats';

const SETTINGS_STORAGE_KEY = 'roast_reed_reader_settings_v1';
const SEED_VERSION_KEY = 'roast_reed_seed_patriotic_md_v5';

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'cafe',
  einkFlashRefresh: true,
  layoutMode: 'paginated-double',
  maxColumnWidth: 'full',
  fontFamily: 'serif-editorial',
  fontSize: 19,
  lineHeight: 1.85,
  letterSpacing: 0.02,
  paragraphSpacing: 16,
  pageMargin: 24,
  indentFirstLine: true,
  autoFlipEnabled: false,
  autoFlipMode: 'scroll',
  autoFlipPageInterval: 12,
  autoScrollSpeed: 36,
  dailyGoalMinutes: 45,
  ttsEngine: 'edge',
  ttsEdgeVoice: 'zh-CN-XiaoxiaoNeural',
  ttsVoiceURI: '',
  ttsRate: 1.0,
  ttsPitch: 1.0,
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ANNOTATIONS)) {
        const annStore = db.createObjectStore(STORE_ANNOTATIONS, { keyPath: 'id' });
        annStore.createIndex('bookId', 'bookId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_FONTS)) {
        db.createObjectStore(STORE_FONTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_STATS)) {
        db.createObjectStore(STORE_STATS, { keyPath: 'date' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore<T>(storeName: string): Promise<T[]> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      })
  );
}

function putIntoStore<T>(storeName: string, item: T): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

function deleteFromStore(storeName: string, key: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

export async function initializeLibraryStorage(): Promise<{
  books: Book[];
  annotations: Annotation[];
  customFonts: CustomFont[];
  dailyStats: ReadingStatsDaily[];
  settings: ReaderSettings;
}> {
  let books = await getAllFromStore<Book>(STORE_BOOKS);
  let annotations = await getAllFromStore<Annotation>(STORE_ANNOTATIONS);
  const customFonts = await getAllFromStore<CustomFont>(STORE_FONTS);
  let dailyStats = await getAllFromStore<ReadingStatsDaily>(STORE_STATS);

  const hasMigratedPatrioticSeed = localStorage.getItem(SEED_VERSION_KEY) === 'true';

  // Seed or migrate to the new 2600+ character Chinese patriotic literary collection
  if (books.length === 0 || !hasMigratedPatrioticSeed) {
    // Remove legacy short sample books if present
    const legacyIds = [
      'sample-coffee-chronicles',
      'sample-autumn-letters',
      'sample-midnight-bakery',
      'patriotic-beloved-china-v2',
      'patriotic-young-china-v2',
      'patriotic-yellow-river-v2',
      'patriotic-beloved-china-md-v3',
      'patriotic-young-china-md-v3',
      'patriotic-yellow-river-md-v3',
    ];
    for (const oldId of legacyIds) {
      await deleteFromStore(STORE_BOOKS, oldId);
    }
    for (const sampleBook of INITIAL_SAMPLE_BOOKS) {
      await putIntoStore(STORE_BOOKS, sampleBook);
    }

    const initialAnnotations: Annotation[] = [
      {
        id: 'ann-patriotic-1',
        bookId: 'patriotic-beloved-china-md-v4',
        type: 'note',
        chapterTitle: '第四章 致未来的青春中国',
        charOffset: 1750,
        selectedText: '朋友，我相信，到那时，到处都是活跃跃的创造，到处都是日新月异的进步！',
        noteText: '跨越时空的信仰与远见，今日之中国正如先辈所愿。',
        color: 'amber',
        createdAt: Date.now() - 86400000 * 2,
      },
      {
        id: 'ann-patriotic-2',
        bookId: 'patriotic-young-china-md-v4',
        type: 'bookmark',
        chapterTitle: '第二章 乾坤万里：红日初升其道大光',
        charOffset: 380,
        selectedText: '红日初升，其道大光。河出伏流，一泻汪洋。潜龙腾渊，鳞爪飞扬。',
        noteText: '少年中国说千古名句',
        color: 'caramel',
        createdAt: Date.now() - 86400000,
      },
    ];
    for (const ann of initialAnnotations) {
      await putIntoStore(STORE_ANNOTATIONS, ann);
    }

    if (dailyStats.length === 0) {
      const seededStats = generateSeededDailyStats();
      for (const stat of seededStats) {
        await putIntoStore(STORE_STATS, stat);
      }
      dailyStats = seededStats;
    }

    localStorage.setItem(SEED_VERSION_KEY, 'true');
    books = await getAllFromStore<Book>(STORE_BOOKS);
    annotations = await getAllFromStore<Annotation>(STORE_ANNOTATIONS);
  }

  for (const font of customFonts) {
    await registerCustomFontFace(font);
  }

  const settings = loadReaderSettings();

  return {
    books: books.sort((a, b) => b.lastReadAt - a.lastReadAt),
    annotations,
    customFonts,
    dailyStats: dailyStats.sort((a, b) => a.date.localeCompare(b.date)),
    settings,
  };
}

/**
 * Reads all current IndexedDB object stores directly and packages them into a single
 * JSON-serializable FullLibraryBackup object for cross-device migration.
 */
export async function exportFullLibraryFromIndexedDB(): Promise<FullLibraryBackup> {
  const [books, annotations, dailyStats] = await Promise.all([
    getAllFromStore<Book>(STORE_BOOKS),
    getAllFromStore<Annotation>(STORE_ANNOTATIONS),
    getAllFromStore<ReadingStatsDaily>(STORE_STATS),
  ]);
  const settings = loadReaderSettings();

  return {
    version: '2.0.0',
    exportedAt: Date.now(),
    books,
    annotations,
    settings,
    dailyStats,
  };
}

export async function saveBook(book: Book): Promise<void> {
  await putIntoStore(STORE_BOOKS, book);
}

export async function removeBook(bookId: string): Promise<void> {
  await deleteFromStore(STORE_BOOKS, bookId);
  const allAnns = await getAllFromStore<Annotation>(STORE_ANNOTATIONS);
  for (const ann of allAnns) {
    if (ann.bookId === bookId) {
      await deleteFromStore(STORE_ANNOTATIONS, ann.id);
    }
  }
}

export async function saveAnnotation(ann: Annotation): Promise<void> {
  await putIntoStore(STORE_ANNOTATIONS, ann);
}

export async function removeAnnotation(annId: string): Promise<void> {
  await deleteFromStore(STORE_ANNOTATIONS, annId);
}

export async function saveCustomFont(font: CustomFont): Promise<void> {
  await registerCustomFontFace(font);
  await putIntoStore(STORE_FONTS, font);
}

export async function removeCustomFont(fontId: string): Promise<void> {
  await deleteFromStore(STORE_FONTS, fontId);
}

export async function registerCustomFontFace(font: CustomFont): Promise<boolean> {
  try {
    const fontFace = new FontFace(font.id, font.data.slice(0));
    const loaded = await fontFace.load();
    document.fonts.add(loaded);
    return true;
  } catch (e) {
    console.warn('Failed to load custom font face:', font.name, e);
    return false;
  }
}

export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    return { ...DEFAULT_READER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function recordReadingProgressDelta(
  existingStats: ReadingStatsDaily[],
  bookId: string,
  secondsDelta: number,
  charsDelta: number
): Promise<ReadingStatsDaily[]> {
  const today = getTodayDateString();
  const currentHour = new Date().getHours();
  const map = new Map<string, ReadingStatsDaily>();
  existingStats.forEach((s) => map.set(s.date, s));

  const existing: ReadingStatsDaily = map.get(today) || {
    date: today,
    secondsRead: 0,
    charsRead: 0,
    booksTouched: [],
    hourlyDistribution: new Array(24).fill(0),
  };

  const updatedHourly = [...(existing.hourlyDistribution || new Array(24).fill(0))];
  updatedHourly[currentHour] = (updatedHourly[currentHour] || 0) + secondsDelta;

  const updatedBooks = existing.booksTouched.includes(bookId)
    ? existing.booksTouched
    : [...existing.booksTouched, bookId];

  const updatedToday: ReadingStatsDaily = {
    ...existing,
    secondsRead: existing.secondsRead + secondsDelta,
    charsRead: Math.max(0, existing.charsRead + charsDelta),
    booksTouched: updatedBooks,
    hourlyDistribution: updatedHourly,
  };

  await putIntoStore(STORE_STATS, updatedToday);
  map.set(today, updatedToday);

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function restoreFullLibraryBackup(backup: FullLibraryBackup): Promise<void> {
  for (const book of backup.books) {
    await putIntoStore(STORE_BOOKS, book);
  }
  for (const ann of backup.annotations) {
    await putIntoStore(STORE_ANNOTATIONS, ann);
  }
  if (Array.isArray(backup.dailyStats)) {
    for (const stat of backup.dailyStats) {
      await putIntoStore(STORE_STATS, stat);
    }
  }
  if (backup.settings) {
    saveReaderSettings(backup.settings);
  }
}

function generateSeededDailyStats(): ReadingStatsDaily[] {
  const stats: ReadingStatsDaily[] = [];
  const sampleMinutes = [28, 42, 35, 50, 19, 48, 34];
  const sampleChars = [6400, 9800, 8100, 11500, 4200, 10800, 7900];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const secs = sampleMinutes[6 - i] * 60;
    const hourly = new Array(24).fill(0);
    hourly[14] = Math.floor(secs * 0.45);
    hourly[21] = Math.floor(secs * 0.55);

    stats.push({
      date: dateStr,
      secondsRead: secs,
      charsRead: sampleChars[6 - i],
      booksTouched: ['patriotic-beloved-china-md-v4', 'patriotic-young-china-md-v4'],
      hourlyDistribution: hourly,
    });
  }
  return stats;
}
