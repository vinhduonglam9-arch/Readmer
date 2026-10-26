import { PageBlock } from './paginationEngine';

export interface EdgeVoiceCharacter {
  id: string;
  name: string;
  roleLabel: string;
  gender: 'female' | 'male' | 'child';
  locale: string;
  badge: string;
  description: string;
}

/**
 * Curated Microsoft Edge Neural TTS Character Voices Matrix
 */
export const EDGE_NEURAL_VOICES: EdgeVoiceCharacter[] = [
  {
    id: 'zh-CN-XiaoxiaoNeural',
    name: '晓晓 · Xiaoxiao',
    roleLabel: '温暖知性女声',
    gender: 'female',
    locale: 'zh-CN',
    badge: '招牌首选',
    description: '情感细腻自然，最适合文学小说、散文随笔与深度长文',
  },
  {
    id: 'zh-CN-YunxiNeural',
    name: '云希 · Yunxi',
    roleLabel: '阳光清朗男声',
    gender: 'male',
    locale: 'zh-CN',
    badge: '故事叙事',
    description: '清朗富有朝气，适合传记、故事叙事与科普读物',
  },
  {
    id: 'zh-CN-YunyeNeural',
    name: '云野 · Yunye',
    roleLabel: '沉稳磁性男声',
    gender: 'male',
    locale: 'zh-CN',
    badge: '古典名著',
    description: '醇厚沧桑有韵味，适合历史、国学经典与有声书',
  },
  {
    id: 'zh-CN-YunjianNeural',
    name: '云健 · Yunjian',
    roleLabel: '铿锵激昂男声',
    gender: 'male',
    locale: 'zh-CN',
    badge: '纪实社科',
    description: '吐字有力、极富感染力，适合爱国名篇、政论与纪实',
  },
  {
    id: 'zh-CN-XiaoyiNeural',
    name: '晓伊 · Xiaoyi',
    roleLabel: '清脆灵动女声',
    gender: 'female',
    locale: 'zh-CN',
    badge: '轻快生活',
    description: '柔和甜美、节奏轻盈，适合轻小说与生活美学',
  },
  {
    id: 'zh-CN-YunyangNeural',
    name: '云扬 · Yunyang',
    roleLabel: '专业播音男声',
    gender: 'male',
    locale: 'zh-CN',
    badge: '新闻研报',
    description: '端庄字正腔圆，适合技术文档、学术论文与商业报告',
  },
  {
    id: 'zh-CN-liaoning-XiaobeiNeural',
    name: '晓北 · Xiaobei',
    roleLabel: '亲切东北女声',
    gender: 'female',
    locale: 'zh-CN',
    badge: '方言特色',
    description: '幽默接地气的东北方言音色，适合趣味随笔与俗世故事',
  },
  {
    id: 'zh-CN-shaanxi-XiaoniNeural',
    name: '晓妮 · Xiaoni',
    roleLabel: '关中陕西女声',
    gender: 'female',
    locale: 'zh-CN',
    badge: '方言特色',
    description: '质朴鲜活的陕西风韵女声，适合西北风物与民俗文学',
  },
  {
    id: 'zh-CN-XiaoshuangNeural',
    name: '晓双 · Xiaoshuang',
    roleLabel: '纯真清亮童声',
    gender: 'child',
    locale: 'zh-CN',
    badge: '童话绘本',
    description: '活泼清澈的儿童音色，适合童话、寓言与少儿读物',
  },
  {
    id: 'zh-HK-HiuGaaiNeural',
    name: '晓佳 · HiuGaai',
    roleLabel: '地道粤语女声',
    gender: 'female',
    locale: 'zh-HK',
    badge: '香港粤语',
    description: '自然纯正的粤语发音，适合港风文学与粤语专栏',
  },
  {
    id: 'zh-TW-HsiaoChenNeural',
    name: '晓臻 · HsiaoChen',
    roleLabel: '温婉国语女声',
    gender: 'female',
    locale: 'zh-TW',
    badge: '台湾国语',
    description: '温柔治愈的台式国语腔调，适合抒情散文与书信',
  },
  {
    id: 'en-US-AriaNeural',
    name: 'Aria · 艾莉亚',
    roleLabel: '母语自然女声',
    gender: 'female',
    locale: 'en-US',
    badge: '英文原版',
    description: '自然流畅的美式英语女声，适合英文著作与中英混排技术文',
  },
];

/**
 * Strip inline Markdown syntax & HTML tags so TTS reads clean natural prose
 */
