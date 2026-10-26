# 焙香书阁 双引擎智能语音朗读（本地 TTS + 微软 Neural TTS 角色声音）实施方案

## User Review & Critical Decisions

基于您的最新要求，本方案已升级为**「本地离线 Web Speech + 在线微软 Edge Neural TTS」双引擎架构**：

- **双引擎自由切换与多角色音色库**：
  - **在线微软 TTS 引擎（Microsoft Neural TTS）**：支持跨浏览器（Chrome / Safari / Firefox / Edge）调用微软超拟真神经网络角色语音，内置精选角色声音矩阵（**晓晓、云希、云野、云健、晓伊、云扬、晓北、晓双、粤语晓佳、台语晓臻、英文 Aria/Guy** 等），并为每位角色标注音色风格与适用题材。
  - **本地离线 TTS 引擎（Web Speech API）**：100% 本地系统底层运行，断网可用、零数据外传，支持所有操作系统内置离线发音人。
- **正文与翻页实时联动**：朗读时实时高亮当前正在播报的段落（支持点击任意段落直接从该段切换起播）；当本页最后一个段落播报完毕时，自动翻至下一页（单页/双页模式）或平滑滚动至下一可视区（瀑布流模式）并无缝连播。
- **顶部入口 + 浮窗迷你播控条**：在阅读器顶部工具栏新增「听书 / 朗读」开关按钮，激活后在底部中央浮现典雅的「浮窗迷你播控条」，集成引擎切换（微软在线角色 / 本地离线）、角色声音选择、播放/暂停、上一段/下一段、语速（0.5x – 2.0x）与语调（0.5 – 1.5）调节。
- **结构化块智能摘要播报**：遇到文中的 Mermaid 图表、代码块与 Markdown 表格时，自动跳过原始符号与代码语法，转为自然语言智能摘要播报。

---

## 1. Overview & Core Concept

**核心愿景**：将浏览器原生 `window.speechSynthesis`（本地离线引擎）与 **Microsoft Edge Neural TTS（微软超拟真神经网络语音引擎）** 深度融合进「焙香书阁」的虚拟分页引擎（`VirtualPage` / `PageBlock`），打造兼顾**极致拟真角色听感**与**全离线隐私保护**的双模有声书伴读体验。

- **核心特性**：
  1. **微软超拟真角色声音库（跨浏览器通用）**：通过内置服务端 SSML 语音合成流接口（`/api/tts/edge`）与前端原生 Edge Online 语音双通道，即使在 Chrome、Safari 或移动端也能直接使用微软「晓晓」「云希」「云野」等高表现力角色声音，并支持 SSML 级语速（`rate`）与语调（`pitch`）精确控制。
  2. **下一段智能预加载（Zero-Latency Pre-buffer）**：使用在线微软 TTS 时，在朗读当前段落的同时后台静默预合成下一段落的音频流并缓存于内存（`Blob URL`），实现段落切换与跨页连播零等待。
  3. **段落级精准寻址与跨页接力**：直接复用 `ReaderView` 解析出的 `PageBlock` 序列（通过唯一 `startOffset` 锚定），实现段落级暖金高亮、点击任意段落即点即读，以及读完本页自动翻页连播。
  4. **多模态块语义提炼器**：针对 `mermaid`、`code`、`table` 与常规正文分别定制语音文本清洗与自然语言摘要生成器。

---

## 2. User Experience & Visual Design

### 美学方向与视觉规范 (Editorial Archival Audio Deck)
延续「焙香书阁」温润馆藏纸张与浓缩咖啡的视觉基因（Archival Warm Paper & Espresso Ink），播控组件采用精致的**半透明毛玻璃浮窗（Floating Editorial Deck）**设计：

- **色彩与材质 Token**：
  - **日间/羊皮纸/护眼绿主题**：温暖石色半透明基底（`rgba(251, 249, 245, 0.94)` + `backdrop-filter: blur(12px)`），细微 `1px` 古铜色描边（`rgba(139, 90, 43, 0.22)`），主控按钮采用深焙焦糖色（`#8b5a2b`）。
  - **夜间暗黑主题**：深焙黑曜基底（`rgba(26, 20, 18, 0.94)`），暖金高亮（`#d4a373`）。
- **朗读段落实时高亮反馈**：
  - 正在播报的 `PageBlock` 呈现温润的琥珀光晕底色（日间 `rgba(212, 163, 115, 0.18)`，夜间 `rgba(212, 163, 115, 0.14)`），并在段落左侧渲染 `3px` 圆角暖金律动指示条与微型「正在朗读」声波徽标。
  - 当朗读开启时，用户点击任意正文段落即可立即切段播报。

