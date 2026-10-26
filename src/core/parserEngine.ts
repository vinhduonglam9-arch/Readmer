import MarkdownIt from 'markdown-it';
import mermaid from 'mermaid';
import {
  Annotation,
  Book,
  BookFormat,
  Chapter,
  FullLibraryBackup,
  ReaderTheme,
} from '../types/reader';

let mermaidRenderSeq = 0;
let mermaidRenderQueue: Promise<any> = Promise.resolve();
const mermaidSvgCache = new Map<
  string,
  { svg: string; naturalWidth: number; naturalHeight: number }
>();

/**
 * Configures Mermaid with `securityLevel: 'loose'` and `startOnLoad: false`,
 * dynamically adapting `wrappingWidth` to the target container width so node rectangle
 * labels wrap and size accurately in dynamic containers.
 */
export function configureMermaidEngine(theme: ReaderTheme = 'cafe', containerWidth = 560): void {
  if (typeof window === 'undefined') return;
  const safeContainerW = Math.max(180, containerWidth || 560);
  const isMobile = safeContainerW < 540;
  // Calculate adaptive wrapping width based on dynamic container width
  const dynamicWrappingWidth = isMobile
    ? Math.max(120, Math.floor(safeContainerW * 0.72))
    : Math.min(240, Math.max(120, Math.floor(safeContainerW * 0.4)));

  const cjkFontStack =
    '"PingFang SC", "Microsoft YaHei", "Plus Jakarta Sans", "Noto Sans SC", sans-serif';

  const sharedFlowchart = {
    htmlLabels: true,
    wrappingWidth: dynamicWrappingWidth,
    padding: isMobile ? 8 : 14,
    nodeSpacing: isMobile ? 26 : 52,
    rankSpacing: isMobile ? 30 : 60,
    curve: 'basis' as const,
    useMaxWidth: true,
  };

  if (theme === 'night') {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      flowchart: sharedFlowchart,
      themeVariables: {
        background: '#1D1814',
        primaryColor: '#2E251F',
        primaryTextColor: '#E6DACB',
        primaryBorderColor: '#D9823B',
        lineColor: '#C4B4A2',
        secondaryColor: '#261F1A',
        tertiaryColor: '#16120F',
        fontFamily: cjkFontStack,
        fontSize: '13px',
      },
    });
  } else if (theme === 'eink') {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      flowchart: sharedFlowchart,
      themeVariables: {
        background: '#F5F5F0',
        primaryColor: '#EAEAE4',
        primaryTextColor: '#111111',
        primaryBorderColor: '#111111',
        lineColor: '#111111',
        secondaryColor: '#DFDFD8',
        tertiaryColor: '#F5F5F0',
        fontFamily: cjkFontStack,
        fontSize: '13px',
      },
    });
  } else if (theme === 'cream') {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      flowchart: sharedFlowchart,
      themeVariables: {
        background: '#FAF3E6',
        primaryColor: '#EBE0CC',
        primaryTextColor: '#3A2518',
        primaryBorderColor: '#C26A32',
        lineColor: '#856853',
        secondaryColor: '#F4E2CE',
        tertiaryColor: '#F7EFE0',
        fontFamily: cjkFontStack,
        fontSize: '13px',
      },
    });
  } else if (theme === 'sandalwood') {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      flowchart: sharedFlowchart,
      themeVariables: {
        background: '#F5EBDC',
        primaryColor: '#E3D4BD',
        primaryTextColor: '#2F2014',
        primaryBorderColor: '#A83E26',
        lineColor: '#78604A',
        secondaryColor: '#EADBC4',
        tertiaryColor: '#F0E4D0',
        fontFamily: cjkFontStack,
        fontSize: '13px',
      },
    });
  } else if (theme === 'candlelight') {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'dark',
      flowchart: sharedFlowchart,
      themeVariables: {
        background: '#2E221A',
        primaryColor: '#3D2E24',
        primaryTextColor: '#ECDCC8',
        primaryBorderColor: '#E08E45',
        lineColor: '#967E67',
        secondaryColor: '#35271E',
        tertiaryColor: '#241A14',
        fontFamily: cjkFontStack,
        fontSize: '13px',
      },
    });
  } else {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      flowchart: sharedFlowchart,
      themeVariables: {
        background: '#FBF7F0',
        primaryColor: '#EFE6D5',
        primaryTextColor: '#2C1E16',
        primaryBorderColor: '#B4532A',
        lineColor: '#7A6352',
        secondaryColor: '#F3DFD1',
        tertiaryColor: '#FAF5EC',
        fontFamily: cjkFontStack,
        fontSize: '13px',
      },
    });
  }
}

/**
 * Sanitizes Mermaid diagram code to prevent syntax errors caused by:
 * 1. Unquoted labels containing special characters: &, #, +, -, :, etc. (e.g. `BM[Burns & McDonnell - DC全球#1]`)
 * 2. Subgraph titles with CJK or special characters without safe IDs (e.g. `subgraph 国际巨头`)
 */
export function sanitizeMermaidCode(rawCode: string): string {
  let cleaned = rawCode
    .replace(/^```(?:mermaid|mmd|flowchart|graph)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  // 1. Auto-quote node labels with special characters (&, #, +, -, :, ;, etc.) if not already quoted
  cleaned = cleaned.replace(
    /(\b[A-Za-z0-9_-]+)(\[|\(|\(\[|\[\(|\{\{)([^"\n\]\)\}>]+)(\]|\)|\)\]|\}\})/g,
    (match, id, open, text, close) => {
      const trimmed = text.trim();
      if (/[&+#:;/]/.test(trimmed) && (!trimmed.startsWith('"') || !trimmed.endsWith('"'))) {
        const escaped = trimmed.replace(/"/g, '\\"');
        return `${id}${open}"${escaped}"${close}`;
      }
      return match;
    }
  );

  // 2. Safe subgraphs with CJK or special characters: subgraph 国际巨头 -> subgraph sg_1 ["国际巨头"]
  let sgCounter = 0;
  cleaned = cleaned.replace(
    /^(\s*subgraph\s+)(?!sg_\d+\s*\[)([^"\n\[\]]+)$/gm,
    (match, prefix, title) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return match;
      const sgId = 'sg_' + (++sgCounter);
      return `${prefix}${sgId} ["${trimmedTitle.replace(/"/g, '\\"')}"]`;
    }
  );

  return cleaned;
}

/**
 * Rewrites Mermaid flowchart/graph direction to `TD` (Top-Down) on mobile/narrow viewports (<540px)
 * so horizontal diagrams (`LR` / `RL`) automatically stack vertically, remaining fully readable.
 */
export function normalizeMermaidDirectionToTD(code: string, forceTD: boolean): string {
  if (!forceTD) return code;
  let updated = code.replace(
    /^(\s*(?:flowchart|graph)\s+)(?:LR|RL|BT|TB)\b/im,
    '$1TD'
  );
  if (/^\s*(?:flowchart|graph)\s*$/im.test(updated)) {
    updated = updated.replace(/^(\s*(?:flowchart|graph))\s*$/im, '$1 TD');
  }
  updated = updated.replace(/^(\s*direction\s+)(?:LR|RL|BT)\b/gim, '$1TD');
  return updated;
}

/**
 * Renders a Mermaid diagram safely through a sequential execution queue and cache,
 * eliminating concurrency race conditions, missing diagrams, and parse failures.
 * Automatically adapts orientation to `TD` on mobile/narrow containers (<540px).
 */
