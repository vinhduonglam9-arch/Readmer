export type BookFormat = 'txt' | 'md';

export type CoverPreset = 'espresso' | 'terracotta' | 'matcha' | 'walnut' | 'parchment';

export interface Chapter {
  id: string;
  title: string;
  level?: number; // 1 for #, 2 for ##, 3 for ###, etc.
  startOffset: number;
  endOffset: number;
  wordCount: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  category: string;
  format: BookFormat;
  encoding: string;
  coverPreset: CoverPreset;
  content: string;
  totalChars: number;
  chapters: Chapter[];
  currentOffset: number;
  isFavorite: boolean;
  addedAt: number;
  lastReadAt: number;
  readingTimeSeconds: number;
  isPrivate?: boolean;
  encryptedPayload?: string;
  encryptionIv?: string;
}

export type HighlightColor = 'amber' | 'caramel' | 'sage';

export interface Annotation {
  id: string;
  bookId: string;
  type: 'bookmark' | 'note';
  chapterTitle: string;
  charOffset: number;
  selectedText: string;
  noteText: string;
  color: HighlightColor;
  createdAt: number;
  isPrivate?: boolean;
  encryptedPayload?: string;
  encryptionIv?: string;
}

export interface VaultConfig {
  isInitialized: boolean;
  kdf?: 'argon2id' | 'pbkdf2';
  masterPasswordHash?: string;
  salt: string;
  verifierIv: string;
  verifierCipher: string;
  passwordHint?: string;
  autoLockMinutes: number;
  lockOnTabHidden: boolean;
  blurOnWindowBlur: boolean;
  updatedAt: number;
}

export interface CustomFont {
  id: string;
  name: string;
  fileName: string;
  format: string;
  data: ArrayBuffer;
  addedAt: number;
}

export type ReaderTheme = 'cafe' | 'cream' | 'sandalwood' | 'candlelight' | 'night' | 'eink';

export type LayoutMode = 'paginated-double' | 'paginated-single' | 'scroll';

export type MaxColumnWidth = 'narrow' | 'standard' | 'wide' | 'full';

export type BuiltinFontFamily = 'serif-editorial' | 'sans-warm' | 'kaiti-classic' | 'mono-tabular';

export interface ReaderSettings {
  theme: ReaderTheme;
  einkFlashRefresh: boolean;
  layoutMode: LayoutMode;
  maxColumnWidth?: MaxColumnWidth; // 'narrow' (680px) | 'standard' (840px) | 'wide' (1040px) | 'full' (100%)
  fontFamily: BuiltinFontFamily | string; // Can be a customFontId
  fontSize: number; // 14 - 32
  lineHeight: number; // 1.4 - 2.2
  letterSpacing: number; // -0.02 to 0.12 (em)
  paragraphSpacing: number; // 8 - 32 (px)
  pageMargin: number; // 24 - 72 (px)
  indentFirstLine: boolean;
  autoFlipEnabled: boolean;
  autoFlipMode: 'page' | 'scroll';
  autoFlipPageInterval: number; // seconds per page (3 - 60)
  autoScrollSpeed: number; // pixels per second (15 - 120)
  dailyGoalMinutes: number;
  ttsEngine?: 'edge' | 'local';
  ttsEdgeVoice?: string;
  ttsVoiceURI?: string;
  ttsRate?: number; // 0.5 - 2.0
  ttsPitch?: number; // 0.5 - 1.5
}

export interface ReadingStatsDaily {
  date: string; // YYYY-MM-DD
  secondsRead: number;
  charsRead: number;
  booksTouched: string[];
  hourlyDistribution: number[]; // 24-element array of seconds read per hour
}

export interface FullLibraryBackup {
  version: string;
  exportedAt: number;
  books: Book[];
  annotations: Annotation[];
  settings: ReaderSettings;
  dailyStats: ReadingStatsDaily[];
}
