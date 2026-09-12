import { For, Show, createSignal } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { FileUp, CircleQuestionMark, X } from 'lucide-solid';
import { submitTask } from '@/api/functions/tasks';
import type { TaskSubmitResponse } from '@/api/schemas/tasks';
import {
  MINERU_EFFORTS,
  MINERU_LANGUAGES,
  MINERU_PARSE_METHODS,
  MINERU_SERVER_BACKENDS,
  type ServerOnlyMineruBackend,
  type MineruEffort,
  type MineruLanguage,
  type MineruParseMethod,
} from '@/api/schemas/mineru-options';
import NoActiveKey from '@/components/NoActiveKey';
import { t } from '@/i18n';
import { mineruBackendLabel, mineruLanguageCoverage, mineruLanguageLabel } from '@/i18n/labels';
import { useApiKey } from '@/stores/api-key-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES } from '@/utils/constants';
import { formatFileSize } from '@/utils/format';
import { validateUploadSize } from '@/utils/upload';
import { env } from '@/env';

export const Route = createFileRoute('/_authenticated/upload')({
  component: UploadPage,
});

const inputCls =
  'border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

function LanguageCodeTable() {
  return (
    <div class="bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 w-80">
      <table class="w-full">
        <thead>
          <tr class="text-gray-400">
            <th class="text-left pr-2 py-0.5">{t('upload.langTableOption')}</th>
            <th class="text-left py-0.5">{t('upload.langTableCoverage')}</th>
          </tr>
        </thead>
        <tbody>
          {MINERU_LANGUAGES.map((lang) => (
            <tr>
              <td class="pr-2 py-0.5 whitespace-nowrap align-top">{mineruLanguageLabel(lang)}</td>
              <td class="py-0.5">{mineruLanguageCoverage(lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UploadPage() {
  const apiKeyStore = useApiKey();
  const toast = useToast();

  const [files, setFiles] = createSignal<File[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [backend, setBackend] = createSignal<ServerOnlyMineruBackend>('hybrid-engine');
  const [langList, setLangList] = createSignal<Set<MineruLanguage>>(new Set(['ch']));
  const [effort, setEffort] = createSignal<MineruEffort>('medium');
  const [parseMethod, setParseMethod] = createSignal<MineruParseMethod>('auto');
  const [formulaEnable, setFormulaEnable] = createSignal(true);
  const [tableEnable, setTableEnable] = createSignal(true);
  const [imageAnalysis, setImageAnalysis] = createSignal(false);
  const [responseZip, setResponseZip] = createSignal(true);

  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [submitted, setSubmitted] = createSignal<TaskSubmitResponse | null>(null);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.length === 0) return;

    const next = [...files(), ...incoming];
    const check = validateUploadSize(next, env.maxUploadSizeBytes);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    setError(null);
    setFiles(next);
  }

  // dragenter/dragleave fire on child elements too, so track nesting depth to
  // avoid flickering the highlight while dragging over the drop zone.
  let dragDepth = 0;

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepth += 1;
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setIsDragging(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    setIsDragging(false);
    addFiles(e.dataTransfer?.files ?? null);
  }

  const totalSize = () => files().reduce((sum, file) => sum + file.size, 0);

  function removeFile(index: number) {
    setFiles(files().filter((_, i) => i !== index));
  }

  function toggleLang(lang: MineruLanguage, checked: boolean) {
    const next = new Set(langList());
    if (checked) next.add(lang);
    else next.delete(lang);
    setLangList(next);
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const key = apiKeyStore.activeKey();
    if (!key) return;
    if (files().length === 0) {
      setError(t('upload.errNoFile'));
      return;
    }
    const sizeCheck = validateUploadSize(files(), env.maxUploadSizeBytes);
    if (!sizeCheck.ok) {
      setError(sizeCheck.message);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSubmitted(null);

    const result = await submitTask({
      apiKey: key,
      parseFields: {
        files: files(),
        backend: backend(),
        langList: [...langList()],
        effort: effort(),
        parseMethod: parseMethod(),
        formulaEnable: formulaEnable(),
        tableEnable: tableEnable(),
        imageAnalysis: imageAnalysis(),
        returnImages: true,
        responseFormat: responseZip() ? 'zip' : 'json',
      },
    });
    setIsSubmitting(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }
    setSubmitted(result.value);
    setFiles([]);
    toast.show(t('upload.submitted'), 'success');
  }

  return (
    <div class="max-w-3xl flex flex-col gap-4">
      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <Show when={submitted()}>
          {(s) => (
            <div class="bg-green-50 border border-green-300 rounded-lg p-4">
              <h3 class="font-semibold text-green-800 mb-1">{t('upload.submitted')}</h3>
              <p class="text-sm text-green-700 mb-2">
                {t('upload.taskIdLabel')}<code>{s().taskId}</code>
                {t('upload.fileCount', { count: s().fileNames.length })}
              </p>
              <Link
                to={ROUTES.taskDetail(s().taskId)}
                class="text-blue-600 hover:underline text-sm"
              >
                {t('upload.viewDetail')}
              </Link>
            </div>
          )}
        </Show>

        <Show when={error()}>
          <p class="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error()}
          </p>
        </Show>

        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          {/* File picker */}
          <section class="bg-white rounded-lg shadow p-6">
            <h2 class="text-lg font-semibold mb-3">{t('upload.fileSection')}</h2>
            <label
              class={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${
                isDragging()
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-blue-400'
              }`}
              onDragEnter={handleDragEnter}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <FileUp class="w-8 h-8 text-gray-400 mb-2" />
              <span class="text-sm text-gray-500">{t('upload.filePicker')}</span>
              <input
                type="file"
                multiple
                class="hidden"
                onChange={(e) => {
                  // Reset so re-picking the same file (e.g. after a rejected
                  // selection or a successful submit) fires change again.
                  addFiles(e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <Show when={files().length > 0}>
              <ul class="mt-3 flex flex-col gap-1">
                <For each={files()}>
                  {(file, index) => (
                    <li class="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                      <span>
                        {file.name}
                        <span class="text-gray-400 ml-2">{formatFileSize(file.size)}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index())}
                        class="text-gray-400 hover:text-red-600"
                      >
                        <X class="w-4 h-4" />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <p class="mt-2 text-xs text-gray-400">
                {t('upload.sizeSummary', {
                  count: files().length,
                  size: formatFileSize(totalSize()),
                  limit: formatFileSize(env.maxUploadSizeBytes),
                })}
              </p>
            </Show>
          </section>

          {/* Parse options */}
          <section class="bg-white rounded-lg shadow p-6 flex flex-col gap-4">
            <h2 class="text-lg font-semibold">{t('upload.optionsSection')}</h2>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium text-gray-700">{t('upload.backend')}</span>
                <select
                  value={backend()}
                  onChange={(e) => setBackend(e.currentTarget.value as ServerOnlyMineruBackend)}
                  class={inputCls}
                >
                  <For each={MINERU_SERVER_BACKENDS}>
                    {(b) => <option value={b}>{mineruBackendLabel(b)}</option>}
                  </For>
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium text-gray-700">{t('upload.parseMethod')}</span>
                <select
                  value={parseMethod()}
                  onChange={(e) => setParseMethod(e.currentTarget.value as MineruParseMethod)}
                  class={inputCls}
                >
                  <For each={MINERU_PARSE_METHODS}>
                    {(m) => <option value={m}>{m}</option>}
                  </For>
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium text-gray-700">{t('upload.effort')}</span>
                <select
                  value={effort()}
                  onChange={(e) => setEffort(e.currentTarget.value as MineruEffort)}
                  class={inputCls}
                >
                  <For each={MINERU_EFFORTS}>
                    {(ef) => <option value={ef}>{ef}</option>}
                  </For>
                </select>
              </label>
            </div>

            <div>
              <div class="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                {t('upload.language')}
                <div class="relative inline-flex group cursor-help">
                  <CircleQuestionMark class="w-4 h-4 text-gray-400" />
                  <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <LanguageCodeTable />
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                <For each={MINERU_LANGUAGES}>
                  {(lang) => (
                    <label class="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={langList().has(lang)}
                        onChange={(e) => toggleLang(lang, e.currentTarget.checked)}
                      />
                      {mineruLanguageLabel(lang)}
                    </label>
                  )}
                </For>
              </div>
            </div>

            <div class="flex flex-wrap gap-x-6 gap-y-1.5">
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={formulaEnable()}
                  onChange={(e) => setFormulaEnable(e.currentTarget.checked)}
                />
                {t('upload.formula')}
              </label>
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={tableEnable()}
                  onChange={(e) => setTableEnable(e.currentTarget.checked)}
                />
                {t('upload.table')}
              </label>
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={imageAnalysis()}
                  onChange={(e) => setImageAnalysis(e.currentTarget.checked)}
                />
                {t('upload.imageAnalysis')}
              </label>
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={responseZip()}
                  onChange={(e) => setResponseZip(e.currentTarget.checked)}
                />
                {t('upload.zipDownload')}
              </label>
            </div>
          </section>

          <button
            type="submit"
            disabled={isSubmitting() || files().length === 0}
            class="self-start bg-blue-600 text-white rounded px-6 py-2 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting()
              ? t('upload.submitting')
              : t('upload.submit', { count: files().length })}
          </button>
        </form>
      </Show>
    </div>
  );
}
