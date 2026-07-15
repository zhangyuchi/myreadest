import { useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '@/hooks/useTranslation';
import type { PDFPageTranslation } from '../hooks/usePDFTranslation';

interface PDFTranslationPaneProps {
  pages: PDFPageTranslation[];
  onRetry: (index: number) => void;
}

const PDFTranslationPane = ({ pages, onRetry }: PDFTranslationPaneProps) => {
  const _ = useTranslation();
  const paneRef = useRef<HTMLElement>(null);
  const visiblePageKey = useMemo(
    () =>
      pages
        .map(
          (page) => `${page.index}:${page.sourceBlocks.map((block) => block.text).join('\u001f')}`,
        )
        .join('|'),
    [pages],
  );

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [visiblePageKey]);

  return (
    <aside
      ref={paneRef}
      aria-label={_('PDF Translation')}
      className='eink-bordered h-full min-h-0 min-w-0 overflow-y-auto border-base-300 bg-base-100 p-4 md:border-l max-md:border-t'
    >
      {pages.map((page) => (
        <article
          key={`${page.index}:${page.sourceBlocks.map((block) => block.text).join('\u001f')}`}
          className='mb-6 last:mb-0'
        >
          <h2 className='mb-2 text-sm font-semibold opacity-70'>
            {_('Page')} {page.index + 1}
          </h2>
          {(page.status === 'detecting' || page.status === 'translating') && (
            <div role='status' className='flex min-h-24 items-center justify-center'>
              <span aria-hidden='true' className='loading loading-spinner loading-md' />
              <span className='sr-only'>{_('Translating...')}</span>
            </div>
          )}
          {page.status === 'translated' && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className='mb-3 text-xl font-semibold leading-snug'>{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className='mb-3 text-lg font-semibold leading-snug'>{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className='mb-3 text-base font-semibold leading-snug'>{children}</h3>
                ),
                p: ({ children }) => <p className='mb-4 text-base leading-relaxed'>{children}</p>,
                ul: ({ children }) => (
                  <ul className='mb-4 list-disc space-y-1 pl-5 text-base leading-relaxed'>
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className='mb-4 list-decimal space-y-1 pl-5 text-base leading-relaxed'>
                    {children}
                  </ol>
                ),
                blockquote: ({ children }) => (
                  <blockquote className='mb-4 border-l-2 border-base-300 pl-3 text-base leading-relaxed opacity-80'>
                    {children}
                  </blockquote>
                ),
              }}
            >
              {page.translatedMarkdown}
            </ReactMarkdown>
          )}
          {page.status === 'error' && (
            <div role='alert' className='rounded border border-error p-3'>
              <p>{page.error || _('Translation failed')}</p>
              <button
                type='button'
                className='btn btn-primary btn-sm mt-3'
                onClick={() => onRetry(page.index)}
              >
                {_('Retry')}
              </button>
            </div>
          )}
        </article>
      ))}
    </aside>
  );
};

export default PDFTranslationPane;