export async function renderMermaidDiagram(
  rawCode: string,
  theme: ReaderTheme = 'cafe',
  containerWidth = 560,
  forceTopDown = false
): Promise<{
  svg: string;
  naturalWidth: number;
  naturalHeight: number;
}> {
  const safeContainerWidth = Math.max(180, containerWidth || 560);
  const shouldForceTD = forceTopDown || (safeContainerWidth > 0 && safeContainerWidth < 540);

  const sanitized = sanitizeMermaidCode(rawCode);
  const cleanCode = normalizeMermaidDirectionToTD(sanitized, shouldForceTD);
  const cacheKey = `v4:::${theme}:::${shouldForceTD ? 'TD' : 'AUTO'}:::${cleanCode}`;

  const cached = mermaidSvgCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Queue render execution sequentially so concurrent calls never corrupt Mermaid's internal state
  const resultPromise = mermaidRenderQueue.then(async () => {
    const existing = mermaidSvgCache.get(cacheKey);
    if (existing) return existing;

    configureMermaidEngine(theme, safeContainerWidth);
    const uniqueId = `mermaid_svg_${Date.now()}_${++mermaidRenderSeq}`;

    let renderResult: { svg: string; bindFunctions?: (element: Element) => void };
    try {
      renderResult = await mermaid.render(uniqueId, cleanCode);
    } catch (errPrimary) {
      // If sanitized/cleanCode fails, fallback to rendering raw code directly
      try {
        const fallbackId = `mermaid_fb_${Date.now()}_${++mermaidRenderSeq}`;
        renderResult = await mermaid.render(fallbackId, rawCode.trim());
      } catch {
        throw errPrimary;
      }
    }

    const rawSvg = renderResult.svg;
    let naturalWidth = safeContainerWidth;
    let naturalHeight = 220;
    let finalSvg = rawSvg;

    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (svgEl) {
          const vbAttr = svgEl.getAttribute('viewBox');
          if (vbAttr) {
            const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
            if (parts.length === 4 && !parts.some(isNaN) && parts[2] > 0 && parts[3] > 0) {
              naturalWidth = Math.round(parts[2]);
              naturalHeight = Math.round(parts[3]);
            }
          }

          svgEl.querySelectorAll('foreignObject').forEach((fo) => {
            fo.setAttribute('overflow', 'visible');
            const div = fo.querySelector('div') as HTMLElement | null;
            if (div) {
              div.style.cssText +=
                '; white-space: normal !important; word-break: break-word !important; overflow-wrap: anywhere !important; text-align: center !important;';
            }
          });

          // Ensure SVG scales responsively without rigid max-width clamping that causes clipping when zoomed
          svgEl.setAttribute('width', '100%');
          svgEl.removeAttribute('height');
          svgEl.setAttribute(
            'style',
            'width: 100%; height: auto; min-width: 100%; overflow: visible; display: block;'
          );
          svgEl.setAttribute('data-natural-width', String(naturalWidth));
          svgEl.setAttribute('data-natural-height', String(naturalHeight));

          // Wrap the SVG in an interactive viewport wrapper to guarantee gesture zoom, CSS zoom,
          // and horizontal scroll panning without forced clipping, especially in narrow reader windows
          finalSvg = `<div class="mermaid-interactive-viewport" style="width: 100%; max-width: 100%; overflow-x: auto; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y pinch-zoom; display: flex; justify-content: center; align-items: center; position: relative;">${svgEl.outerHTML}</div>`;
        }
      } catch {
        finalSvg = `<div class="mermaid-interactive-viewport" style="width: 100%; max-width: 100%; overflow-x: auto; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y pinch-zoom; display: flex; justify-content: center; align-items: center; position: relative;">${rawSvg}</div>`;
      }
    } else {
      finalSvg = `<div class="mermaid-interactive-viewport" style="width: 100%; max-width: 100%; overflow-x: auto; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y pinch-zoom; display: flex; justify-content: center; align-items: center; position: relative;">${rawSvg}</div>`;
    }

    const res = {
      svg: finalSvg,
      naturalWidth: Math.max(180, naturalWidth),
      naturalHeight: Math.max(60, naturalHeight),
    };
    mermaidSvgCache.set(cacheKey, res);
    return res;
  });

  mermaidRenderQueue = resultPromise.catch(() => {});
  return resultPromise;
}

export type ParsedMarkdownBlockType =
  | 'paragraph'
  | 'heading'
  | 'table'
  | 'mermaid'
  | 'code'
  | 'blockquote'
  | 'list'
  | 'hr';

export interface ParsedMarkdownBlock {
  type: ParsedMarkdownBlockType;
  text: string;
  html?: string;
  isHeading: boolean;
  level?: number;
  lang?: string;
  tableHeaders?: string[];
  tableAlign?: ('left' | 'center' | 'right' | null)[];
  tableRows?: string[][];
  ordered?: boolean;
  listItems?: { text: string; html: string; task?: boolean; checked?: boolean }[];
  startOffset: number;
  endOffset: number;
  isContinuation?: boolean;
  start?: number;
}

export interface ExportedMermaidDiagram {
  code: string;
  svg: string;
  svgDataUrl: string;
  pngDataUrl: string;
  width: number;
  height: number;
}

const exportMermaidCache = new Map<string, ExportedMermaidDiagram>();

function getExportPaletteForTheme(themeStyle = 'parchment') {
  if (themeStyle === 'espresso' || themeStyle === 'night' || themeStyle === 'candlelight') {
    return {
      bg: '#211A15',
      surface: '#2C221C',
      nodeFill: '#352820',
      text: '#EAE0D5',
      muted: '#B8A693',
      accent: '#D97724',
      border: '#594436',
      line: '#C4B4A2',
    };
  }
  if (themeStyle === 'eink') {
    return {
      bg: '#F7F7F7',
      surface: '#ECECEC',
      nodeFill: '#E2E2E2',
      text: '#141414',
      muted: '#4A4A4A',
      accent: '#222222',
      border: '#333333',
      line: '#222222',
    };
  }
  if (themeStyle === 'caramel' || themeStyle === 'sandalwood') {
    return {
      bg: '#F7EEDF',
      surface: '#EFE3CE',
      nodeFill: '#E5D4B7',
      text: '#261810',
      muted: '#543B2B',
      accent: '#9E3E16',
      border: '#B87A56',
      line: '#7D604D',
    };
  }
  return {
    bg: '#FBF7F0',
    surface: '#F5EFE4',
    nodeFill: '#EFE6D5',
    text: '#2C1E16',
    muted: '#5C4738',
    accent: '#B4532A',
    border: '#C79272',
    line: '#7A6352',
  };
}

function configureMermaidForPureSvgExport(themeStyle = 'parchment'): void {
  if (typeof window === 'undefined') return;
  const pal = getExportPaletteForTheme(themeStyle);
  const cjkFontStack =
    '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Plus Jakarta Sans", sans-serif';

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: themeStyle === 'espresso' ? 'dark' : 'base',
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
      wrappingWidth: 210,
      padding: 14,
      nodeSpacing: 42,
      rankSpacing: 52,
      curve: 'basis',
      useMaxWidth: false,
    },
    sequence: {
      useMaxWidth: false,
      mirrorActors: false,
    },
    gantt: {
      useMaxWidth: false,
    },
    pie: {
      useMaxWidth: false,
    },
    class: {
      htmlLabels: false,
      useMaxWidth: false,
    },
    state: {
      useMaxWidth: false,
    },
    themeVariables: {
      background: pal.bg,
      primaryColor: pal.nodeFill,
      primaryTextColor: pal.text,
      primaryBorderColor: pal.accent,
      lineColor: pal.line,
      secondaryColor: pal.surface,
      tertiaryColor: pal.bg,
      mainBkg: pal.nodeFill,
      nodeBorder: pal.accent,
      clusterBkg: pal.surface,
      clusterBorder: pal.border,
      titleColor: pal.text,
      edgeLabelBackground: pal.bg,
      fontFamily: cjkFontStack,
      fontSize: '13px',
    },
  });
}

