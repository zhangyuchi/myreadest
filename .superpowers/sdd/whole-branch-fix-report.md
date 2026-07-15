# Whole-branch reliability fix report

**Date:** 2026-07-15

## Scope and root cause

This repair addresses the three whole-branch findings only:

1. `useTextTranslation` had acquired LLM language detection and `und`/same-language early exits.
   That hook is shared by reflowable EPUB text, so an unavailable detector could stop EPUB
   translation. The PDF-specific resolver remains `resolvePDFSourceLanguage`.
2. Two partial `FoliateView` fixtures used direct assertions and failed TypeScript `TS2352`.
3. The PDF controller lacked regressions covering completion of pending work after unmount and
   reactive settings replacement.

The prior design still applies: PDF language detection is best effort and local to the PDF flow;
browser smoke testing and the raw full-suite limitation remain explicitly unexecuted/unresolved.

## RED / GREEN evidence

### EPUB isolation

- **RED:**

  ```bash
  pnpm --dir apps/readest-app exec vitest run \
    src/__tests__/app/reader/hooks/useTextTranslationBehavior.test.tsx \
    src/__tests__/app/reader/utils/pdfTranslation.test.ts
  ```

  Result: failed as intended. The new EPUB test recorded zero `translate(['EPUB source'])` calls
  and an unhandled `LLM detector unavailable` rejection.
- **GREEN:** removed the branch-added LLM detection/same-language early-exit code from the shared
  `useTextTranslation` hook. The same command then passed: 2 files, 3 tests.

### PDF controller lifecycle

Added regressions using the existing `useSyncExternalStore` reader-settings subscription seam:

- a pending translation cannot publish after unmount;
- provider replacement translates with the replacement provider and leaves the replacement state
  intact after the former provider completes;
- target-language replacement translates with `target: 'fr'` and rejects the late old-target
  completion.

The focused hook command passed with 17 tests.

## Changed files

- `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts`
- `apps/readest-app/src/__tests__/app/reader/hooks/useTextTranslationBehavior.test.tsx`
- `apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx`
- `apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts`
- `docs/superpowers/specs/2026-07-14-pdf-translation-reliability-design.md`

## Final validation

All commands below exited 0.

```bash
pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run \
  src/__tests__/services/translators/providers/llm.test.ts \
  src/__tests__/hooks/useTranslator.test.tsx \
  src/__tests__/services/translators/pdfLanguage.test.ts \
  src/__tests__/app/reader/utils/pdfTranslation.test.ts \
  src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx \
  src/__tests__/app/reader/components/PDFTranslationPane.test.tsx \
  src/__tests__/app/reader/PDFTranslationFlow.test.tsx \
  src/__tests__/app/reader/hooks/useTextTranslation.test.ts \
  src/__tests__/app/reader/FoliateViewerPDFTranslationLayout.test.tsx
# 9 files, 56 tests passed

pnpm --dir apps/readest-app exec vitest run \
  src/__tests__/app/reader/hooks/useTextTranslationBehavior.test.tsx
# 1 file, 1 test passed

pnpm --dir apps/readest-app lint
pnpm --dir apps/readest-app format:check
git diff --check
```

The dotenv suite emitted the existing Node warning that `--localstorage-file` lacks a valid path,
but all nine selected files passed. Lint ran `tsgo --noEmit && biome lint .` with no diagnostics.

## Commit

- `521880f1 fix: preserve EPUB translation isolation`

## Concerns and exclusions

- The raw full-suite command remains unexecuted because the documented local-storage environment
  issue causes it to fail; this report does not claim it is green.
- The interactive browser PDF smoke remains unexecuted.
- Pre-existing untracked `.codegraph/` and `.memsearch/` files were deliberately left out of the
  commit.
