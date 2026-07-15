import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useTranslator } from '@/hooks/useTranslator';
import type { UseTranslatorOptions } from '@/services/translators';
import { resolvePDFSourceLanguage } from '@/services/translators/pdfLanguage';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useReaderStore } from '@/store/readerStore';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import { getVisiblePDFPageSources, type PDFSourceBlock } from '../utils/pdfTranslation';

export type PDFTranslationStatus = 'detecting' | 'translating' | 'translated' | 'error';

export interface PDFPageTranslation {
  index: number;
  sourceBlocks: PDFSourceBlock[];
  sourceLanguage: string;
  status: PDFTranslationStatus;
  translatedMarkdown?: string;
  error?: string;
}

export interface UsePDFTranslationResult {
  pages: PDFPageTranslation[];
  retryPage: (index: number) => void;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const alignedTranslations = (sourceBlocks: PDFSourceBlock[], translated: string[]) => {
  const translations = translated.map((translation) => translation.trim());
  return translations.length === sourceBlocks.length && translations.every(Boolean)
    ? translations
    : null;
};

const escapeProviderMarkdown = (text: string) =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/([\\`*_{}\[\]#+\-.!|~])/gu, '\\$1');

const isList = (block: PDFSourceBlock) =>
  block.kind === 'unordered-list' || block.kind === 'ordered-list';

export const formatPDFMarkdown = (blocks: PDFSourceBlock[], translations: string[]) =>
  blocks.reduce((markdown, block, index) => {
    const prefix =
      block.kind === 'heading'
        ? `${'#'.repeat(block.headingLevel ?? 1)} `
        : block.kind === 'unordered-list'
          ? '- '
          : block.kind === 'ordered-list'
            ? '1. '
            : block.kind === 'blockquote'
              ? '> '
              : '';
    const previousBlock = blocks[index - 1];
    const separator =
      index === 0 ? '' : previousBlock && isList(previousBlock) && isList(block) ? '\n' : '\n\n';
    return `${markdown}${separator}${prefix}${escapeProviderMarkdown(translations[index]!)}`;
  }, '');

export function usePDFTranslation(
  bookKey: string,
  view: FoliateView | null,
): UsePDFTranslationResult {
  const _ = useTranslation();
  const settings = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings ?? null);
  const getBookData = useBookDataStore((state) => state.getBookData);
  const progress = useBookProgress(bookKey);
  const bookData = getBookData(bookKey);
  const enabled =
    view !== null && bookData?.book?.format === 'PDF' && !!settings?.translationEnabled;
  const provider = settings?.translationProvider;
  const targetLanguage = settings?.translateTargetLang || getLocale();
  const metadataLanguage = bookData?.book?.primaryLanguage;
  const { translate } = useTranslator({
    provider,
    targetLang: targetLanguage,
  } as UseTranslatorOptions);
  const [pages, setPages] = useState<PDFPageTranslation[]>([]);
  const pagesRef = useRef<PDFPageTranslation[]>([]);
  const generationRef = useRef(0);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const refresh = useCallback(
    async (showEmptyToast: boolean) => {
      if (!enabled || !view) return;

      const generation = ++generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      const sources = getVisiblePDFPageSources(view);

      if (sources.length === 0) {
        if (isCurrent()) setPages([]);
        if (showEmptyToast) {
          await eventDispatcher.dispatch('toast', {
            timeout: 5000,
            message: _(
              'No selectable text found for translation. This may be an image-based PDF or a scanned document.',
            ),
            type: 'info',
          });
        }
        return;
      }

      setPages(
        sources.map(({ index, blocks }) => ({
          index,
          sourceBlocks: blocks,
          sourceLanguage: 'AUTO',
          status: 'detecting',
        })),
      );

      const resolved = await resolvePDFSourceLanguage({
        metadataLanguage,
        targetLanguage,
        sample: sources
          .flatMap((source) => source.blocks.map((block) => block.text))
          .join('\n')
          .slice(0, 500),
      });
      if (!isCurrent()) return;

      if (resolved.skipTranslation) {
        setPages([]);
        await eventDispatcher.dispatch('toast', {
          timeout: 5000,
          message: _('The document is already in the target language. No translation needed.'),
          type: 'info',
        });
        return;
      }

      setPages(
        sources.map(({ index, blocks }) => ({
          index,
          sourceBlocks: blocks,
          sourceLanguage: resolved.language,
          status: 'translating',
        })),
      );

      const settled = await Promise.allSettled(
        sources.map(({ blocks }) =>
          translate(
            blocks.map((block) => block.text),
            { source: resolved.language, target: targetLanguage },
          ),
        ),
      );
      if (!isCurrent()) return;

      setPages(
        sources.map(({ index, blocks }, resultIndex): PDFPageTranslation => {
          const result = settled[resultIndex]!;
          if (result.status === 'rejected') {
            return {
              index,
              sourceBlocks: blocks,
              sourceLanguage: resolved.language,
              status: 'error',
              error: errorMessage(result.reason),
            };
          }

          const translations = alignedTranslations(blocks, result.value);
          if (!translations) {
            return {
              index,
              sourceBlocks: blocks,
              sourceLanguage: resolved.language,
              status: 'error',
              error: 'Translation did not return one result for each paragraph.',
            };
          }

          return {
            index,
            sourceBlocks: blocks,
            sourceLanguage: resolved.language,
            status: 'translated',
            translatedMarkdown: formatPDFMarkdown(blocks, translations),
          };
        }),
      );
    },
    [_, enabled, metadataLanguage, targetLanguage, translate, view],
  );

  useEffect(() => {
    if (!enabled || !view) {
      generationRef.current += 1;
      setPages([]);
      return;
    }

    const onLoad = () => void refresh(false);
    const onTextLayerRendered = () => void refresh(true);
    view.addEventListener('load', onLoad);
    view.addEventListener('pdf-text-layer-rendered', onTextLayerRendered);
    void refresh(false);

    return () => {
      view.removeEventListener('load', onLoad);
      view.removeEventListener('pdf-text-layer-rendered', onTextLayerRendered);
      generationRef.current += 1;
    };
  }, [enabled, progress?.index, refresh, view]);

  const retryPage = useCallback(
    (index: number) => {
      const page = pagesRef.current.find((candidate) => candidate.index === index);
      if (!page || page.status !== 'error' || !enabled) return;

      const generation = ++generationRef.current;
      setPages((current) =>
        current.map((candidate) =>
          candidate.index === index
            ? { ...candidate, status: 'translating', error: undefined }
            : candidate,
        ),
      );

      void translate(
        page.sourceBlocks.map((block) => block.text),
        {
          source: page.sourceLanguage,
          target: targetLanguage,
        },
      )
        .then((translated) => {
          if (generationRef.current !== generation) return;
          setPages((current) =>
            current.map((candidate) => {
              if (candidate.index !== index || candidate.sourceBlocks !== page.sourceBlocks) {
                return candidate;
              }
              const translations = alignedTranslations(page.sourceBlocks, translated);
              return translations
                ? {
                    ...candidate,
                    status: 'translated',
                    translatedMarkdown: formatPDFMarkdown(page.sourceBlocks, translations),
                  }
                : {
                    ...candidate,
                    status: 'error',
                    error: 'Translation did not return one result for each paragraph.',
                  };
            }),
          );
        })
        .catch((error: unknown) => {
          if (generationRef.current !== generation) return;
          setPages((current) =>
            current.map((candidate) =>
              candidate.index === index && candidate.sourceBlocks === page.sourceBlocks
                ? { ...candidate, status: 'error', error: errorMessage(error) }
                : candidate,
            ),
          );
        });
    },
    [enabled, targetLanguage, translate],
  );

  return { pages, retryPage };
}
