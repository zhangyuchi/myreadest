# PDF Translation Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render PDF translation pages as safe, source-structure-derived Markdown for both Google and LLM translations.

**Architecture:** Replace PDF source paragraph strings with ordered source blocks that retain only reliable block semantics. Translate each block's plain text, deterministically apply Markdown wrappers after translation, and render the resulting page Markdown with `react-markdown` plus `remark-gfm` without raw HTML.

**Tech Stack:** React, TypeScript, PDF.js text-layer geometry, `react-markdown`, `remark-gfm`, Vitest, Testing Library.

## Global Constraints

- PDF external translation pane only; EPUB, PDF iframe rendering, and provider implementations remain unchanged.
- Filter the upper and lower 8% edge bands before block classification.
- Support only headings, unordered lists, ordered lists, block quotes, and paragraphs; ambiguous blocks become paragraphs.
- Submit provider plain text, not Markdown tokens; preserve equal-count/non-empty response errors.
- Render no raw HTML and add no dependencies.

---

### Task 1: Extract typed PDF Markdown blocks

**Files:**
- Modify: `apps/readest-app/src/app/reader/utils/pdfTranslation.ts`
- Modify: `apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts`

**Interfaces:**
- Produces: `PDFPageSource { index: number; blocks: PDFSourceBlock[] }`.
- Produces: `PDFSourceBlock { kind: 'heading' | 'unordered-list' | 'ordered-list' | 'blockquote' | 'paragraph'; text: string; headingLevel?: 1 | 2 | 3 }`.

- [ ] **Step 1: Write failing source-block tests**

Create positioned spans with a large title line, a normal paragraph, `•` and `2)` list lines, a
clearly indented quote line, and edge-band header/footer lines. Assert:

```tsx
expect(getVisiblePDFPageSources(view)).toEqual([
  {
    index: 0,
    blocks: [
      { kind: 'heading', headingLevel: 1, text: 'Title' },
      { kind: 'paragraph', text: 'Body paragraph.' },
      { kind: 'unordered-list', text: 'Bullet item' },
      { kind: 'ordered-list', text: 'Numbered item' },
      { kind: 'blockquote', text: 'Quoted text' },
    ],
  },
]);
```

Add a visible page containing only header/footer spans and assert it is omitted. Add same-baseline
multi-span text with a word gap and no gap to assert geometry joins `Hello world` and `hyphenated`
without inventing spaces.

- [ ] **Step 2: Run RED**

Run: `pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts`

Expected: FAIL because the current source returns untyped `paragraphs`.

- [ ] **Step 3: Implement block classification**

Replace the page source with the interfaces above. Reuse edge filtering and line grouping, then
classify each completed body line before paragraph merging: bullet regex `/^[•◦▪*-]\s+/u`, ordered
regex `/^\d+[.)]\s+/u`, and quote indent relative to the median body-line left coordinate. Heading
classification uses line height relative to median body height, mapping largest to level 1 and the
next two thresholds to levels 2/3. Merge only adjacent `paragraph` lines with normal line spacing;
lists, headings, and quotes stay individual blocks. Strip list markers before creating block text.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts`

Expected: PASS, including direct edge-only and same-line multi-span coverage.

- [ ] **Step 5: Commit**

Run: `git add apps/readest-app/src/app/reader/utils/pdfTranslation.ts apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts && git commit -m "feat: classify PDF translation markdown blocks"`

### Task 2: Produce deterministic Markdown after translation

**Files:**
- Modify: `apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts`
- Modify: `apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx`
- Modify: `apps/readest-app/src/__tests__/app/reader/PDFTranslationFlow.test.tsx`

**Interfaces:**
- Consumes: `PDFSourceBlock[]` from Task 1.
- Produces: `PDFPageTranslation { sourceBlocks: PDFSourceBlock[]; translatedMarkdown?: string; ... }`.
- Produces: `formatPDFMarkdown(blocks: PDFSourceBlock[], translations: string[]): string`.

- [ ] **Step 1: Write failing controller and flow tests**

Mock Google-style plain translations for source heading/list/paragraph blocks and assert the
translator receives only plain source texts. Assert the published page has:

```ts
translatedMarkdown: '# 翻译标题\n\n正文译文\n\n- 列表译文\n\n1. 编号译文\n\n> 引文译文'
```

Add provider text containing `<img src=x onerror=alert(1)>` and assert it remains source text in
the Markdown value, not a trusted HTML node. Retain mismatch and blank-response error tests.

- [ ] **Step 2: Run RED**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx`

Expected: FAIL because the controller consumes paragraphs and exposes `translatedParagraphs`.

- [ ] **Step 3: Implement plain-text translation plus Markdown wrapping**

Translate `sourceBlocks.map((block) => block.text)`. Keep count and blank validation before
formatting. Escape provider Markdown control characters before wrapping so only source structure
creates headings/lists/quotes. Use:

```ts
const prefix = block.kind === 'heading' ? '#'.repeat(block.headingLevel ?? 1) + ' '
  : block.kind === 'unordered-list' ? '- '
  : block.kind === 'ordered-list' ? '1. '
  : block.kind === 'blockquote' ? '> '
  : '';
```

Join adjacent list blocks with one newline and all other block boundaries with two newlines. Apply
the identical formatting path on retry and preserve generation safeguards.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx`

Expected: PASS; plain translator output becomes deterministic Markdown and invalid responses still error.

- [ ] **Step 5: Commit**

Run: `git add apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx apps/readest-app/src/__tests__/app/reader/PDFTranslationFlow.test.tsx && git commit -m "feat: format PDF translations as markdown"`

### Task 3: Safely render translation Markdown in the pane

**Files:**
- Modify: `apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx`
- Modify: `apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx`

**Interfaces:**
- Consumes: `PDFPageTranslation.translatedMarkdown` from Task 2.
- Renders: `ReactMarkdown` with `remarkGfm`, no `rehypeRaw` plugin, and PDF-pane block styles.

- [ ] **Step 1: Write failing pane tests**

Pass `# 标题\n\n- 项目\n\n> 引文\n\n正文` and assert a heading, list item, blockquote, and paragraph are present. Pass
`<img src=x onerror=alert(1)>` and assert no `img` element exists. Keep pending/error/retry and
scroll-reset tests with `sourceBlocks` fixtures.

- [ ] **Step 2: Run RED**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/components/PDFTranslationPane.test.tsx`

Expected: FAIL because the pane expects `translatedParagraphs` and renders plain `<p>` nodes.

- [ ] **Step 3: Implement safe Markdown rendering**

Import `ReactMarkdown` and `remarkGfm`. Render one page-level markdown document with:

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>{page.translatedMarkdown}</ReactMarkdown>
```

Do not add `rehypeRaw`. Supply local components/classes for `h1`, `h2`, `h3`, `p`, `ul`, `ol`, and
`blockquote` matching the existing compact pane typography. Keep the page article, heading,
pending/error/retry state, and source-block-based scroll key.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/components/PDFTranslationPane.test.tsx`

Expected: PASS; GFM blocks render and raw HTML is inert.

- [ ] **Step 5: Commit**

Run: `git add apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx && git commit -m "feat: render PDF translations as markdown"`

### Task 4: Final Markdown-path verification

**Files:** verify only.

- [ ] **Step 1: Run focused regression suite**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx src/__tests__/app/reader/components/PDFTranslationPane.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx src/__tests__/app/reader/FoliateViewerPDFTranslationLayout.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run mechanical checks**

Run: `pnpm --dir apps/readest-app lint && pnpm --dir apps/readest-app format:check && git diff --check`

Expected: all commands exit `0`.
