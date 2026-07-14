import { Book } from '@/types/book';
import { isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

export const isTranslationAvailable = (book?: Book | null, targetLanguage?: string | null) => {
  if (!book) {
    return false;
  }

  const primaryLanguage = book.primaryLanguage || '';
  const langKnown = !!primaryLanguage && primaryLanguage.toLowerCase() !== 'und';

  if (langKnown && targetLanguage && isSameLang(primaryLanguage, targetLanguage)) {
    return false;
  }

  if (langKnown && !targetLanguage && isSameLang(primaryLanguage, getLocale())) {
    return false;
  }

  return true;
};