/**
 * Converts any `<foreignObject>` inside a Mermaid SVG into pure native SVG `<text>`/`<tspan>` nodes
 * and ensures explicit numeric `width`, `height`, and `viewBox` attributes so the SVG renders 100%
 * inside `<img>`, `<canvas>` (for jsPDF PNG embedding), print sheets, HTML, and EPUB.
 */
function sanitizeMermaidSvgToPureVector(
  rawSvg: string,
  themeStyle = 'parchment'
): { pureSvg: string; width: number; height: number } {
  const pal = getExportPaletteForTheme(themeStyle);
  let width = 560;
  let height = 260;

  if (typeof DOMParser === 'undefined') {
    return { pureSvg: rawSvg, width, height };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) {
      return { pureSvg: rawSvg, width, height };
    }

    let minX = 0;
    let minY = 0;
    const vbAttr = svgEl.getAttribute('viewBox');
    if (vbAttr) {
      const parts = vbAttr
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length === 4 && !parts.some(isNaN) && parts[2] > 0 && parts[3] > 0) {
        minX = parts[0];
        minY = parts[1];
        width = Math.max(160, Math.ceil(parts[2]));
        height = Math.max(80, Math.ceil(parts[3]));
      }
    } else {
      const wAttr = parseFloat(svgEl.getAttribute('width') || '560');
      const hAttr = parseFloat(svgEl.getAttribute('height') || '260');
      if (!isNaN(wAttr) && wAttr > 0) width = Math.max(160, Math.ceil(wAttr));
      if (!isNaN(hAttr) && hAttr > 0) height = Math.max(80, Math.ceil(hAttr));
    }

    // Add breathing padding around viewBox so borders/labels never clip
    const pad = 12;
    const finalVb = `${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`;
    width += pad * 2;
    height += pad * 2;

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.setAttribute('viewBox', finalVb);
    svgEl.setAttribute('width', String(width));
    svgEl.setAttribute('height', String(height));
    svgEl.setAttribute(
      'style',
      `background-color:${pal.bg};max-width:100%;height:auto;display:block;margin:0 auto;`
    );

    // Replace any remaining <foreignObject> nodes with native SVG <text>/<tspan> elements
    svgEl.querySelectorAll('foreignObject').forEach((fo) => {
      const rawLabel = (fo.textContent || '').replace(/\s+/g, ' ').trim();
      if (!rawLabel) {
        fo.remove();
        return;
      }
      const fx = parseFloat(fo.getAttribute('x') || '0') || 0;
      const fy = parseFloat(fo.getAttribute('y') || '0') || 0;
      const rawW = parseFloat(fo.getAttribute('width') || '0');
      const rawH = parseFloat(fo.getAttribute('height') || '0');
      // Only offset by fw/2 if width/height are genuinely positive; if 0, parent <g> is already centered at (0,0)
      const cx = rawW > 2 ? fx + rawW / 2 : fx;
      const cy = rawH > 2 ? fy + rawH / 2 : fy;
      const wrapW = rawW > 40 ? rawW : 180;

      const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      textEl.setAttribute('x', String(cx));
      textEl.setAttribute('y', String(cy));
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('dominant-baseline', 'central');
      textEl.setAttribute('fill', pal.text);
      textEl.setAttribute('font-size', '12.5');
      textEl.setAttribute('font-weight', '600');
      textEl.setAttribute(
        'font-family',
        "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"
      );

      const maxCharsPerLine = Math.max(10, Math.floor(wrapW / 13));
      const lines: string[] = [];
      for (let idx = 0; idx < rawLabel.length; idx += maxCharsPerLine) {
        lines.push(rawLabel.slice(idx, idx + maxCharsPerLine));
      }

      if (lines.length <= 1) {
        textEl.textContent = rawLabel;
      } else {
        const lineHeight = 15;
        const startOffset = -((lines.length - 1) * lineHeight) / 2;
        lines.forEach((ln, idx) => {
          const tspan = doc.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', String(cx));
          tspan.setAttribute('dy', idx === 0 ? String(startOffset) : String(lineHeight));
          tspan.textContent = ln;
          textEl.appendChild(tspan);
        });
      }

      fo.parentNode?.replaceChild(textEl, fo);
    });

    // Insert background rect as the first visual child so transparent areas match the theme paper
    const bgRect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', String(minX - pad));
    bgRect.setAttribute('y', String(minY - pad));
    bgRect.setAttribute('width', String(width));
    bgRect.setAttribute('height', String(height));
    bgRect.setAttribute('rx', '8');
    bgRect.setAttribute('fill', pal.bg);
    svgEl.insertBefore(bgRect, svgEl.firstChild);

    const serializer = new XMLSerializer();
    const pureSvg = serializer.serializeToString(svgEl);
    return { pureSvg, width, height };
  } catch {
    return { pureSvg: rawSvg, width, height };
  }
}

/**
 * Deterministic pure-SVG diagram synthesizer used as an instant synchronous fallback
 * or if a custom Mermaid snippet contains non-standard syntax, guaranteeing 100% diagram output.
 */
