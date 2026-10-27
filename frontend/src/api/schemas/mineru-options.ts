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

/**
 * Every artifact format MinerU 4.0's `/v1` parse surface accepts, in display
 * order. Images and `model_output.json` are bundled in the ZIP archive.
 */
export const MINERU_OUTPUT_FORMATS: MineruOutputFormat[] = [
  'markdown',
  'zip',
  'middle_json',
  'structured_content',
];

/** Formats selected by default: readable output + self-contained download. */
export const MINERU_DEFAULT_OUTPUT_FORMATS: MineruOutputFormat[] = ['markdown', 'zip'];

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