### 微软 TTS 精选角色声音库 (Character Voice Matrix)
在语音设置面板中，用户可切换 **「微软神经网络角色 (在线)」** 与 **「系统原生语音 (本地离线)」** 两大标签页。微软在线角色库提供直观的角色卡片与音色标签：

| 角色名称 | 语音 ID (`VoiceName`) | 性别 / 语言 | 音色风格与推荐阅读场景 |
| :--- | :--- | :--- | :--- |
| **晓晓 (Xiaoxiao)** | `zh-CN-XiaoxiaoNeural` | 女声 · 普通话 | 温暖知性、情感细腻（默认推荐，适合小说、散文、深度长文） |
| **云希 (Yunxi)** | `zh-CN-YunxiNeural` | 男声 · 普通话 | 阳光清朗、叙事感强（适合故事、传记、科普） |
| **云野 (Yunye)** | `zh-CN-YunyeNeural` | 男声 · 普通话 | 醇厚沉稳、古典磁性（适合历史、国学经典、有声书） |
| **云健 (Yunjian)** | `zh-CN-YunjianNeural` | 男声 · 普通话 | 铿锵有力、富有感染力（适合纪实、社科、演讲） |
| **晓伊 (Xiaoyi)** | `zh-CN-XiaoyiNeural` | 女声 · 普通话 | 清脆灵动、柔和亲切（适合轻小说、生活随笔） |
| **云扬 (Yunyang)** | `zh-CN-YunyangNeural` | 男声 · 普通话 | 专业播音、字正腔圆（适合技术文档、研报、说明文） |
| **晓北 (Xiaobei)** | `zh-CN-liaoning-XiaobeiNeural` | 女声 · 东北话 | 幽默亲切、东北方言特色（适合趣味读物、俗世奇人） |
| **晓双 (Xiaoshuang)** | `zh-CN-XiaoshuangNeural` | 女童 · 普通话 | 纯真清亮童声（适合童话、寓言、绘本） |
| **晓佳 (HiuGaai)** | `zh-HK-HiuGaaiNeural` | 女声 · 粤语 | 自然地道香港粤语女声 |
| **晓臻 (HsiaoChen)** | `zh-TW-HsiaoChenNeural` | 女声 · 台湾国语 | 温婉柔和台湾国语女声 |
| **Aria / Guy** | `en-US-AriaNeural` / `GuyNeural` | 女/男 · 英语 | 母语级自然英语播报（适合英文原版与技术文献） |

---

## 3. Key Product Decisions & Trade-Offs

### 决策 1：跨浏览器微软 Neural TTS 实现机制 + 预加载缓冲
- **权衡分析**：若仅依赖浏览器内置的 `window.speechSynthesis`，则只有 Microsoft Edge 桌面版浏览器才能看到微软在线语音，Chrome、Safari 和 Firefox 用户将无法体验微软晓晓/云希等角色声音。
- **方案设计**：
  1. **内置服务端 Edge Neural TTS 合成代理（`/api/tts/edge`）**：在应用内集成 Express 服务端接口（`server.ts`），通过微软 Edge Read Aloud WebSocket SSML 协议（支持动态 `Sec-MS-GEC` 安全令牌生成）实时合成高音质 MP3 音频流返回前端 `<audio>` 播放器。
  2. **原生回退与断网容错**：若当前运行在纯静态离线环境或网络中断，系统会自动尝试调用浏览器内置的 `Microsoft ... Online` 语音或平滑降级至本地离线 `speechSynthesis` 语音，确保任何网络环境下点击朗读都能立即发声。
  3. **智能下一段预取（Pre-fetching）**：当前段落开始播放时，后台立即触发 `index + 1` 段落的音频流合成并存入 `Map<string, string>`（缓存最近 10 段音频 Blob URL），消除在线 TTS 跨段与翻页时的网络请求停顿。

### 决策 2：非正文块（Mermaid / 代码块 / 表格 / 公式）的智能摘要合成
- **智能摘要规则**：
  - **Mermaid 图表 (`blockType === 'mermaid'`)**：识别图表类型（如流程图、时序图、甘特图、思维导图）并提取节点文本摘要，播报为：*“此处包含一张【流程图】，主要节点包括：……”*。
  - **Markdown 表格 (`blockType === 'table'`)**：提取 `tableHeaders` 表头列表与数据行数，播报为：*“此处有一张数据表格，包含 X 列（列名分别为：……），共 Y 行数据。”*
  - **代码块 (`blockType === 'code'`)**：识别 `lang` 语言标识与代码行数，播报为：*“此处有一段 【TypeScript】 代码示例，共 X 行，已为您略过代码细节。”*

---

## 4. Technical Architecture & Data Strategy

### 系统数据流与双引擎架构图