function buildSynthesizedMermaidDiagram(
  rawCode: string,
  themeStyle = 'parchment'
): ExportedMermaidDiagram {
  const pal = getExportPaletteForTheme(themeStyle);
  const cleaned = rawCode
    .replace(/^```(?:mermaid|mmd|flowchart|graph)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const rawLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));

  // Extract nodes & relationships for visual flowchart/diagram layout
  const nodeMap = new Map<string, string>();
  const edges: { from: string; to: string; label?: string }[] = [];
  const subgraphs: { title: string; nodes: string[] }[] = [];
  let activeSubgraph: { title: string; nodes: string[] } | null = null;

  const registerNode = (token: string): string => {
    const t = token.trim();
    const match = t.match(
      /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*(?:\[\s*"?([^"\]]+)"?\s*\]|\(\s*"?([^"\)]+)"?\s*\)|\{\s*"?([^"\}]+)"?\s*\})?$/
    );
    if (match) {
      const id = match[1];
      const label = (match[2] || match[3] || match[4] || id).trim();
      if (!nodeMap.has(id) || nodeMap.get(id) === id) {
        nodeMap.set(id, label);
      }
      if (activeSubgraph && !activeSubgraph.nodes.includes(id)) {
        activeSubgraph.nodes.push(id);
      }
      return id;
    }
    const cleanId = t.replace(/["\[\](){}]/g, '').trim() || `node_${nodeMap.size + 1}`;
    if (!nodeMap.has(cleanId)) {
      nodeMap.set(cleanId, cleanId);
    }
    if (activeSubgraph && !activeSubgraph.nodes.includes(cleanId)) {
      activeSubgraph.nodes.push(cleanId);
    }
    return cleanId;
  };

  for (const line of rawLines) {
    if (/^(?:flowchart|graph|sequenceDiagram|mindmap|gantt|pie|classDiagram|stateDiagram|erDiagram|direction)\b/i.test(line)) {
      continue;
    }
    const sgMatch = line.match(/^subgraph\s+(?:[A-Za-z0-9_]+\s*\[\s*"?([^"\]]+)"?\s*\]|(.+))$/i);
    if (sgMatch) {
      const title = (sgMatch[1] || sgMatch[2] || '模块分组').replace(/"/g, '').trim();
      activeSubgraph = { title, nodes: [] };
      subgraphs.push(activeSubgraph);
      continue;
    }
    if (/^end\b/i.test(line)) {
      activeSubgraph = null;
      continue;
    }

    // Check for edge connections: A --> B, A -->|label| B, A --- B, A ->> B
    const edgeMatch = line.match(
      /^(.+?)\s*(?:-->|---|-\.->|==>|-->>|->>)\s*(?:\|([^|]+)\|)?\s*(.+)$/
    );
    if (edgeMatch) {
      const leftId = registerNode(edgeMatch[1]);
      const edgeLabel = edgeMatch[2]?.trim();
      const rightTargets = edgeMatch[3].split('&').map((s) => s.trim()).filter(Boolean);
      for (const rt of rightTargets) {
        const rightId = registerNode(rt);
        edges.push({ from: leftId, to: rightId, label: edgeLabel });
      }
      continue;
    }

    // Standalone node or item line
    registerNode(line);
  }

  const allNodes = Array.from(nodeMap.entries());
  if (allNodes.length === 0) {
    allNodes.push(['root', cleaned.slice(0, 48) || 'Mermaid 结构图']);
  }

  const cols = allNodes.length <= 4 ? Math.min(2, allNodes.length) : 3;
  const rows = Math.ceil(allNodes.length / cols);
  const width = 540;
  const nodeW = cols === 1 ? 260 : cols === 2 ? 210 : 148;
  const nodeH = 42;
  const gapX = cols === 1 ? 0 : (width - 56 - cols * nodeW) / Math.max(1, cols - 1);
  const gapY = 34;
  const topPad = subgraphs.length > 0 ? 44 : 24;
  const height = Math.max(120, topPad + rows * nodeH + Math.max(0, rows - 1) * gapY + 28);

  const coords = new Map<string, { x: number; y: number; cx: number; cy: number }>();
  const svgParts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color:${pal.bg};max-width:100%;height:auto;display:block;margin:0 auto;">`,
    `<defs><marker id="m_arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="${pal.line}"/></marker></defs>`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="${pal.bg}" stroke="${pal.border}" stroke-width="1"/>`,
  ];

  if (subgraphs.length > 0) {
    const sgTitles = subgraphs.map((s) => s.title).join(' · ');
    svgParts.push(
      `<text x="20" y="24" fill="${pal.accent}" font-size="11" font-weight="700" font-family="'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(
        sgTitles.slice(0, 52)
      )}</text>`
    );
  }

  allNodes.forEach(([id], idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const x = cols === 1 ? (width - nodeW) / 2 : 28 + c * (nodeW + gapX);
    const y = topPad + r * (nodeH + gapY);
    coords.set(id, { x, y, cx: x + nodeW / 2, cy: y + nodeH / 2 });
  });

  // Draw edges
  for (const e of edges) {
    const fromPos = coords.get(e.from);
    const toPos = coords.get(e.to);
    if (!fromPos || !toPos) continue;
    const x1 = fromPos.cx;
    const y1 = fromPos.cy <= toPos.cy ? fromPos.y + nodeH : fromPos.y;
    const x2 = toPos.cx;
    const y2 = fromPos.cy <= toPos.cy ? toPos.y : toPos.y + nodeH;
    svgParts.push(
      `<path d="M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}" fill="none" stroke="${pal.line}" stroke-width="1.4" marker-end="url(#m_arrow)"/>`
    );
  }

  // Draw nodes
  allNodes.forEach(([id, label]) => {
    const pos = coords.get(id)!;
    const displayLabel = label.length > 22 ? label.slice(0, 21) + '…' : label;
    svgParts.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${nodeW}" height="${nodeH}" rx="7" fill="${pal.nodeFill}" stroke="${pal.accent}" stroke-width="1.3"/>`,
      `<text x="${pos.cx}" y="${pos.cy}" text-anchor="middle" dominant-baseline="central" fill="${pal.text}" font-size="11.5" font-weight="600" font-family="'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(
        displayLabel
      )}</text>`
    );
  });

  svgParts.push('</svg>');
  const pureSvg = svgParts.join('');
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pureSvg)}`;
  return {
    code: rawCode.trim(),
    svg: pureSvg,
    svgDataUrl,
    pngDataUrl: '',
    width,
    height,
  };
}

/**
 * Rasterizes a pure native SVG string onto a high-DPI (3.0x Ultra-Retina) offscreen canvas
 * and returns a PNG data URL (`data:image/png;base64,...`) suitable for `jsPDF.addImage`.
 */
export async function rasterizePureSvgToPngDataUrl(
  pureSvg: string,
  width: number,
  height: number,
  bgColor: string
): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return '';
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pureSvg)}`;

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timeout = setTimeout(() => resolve(''), 4000);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const scale = 3.0;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve('');
          return;
        }
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve('');
      }
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve('');
    };
    img.src = svgDataUrl;
  });
}

function getMermaidExportCacheKey(rawCode: string, themeStyle = 'parchment'): string {
  const sanitized = sanitizeMermaidCode(rawCode);
  return `exp_v3:::${themeStyle}:::${sanitized}`;
}

/**
 * Synchronously retrieves a pre-rendered Mermaid diagram for PDF/HTML/EPUB export.
 * Checks exportMermaidCache first, then checks the Reader's live mermaidSvgCache,
 * and falls back to the deterministic pure-SVG diagram synthesizer so zero blocks are omitted.
 */
