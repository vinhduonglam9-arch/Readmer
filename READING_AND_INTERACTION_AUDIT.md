# 《书阁 (Roast & Reed)》全面系统与交互审核报告 (Full-Stack & UX Audit Report)

> **审核对象**：《书阁 · 典藏长文阅读与知识提取工作台》全栈代码库  
> **审核范围**：排版分页引擎、Markdown/Mermaid/GFM 渲染、双引擎 TTS 朗读、零知识加密私密空间（Argon2id + AES-256-GCM）、书架与多视图管理、全文搜索与内联高亮批注、多格式导出工作坊（HTML/MD/EPUB/CSV/JSON/PDF）、离线存储与 PWA 架构。

---

## 一、 核心模块审核总览 (Module Audit Matrix)

| 模块域 | 核心文件 | 状态评估 | 关键架构亮点 |
| :--- | :--- | :---: | :--- |
| **1. 虚拟分页与排版引擎** | `paginationEngine.ts` / `ReaderView.tsx` | ✅ 优秀 | AST 解析与分页计算解耦缓存（字号/边距调整 `< 5ms` 重算）；支持单栏/双栏古籍展开/长卷滚动；支持版心最大宽度（600–960px）与 E-Ink 残影刷新。 |
| **2. Markdown / Mermaid / GFM 渲染** | `MarkdownRenderer.tsx` / `parserEngine.ts` | ✅ 优秀 | 内置 `markdown-it` + GFM 表格粘性表头与横向滚动阴影提示；Mermaid 支持移动端窄屏自动 `LR -> TD` 重排、双指捏合缩放、拖拽平移及全屏独立检视弹窗。 |
| **3. 批注、内联高亮与全文检索** | `ReaderView.tsx` / `MarkdownRenderer.tsx` | ✅ 优秀 | 正文精准 `<mark>` 字符级内联染色（支持琥珀/赤陶/松石/黛紫四色与波浪下划线）；点击高亮原位弹出编辑/分享气泡；内置 `Ctrl/Cmd + F` 全书匹配与跨页跳回胶囊（Jump-back Pill）。 |
| **4. 双引擎语音朗读 (TTS)** | `ttsEngine.ts` / `ReaderView.tsx` / `server.ts` | ✅ 优秀 | 集成 **Microsoft Edge Neural TTS**（晓晓/云希/云扬等自然神经语音）与 **Web Speech API 本地离线语音**；具备 `AbortController` 竞态防重、自动翻页跟随、失败无感降级与点击任意段落即读。 |
| **5. 零知识加密私密空间** | `cryptoEngine.ts` / `VaultModals.tsx` / `App.tsx` | ✅ 优秀 | 采用 **Argon2id**（64MB 内存硬化）或 PBKDF2 派生 **AES-256-GCM** 密钥；支持助记词恢复、闲置自动上锁、窗口失焦/切后台 `backdrop-filter: blur(24px)` 防窥护盾，且打开文件选择器时不误锁。 |
| **6. 书架管理与多维视图** | `BookshelfView.tsx` / `BookCoverArt.tsx` | ✅ 优秀 | 支持大图网格、小图网格、详情列表三视图；支持多选批量分类、批量移入/移出私密空间、批量导出与自定义分类标签。 |
| **7. 导出工作坊与数据备份** | `exportEngine.ts` / `ExportStudioModal.tsx` | ✅ 优秀 | 支持 HTML 独立网页、标准 Markdown、EPUB 3.0 电子书（纯前端 ZIP 封装）、CSV 报表、JSON 与隐藏 iframe 免弹窗 PDF 印刷排版；支持 IndexedDB 全量一键备份与恢复。 |

---

## 二、 本次全面审核发现并修复的缺陷 (Resolved Defects)

