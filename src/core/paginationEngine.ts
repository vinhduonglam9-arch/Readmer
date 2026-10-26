import { Chapter, ReaderSettings } from '../types/reader';
import {
  ParsedMarkdownBlock,
  ParsedMarkdownBlockType,
  parseDocumentWithMarkdownIt,
  renderInlineMarkdown,
} from './parserEngine';

export type PageBlockType = ParsedMarkdownBlockType;
export type PageBlock = ParsedMarkdownBlock;

export interface VirtualPage {
  pageNumber: number; // 1-indexed
  startOffset: number;
  endOffset: number;
  paragraphs: PageBlock[];
  chapterTitle: string;
}

export interface PaginationDimension {
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Estimates how many vertical text-line equivalents a ParsedMarkdownBlock occupies,
 * dynamically adapting to the current page width and line height so charts and tables
 * never overflow or overlap across small, medium, or double-page window sizes.
 */
function estimateBlockLines(
  block: PageBlock,
  charsPerLine: number,
  indentFirstLine: boolean,
  spacingLines: number,
  lineHeightPx = 28
): number {
  switch (block.type) {
    case 'mermaid': {
      const rawLines = block.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('%%'));
      const statementCount = Math.max(2, rawLines.length - 1);
      const isMobile = charsPerLine < 26;
      const estimatedDiagramPx = isMobile
        ? Math.min(210, 75 + statementCount * 22)
        : Math.min(270, 95 + statementCount * 22);
      const neededLines =
        (estimatedDiagramPx / Math.max(20, lineHeightPx)) +
        spacingLines * 0.35 +
        0.2;
      return Math.max(4.5, neededLines);
    }
    case 'table': {
      const rowCount = (block.tableRows || []).length;
      return Math.min(16, 1.2 + rowCount * 1.15) + spacingLines * 0.35;
    }
    case 'code': {
      const lines = block.text.split('\n').length;
      return lines * 0.85 + 1.1 + spacingLines * 0.35;
    }
    case 'blockquote': {
      const lines = Math.max(1, Math.ceil(block.text.length / Math.max(10, charsPerLine - 2)));
      return lines + 0.5 + spacingLines * 0.35;
    }
    case 'list': {
      const items = block.listItems || [];
      let total = 0.2;
      for (const item of items) {
        total += Math.max(1, Math.ceil(item.text.length / charsPerLine)) + 0.15;
      }
      return total + spacingLines * 0.35;
    }
    case 'hr':
      return 0.8;
    case 'heading': {
      const lines = Math.max(1, Math.ceil(block.text.length / Math.max(10, charsPerLine * 0.85)));
      return lines + 0.4 + spacingLines * 0.35;
    }
    case 'paragraph':
    default: {
      const indent = indentFirstLine && !block.isContinuation ? 2 : 0;
      const lines = Math.max(1, Math.ceil((block.text.length + indent) / charsPerLine));
      return lines + spacingLines * 0.45;
    }
  }
}