export function getExportedMermaidDiagramSync(
  rawCode: string,
  themeStyle = 'parchment'
): ExportedMermaidDiagram {
  const key = getMermaidExportCacheKey(rawCode, themeStyle);
  const cached = exportMermaidCache.get(key);
  if (cached) return cached;

  const sanitized = sanitizeMermaidCode(rawCode);
  for (const [liveKey, liveVal] of mermaidSvgCache.entries()) {
    if (liveKey.endsWith(`:::${sanitized}`) && liveVal.svg) {
      const converted = sanitizeMermaidSvgToPureVector(liveVal.svg, themeStyle);
      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(converted.pureSvg)}`;
      return {
        code: rawCode.trim(),
        svg: converted.pureSvg,
        svgDataUrl,
        pngDataUrl: '',
        width: converted.width,
        height: converted.height,
      };
    }
  }

  return buildSynthesizedMermaidDiagram(rawCode, themeStyle);
}

/**
 * Pre-renders a single Mermaid diagram for export (pure native SVG + 3.0x PNG DataURL for jsPDF).
 */
export async function renderMermaidForExport(
  rawCode: string,
  themeStyle = 'parchment'
): Promise<ExportedMermaidDiagram> {
  const key = getMermaidExportCacheKey(rawCode, themeStyle);
  const cached = exportMermaidCache.get(key);
  if (cached && cached.pngDataUrl) {
    return cached;
  }

  const pal = getExportPaletteForTheme(themeStyle);
  const sanitized = sanitizeMermaidCode(rawCode);
  // If a horizontal flowchart has many edges (> 5), normalize to TD so it fits cleanly on an A4 column
  const edgeCount = (sanitized.match(/-->|---|-\.->|==>/g) || []).length;
  const a4AdaptedCode =
    edgeCount > 5 ? normalizeMermaidDirectionToTD(sanitized, true) : sanitized;

  const resultPromise = mermaidRenderQueue.then(async () => {
    const existing = exportMermaidCache.get(key);
    if (existing && existing.pngDataUrl) return existing;

    let pureSvg = '';
    let width = 560;
    let height = 260;

    try {
      configureMermaidForPureSvgExport(themeStyle);
      const uniqueId = `mermaid_exp_${Date.now()}_${++mermaidRenderSeq}`;
      let renderRes: { svg: string };
      try {
        renderRes = await mermaid.render(uniqueId, a4AdaptedCode);
      } catch {
        const fbId = `mermaid_exp_fb_${Date.now()}_${++mermaidRenderSeq}`;
        renderRes = await mermaid.render(fbId, rawCode.trim());
      }
      const converted = sanitizeMermaidSvgToPureVector(renderRes.svg, themeStyle);
      pureSvg = converted.pureSvg;
      width = converted.width;
      height = converted.height;
    } catch {
      const synth = buildSynthesizedMermaidDiagram(rawCode, themeStyle);
      pureSvg = synth.svg;
      width = synth.width;
      height = synth.height;
    }

    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pureSvg)}`;
    const pngDataUrl = await rasterizePureSvgToPngDataUrl(pureSvg, width, height, pal.bg);

    const exported: ExportedMermaidDiagram = {
      code: rawCode.trim(),
      svg: pureSvg,
      svgDataUrl,
      pngDataUrl,
      width,
      height,
    };
    exportMermaidCache.set(key, exported);
    return exported;
  });

  mermaidRenderQueue = resultPromise.catch(() => {});
  return resultPromise;
}

/**
 * Scans a Markdown/TXT document for all Mermaid diagrams (both fenced and unfenced)
 * and warms up their pure-SVG + high-DPI PNG representations in the export cache.
 */
export async function warmUpMermaidDiagramsForContent(
  content: string,
  themeStyle = 'parchment'
): Promise<void> {
  if (!content) return;
  const blocks = parseDocumentWithMarkdownIt(content);
  const mermaidBlocks = blocks.filter((b) => b.type === 'mermaid' && b.text.trim());
  for (const block of mermaidBlocks) {
    await renderMermaidForExport(block.text, themeStyle);
  }
}

/**
 * Custom markdown-it Table plugin (`markdown-it-table` enhancement)
 * Adds editorial cafe styling classes, responsive container wrappers, and tabular numerals
 * to all GFM tables rendered by markdown-it.
 */
export function markdownItTablePlugin(md: any): void {
  md.renderer.rules.table_open = () =>
    '<div class="reader-md-table-wrap my-3.5 overflow-x-auto rounded-xl"><table class="reader-md-table w-full border-collapse text-left text-xs sm:text-sm">';

  md.renderer.rules.table_close = () => '</table></div>';

  md.renderer.rules.thead_open = () => '<thead class="reader-md-thead">';

  md.renderer.rules.th_open = (tokens: any[], idx: number) => {
    const token = tokens[idx];
    const style = token.attrGet('style') || '';
    return `<th class="reader-md-th px-3.5 py-2.5 font-semibold" ${
      style ? `style="${style}"` : ''
    }>`;
  };

  md.renderer.rules.tbody_open = () => '<tbody class="reader-md-tbody">';

  md.renderer.rules.tr_open = () => '<tr class="reader-md-tr">';

  md.renderer.rules.td_open = (tokens: any[], idx: number) => {
    const token = tokens[idx];
    const style = token.attrGet('style') || '';
    return `<td class="reader-md-td tabular-nums px-3.5 py-2" ${
      style ? `style="${style}"` : ''
    }>`;
  };
}

/**
 * Custom markdown-it Mermaid plugin (`markdown-it-mermaid` enhancement)
 * Detects ```mermaid, ```flowchart, ```sequenceDiagram, ```graph, ```mindmap, ```gantt, ```pie
 * code fences and transforms them into structured Mermaid diagram containers.
 * Forces `securityLevel: 'loose'` and `startOnLoad: false` via `configureMermaidEngine`.
 */
export function markdownItMermaidPlugin(md: any): void {
  configureMermaidEngine('cafe', 560);

  const defaultFence =
    md.renderer.rules.fence ||
    function (tokens: any[], idx: number, options: any, _env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };

  md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().toLowerCase();
    const content = token.content.trim();

    if (isMermaidFence(info, content)) {
      const encoded = encodeURIComponent(content);
      return `<div class="md-mermaid-block my-3" data-mermaid="${encoded}"></div>`;
    }

    return defaultFence(tokens, idx, options, env, self);
  };
}

export function isMermaidFence(langInfo: string, codeContent: string): boolean {
  const cleanLang = langInfo.split(/\s+/)[0].toLowerCase();
  if (
    cleanLang === 'mermaid' ||
    cleanLang === 'mmd' ||
    cleanLang === 'flowchart' ||
    cleanLang === 'sequencediagram' ||
    cleanLang === 'mindmap' ||
    cleanLang === 'gantt' ||
    cleanLang === 'classdiagram' ||
    cleanLang === 'statediagram' ||
    cleanLang === 'erdiagram' ||
    cleanLang === 'pie'
  ) {
    return true;
  }
  if (!cleanLang) {
    return /^(?:graph\s+(?:TD|TB|BT|RL|LR)|flowchart\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey)\b/i.test(
      codeContent.trim()
    );
  }
  return false;
}

/**
 * Shared singleton markdown-it instance configured with GFM tables, Mermaid plugin,
 * typographer, and linkify support.
 */
export const mdParser = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  typographer: true,
})
  .enable('table')
  .enable('strikethrough')
  .use(markdownItTablePlugin)
  .use(markdownItMermaidPlugin);

/**
 * Renders inline Markdown syntax (**bold**, *italic*, `code`, ~~strike~~, [link](url)) via markdown-it.
 */
export function renderInlineMarkdown(text: string): string {
  if (!text) return '';
  try {
    return mdParser.renderInline(text);
  } catch {
    return escapeHtml(text);
  }
}

/**
 * Renders full Markdown document to HTML via markdown-it (including tables and inline rendered Mermaid SVGs).
 */