### 1. [已修复] 阅读器设置面板「段距 (`paragraphSpacing`)」滑块单位与量程不一致
- **问题定位**：`src/components/ReaderView.tsx` (L3804–3817) & `src/components/TypographyDataView.tsx`
- **根因分析**：
  - 在 `DEFAULT_READER_SETTINGS`、`paginationEngine.ts` 与 `MarkdownRenderer.tsx` 中，`paragraphSpacing` 均以 **像素 (`px`)** 为单位（默认值为 `16px`，合理区间 `8px ~ 32px`）。
  - 但 `ReaderView.tsx` 顶部排版设置弹窗中的「段距」滑块此前误配置为 `min={0.4} max={2.0} step={0.1}` 且显示为 `em`。导致初始值 `16` 卡在滑块最右端，用户一旦拖动滑块，段距立即坍缩为 `0.4px ~ 2.0px`。
- **修复方案**：
  - 将 `ReaderView.tsx` 中的段距滑块修正为 `min={8} max={32} step={2}`，单位统一显示为 `{settings.paragraphSpacing}px`。
  - 在 `TypographyDataView.tsx`（排版与数据页）中同步补充了「段距 (`8px ~ 32px`)」调节滑块，确保全局排版控制器完全一致。

### 2. [已修复] 连续滚动模式 (`layoutMode === 'scroll'`) 切换与跳页时的滚动位置同步
- **问题定位**：`src/components/ReaderView.tsx` (L355–380, L474–490)
- **根因分析**：
  - 当用户从「单页/双页翻页模式」切换至「长卷连续滚动模式」或在滚动模式下打开书籍时，`scrollContainerRef` 初始位于顶部 `scrollTop = 0`，未能自动对齐当前阅读进度 `book.currentOffset`。
  - 此外，在滚动模式下通过目录或全文搜索调用 `jumpToCharOffset` 时，按全书字符比例估算 `scrollTop` 在含有大量代码块或 Mermaid 图表的文档中存在偏差。
- **修复方案**：
  - 新增滚动模式挂载与切换同步 Effect：优先通过 DOM `[data-start-offset]` 精确定位当前页首段元素并调用 `scrollIntoView`，若未命中则回退至字符偏移比例计算。
  - 优化 `jumpToCharOffset` 在滚动模式下的跳转逻辑，优先定位目标虚拟页首段的 `[data-start-offset]` DOM 节点平滑滚动。

### 3. [已修复] 恢复全量备份 JSON 时的私密空间内存态即时水合 (Hydration)
- **问题定位**：`src/App.tsx` (`handleImportBackupFile` & `handleImportFiles`)
- **根因分析**：
  - 当用户已解锁私密空间（`vaultKeyRef.current` 存在）并导入 `.json` 全量备份文件恢复书库时，虽然 IndexedDB 与 `books` 状态已更新，但未立即触发 `hydratePrivateVaultIntoMemory`，导致恢复的加密书籍需重新锁定再解锁才能显示解密标题与正文。
- **修复方案**：
  - 在 `handleImportBackupFile` 与 `handleImportFiles` 的备份恢复分支中，若检测到当前会话 `vaultKeyRef.current` 处于激活状态，立即自动执行 `hydratePrivateVaultIntoMemory` 并展示恢复反馈提示。

---

## 三、 安全、性能与工程规范验证 (Verification Checklist)

1. **零知识加密安全性**：
   - 私密书籍的 `title`、`author`、`content`、`chapters` 及私密批注的 `selectedText`、`note` 在落盘 IndexedDB 前均经 AES-256-GCM 独立随机 IV 加密，密文前缀 `ENC_V1:`。
   - 仅当用户输入正确口令派生密钥后，在 React 内存映射表 (`decryptedBooksMap` / `decryptedAnnsMap`) 中解密展示；上锁时立即清空内存引用。
2. **渲染与分页性能**：
   - `parsedBlocks` 仅依赖 `book.content` 缓存；调节字号、行高、段距、版心宽度或窗口尺寸时跳过 Markdown AST 解析，仅执行轻量几何分页计算。
3. **构建与静态类型检查**：
   - 通过 `tsc --noEmit` 严格类型检查与 `vite build` 生产构建验证，零编译错误与死代码警告。
