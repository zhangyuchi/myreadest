# PDF Translation Paragraph Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Render every PDF translation source block as its corresponding independent translation block.

**Architecture:** Replace page-wide translated Markdown with ordered PDFTranslatedBlock values that retain the source block and its deterministic, escaped Markdown. Render non-list blocks independently and render only consecutive blocks of the same list kind as one Markdown list, so parsing cannot cross a source paragraph boundary.

**Tech Stack:** React, TypeScript, react-markdown, remark-gfm, Vitest, Testing Library.

## Global Constraints

- Change only the PDF external translation pane; leave EPUB, provider implementations, source extraction, and language detection unchanged.
- Preserve count-mismatch, blank-result, retry, stale-generation, page ordering, scroll-reset, and accessibility behaviour.
- Continue to normalize and escape provider text before source-derived Markdown is created.
- Keep raw HTML disabled and add no dependencies.

---

### Task 1: Publish source-aligned translated blocks

**Files:**

- Modify: apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts
- Modify: apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx

**Interfaces:**

- Produces: PDFTranslatedBlock { sourceBlock: PDFSourceBlock; markdown: string }.
- Changes: PDFPageTranslation.translatedMarkdown to translatedBlocks?: PDFTranslatedBlock[].
- Produces: formatPDFTranslationBlocks(blocks, translations): PDFTranslatedBlock[].
- Consumes: a validated provider string array.

- [ ] **Step 1: Write the failing controller tests**

Import formatPDFTranslationBlocks instead of formatPDFMarkdown. Assert two source paragraphs produce two matching values, each containing the original sourceBlock and its own markdown text. Update the success test to assert five translatedBlocks in source order: heading, paragraph, unordered list, ordered list, and quote. Update error, late-result, text-layer-refresh, view-replacement, and retry assertions to use translatedBlocks. Keep provider HTML and newline assertions against an individual markdown field.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx

Expected: FAIL because PDFPageTranslation still exposes translatedMarkdown and the new formatter does not exist.

- [ ] **Step 3: Write the minimal controller implementation**

Add PDFTranslatedBlock with sourceBlock and markdown fields. Replace translatedMarkdown with translatedBlocks. Add markdownPrefix(block), returning heading hashes, a bullet prefix, an ordered-list prefix, a quote prefix, or empty text based on the source block. Implement formatPDFTranslationBlocks by mapping every source block and translation at the same index to { sourceBlock, markdown: markdownPrefix(sourceBlock) + escapeProviderMarkdown(translation) }. On the initial settled result and retryPage, set translatedBlocks only after alignedTranslations succeeds. Do not change provider requests, generation checks, or extraction.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the command from Step 2.

Expected: PASS with all hook tests green.

- [ ] **Step 5: Commit the controller model**

Run: git add apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx && git commit -m "feat: align PDF translation blocks"

### Task 2: Render translation blocks without cross-paragraph parsing

**Files:**

- Modify: apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx
- Modify: apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx

**Interfaces:**

- Consumes: PDFPageTranslation.translatedBlocks.
- Produces: one independent ReactMarkdown render for every non-list block.
- Produces: one ReactMarkdown render for each consecutive same-kind unordered or ordered list group.

- [ ] **Step 1: Write the failing pane tests**

Replace the page fixture that accepts a page-wide markdown string with fixtures that include matching sourceBlocks and translatedBlocks. Add two paragraph blocks, First translation and Second translation; assert each matched text has P as tag name and the rendered page has two paragraph nodes. Add two adjacent unordered-list blocks followed by a paragraph; assert one list has two items and the paragraph is outside it. Keep heading, quote, raw-HTML, retry, pending, ordering, and scroll-reset coverage using translatedBlocks.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/components/PDFTranslationPane.test.tsx

Expected: FAIL because the component still consumes page-wide translatedMarkdown.

- [ ] **Step 3: Write the minimal block renderer**

Extract the existing safe ReactMarkdown configuration into TranslationMarkdown(markdown). Add isList and isSameListKind predicates over PDFTranslatedBlock.sourceBlock.kind. Build TranslationBlocks(blocks): collect only adjacent blocks with the same list kind, render their markdown joined by a newline through one TranslationMarkdown, and render every other block by itself through TranslationMarkdown. Use a source-text-plus-index key for each rendered root. Replace the page-wide renderer with TranslationBlocks(page.translatedBlocks). Keep the page article, localized heading, loading/error/retry UI, scroll key, existing typography, remarkGfm, and no-rehypeRaw safety boundary.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the command from Step 2.

Expected: PASS; paragraphs have independent DOM boundaries and only same-kind list blocks combine.

- [ ] **Step 5: Commit the renderer**

Run: git add apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx && git commit -m "feat: render aligned PDF translation paragraphs"

### Task 3: Verify the complete PDF translation path

**Files:** verify only.

- [ ] **Step 1: Run focused PDF translation regressions**

Run: pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx src/__tests__/app/reader/components/PDFTranslationPane.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx src/__tests__/app/reader/FoliateViewerPDFTranslationLayout.test.tsx

Expected: PASS with no failing tests.

- [ ] **Step 2: Run static and formatting verification**

Run: pnpm --dir apps/readest-app lint
Run: pnpm --dir apps/readest-app format:check
Run: git diff --check

Expected: each command exits 0.

- [ ] **Step 3: Review the final change set**

Run: git status --short --untracked-files=all
Run: git diff --stat HEAD~2..HEAD
Run: git show --check --stat HEAD~2..HEAD

Expected: only the two implementation commits modify the hook, pane, and their focused tests; no generated files, dependencies, or unrelated paths change.