export function renderFullMarkdownToHtml(markdown: string, themeStyle = 'parchment'): string {
  if (!markdown) return '';
  try {
    const wrapped = autoWrapUnfencedMermaid(markdown);
    const rawHtml = mdParser.render(wrapped);
    // Replace any <div class="md-mermaid-block" data-mermaid="..."></div> with actual rendered pure SVG diagrams
    return rawHtml.replace(
      /<div class="md-mermaid-block[^"]*" data-mermaid="([^"]+)"><\/div>/g,
      (_match, encoded) => {
        try {
          const decoded = decodeURIComponent(encoded);
          const diag = getExportedMermaidDiagramSync(decoded, themeStyle);
          return `<figure class="mermaid-export-figure" style="margin:18px 0;padding:14px;border-radius:12px;border:1px solid rgba(180,83,42,0.28);page-break-inside:avoid;break-inside:avoid;text-align:center;overflow-x:auto;">${diag.svg}</figure>`;
        } catch {
          return _match;
        }
      }
    );
  } catch {
    return `<p>${escapeHtml(markdown)}</p>`;
  }
}

/**
 * Automatically detects unfenced Mermaid diagrams in raw text or imported TXT/Markdown documents
 * and wraps them in ```mermaid ... ``` code fences so markdown-it parses them as diagrams.
 */
export function autoWrapUnfencedMermaid(content: string): string {
  if (!content) return '';
  const lines = content.split('\n');
  const result: string[] = [];
  let inFence = false;
  let inMermaid = false;
  let mermaidBuffer: string[] = [];

  const mermaidStartRegex =
    /^\s*(?:flowchart\s+(?:TD|TB|BT|RL|LR)|graph\s+(?:TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      if (inMermaid) {
        result.push('```mermaid\n' + mermaidBuffer.join('\n') + '\n```');
        mermaidBuffer = [];
        inMermaid = false;
      }
      result.push(line);
      continue;
    }

    if (inFence) {
      result.push(line);
      continue;
    }

    if (!inMermaid && mermaidStartRegex.test(trimmed)) {
      inMermaid = true;
      mermaidBuffer.push(line);
      continue;
    }

    if (inMermaid) {
      const isHeading = /^#{1,6}\s+/.test(trimmed);
      const isHr = /^---+$/.test(trimmed);
      const isNormalProse =
        trimmed.length > 0 &&
        !trimmed.startsWith('subgraph') &&
        !trimmed.startsWith('end') &&
        !trimmed.includes('-->') &&
        !trimmed.includes('---') &&
        /^[^\s\-><&|()\[\]{}:]+[，。！？；]/.test(trimmed);

      if (isHeading || isHr || isNormalProse) {
        result.push('```mermaid\n' + mermaidBuffer.join('\n') + '\n```');
        mermaidBuffer = [];
        inMermaid = false;
        result.push(line);
      } else {
        mermaidBuffer.push(line);
      }
      continue;
    }

    result.push(line);
  }

  if (inMermaid && mermaidBuffer.length > 0) {
    result.push('```mermaid\n' + mermaidBuffer.join('\n') + '\n```');
  }

  return result.join('\n');
}

/**
 * Parses a document (Markdown or TXT) into atomic blocks using markdown-it's token stream (`mdParser.parse`).
 * Guarantees that GFM tables, Mermaid diagrams, code blocks, blockquotes, and task lists are extracted
 * accurately with their full structure and rendered HTML.
 */
export function parseDocumentWithMarkdownIt(content: string): ParsedMarkdownBlock[] {
  const wrapped = autoWrapUnfencedMermaid(content);
  const normalized = normalizeLineEndings(wrapped);
  const lines = normalized.split('\n');

  // Precompute character offsets at the start of each line (0-indexed line numbers)
  const lineStartOffsets: number[] = new Array(lines.length + 1);
  let accOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStartOffsets[i] = accOffset;
    accOffset += lines[i].length + 1;
  }
  lineStartOffsets[lines.length] = normalized.length;

  const getOffsetsForMap = (map: [number, number] | null | undefined): { start: number; end: number } => {
    if (!map) return { start: 0, end: normalized.length };
    const startLine = Math.max(0, Math.min(lines.length, map[0]));
    const endLine = Math.max(startLine, Math.min(lines.length, map[1]));
    return {
      start: lineStartOffsets[startLine] ?? 0,
      end: lineStartOffsets[endLine] ?? normalized.length,
    };
  };

  const tokens = mdParser.parse(normalized, {});
  const blocks: ParsedMarkdownBlock[] = [];

  const headingRegex =
    /^\s*(?:第[零一二三四五六七八九十百千万0-9]+[章回节卷集部篇].*|(?:序章|楔子|引子|前言|尾声|后记)(?:\s+.*|$)|Chapter\s+\d+.*)$/i;

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    // 1. Headings (#, ##, ###)
    if (token.type === 'heading_open') {
      const level = Number(token.tag.replace('h', '')) || 2;
      const inlineToken = tokens[i + 1];
      const text = inlineToken?.content?.trim() || '';
      const { start, end } = getOffsetsForMap(token.map);
      blocks.push({
        type: 'heading',
        text,
        html: renderInlineMarkdown(text),
        isHeading: true,
        level,
        startOffset: start,
        endOffset: end,
      });
      i += 3; // heading_open, inline, heading_close
      continue;
    }

    // 2. Code Fences & Mermaid Diagrams
    if (token.type === 'fence' || token.type === 'code_block') {
      const info = (token.info || '').trim();
      const rawCode = token.content.replace(/\n$/, '');
      const { start, end } = getOffsetsForMap(token.map);

      if (isMermaidFence(info, rawCode)) {
        blocks.push({
          type: 'mermaid',
          text: rawCode,
          isHeading: false,
          lang: 'mermaid',
          startOffset: start,
          endOffset: end,
        });
      } else {
        blocks.push({
          type: 'code',
          text: rawCode,
          isHeading: false,
          lang: info || 'text',
          startOffset: start,
          endOffset: end,
        });
      }
      i += 1;
      continue;
    }

    // 3. Markdown Tables (table_open ... table_close)
    if (token.type === 'table_open') {
      const { start, end } = getOffsetsForMap(token.map);
      const tableTokens: typeof tokens = [];
      const headers: string[] = [];
      const aligns: ('left' | 'center' | 'right' | null)[] = [];
      const rows: string[][] = [];

      let currentRow: string[] = [];
      let inThead = false;
      let inTbody = false;

      while (i < tokens.length && tokens[i].type !== 'table_close') {
        const t = tokens[i];
        tableTokens.push(t);

        if (t.type === 'thead_open') inThead = true;
        if (t.type === 'thead_close') inThead = false;
        if (t.type === 'tbody_open') inTbody = true;
        if (t.type === 'tbody_close') inTbody = false;

        if (t.type === 'tr_open') {
          currentRow = [];
        } else if (t.type === 'th_open') {
          const style = String(t.attrGet('style') || '');
          if (style.includes('center')) aligns.push('center');
          else if (style.includes('right')) aligns.push('right');
          else if (style.includes('left')) aligns.push('left');
          else aligns.push(null);
        } else if (t.type === 'inline') {
          currentRow.push(t.content.trim());
        } else if (t.type === 'tr_close') {
          if (inThead) {
            headers.push(...currentRow);
          } else if (inTbody) {
            rows.push(currentRow);
          }
        }
        i++;
      }
      if (i < tokens.length && tokens[i].type === 'table_close') {
        tableTokens.push(tokens[i]);
        i++;
      }

      const tableHtml = mdParser.renderer.render(tableTokens, mdParser.options, {});
      blocks.push({
        type: 'table',
        text: headers.join(' | '),
        html: tableHtml,
        isHeading: false,
        tableHeaders: headers,
        tableAlign: aligns,
        tableRows: rows,
        startOffset: start,
        endOffset: end,
      });
      continue;
    }

    // 4. Blockquotes (blockquote_open ... blockquote_close)
    if (token.type === 'blockquote_open') {
      const { start, end } = getOffsetsForMap(token.map);
      const quoteLines: string[] = [];
      i++;
      while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
        if (tokens[i].type === 'inline') {
          quoteLines.push(tokens[i].content.trim());
        }
        i++;
      }
      if (i < tokens.length && tokens[i].type === 'blockquote_close') i++;
      const joined = quoteLines.join('\n');
      blocks.push({
        type: 'blockquote',
        text: joined,
        html: renderInlineMarkdown(joined),
        isHeading: false,
        startOffset: start,
        endOffset: end,
      });
      continue;
    }

    // 5. Bullet & Ordered Lists (including Task Lists - [x] / - [ ])
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const ordered = token.type === 'ordered_list_open';
      const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close';
      const { start, end } = getOffsetsForMap(token.map);
      const items: { text: string; html: string; task?: boolean; checked?: boolean }[] = [];

      let depth = 1;
      i++;
      while (i < tokens.length && depth > 0) {
        const t = tokens[i];
        if (t.type === token.type) depth++;
        else if (t.type === closeType) depth--;

        if (depth > 0 && t.type === 'inline') {
          const rawItem = t.content.trim();
          const taskMatch = rawItem.match(/^\[([ xX])\]\s*([\s\S]*)$/);
          if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === 'x';
            const cleanText = taskMatch[2].trim();
            items.push({
              text: cleanText,
              html: renderInlineMarkdown(cleanText),
              task: true,
              checked,
            });
          } else {
            items.push({
              text: rawItem,
              html: renderInlineMarkdown(rawItem),
              task: false,
            });
          }
        }
        i++;
      }

      blocks.push({
        type: 'list',
        text: items.map((it) => it.text).join('\n'),
        isHeading: false,
        ordered,
        listItems: items,
        startOffset: start,
        endOffset: end,
      });
      continue;
    }

    // 6. Horizontal Rule
    if (token.type === 'hr') {
      const { start, end } = getOffsetsForMap(token.map);
      blocks.push({
        type: 'hr',
        text: '---',
        isHeading: false,
        startOffset: start,
        endOffset: end,
      });
      i++;
      continue;
    }

    // 7. Paragraphs (split multi-line TXT paragraphs cleanly while preserving inline Markdown)
    if (token.type === 'paragraph_open') {
      const { start, end } = getOffsetsForMap(token.map);
      const inlineToken = tokens[i + 1];
      const rawContent = inlineToken?.content || '';
      const subLines = rawContent.split('\n');
      let subCursor = start;

      for (const sub of subLines) {
        const trimmed = sub.trim();
        const subEnd = Math.min(end, subCursor + sub.length);
        if (trimmed) {
          const isChHeading = trimmed.length <= 60 && headingRegex.test(trimmed);
          blocks.push({
            type: isChHeading ? 'heading' : 'paragraph',
            text: trimmed,
            html: renderInlineMarkdown(trimmed),
            isHeading: isChHeading,
            level: isChHeading ? 2 : undefined,
            startOffset: subCursor,
            endOffset: subEnd,
          });
        }
        subCursor = subEnd + 1;
      }

      i += 3; // paragraph_open, inline, paragraph_close
      continue;
    }

    i++;
  }

  return blocks;
}