function isInsideMarkdownDelimiter(text: string, idx: number): boolean {
  const prefix = text.slice(0, idx);
  const backticks = (prefix.match(/`/g) || []).length;
  if (backticks % 2 !== 0) return true;
  const asterisks = (prefix.match(/\*/g) || []).length;
  if (asterisks % 2 !== 0) return true;
  return false;
}

/**
 * Finds a safe split index near `targetLength` at a natural CJK/English sentence boundary
 * so inline Markdown (`**bold**`, `*italic*`, `` `code` ``) and words are never cut in half,
 * while tightly packing text down to the bottom margin.
 */
function findSafeSentenceSplitLength(
  text: string,
  targetLength: number,
  charsPerLine = 20
): number {
  if (targetLength >= text.length) return text.length;
  // Look back at most 38% of line width to find a punctuation boundary,
  // preventing loose gaps at the bottom of the page.
  const lookbackSpan = Math.min(16, Math.max(6, Math.floor(charsPerLine * 0.38)));
  const minLookback = Math.max(6, targetLength - lookbackSpan);

  // 1. First priority: strong sentence-ending punctuation (period, exclamation, question mark, ellipsis)
  const sentencePunct = '。！？；…\n.!?';
  for (let i = targetLength; i >= minLookback; i--) {
    if (sentencePunct.includes(text[i - 1])) {
      if (!isInsideMarkdownDelimiter(text, i)) {
        return i;
      }
    }
  }

  // 2. Second priority: clause-ending punctuation (comma, colon, dash, quotes, brackets)
  const clausePunct = '，、：:—“”‘’()（）';
  for (let i = targetLength; i >= minLookback; i--) {
    if (clausePunct.includes(text[i - 1])) {
      if (!isInsideMarkdownDelimiter(text, i)) {
        return i;
      }
    }
  }

  // 3. Third priority: space delimiter for Latin text
  for (let i = targetLength; i >= minLookback; i--) {
    if (text[i - 1] === ' ') {
      return i;
    }
  }

  // 4. Default: split at targetLength safely without breaking inside markdown delimiters
  let safeIdx = targetLength;
  while (safeIdx > minLookback && isInsideMarkdownDelimiter(text, safeIdx)) {
    safeIdx--;
  }
  return safeIdx;
}

/**
 * Computes virtual pages from raw book content using markdown-it AST blocks (`parseDocumentWithMarkdownIt`).
 * Tightly packs paragraphs across page boundaries so the text completely fills the reading window
 * down to the bottom margin without artificial whitespace or overflowing.
 */
export function getMaxColumnWidthPx(mode: ReaderSettings['maxColumnWidth']): number | null {
  if (mode === 'narrow') return 820;
  if (mode === 'standard') return 1280;
  if (mode === 'wide') return 1680;
  return null; // 'full' -> unrestricted
}

export function paginateBookContent(
  content: string,
  chapters: Chapter[],
  settings: ReaderSettings,
  dimension: PaginationDimension,
  isSpreadMode: boolean,
  preParsedBlocks?: ParsedMarkdownBlock[]
): VirtualPage[] {
  if (!content || content.length === 0) {
    return [
      {
        pageNumber: 1,
        startOffset: 0,
        endOffset: 0,
        paragraphs: [
          {
            type: 'paragraph',
            text: '（空文档）',
            html: '（空文档）',
            isHeading: false,
            startOffset: 0,
            endOffset: 0,
          },
        ],
        chapterTitle: '正文',
      },
    ];
  }

  const isMobile = dimension.viewportWidth < 640;
  const horizontalPadding = isSpreadMode
    ? (isMobile ? 24 : Math.max(24, Math.min(settings.pageMargin * 1.2, 64)))
    : (isMobile ? 20 : Math.max(20, Math.min(settings.pageMargin, 56)));
  const rawSingleWidth = Math.max(280, dimension.viewportWidth - horizontalPadding);
  const measureLimitPx = !isSpreadMode ? getMaxColumnWidthPx(settings.maxColumnWidth) : null;
  const singlePageWidth = isSpreadMode
    ? Math.max(260, (dimension.viewportWidth - horizontalPadding - 28) / 2)
    : measureLimitPx
      ? Math.min(rawSingleWidth, measureLimitPx)
      : rawSingleWidth;

  // Vertical chrome calculation for frameless full-bleed reading canvas:
  // Maximizes vertical lines per page across mobile, tablet, and desktop
  const verticalChrome = isMobile ? 74 : 104;
  const usableHeight = Math.max(280, dimension.viewportHeight - verticalChrome);

  // In CJK typography, character glyphs are square with 1em width.
  const effectiveCharWidth = settings.fontSize * (1.0 + Math.max(0, settings.letterSpacing));
  const charsPerLine = Math.max(12, Math.floor(singlePageWidth / effectiveCharWidth));
  const lineHeightPx = settings.fontSize * settings.lineHeight;
  const maxLinesPerPage = Math.max(6, Math.floor(usableHeight / lineHeightPx));
  const spacingLines = settings.paragraphSpacing / lineHeightPx;

  const blocks = preParsedBlocks || parseDocumentWithMarkdownIt(content);
  const pages: VirtualPage[] = [];

  let currentBlocks: PageBlock[] = [];
  let currentLinesUsed = 0;
  let pageStartOffset = 0;

  const flushPage = (endOffset: number) => {
    if (currentBlocks.length === 0) return;
    const chapterTitle = findChapterTitleAtOffset(chapters, pageStartOffset);
    const safeEnd = Math.max(pageStartOffset + 1, endOffset);
    pages.push({
      pageNumber: pages.length + 1,
      startOffset: pageStartOffset,
      endOffset: safeEnd,
      paragraphs: currentBlocks,
      chapterTitle,
    });
    currentBlocks = [];
    currentLinesUsed = 0;
    pageStartOffset = safeEnd;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block: PageBlock = blocks[i];

    // 1. Level 1 Major Chapter Headings (# 第一章): always start on a fresh page
    if (
      block.type === 'heading' &&
      block.level === 1 &&
      currentBlocks.length > 0 &&
      currentLinesUsed >= 3
    ) {
      flushPage(block.startOffset);
    }

    // 2. Headings: Anti-orphan logic
    // Never leave a heading alone on an empty page, nor stranded at the bottom of a page without content
    if (block.type === 'heading') {
      const headingLines = estimateBlockLines(
        block,
        charsPerLine,
        false,
        spacingLines,
        lineHeightPx
      );
      if (currentBlocks.length > 0) {
        // Look ahead to check whether at least part of the following block can fit
        const nextBlock = blocks[i + 1];
        const nextMinLines = nextBlock
          ? Math.min(2.5, estimateBlockLines(nextBlock, charsPerLine, false, spacingLines, lineHeightPx))
          : 1.5;
        if (currentLinesUsed + headingLines + nextMinLines > maxLinesPerPage + 0.4) {
          flushPage(block.startOffset);
        }
      }
      currentBlocks.push(block);
      currentLinesUsed += headingLines;
      continue;
    }

    // 3. Lists: Continuous splitting across page boundaries
    if (block.type === 'list' && (block.listItems || []).length > 0) {
      let listBlock = block;
      while (listBlock && (listBlock.listItems || []).length > 0) {
        const items = listBlock.listItems!;
        const remainingLines = maxLinesPerPage - currentLinesUsed;
        const fullNeeded = estimateBlockLines(
          listBlock,
          charsPerLine,
          false,
          spacingLines,
          lineHeightPx
        );

        // Entire list fits on current page
        if (fullNeeded <= remainingLines + 0.6) {
          currentBlocks.push(listBlock);
          currentLinesUsed += fullNeeded;
          if (currentLinesUsed >= maxLinesPerPage && i < blocks.length - 1) {
            flushPage(listBlock.endOffset);
          }
          break;
        }

        // Partial list fits on current page (must fit at least 1 item)
        if (remainingLines >= 1.5 && items.length > 1) {
          let fitCount = 0;
          let testLines = 0.2;
          for (let idx = 0; idx < items.length; idx++) {
            const itemLines =
              Math.max(1, Math.ceil(items[idx].text.length / charsPerLine)) + 0.15;
            if (testLines + itemLines <= remainingLines + 0.4) {
              testLines += itemLines;
              fitCount++;
            } else {
              break;
            }
          }

          if (fitCount > 0 && fitCount < items.length) {
            const sliceItems = items.slice(0, fitCount);
            const remainderItems = items.slice(fitCount);
            currentBlocks.push({
              ...listBlock,
              listItems: sliceItems,
              text: sliceItems.map((it) => it.text).join('\n'),
            });
            currentLinesUsed += testLines;
            flushPage(listBlock.startOffset);
            listBlock = {
              ...listBlock,
              listItems: remainderItems,
              text: remainderItems.map((it) => it.text).join('\n'),
              isContinuation: true,
              start: (listBlock.start || 1) + fitCount,
            };
            continue;
          }
        }

        // If not even 1 item fits on the current page, flush to a fresh page
        if (currentBlocks.length > 0) {
          flushPage(listBlock.startOffset);
          continue;
        }

        // Fresh page: if the list is larger than an entire page, fit as many as possible
        let fitCount = 0;
        let testLines = 0.2;
        for (let idx = 0; idx < items.length; idx++) {
          const itemLines =
            Math.max(1, Math.ceil(items[idx].text.length / charsPerLine)) + 0.15;
          if (testLines + itemLines <= maxLinesPerPage + 0.4 || fitCount === 0) {
            testLines += itemLines;
            fitCount++;
          } else {
            break;
          }
        }
        const sliceItems = items.slice(0, fitCount);
        const remainderItems = items.slice(fitCount);
        currentBlocks.push({
          ...listBlock,
          listItems: sliceItems,
          text: sliceItems.map((it) => it.text).join('\n'),
        });
        currentLinesUsed += testLines;
        if (remainderItems.length > 0) {
          flushPage(listBlock.startOffset);
          listBlock = {
            ...listBlock,
            listItems: remainderItems,
            text: remainderItems.map((it) => it.text).join('\n'),
            isContinuation: true,
            start: (listBlock.start || 1) + fitCount,
          };
        } else {
          break;
        }
      }
      continue;
    }

    // 4. Code Blocks: Continuous splitting across page boundaries
    if (block.type === 'code') {
      let codeBlock = block;
      while (codeBlock && codeBlock.text.length > 0) {
        const codeLines = codeBlock.text.split('\n');
        const remainingLines = maxLinesPerPage - currentLinesUsed;
        const fullNeeded = estimateBlockLines(
          codeBlock,
          charsPerLine,
          false,
          spacingLines,
          lineHeightPx
        );

        if (fullNeeded <= remainingLines + 0.6) {
          currentBlocks.push(codeBlock);
          currentLinesUsed += fullNeeded;
          if (currentLinesUsed >= maxLinesPerPage && i < blocks.length - 1) {
            flushPage(codeBlock.endOffset);
          }
          break;
        }

        // Can we slice at least 2 lines of code onto the current page?
        if (remainingLines >= 3.0 && codeLines.length >= 4) {
          const linesToFit = Math.max(2, Math.floor((remainingLines - 1.2) / 0.85));
          if (linesToFit >= 2 && linesToFit < codeLines.length) {
            const sliceLines = codeLines.slice(0, linesToFit);
            const remainderLines = codeLines.slice(linesToFit);
            const sliceText = sliceLines.join('\n');
            const remainderText = remainderLines.join('\n');
            const sliceEndOffset: number = codeBlock.startOffset + sliceText.length;

            currentBlocks.push({
              ...codeBlock,
              text: sliceText,
              endOffset: sliceEndOffset,
            });
            currentLinesUsed += estimateBlockLines(
              currentBlocks[currentBlocks.length - 1],
              charsPerLine,
              false,
              spacingLines,
              lineHeightPx
            );
            flushPage(sliceEndOffset);

            codeBlock = {
              ...codeBlock,
              text: remainderText,
              isContinuation: true,
              startOffset: sliceEndOffset,
              endOffset: codeBlock.endOffset,
            };
            continue;
          }
        }

        // Not enough room on current page -> flush
        if (currentBlocks.length > 0) {
          flushPage(codeBlock.startOffset);
          continue;
        }

        // Oversized code on fresh page
        const linesToFit = Math.max(3, Math.floor((maxLinesPerPage - 1.2) / 0.85));
        if (linesToFit < codeLines.length) {
          const sliceLines = codeLines.slice(0, linesToFit);
          const remainderLines = codeLines.slice(linesToFit);
          const sliceText = sliceLines.join('\n');
          const remainderText = remainderLines.join('\n');
          const sliceEndOffset: number = codeBlock.startOffset + sliceText.length;

          currentBlocks.push({
            ...codeBlock,
            text: sliceText,
            endOffset: sliceEndOffset,
          });
          flushPage(sliceEndOffset);

          codeBlock = {
            ...codeBlock,
            text: remainderText,
            isContinuation: true,
            startOffset: sliceEndOffset,
            endOffset: codeBlock.endOffset,
          };
        } else {
          currentBlocks.push(codeBlock);
          currentLinesUsed += fullNeeded;
          break;
        }
      }
      continue;
    }

    // 5. Blockquotes: Continuous splitting across page boundaries
    if (block.type === 'blockquote') {
      let quoteBlock = block;
      while (quoteBlock && quoteBlock.text.length > 0) {
        const remainingLines = maxLinesPerPage - currentLinesUsed;
        const fullNeeded = estimateBlockLines(
          quoteBlock,
          charsPerLine,
          false,
          spacingLines,
          lineHeightPx
        );

        if (fullNeeded <= remainingLines + 0.6) {
          currentBlocks.push(quoteBlock);
          currentLinesUsed += fullNeeded;
          if (currentLinesUsed >= maxLinesPerPage && i < blocks.length - 1) {
            flushPage(quoteBlock.endOffset);
          }
          break;
        }

        if (remainingLines >= 2.0 && quoteBlock.text.length > 50) {
          const approxTargetChars = Math.floor((remainingLines - 0.6) * (charsPerLine - 2));
          const safeTarget = Math.min(quoteBlock.text.length - 1, approxTargetChars);
          const splitIdx = findSafeSentenceSplitLength(quoteBlock.text, safeTarget, charsPerLine);

          if (splitIdx >= 16 && splitIdx < quoteBlock.text.length) {
            const sliceText = quoteBlock.text.slice(0, splitIdx);
            const remainderText = quoteBlock.text.slice(splitIdx);
            const sliceEndOffset: number = quoteBlock.startOffset + sliceText.length;

            currentBlocks.push({
              ...quoteBlock,
              text: sliceText,
              html: renderInlineMarkdown(sliceText),
              endOffset: sliceEndOffset,
            });
            currentLinesUsed += estimateBlockLines(
              currentBlocks[currentBlocks.length - 1],
              charsPerLine,
              false,
              spacingLines,
              lineHeightPx
            );
            flushPage(sliceEndOffset);

            quoteBlock = {
              ...quoteBlock,
              text: remainderText,
              html: renderInlineMarkdown(remainderText),
              isContinuation: true,
              startOffset: sliceEndOffset,
              endOffset: quoteBlock.endOffset,
            };
            continue;
          }
        }

        if (currentBlocks.length > 0) {
          flushPage(quoteBlock.startOffset);
          continue;
        }

        // Oversized quote on fresh page
        const approxTargetChars = Math.floor((maxLinesPerPage - 0.6) * (charsPerLine - 2));
        const safeTarget = Math.min(quoteBlock.text.length - 1, approxTargetChars);
        const splitIdx = findSafeSentenceSplitLength(quoteBlock.text, safeTarget, charsPerLine);
        const safeSplit =
          splitIdx > 0 && splitIdx < quoteBlock.text.length ? splitIdx : Math.max(16, safeTarget);

        const sliceText = quoteBlock.text.slice(0, safeSplit);
        const remainderText = quoteBlock.text.slice(safeSplit);
        const sliceEndOffset: number = quoteBlock.startOffset + sliceText.length;

        currentBlocks.push({
          ...quoteBlock,
          text: sliceText,
          html: renderInlineMarkdown(sliceText),
          endOffset: sliceEndOffset,
        });
        flushPage(sliceEndOffset);

        quoteBlock = {
          ...quoteBlock,
          text: remainderText,
          html: renderInlineMarkdown(remainderText),
          isContinuation: true,
          startOffset: sliceEndOffset,
          endOffset: quoteBlock.endOffset,
        };
      }
      continue;
    }

    // 6. Non-paragraph atomic blocks (mermaid diagrams, tables, hr)
    if (block.type !== 'paragraph') {
      const neededLines = estimateBlockLines(
        block,
        charsPerLine,
        settings.indentFirstLine,
        spacingLines,
        lineHeightPx
      );
      if (currentBlocks.length > 0 && currentLinesUsed + neededLines > maxLinesPerPage + 0.4) {
        flushPage(block.startOffset);
      }
      currentBlocks.push(block);
      currentLinesUsed += neededLines;
      if (currentLinesUsed >= maxLinesPerPage && i < blocks.length - 1) {
        flushPage(block.endOffset);
      }
      continue;
    }

    // 7. Paragraph blocks: tightly pack and fill down to the bottom of the page
    let pBlock: PageBlock | null = block;
    while (pBlock && pBlock.text.length > 0) {
      const neededLines = estimateBlockLines(
        pBlock,
        charsPerLine,
        settings.indentFirstLine,
        spacingLines,
        lineHeightPx
      );
      const remainingLines = maxLinesPerPage - currentLinesUsed;

      // Case A: Fits entirely into the remaining lines (with 0.6 line sub-pixel margin tolerance)
      if (neededLines <= remainingLines + 0.6) {
        currentBlocks.push(pBlock);
        currentLinesUsed += neededLines;
        if (currentLinesUsed >= maxLinesPerPage && i < blocks.length - 1) {
          flushPage(pBlock.endOffset);
        }
        break;
      }

      // Case B: Does not fit entirely. Can we split to fill the remaining lines?
      if (remainingLines >= 1.0) {
        const indentChars = settings.indentFirstLine && !pBlock.isContinuation ? 2 : 0;
        const usableTextLines = Math.max(1, remainingLines - spacingLines * 0.45);
        const approxTargetChars = Math.floor(usableTextLines * charsPerLine - indentChars);
        const safeTarget = Math.min(pBlock.text.length - 1, approxTargetChars);
        const splitIdx = findSafeSentenceSplitLength(pBlock.text, safeTarget, charsPerLine);

        const minAcceptableChars = Math.max(6, Math.floor(charsPerLine * 0.35));
        if (splitIdx >= minAcceptableChars && splitIdx < pBlock.text.length) {
          const sliceText = pBlock.text.slice(0, splitIdx);
          const remainderText = pBlock.text.slice(splitIdx);
          const sliceEndOffset: number = pBlock.startOffset + sliceText.length;

          currentBlocks.push({
            type: 'paragraph',
            text: sliceText,
            html: renderInlineMarkdown(sliceText),
            isHeading: false,
            isContinuation: pBlock.isContinuation,
            startOffset: pBlock.startOffset,
            endOffset: sliceEndOffset,
          });

          const sliceLines = estimateBlockLines(
            currentBlocks[currentBlocks.length - 1],
            charsPerLine,
            settings.indentFirstLine,
            spacingLines,
            lineHeightPx
          );
          currentLinesUsed += sliceLines;

          flushPage(sliceEndOffset);

          pBlock = {
            type: 'paragraph',
            text: remainderText,
            html: renderInlineMarkdown(remainderText),
            isHeading: false,
            isContinuation: true,
            startOffset: sliceEndOffset,
            endOffset: pBlock.endOffset,
          };
          continue;
        }
      }

      // Case C: Less than 1 line remaining on current page -> flush page
      if (currentBlocks.length > 0) {
        flushPage(pBlock.startOffset);
        continue;
      }

      // Case D: Single oversized paragraph that exceeds an entire fresh page on its own
      const indentChars = settings.indentFirstLine && !pBlock.isContinuation ? 2 : 0;
      const usableTextLines = Math.max(2, maxLinesPerPage - spacingLines * 0.45);
      const approxTargetChars = Math.floor(usableTextLines * charsPerLine - indentChars);
      const safeTarget = Math.min(pBlock.text.length - 1, approxTargetChars);
      const splitIdx = findSafeSentenceSplitLength(pBlock.text, safeTarget, charsPerLine);
      const safeSplit =
        splitIdx > 0 && splitIdx < pBlock.text.length ? splitIdx : Math.max(12, safeTarget);

      const sliceText = pBlock.text.slice(0, safeSplit);
      const remainderText = pBlock.text.slice(safeSplit);
      const sliceEndOffset: number = pBlock.startOffset + sliceText.length;

      currentBlocks.push({
        type: 'paragraph',
        text: sliceText,
        html: renderInlineMarkdown(sliceText),
        isHeading: false,
        isContinuation: pBlock.isContinuation,
        startOffset: pBlock.startOffset,
        endOffset: sliceEndOffset,
      });

      flushPage(sliceEndOffset);

      pBlock = {
        type: 'paragraph',
        text: remainderText,
        html: renderInlineMarkdown(remainderText),
        isHeading: false,
        isContinuation: true,
        startOffset: sliceEndOffset,
        endOffset: pBlock.endOffset,
      };
    }
  }

  if (currentBlocks.length > 0) {
    flushPage(content.length);
  }

  return pages.length > 0
    ? pages
    : [
        {
          pageNumber: 1,
          startOffset: 0,
          endOffset: content.length,
          paragraphs: [
            {
              type: 'paragraph',
              text: content,
              html: renderInlineMarkdown(content),
              isHeading: false,
              startOffset: 0,
              endOffset: content.length,
            },
          ],
          chapterTitle: chapters[0]?.title || '正文',
        },
      ];
}

export function findPageIndexForOffset(pages: VirtualPage[], offset: number): number {
  if (pages.length <= 1) return 0;
  if (offset <= 0) return 0;

  for (let i = 0; i < pages.length; i++) {
    const isLast = i === pages.length - 1;
    if (offset >= pages[i].startOffset && (offset < pages[i].endOffset || isLast)) {
      return i;
    }
  }
  return pages.length - 1;
}

export function findChapterTitleAtOffset(chapters: Chapter[], offset: number): string {
  if (!chapters || chapters.length === 0) return '正文';
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (offset >= chapters[i].startOffset) {
      return chapters[i].title;
    }
  }
  return chapters[0].title;
}

export interface InstalledSystemFont {
  family: string;
  label: string;
  category: 'serif' | 'sans' | 'kaiti' | 'other';
  detected: boolean;
}

const CANDIDATE_SYSTEM_FONTS: {
  family: string;
  aliases: string[];
  label: string;
  category: 'serif' | 'sans' | 'kaiti' | 'other';
}[] = [
  { family: 'Microsoft YaHei', aliases: ['微软雅黑', 'Microsoft YaHei UI'], label: '微软雅黑', category: 'sans' },
  { family: 'PingFang SC', aliases: ['苹方-简', 'PingFang TC'], label: '苹果苹方 (PingFang SC)', category: 'sans' },
  { family: 'SimSun', aliases: ['宋体', 'NSimSun', '新宋体'], label: '中易宋体 (SimSun)', category: 'serif' },
  { family: 'Songti SC', aliases: ['宋体-简', 'STSongti-SC-Regular'], label: '苹果宋体 (Songti SC)', category: 'serif' },
  { family: 'KaiTi', aliases: ['楷体', 'KaiTi_GB2312'], label: '中易楷体 (KaiTi)', category: 'kaiti' },
  { family: 'Kaiti SC', aliases: ['楷体-简', 'STKaitiSC-Regular'], label: '苹果楷体 (Kaiti SC)', category: 'kaiti' },
  { family: 'FangSong', aliases: ['仿宋', 'FangSong_GB2312'], label: '中易仿宋 (FangSong)', category: 'serif' },
  { family: 'SimHei', aliases: ['黑体'], label: '中易黑体 (SimHei)', category: 'sans' },
  { family: 'STSong', aliases: ['华文宋体'], label: '华文宋体 (STSong)', category: 'serif' },
  { family: 'STZhongsong', aliases: ['华文中宋'], label: '华文中宋 (STZhongsong)', category: 'serif' },
  { family: 'STKaiti', aliases: ['华文楷体'], label: '华文楷体 (STKaiti)', category: 'kaiti' },
  { family: 'STFangsong', aliases: ['华文仿宋'], label: '华文仿宋 (STFangsong)', category: 'serif' },
  { family: 'STXihei', aliases: ['华文细黑'], label: '华文细黑 (STXihei)', category: 'sans' },
  { family: 'DengXian', aliases: ['等线'], label: '等线 (DengXian)', category: 'sans' },
  { family: 'LiSu', aliases: ['隶书', 'STLiti', '华文隶书'], label: '隶书 (LiSu)', category: 'kaiti' },
  { family: 'YouYuan', aliases: ['幼圆'], label: '幼圆 (YouYuan)', category: 'sans' },
  { family: 'Hiragino Sans GB', aliases: ['冬青黑体简体中文'], label: '冬青黑体 (Hiragino)', category: 'sans' },
  { family: 'LXGW WenKai', aliases: ['霞鹜文楷', 'LXGW WenKai Screen'], label: '霞鹜文楷 (LXGW WenKai)', category: 'kaiti' },
  { family: 'Source Han Serif SC', aliases: ['思源宋体', 'Source Han Serif CN', 'Noto Serif CJK SC', 'Noto Serif SC'], label: '思源宋体 (Source Han Serif)', category: 'serif' },
  { family: 'Source Han Sans SC', aliases: ['思源黑体', 'Source Han Sans CN', 'Noto Sans CJK SC', 'Noto Sans SC'], label: '思源黑体 (Source Han Sans)', category: 'sans' },
  { family: 'HarmonyOS Sans SC', aliases: ['HarmonyOS Sans'], label: '鸿蒙黑体 (HarmonyOS Sans)', category: 'sans' },
  { family: 'MiSans', aliases: ['小米兰亭'], label: '小米 MiSans', category: 'sans' },
  { family: 'FZShuSong-Z01S', aliases: ['方正书宋简体', 'FZShuSong-Z01'], label: '方正书宋', category: 'serif' },
  { family: 'FZKai-Z03S', aliases: ['方正楷体简体', 'FZKai-Z03'], label: '方正楷体', category: 'kaiti' },
  { family: 'Georgia', aliases: [], label: 'Georgia (西文衬线)', category: 'serif' },
  { family: 'Times New Roman', aliases: [], label: 'Times New Roman', category: 'serif' },
  { family: 'Segoe UI', aliases: ['SF Pro Text', 'Roboto'], label: 'Segoe UI / 系统无衬', category: 'sans' },
];

let cachedDetectedLocalFonts: InstalledSystemFont[] | null = null;

/**
 * Probes the operating system's locally installed fonts via offscreen Canvas glyph measurement.
 */
export function detectInstalledLocalFonts(): InstalledSystemFont[] {
  if (cachedDetectedLocalFonts && cachedDetectedLocalFonts.length > 0) {
    return cachedDetectedLocalFonts;
  }
  if (typeof document === 'undefined') {
    return CANDIDATE_SYSTEM_FONTS.map((c) => ({
      family: c.family,
      label: c.label,
      category: c.category,
      detected: true,
    }));
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return CANDIDATE_SYSTEM_FONTS.map((c) => ({
      family: c.family,
      label: c.label,
      category: c.category,
      detected: true,
    }));
  }

  const testText = '天地玄黄宇宙洪荒永和九年abcMW123';
  const baseFamilies = ['monospace', 'sans-serif', 'serif'];
  const baseWidths: Record<string, number> = {};
  for (const base of baseFamilies) {
    ctx.font = `72px ${base}`;
    baseWidths[base] = ctx.measureText(testText).width;
  }

  const isFontPresent = (fontName: string): boolean => {
    for (const base of baseFamilies) {
      ctx.font = `72px "${fontName}", ${base}`;
      const w = ctx.measureText(testText).width;
      if (Math.abs(w - baseWidths[base]) > 0.1) {
        return true;
      }
    }
    return false;
  };

  const detectedList: InstalledSystemFont[] = [];
  const fallbackList: InstalledSystemFont[] = [];

  for (const candidate of CANDIDATE_SYSTEM_FONTS) {
    const namesToTry = [candidate.family, ...candidate.aliases];
    let matchedName: string | null = null;
    for (const name of namesToTry) {
      if (isFontPresent(name)) {
        matchedName = name;
        break;
      }
    }
    if (matchedName) {
      detectedList.push({
        family: matchedName,
        label: candidate.label,
        category: candidate.category,
        detected: true,
      });
    } else {
      fallbackList.push({
        family: candidate.family,
        label: candidate.label,
        category: candidate.category,
        detected: false,
      });
    }
  }

  // Always show genuinely detected local OS fonts first; if the OS environment has few detected CJK fonts,
  // also append standard system font options so users can select any local font family.
  const combined =
    detectedList.length >= 5
      ? detectedList
      : [...detectedList, ...fallbackList.slice(0, Math.max(8, 12 - detectedList.length))];

  cachedDetectedLocalFonts = combined;
  return combined;
}

/**
 * Queries the browser's Local Font Access API (`window.queryLocalFonts()`) when supported and permitted,
 * merging all discovered local OS font families with the Canvas-detected system fonts.
 */
export async function queryBrowserLocalFonts(): Promise<InstalledSystemFont[]> {
  const baseDetected = detectInstalledLocalFonts();
  if (typeof window === 'undefined' || !('queryLocalFonts' in window)) {
    return baseDetected;
  }

  try {
    const queryFn = (window as unknown as {
      queryLocalFonts: () => Promise<Array<{ family: string; fullName?: string }>>;
    }).queryLocalFonts;
    const rawFonts = await queryFn();
    if (!Array.isArray(rawFonts) || rawFonts.length === 0) {
      return baseDetected;
    }

    const byFamily = new Map<string, InstalledSystemFont>();
    for (const item of baseDetected) {
      if (item.detected) {
        byFamily.set(item.family.toLowerCase(), item);
      }
    }

    for (const f of rawFonts) {
      const fam = (f.family || '').trim();
      if (!fam || fam.startsWith('.')) continue;
      const key = fam.toLowerCase();
      if (byFamily.has(key)) continue;

      const displayLabel =
        f.fullName && f.fullName.trim() && f.fullName.trim() !== fam
          ? `${f.fullName.trim()} (${fam})`
          : fam;
      const lower = displayLabel.toLowerCase();
      const category: 'serif' | 'sans' | 'kaiti' | 'other' =
        lower.includes('kai') || lower.includes('楷') || lower.includes('隶')
          ? 'kaiti'
          : lower.includes('song') || lower.includes('serif') || lower.includes('宋') || lower.includes('明')
          ? 'serif'
          : lower.includes('hei') || lower.includes('sans') || lower.includes('黑') || lower.includes('雅') || lower.includes('苹')
          ? 'sans'
          : 'other';

      byFamily.set(key, {
        family: fam,
        label: displayLabel,
        category,
        detected: true,
      });
    }

    const merged = Array.from(byFamily.values());
    // Sort CJK / known reading fonts to the top
    merged.sort((a, b) => {
      const aCjk = /[\u4e00-\u9fa5]/.test(a.label) ? 0 : 1;
      const bCjk = /[\u4e00-\u9fa5]/.test(b.label) ? 0 : 1;
      if (aCjk !== bCjk) return aCjk - bCjk;
      return a.label.localeCompare(b.label, 'zh-CN');
    });

    cachedDetectedLocalFonts = merged;
    return merged;
  } catch {
    return baseDetected;
  }
}

export function resolveReaderFontFamilyCss(fontId: string): string {
  if (fontId === 'serif-editorial') return "'Lora', 'Noto Serif SC', 'Songti SC', serif";
  if (fontId === 'sans-warm') return "'Plus Jakarta Sans', -apple-system, sans-serif";
  if (fontId === 'kaiti-classic') return "'LXGW WenKai', 'Kaiti SC', 'STKaiti', 'KaiTi', serif";
  if (fontId === 'mono-tabular') return "'JetBrains Mono', monospace";
  if (fontId.startsWith('local:')) {
    const rawFamily = fontId.slice('local:'.length).trim();
    return `"${rawFamily}", 'Noto Serif SC', serif`;
  }
  return `"${fontId}", 'Noto Serif SC', serif`;
}

export function getShortLocalFontLabel(
  fontId: string,
  installedFonts?: InstalledSystemFont[]
): string {
  if (!fontId.startsWith('local:')) return '本地字体';
  const rawFamily = fontId.slice('local:'.length).trim();
  if (!rawFamily) return '本地字体';
  const list = installedFonts || cachedDetectedLocalFonts || [];
  const matched = list.find((f) => f.family.toLowerCase() === rawFamily.toLowerCase());
  if (matched) {
    return matched.label.replace(/\s*\(.*?\)\s*/g, '').trim() || rawFamily;
  }
  return rawFamily;
}

