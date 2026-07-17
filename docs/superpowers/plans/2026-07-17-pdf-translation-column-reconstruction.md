# PDF Translation Column-Aware Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Reconstruct PDF paragraphs using region-local body margins so quotes and visual wraps preserve translation semantics.

**Architecture:** Split repeated wide same-baseline regions into left-to-right text columns, process each region top-to-bottom, and derive the body margin from the minimum non-structural prose left edge in that region. Use the region-local margin and quote-candidate outdent to group prose before assigning paragraph or quote kinds.

**Tech Stack:** TypeScript, PDF.js text-layer geometry, Vitest.

## Global Constraints

- Change only apps/readest-app/src/app/reader/utils/pdfTranslation.ts and its focused unit test.
- Keep controller, providers, Markdown renderer, retry, page ordering outside the extractor, and pane layout unchanged.
- Preserve edge filtering, same-baseline text joining within a column, headings, lists, iframe non-mutation, and exported interfaces.
- Keep readest.png untracked and unmodified; add no dependencies; prefer paragraphs under ambiguity.

---

### Task 1: Add region-aware source-line reconstruction

**Files:**

- Modify: apps/readest-app/src/app/reader/utils/pdfTranslation.ts
- Modify: apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts

**Interfaces:**

- Consumes: positioned text spans from one PDF text layer.
- Produces: unchanged PDFPageSource and PDFSourceBlock values in reading order.
- Preserves: getVisiblePDFPageSources(view) public contract.

- [ ] **Step 1: Write failing geometry regressions**

Add a quote-majority case with one body-left prose line followed by two quote lines; assert paragraph then blockquote. Retain the existing first-line-indent, quote-to-indented-paragraph, structural-line, and hyphen-wrap cases.

Add a two-column page with at least two matching baselines containing left and right spans separated by a wide gap. Assert blocks read every left-column line top-to-bottom before right-column lines. Add a control with one ordinary line containing a single wide gap; assert it remains one paragraph line rather than two regions.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts

Expected: FAIL because quote-majority input chooses the quote as the global body margin, and same-baseline distant spans are still joined into one line.

- [ ] **Step 3: Implement minimal region-local grouping**

Replace global prose left-median use with region-local minimum prose left. Split a same-baseline span sequence into fragments only at a gap greater than max(4 times median span height, 12 percent of text-layer width). Treat fragments as separate columns only when the same horizontal split recurs on at least two baselines; otherwise preserve the original one-line span grouping.

Sort detected regions left-to-right and process each region's fragments top-to-bottom. Within each region, classify headings/lists before collecting the prose-left sample, use the minimum prose left as body-left, and reuse candidate flushing for material gaps, body-to-indent starts, and quote-candidate outdents. Emit a quote only for a multi-line candidate wholly offset from body-left. Keep text joining and dehyphenation behavior unchanged.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the command from Step 2.

Expected: PASS with quote-majority, two-column ordering, and one-off-gap controls passing alongside all prior extraction tests.

- [ ] **Step 5: Commit the extractor change**

Run: git add apps/readest-app/src/app/reader/utils/pdfTranslation.ts apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts && git commit -m "fix: reconstruct PDF text by column"

### Task 2: Verify PDF translation regressions

**Files:** verify only.

- [ ] **Step 1: Run the complete focused PDF translation suite**

Run: pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx src/__tests__/app/reader/components/PDFTranslationPane.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx src/__tests__/app/reader/FoliateViewerPDFTranslationLayout.test.tsx

Expected: PASS with no failures.

- [ ] **Step 2: Run static and whitespace checks**

Run: pnpm --dir apps/readest-app lint
Run: pnpm --dir apps/readest-app format:check
Run: git diff --check

Expected: each command exits 0.

- [ ] **Step 3: Review changed-path scope**

Run: git status --short --untracked-files=all
Run: git diff --stat HEAD~1..HEAD
Run: git show --check --stat HEAD~1..HEAD

Expected: only extractor/test implementation paths change. readest.png remains an untracked user file and is never staged.