/**
 * Automatically detects UTF-8 vs GB18030/GBK/Big5 encoding from an ArrayBuffer
 * and returns decoded clean text along with the detected encoding label.
 */
export function decodeFileBuffer(buffer: ArrayBuffer): { text: string; encoding: string } {
  const uint8 = new Uint8Array(buffer);

  if (uint8.length >= 3 && uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
    const decoder = new TextDecoder('utf-8');
    return { text: normalizeLineEndings(decoder.decode(uint8.subarray(3))), encoding: 'UTF-8 (BOM)' };
  }

  if (uint8.length >= 2 && uint8[0] === 0xff && uint8[1] === 0xfe) {
    const decoder = new TextDecoder('utf-16le');
    return { text: normalizeLineEndings(decoder.decode(uint8.subarray(2))), encoding: 'UTF-16LE' };
  }
  if (uint8.length >= 2 && uint8[0] === 0xfe && uint8[1] === 0xff) {
    const decoder = new TextDecoder('utf-16be');
    return { text: normalizeLineEndings(decoder.decode(uint8.subarray(2))), encoding: 'UTF-16BE' };
  }

  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    const text = utf8Decoder.decode(uint8);
    return { text: normalizeLineEndings(text), encoding: 'UTF-8' };
  } catch {
    try {
      const gbkDecoder = new TextDecoder('gb18030', { fatal: false });
      const text = gbkDecoder.decode(uint8);
      return { text: normalizeLineEndings(text), encoding: 'GB18030 / GBK' };
    } catch {
      const fallbackDecoder = new TextDecoder('utf-8');
      return { text: normalizeLineEndings(fallbackDecoder.decode(uint8)), encoding: 'UTF-8' };
    }
  }
}

