import { type } from 'arktype';

export const MineruTierSchema = type("'flash' | 'basic' | 'standard' | 'advanced'");
export type MineruTier = typeof MineruTierSchema.infer;

export const MineruOcrModeSchema = type("'auto' | 'txt' | 'ocr'");
export type MineruOcrMode = typeof MineruOcrModeSchema.infer;

export const MineruOutputFormatSchema = type(
  "'markdown' | 'middle_json' | 'structured_content' | 'zip'",
);
export type MineruOutputFormat = typeof MineruOutputFormatSchema.infer;

export const MINERU_TIERS: MineruTier[] = ['flash', 'basic', 'standard', 'advanced'];
export const MINERU_OCR_MODES: MineruOcrMode[] = ['auto', 'txt', 'ocr'];

export interface ParseRequestFields {
  files: File[];
  tier?: MineruTier;
  ocrMode?: MineruOcrMode;
  pageRange?: string;
  outputFormats?: MineruOutputFormat[];
}

export function createParseFormData(fields: ParseRequestFields): FormData {
  const fd = new FormData();

  for (const file of fields.files) {
    fd.append('files', file);
  }

  if (fields.tier !== undefined) fd.append('tier', fields.tier);
  if (fields.ocrMode !== undefined) fd.append('ocr_mode', fields.ocrMode);
  if (fields.pageRange !== undefined) fd.append('page_range', fields.pageRange);
  if (fields.outputFormats?.length) fd.append('output_formats', fields.outputFormats.join(','));

  return fd;
}