```
+-----------------------------------------------------------------------------------+
|                            ReaderView (阅读器主容器)                                |
|                                                                                   |
|  [顶部工具栏: 听书按钮] ──> 唤醒/收起 [底部浮窗迷你播控条 (TtsControlBar)]        |
|                                         │                                         |
|        ┌────────────────────────────────┴────────────────────────────────┐        |
|        ▼                                                                 ▼        |
|  +-------------------------------------+   +-----------------------------------+  |
|  |     双模语音合成调度器 (TtsManager)   |   |    ReaderSettings 持久化存储       |  |
|  | - ttsEngine: 'edge' | 'local'       |   | - ttsEngine: 'edge' | 'local'     |  |
|  | - activeBlockOffset: number | null  |   | - ttsEdgeVoice: 'zh-CN-Xiaoxiao..'|  |
|  | - audioCache: Map<cacheKey, url>    |   | - ttsLocalVoiceURI: string        |  |
|  +-------------------------------------+   | - ttsRate: 0.5~2.0 / ttsPitch     |  |
|        │                                   +-----------------------------------+  |
|        ├── 1. 智能语音文本提炼器 (buildBlockSpeechText)                            |
|        │      └─ 正文净化 / Mermaid 图表摘要 / GFM 表格摘要 / 代码块语言提示        |
|        │                                                                          |
|        ├── 2A. [在线微软 TTS 引擎 ('edge')]                                        |
|        │       ├─ 播放当前段 HTMLAudioElement + 后台预取下一段 (Pre-fetch)         |
|        │       └─ 请求 POST /api/tts/edge (SSML: voice + rate + pitch) -> MP3 流  |
|        │                                                                          |
|        ├── 2B. [本地离线 TTS 引擎 ('local')]                                       |
|        │       └─ 调用 window.speechSynthesis.speak(SpeechSynthesisUtterance)     |
|        │                                                                          |
|        └── 3. 段落结束回调 (onended / onend)                                       |
|               ├─ 推进至下一 PageBlock -> 更新 activeTtsOffset (高亮当前段)         |
|               └─ 若跨页 -> 自动触发 setCurrentSpread 翻页或平滑滚动连播            |
+-----------------------------------------------------------------------------------+
```

### 核心模块与文件变更清单

1. **`/server.ts` & `/package.json`（新增全栈 Express + Vite 中间件与微软 TTS 接口）**
   - 建立 Express 服务端入口 `/server.ts`（开发环境挂载 `vite.middlewares` 于 3000 端口，生产环境提供静态构建与 API 服务）。
   - 实现 `/api/tts/edge` 路由：遵循微软 Edge Read Aloud WebSocket SSML 协议（内置 `Sec-MS-GEC` SHA-256 令牌计算与 SSML `<prosody rate="..." pitch="...">` 封装），将文本实时合成为高音质 MP3 音频流返回前端，无需用户配置任何 API Key。

2. **`/src/types/reader.ts` & `/src/core/storageEngine.ts`**
   - 在 `ReaderSettings` 接口中扩展双引擎语音配置字段：
     - `ttsEngine: 'edge' | 'local'`（默认 `'edge'` 优先体验微软晓晓超拟真音色，断网自动回退 `'local'`）
     - `ttsEdgeVoice: string`（默认 `'zh-CN-XiaoxiaoNeural'`）
     - `ttsVoiceURI: string`（本地离线语音 URI，默认自动匹配系统本地中文语音）
     - `ttsRate: number`（默认 `1.0`）
     - `ttsPitch: number`（默认 `1.0`）

3. **`/src/core/ttsEngine.ts`（新增双引擎语音合成与智能摘要核心模块）**
   - `EDGE_NEURAL_VOICES`：内置 12 款精选微软神经网络角色声音元数据（名称、ID、性别、语言、风格标签、推荐场景）。
   - `buildBlockSpeechText(block: PageBlock): string`：针对正文、标题、列表、Mermaid 图表、Markdown 表格、代码块生成自然语言播报文本。
   - `synthesizeEdgeSpeech(text, voice, rate, pitch, signal)`：带内存 LRU 缓存（`Blob URL`）与下一段预加载能力的在线音频合成函数。
   - `getSortedLocalVoices()`：获取并排序本地 `window.speechSynthesis` 发音人，明确标注 `[本地离线]` 与 `[浏览器内置]`。

4. **`/src/components/MarkdownRenderer.tsx` & `/src/components/ReaderView.tsx`**
   - `MarkdownBlockRenderer` 支持 `isTtsActive` 琥珀金高亮、左侧律动指示条、声波徽标及点击任意段落直接切段起播。
   - `ReaderView` 集成顶部「听书」按钮与底部「浮窗迷你播控条」，支持一键切换「微软角色语音 / 本地离线语音」、挑选角色音色、调节语速语调，以及跨页自动翻页连播。