export function normalizeLineEndings(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/**
 * Extracts chapter table of contents using multi-pattern regex matching while ignoring code fences.
 */
export function extractChapters(content: string, _format: BookFormat): Chapter[] {
  const lines = content.split('\n');
  const rawChapters: { title: string; level: number; startOffset: number }[] = [];

  const txtChapterRegex =
    /^\s*(?:第[零一二三四五六七八九十百千万0-9]+[章回节卷集部篇]|(?:序章|楔子|引子|前言|序言|尾声|后记|番外)(?:\s+.*|$)|Chapter\s+\d+.*|Part\s+\d+.*)\s*$/i;
  const mdHeadingRegex = /^\s*(#{1,4})\s+(.+)$/;
  const fenceRegex = /^\s*```/;

  let runningOffset = 0;
  let insideFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (fenceRegex.test(trimmed)) {
      insideFence = !insideFence;
      runningOffset += line.length + 1;
      continue;
    }

    if (!insideFence && trimmed.length > 0 && trimmed.length <= 72) {
      const mdMatch = trimmed.match(mdHeadingRegex);
      if (mdMatch) {
        rawChapters.push({
          title: mdMatch[2].trim(),
          level: mdMatch[1].length,
          startOffset: runningOffset,
        });
        runningOffset += line.length + 1;
        continue;
      }

      if (txtChapterRegex.test(trimmed)) {
        const isVolume = /^\s*第[零一二三四五六七八九十百千万0-9]+[卷集部]/.test(trimmed);
        rawChapters.push({
          title: trimmed.replace(/^#{1,4}\s+/, ''),
          level: isVolume ? 1 : 2,
          startOffset: runningOffset,
        });
      }
    }

    runningOffset += line.length + 1;
  }

  if (rawChapters.length === 0) {
    const chunkSize = 3500;
    const totalLen = content.length;
    if (totalLen <= chunkSize) {
      return [
        {
          id: 'ch-0',
          title: '全篇正文',
          level: 1,
          startOffset: 0,
          endOffset: totalLen,
          wordCount: totalLen,
        },
      ];
    }

    const fallbackChapters: Chapter[] = [];
    let offset = 0;
    let index = 1;
    while (offset < totalLen) {
      let nextEnd = Math.min(offset + chunkSize, totalLen);
      if (nextEnd < totalLen) {
        const nextNewline = content.indexOf('\n', nextEnd);
        if (nextNewline !== -1 && nextNewline - nextEnd < 400) {
          nextEnd = nextNewline + 1;
        }
      }
      fallbackChapters.push({
        id: `ch-${index}`,
        title: `第 ${index} 节`,
        level: 1,
        startOffset: offset,
        endOffset: nextEnd,
        wordCount: nextEnd - offset,
      });
      offset = nextEnd;
      index++;
    }
    return fallbackChapters;
  }

  if (rawChapters[0].startOffset > 60) {
    rawChapters.unshift({
      title: '扉页与引子',
      level: 1,
      startOffset: 0,
    });
  } else {
    rawChapters[0].startOffset = 0;
  }

  return rawChapters.map((item, idx) => {
    const endOffset =
      idx < rawChapters.length - 1 ? rawChapters[idx + 1].startOffset : content.length;
    return {
      id: `ch-${idx + 1}`,
      title: item.title,
      level: item.level,
      startOffset: item.startOffset,
      endOffset,
      wordCount: Math.max(0, endOffset - item.startOffset),
    };
  });
}

/**
 * Generates a standalone, styled HTML Reading Notebook using markdown-it to render tables and Mermaid blocks.
 */
export function buildHtmlNotebookExport(
  book: Book,
  annotations: Annotation[],
  includeFullText: boolean
): string {
  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const sortedAnnotations = [...annotations].sort((a, b) => a.charOffset - b.charOffset);

  const notesHtml =
    sortedAnnotations.length === 0
      ? `<p class="empty">暂无书签或高亮批注记录。</p>`
      : sortedAnnotations
          .map(
            (ann, idx) => `
      <div class="note-card">
        <div class="note-meta">
          <span>#${String(idx + 1).padStart(2, '0')} · ${escapeHtml(ann.chapterTitle)}</span>
          <span>字符位置 ${ann.charOffset} · ${new Date(ann.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
        <blockquote class="quote">${escapeHtml(ann.selectedText)}</blockquote>
        ${ann.noteText ? `<p class="thought"><strong>随笔批注：</strong>${escapeHtml(ann.noteText)}</p>` : ''}
      </div>`
          )
          .join('\n');

  const manuscriptHtml = includeFullText
    ? `<section class="manuscript">
        <h2>全书正文归档</h2>
        ${renderFullMarkdownToHtml(book.content)}
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>&#8203;</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 0mm;
    }
    body {
      background-color: #F6F0E6;
      color: #2C1E16;
      font-family: "Songti SC", "Noto Serif SC", Georgia, serif;
      line-height: 1.85;
      margin: 0;
      padding: 48px 24px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @media print {
      body {
        background-color: #FBF7F0;
        padding: 16mm;
      }
      .container {
        border: none;
        box-shadow: none;
        padding: 0;
        max-width: 100%;
      }
    }
    .container {
      max-width: 780px;
      margin: 0 auto;
      background: #FBF7F0;
      border: 1px solid #DECBB3;
      border-radius: 16px;
      padding: 48px;
      box-shadow: 0 12px 32px rgba(44, 30, 22, 0.08);
    }
    header {
      border-bottom: 1px solid #DECBB3;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .kicker {
      font-size: 12px;
      color: #B4532A;
      letter-spacing: 0.08em;
    }
    h1 {
      font-size: 30px;
      margin: 8px 0;
      color: #2C1E16;
    }
    .meta {
      font-size: 13px;
      color: #7A6352;
    }
    h2 {
      font-size: 20px;
      color: #544032;
      margin-top: 36px;
      margin-bottom: 16px;
      border-bottom: 1px dashed #DECBB3;
      padding-bottom: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    th, td {
      border: 1px solid #DECBB3;
      padding: 8px 12px;
      font-size: 14px;
    }
    th {
      background: #EFE6D5;
    }
    .note-card {
      background: #F6F0E6;
      border: 1px solid #DECBB3;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .note-meta {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #7A6352;
      margin-bottom: 10px;
    }
    .quote {
      margin: 0;
      padding: 8px 14px;
      background: #FBF7F0;
      border-radius: 8px;
      color: #2C1E16;
      font-style: italic;
    }
    .thought {
      margin: 12px 0 0 0;
      font-size: 14px;
      color: #544032;
    }
    footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid #DECBB3;
      font-size: 12px;
      color: #7A6352;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>《${escapeHtml(book.title)}》</h1>
      <div class="meta">
        作者：${escapeHtml(book.author)} · 分类：${escapeHtml(book.category)} · 全书字数：${book.totalChars.toLocaleString()} 字 · ${dateStr}
      </div>
    </header>
    <section>
      <h2>精选书摘与随笔批注（共 ${sortedAnnotations.length} 条）</h2>
      ${notesHtml}
    </section>
    ${manuscriptHtml}
  </div>
</body>
</html>`;
}

export interface TxtExportOptions {
  includeFullText?: boolean;
  includeNotes?: boolean;
  includeExcerpts?: boolean;
  includeOutline?: boolean;
  selectedChapterIds?: string[];
}

export function buildTxtExport(
  book: Book,
  annotations: Annotation[],
  includeFullTextOrOpts: boolean | TxtExportOptions
): string {
  const opts: TxtExportOptions =
    typeof includeFullTextOrOpts === 'boolean'
      ? {
          includeFullText: includeFullTextOrOpts,
          includeNotes: true,
          includeExcerpts: true,
          includeOutline: true,
          selectedChapterIds: [],
        }
      : includeFullTextOrOpts;

  const showFullText = Boolean(opts.includeFullText);
  const showNotes = opts.includeNotes ?? true;
  const showExcerpts = opts.includeExcerpts ?? true;
  const showOutline = opts.includeOutline ?? true;
  const allChapters =
    book.chapters && book.chapters.length > 0
      ? book.chapters
      : extractChapters(book.content, book.format);
  const selectedIds = opts.selectedChapterIds || [];
  const chapters =
    selectedIds.length > 0
      ? allChapters.filter((ch) => selectedIds.includes(ch.id))
      : allChapters;

  const lines: string[] = [
    `================================================`,
    `《${book.title}》 — 读书笔记与书摘归档`,
    `作者：${book.author}  ·  分类：${book.category}  ·  总字数：${book.totalChars} 字`,
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `================================================`,
    ``,
  ];

  if (showOutline && chapters.length > 0) {
    lines.push(`【章节目录大纲 (${chapters.length} 节)】`, ``);
    chapters.forEach((ch, idx) => {
      const indent = '  '.repeat(Math.max(0, (ch.level || 1) - 1));
      lines.push(`${indent}${String(idx + 1).padStart(2, '0')}. ${ch.title} (${ch.wordCount} 字)`);
    });
    lines.push(``);
  }

  if (showNotes || showExcerpts) {
    const sorted = [...annotations].sort((a, b) => a.charOffset - b.charOffset);
    const filteredAnns =
      !showExcerpts && showNotes
        ? sorted.filter((a) => Boolean(a.noteText && a.noteText.trim()))
        : sorted;

    lines.push(`【书签与高亮书摘 (${filteredAnns.length} 条)】`, ``);
    if (filteredAnns.length === 0) {
      lines.push('（暂无书签或批注）', '');
    } else {
      filteredAnns.forEach((ann, i) => {
        lines.push(`${i + 1}. [${ann.chapterTitle}] (位置 ${ann.charOffset})`);
        if (showExcerpts) {
          lines.push(`   「${ann.selectedText}」`);
        }
        if (showNotes && ann.noteText) {
          lines.push(`   批注：${ann.noteText}`);
        }
        lines.push('');
      });
    }
  }

  if (showFullText) {
    const bodyText =
      selectedIds.length > 0
        ? chapters.map((ch) => book.content.slice(ch.startOffset, ch.endOffset).trim()).join('\n\n')
        : book.content;
    lines.push(
      `================================================`,
      `【正文归档】`,
      `================================================`,
      ``,
      bodyText
    );
  }

  return lines.join('\n');
}

export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 15000);
}

export function validateBackupJson(raw: string): FullLibraryBackup | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.books) && Array.isArray(parsed.annotations)) {
      return parsed as FullLibraryBackup;
    }
    return null;
  } catch {
    return null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
