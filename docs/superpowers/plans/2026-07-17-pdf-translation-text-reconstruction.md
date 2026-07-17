# PDF Translation Text Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Reconstruct complete PDF paragraphs before translation and stop normal first-line indents becoming quotes.

**Architecture:** Keep existing span-to-visual-line extraction and edge filtering. Replace per-line block classification with prose paragraph reconstruction: identify structural headings/lists, group adjacent prose lines using indentation and vertical spacing, then classify a completed consistently indented group as a quote only when every line is offset.

**Tech Stack:** TypeScript, PDF.js text-layer geometry, Vitest.

## Global Constraints

- Change only apps/readest-app/src/app/reader/utils/pdfTranslation.ts and its focused unit test.
- Keep provider, controller, renderer, Markdown, retry, page ordering, and external pane layout unchanged.
- Preserve header/footer filtering, same-baseline span joining, headings, list items, and iframe non-mutation.
- Prefer ordinary paragraphs when geometry is ambiguous; do not add dependencies.

---

### Task 1: Reconstruct source paragraphs before classifying blocks

**Files:**

- Modify: apps/readest-app/src/app/reader/utils/pdfTranslation.ts
- Modify: apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts

**Interfaces:**

- Consumes: the existing internal TextLine values produced from PDF text-layer spans.
- Produces: unchanged public PDFPageSource and PDFSourceBlock interfaces.
- Preserves: getVisiblePDFPageSources(view) call shape and output ownership.

- [ ] **Step 1: Write failing screenshot-shaped extraction tests**

In the focused test file, add a visible page whose lines model the screenshot: three body-left visual lines for the first paragraph; an indented first line followed by a body-left continuation for the second; and another indented first line followed by body-left continuations for the third. Assert the extractor returns three paragraph blocks, with the continuation text joined into complete sentences, and no blockquote kind.

Add a separate multi-line consistently indented block after a body paragraph. Assert it produces one blockquote whose text joins both quote lines. Add a soft-wrap case with first text ending in talk- and next text beginning ing about sets; assert the reconstructed paragraph contains talking about sets and does not contain talk- ing.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts

Expected: FAIL because the current extractor emits one paragraph per visual line and classifies any single left-indented line as a blockquote.

- [ ] **Step 3: Implement minimal paragraph reconstruction**

In getBodyBlocks, retain span filtering, sorting, same-baseline line assembly, textForLine, heading recognition, and list-marker stripping. Add a small local paragraph-candidate accumulator over consecutive prose TextLine values. Use the body-left median and line-height median to start a new candidate when the current line follows a structural block, has a material vertical gap, or is indented after a body-left previous line. Otherwise append it to the current candidate.

Join candidate line text with a helper that removes the separator only when the prior text ends in a hyphen and the following text starts with a lowercase Unicode letter; otherwise use one space. Emit headings and lists immediately as their existing standalone block kinds. After a prose candidate closes, classify it as blockquote only when every source line stays substantially offset from body-left; otherwise emit paragraph. Do not change exported types or callers.

- [ ] **Step 4: Run the focused test to verify it passes**

Run the command from Step 2.

Expected: PASS; the new screenshot-shaped, quote, and dehyphenation tests pass with all existing extraction tests.

- [ ] **Step 5: Commit the reconstruction fix**

Run: git add apps/readest-app/src/app/reader/utils/pdfTranslation.ts apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts && git commit -m "fix: reconstruct PDF translation paragraphs"

### Task 2: Verify extraction and translation regressions

**Files:** verify only.

- [ ] **Step 1: Run extraction and translation-path tests**

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

Expected: the implementation commit changes only the extractor and its focused test. The user-provided readest.png remains untracked and is not staged.
