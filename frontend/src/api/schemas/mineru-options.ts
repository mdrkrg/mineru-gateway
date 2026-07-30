import { type } from 'arktype';

export const MineruBackendSchema = type(
  "'pipeline' | 'vlm-engine' | 'hybrid-engine' | 'vlm-http-client' | 'hybrid-http-client'",
);
export type MineruBackend = typeof MineruBackendSchema.infer;

export const MineruLanguageSchema = type(
  "'ch' | 'ch_server' | 'korean' | 'ta' | 'te' | 'ka' | 'th' | 'el' | 'arabic' | 'east_slavic' | 'cyrillic' | 'devanagari'",
);
export type MineruLanguage = typeof MineruLanguageSchema.infer;

export const MineruEffortSchema = type("'medium' | 'high'");
export type MineruEffort = typeof MineruEffortSchema.infer;

export const MineruParseMethodSchema = type("'auto' | 'txt' | 'ocr'");
export type MineruParseMethod = typeof MineruParseMethodSchema.infer;

export const MINERU_BACKENDS: MineruBackend[] = [
  'pipeline',
  'vlm-engine',
  'hybrid-engine',
  'vlm-http-client',
  'hybrid-http-client',
];
export const MINERU_LANGUAGES: MineruLanguage[] = [
  'ch',
  'ch_server',
  'korean',
  'ta',
  'te',
  'ka',
  'th',
  'el',
  'arabic',
  'east_slavic',
  'cyrillic',
  'devanagari',
];
export const MINERU_EFFORTS: MineruEffort[] = ['medium', 'high'];
export const MINERU_PARSE_METHODS: MineruParseMethod[] = ['auto', 'txt', 'ocr'];

export interface ParseRequestFields {
  files: File[];
  backend?: MineruBackend;
  langList?: MineruLanguage[];
  effort?: MineruEffort;
  parseMethod?: MineruParseMethod;
  formulaEnable?: boolean;
  tableEnable?: boolean;
  imageAnalysis?: boolean;
  returnImages?: boolean;
  /**
   * `'zip'`  -> `response_format_zip=true` (downloadable)
   * `'json'` -> inline JSON/Markdown
   * */
  responseFormat?: 'json' | 'zip';
  serverUrl?: string;
  startPageId?: number;
  endPageId?: number;
}

export function createParseFormData(fields: ParseRequestFields): FormData {
  const fd = new FormData();

  for (const file of fields.files) {
    fd.append('files', file);
  }

  if (fields.backend !== undefined) fd.append('backend', fields.backend);
  if (fields.langList?.length) fd.append('lang_list', fields.langList.join(','));
  if (fields.effort !== undefined) fd.append('effort', fields.effort);
  if (fields.parseMethod !== undefined) fd.append('parse_method', fields.parseMethod);
  if (fields.formulaEnable !== undefined) fd.append('formula_enable', String(fields.formulaEnable));
  if (fields.tableEnable !== undefined) fd.append('table_enable', String(fields.tableEnable));
  if (fields.imageAnalysis !== undefined) fd.append('image_analysis', String(fields.imageAnalysis));
  if (fields.returnImages !== undefined) fd.append('return_images', String(fields.returnImages));
  if (fields.responseFormat) fd.append('response_format_zip', fields.responseFormat === 'zip' ? 'true' : 'false');
  if (fields.serverUrl !== undefined) fd.append('server_url', fields.serverUrl);
  if (fields.startPageId !== undefined) fd.append('start_page_id', String(fields.startPageId));
  if (fields.endPageId !== undefined) fd.append('end_page_id', String(fields.endPageId));

  return fd;
}