export function stripMarkdownForSpeech(raw: string): string {
  if (!raw) return '';
  return raw
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Replace links [label](url) with label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Replace images ![alt](url) with alt description
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_m, alt) => (alt ? `插图：${alt}。` : ''))
    // Remove inline code backticks but keep content
    .replace(/`([^`]+)`/g, '$1')
    // Remove bold/italic/strikethrough markers
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    // Remove heading hashes at start
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquote markers
    .replace(/^>\s*/gm, '')
    // Clean up LaTeX delimiters
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a concise natural-language summary for Mermaid diagrams
 */
function summarizeMermaidBlock(code: string): string {
  const trimmed = code.trim();
  const firstLine = trimmed.split('\n')[0]?.toLowerCase() || '';

  let chartTypeName = '结构关系图表';
  if (firstLine.includes('flowchart') || firstLine.includes('graph')) {
    chartTypeName = '流程图';
  } else if (firstLine.includes('sequencediagram')) {
    chartTypeName = '时序交互图';
  } else if (firstLine.includes('gantt')) {
    chartTypeName = '甘特进度图';
  } else if (firstLine.includes('classdiagram')) {
    chartTypeName = '类结构图';
  } else if (firstLine.includes('statediagram')) {
    chartTypeName = '状态机图';
  } else if (firstLine.includes('erdiagram')) {
    chartTypeName = '实体关系图';
  } else if (firstLine.includes('pie')) {
    chartTypeName = '饼状分布图';
  } else if (firstLine.includes('mindmap')) {
    chartTypeName = '思维导图';
  } else if (firstLine.includes('timeline') || firstLine.includes('journey')) {
    chartTypeName = '时间轴历程图';
  }

  // Extract human-readable node labels inside [...], (...), {...}, or quotes
  const labels: string[] = [];
  const labelRegex = /(?:\[|\(|\{ roughly?|"|')([^[\](){}"'\n]{2,28})(?:\]|\)|\}|"|')/g;
  let match: RegExpExecArray | null;
  while ((match = labelRegex.exec(trimmed)) !== null && labels.length < 6) {
    const candidate = match[1]
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/[#;:]/g, '')
      .trim();
    if (
      candidate.length >= 2 &&
      !/^(td|lr|tb|bt|rl|subgraph|end|style|classDef)$/i.test(candidate) &&
      !labels.includes(candidate)
    ) {
      labels.push(candidate);
    }
  }

  if (labels.length > 0) {
    return `此处包含一张${chartTypeName}，主要节点涵盖：${labels.join('、')}。`;
  }
  return `此处包含一张${chartTypeName}，已为您自动略过图表拓扑源码。`;
}

/**
 * Extract a concise natural-language summary for GFM Markdown Tables
 */
function summarizeTableBlock(block: PageBlock): string {
  const headers = (block.tableHeaders || [])
    .map((h) => stripMarkdownForSpeech(h))
    .filter(Boolean);
  const rows = block.tableRows || [];

  if (headers.length === 0 && block.text) {
    // Fallback parse from raw markdown table text
    const lines = block.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|'));
    if (lines.length >= 2) {
      const parsedHeaders = lines[0]
        .split('|')
        .map((c) => stripMarkdownForSpeech(c))
        .filter(Boolean);
      const dataRowCount = Math.max(0, lines.length - 2);
      if (parsedHeaders.length > 0) {
        return `此处有一张数据表格，共 ${parsedHeaders.length} 列，表头依次为：${parsedHeaders.join('、')}，包含 ${dataRowCount} 行数据记录。`;
      }
    }
    return '此处有一张数据对比表格。';
  }

  const headerDesc =
    headers.length > 0 ? `，列名为：${headers.slice(0, 6).join('、')}` : '';
  const rowCount = rows.length;

  // If the table is compact (<= 4 rows), read out the first 2 rows briefly for context
  if (rowCount > 0 && rowCount <= 4 && headers.length <= 5) {
    const sampleRows = rows.slice(0, 2).map((r) =>
      r
        .map((cell, idx) => {
          const cleanCell = stripMarkdownForSpeech(cell);
          const colName = headers[idx];
          return colName && cleanCell ? `${colName}为${cleanCell}` : cleanCell;
        })
        .filter(Boolean)
        .join('，')
    );
    return `此处有一张数据表格${headerDesc}，共 ${rowCount} 行。其中：${sampleRows.join('；')}。`;
  }

  return `此处有一张数据表格${headerDesc}，共包含 ${rowCount} 行数据。`;
}

/**
 * Convert any PageBlock into clean, natural-sounding speech narration text
 */
export function buildBlockSpeechText(block: PageBlock): string {
  if (!block) return '';

  switch (block.type) {
    case 'hr':
      return '';

    case 'mermaid':
      return summarizeMermaidBlock(block.text);

    case 'table':
      return summarizeTableBlock(block);

    case 'code': {
      const lang = (block.lang || '代码').toUpperCase();
      const lineCount = block.text ? block.text.trim().split('\n').length : 1;
      if (block.isContinuation) {
        return `接上页 ${lang} 代码块，共 ${lineCount} 行。`;
      }
      return `此处有一段 ${lang} 代码示例，共 ${lineCount} 行，已为您略过代码符号。`;
    }

    case 'blockquote': {
      const alertMatch = block.text.match(
        /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*)$/i
      );
      if (alertMatch) {
        const kindMap: Record<string, string> = {
          NOTE: '注释提示',
          TIP: '实用技巧',
          IMPORTANT: '重要提示',
          WARNING: '注意警告',
          CAUTION: '风险警示',
        };
        const label = kindMap[alertMatch[1].toUpperCase()] || '提示';
        return `${label}：${stripMarkdownForSpeech(alertMatch[2])}`;
      }
      return `引述：${stripMarkdownForSpeech(block.text)}`;
    }

    case 'list': {
      const items = block.listItems || [];
      if (items.length === 0) {
        return stripMarkdownForSpeech(block.text);
      }
      return items
        .map((item, idx) => {
          const cleanItem = stripMarkdownForSpeech(item.text);
          if (item.task) {
            return `${item.checked ? '已完成项' : '待办项'}：${cleanItem}`;
          }
          if (block.ordered) {
            return `第 ${(block.start || 1) + idx} 点：${cleanItem}`;
          }
          return `${cleanItem}`;
        })
        .join('；');
    }

    case 'heading':
    case 'paragraph':
    default:
      return stripMarkdownForSpeech(block.text);
  }
}

export interface LocalVoiceOption {
  voice: SpeechSynthesisVoice;
  label: string;
  isOfflineLocal: boolean;
  isChinese: boolean;
  isMicrosoftNative: boolean;
}

/**
 * Retrieve and sort browser SpeechSynthesis voices, prioritizing Chinese and offline local voices
 */
export function getSortedLocalVoices(): LocalVoiceOption[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  const rawVoices = window.speechSynthesis.getVoices() || [];
  const mapped: LocalVoiceOption[] = rawVoices.map((v) => {
    const isChinese = /^(zh|cmn|yue)/i.test(v.lang) || /chinese|中文|普通话|粤语|国语/i.test(v.name);
    const isOfflineLocal = Boolean(v.localService);
    const isMicrosoftNative = /microsoft/i.test(v.name);
    const cleanName = v.name
      .replace(/^Microsoft\s+/i, '微软 ')
      .replace(/\s+Online\s*\(Natural\)/i, ' (超拟真)')
      .replace(/\s*-\s*Chinese\s*\([^)]+\)/i, '');
    return {
      voice: v,
      label: `${cleanName} (${v.lang})`,
      isOfflineLocal,
      isChinese,
      isMicrosoftNative,
    };
  });

  return mapped.sort((a, b) => {
    if (a.isChinese !== b.isChinese) return a.isChinese ? -1 : 1;
    if (a.isOfflineLocal !== b.isOfflineLocal) return a.isOfflineLocal ? -1 : 1;
    if (a.isMicrosoftNative !== b.isMicrosoftNative) return a.isMicrosoftNative ? -1 : 1;
    return a.label.localeCompare(b.label, 'zh-CN');
  });
}

// LRU Cache of synthesized Edge TTS Blob URLs (up to 16 paragraphs in memory)
const edgeAudioBlobCache = new Map<string, string>();
const edgePendingPromises = new Map<string, Promise<string>>();
const MAX_AUDIO_CACHE_ENTRIES = 16;

function makeEdgeCacheKey(text: string, voice: string, rate: number, pitch: number): string {
  return `${voice}|${rate.toFixed(2)}|${pitch.toFixed(2)}|${text}`;
}

/**
 * Synthesize speech using Microsoft Edge Neural TTS (/api/tts/edge) with in-memory LRU caching
 */
export async function synthesizeEdgeSpeechUrl(
  text: string,
  voice: string,
  rate: number,
  pitch: number,
  signal?: AbortSignal
): Promise<string> {
  const key = makeEdgeCacheKey(text, voice, rate, pitch);
  const cached = edgeAudioBlobCache.get(key);
  if (cached) {
    return cached;
  }

  const existingPromise = edgePendingPromises.get(key);
  if (existingPromise && !signal) {
    return existingPromise;
  }

  const requestPromise = (async () => {
    try {
      const response = await fetch('/api/tts/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, rate, pitch }),
        signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Edge TTS HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('Empty audio blob received');
      }

      const blobUrl = URL.createObjectURL(blob);
      if (edgeAudioBlobCache.size >= MAX_AUDIO_CACHE_ENTRIES) {
        const oldestKey = edgeAudioBlobCache.keys().next().value;
        if (oldestKey) {
          const oldUrl = edgeAudioBlobCache.get(oldestKey);
          if (oldUrl) URL.revokeObjectURL(oldUrl);
          edgeAudioBlobCache.delete(oldestKey);
        }
      }
      edgeAudioBlobCache.set(key, blobUrl);
      return blobUrl;
    } finally {
      edgePendingPromises.delete(key);
    }
  })();

  if (!signal) {
    edgePendingPromises.set(key, requestPromise);
  }

  return requestPromise;
}

/**
 * Pre-fetch the next paragraph's Edge TTS audio in background so transitions are seamless
 */
export function prefetchEdgeSpeech(
  text: string,
  voice: string,
  rate: number,
  pitch: number
): void {
  const clean = text.trim();
  if (!clean) return;
  const key = makeEdgeCacheKey(clean, voice, rate, pitch);
  if (edgeAudioBlobCache.has(key) || edgePendingPromises.has(key)) return;
  synthesizeEdgeSpeechUrl(clean, voice, rate, pitch).catch(() => {
    // Silently ignore prefetch errors
  });
}
