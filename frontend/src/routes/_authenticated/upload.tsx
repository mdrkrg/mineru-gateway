import { For, Show, createSignal } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { FileUp, CircleQuestionMark, X } from 'lucide-solid';
import { submitTask } from '@/api/functions/tasks';
import type { TaskSubmitResponse } from '@/api/schemas/tasks';
import {
  MINERU_BACKENDS,
  MINERU_EFFORTS,
  MINERU_LANGUAGES,
  MINERU_PARSE_METHODS,
  type MineruBackend,
  type MineruEffort,
  type MineruLanguage,
  type MineruParseMethod,
} from '@/api/schemas/mineru-options';
import NoActiveKey from '@/components/NoActiveKey';
import { useApiKey } from '@/stores/api-key-context';
import { errorMessage } from '@/utils/api-error';
import { MINERU_LANGUAGE_COVERAGE, MINERU_LANGUAGE_LABELS, ROUTES } from '@/utils/constants';
import { formatFileSize } from '@/utils/format';

export const Route = createFileRoute('/_authenticated/upload')({
  component: UploadPage,
});

const inputCls =
  'border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500';

const needsServerUrl = (backend: MineruBackend) => backend.endsWith('-http-client');

function LanguageCodeTable() {
  return (
    <div class="bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 w-80">
      <table class="w-full">
        <thead>
          <tr class="text-gray-400">
            <th class="text-left pr-2 py-0.5">选项</th>
            <th class="text-left py-0.5">覆盖语言</th>
          </tr>
        </thead>
        <tbody>
          {MINERU_LANGUAGES.map((lang) => (
            <tr>
              <td class="pr-2 py-0.5 whitespace-nowrap align-top">{MINERU_LANGUAGE_LABELS[lang]}</td>
              <td class="py-0.5">{MINERU_LANGUAGE_COVERAGE[lang]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UploadPage() {
  const apiKeyStore = useApiKey();

  const [files, setFiles] = createSignal<File[]>([]);
  const [backend, setBackend] = createSignal<MineruBackend>('pipeline');
  const [langList, setLangList] = createSignal<Set<MineruLanguage>>(new Set(['ch']));
  const [effort, setEffort] = createSignal<MineruEffort>('medium');
  const [parseMethod, setParseMethod] = createSignal<MineruParseMethod>('auto');
  const [formulaEnable, setFormulaEnable] = createSignal(true);
  const [tableEnable, setTableEnable] = createSignal(true);
  const [imageAnalysis, setImageAnalysis] = createSignal(false);
  const [responseZip, setResponseZip] = createSignal(true);
  const [serverUrl, setServerUrl] = createSignal('');

  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [submitted, setSubmitted] = createSignal<TaskSubmitResponse | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles([...files(), ...Array.from(list)]);
  }

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
      setError('请先选择要解析的文件');
      return;
    }
    if (needsServerUrl(backend()) && !serverUrl().trim()) {
      setError('当前后端需要填写 Server URL');
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
        serverUrl: needsServerUrl(backend()) ? serverUrl().trim() : undefined,
      },
    });
    setIsSubmitting(false);

    if (result.isErr()) {
      setError(errorMessage(result.error));
      return;
    }
    setSubmitted(result.value);
    setFiles([]);
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
              <h3 class="font-semibold text-green-800 mb-1">任务已提交</h3>
              <p class="text-sm text-green-700 mb-2">
                任务 ID:<code>{s().taskId}</code>({s().fileNames.length} 个文件)
              </p>
              <Link
                to={ROUTES.taskDetail(s().taskId)}
                class="text-blue-600 hover:underline text-sm"
              >
                查看任务详情 →
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
            <h2 class="text-lg font-semibold mb-3">文件</h2>
            <label class="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-8 cursor-pointer hover:border-blue-400">
              <FileUp class="w-8 h-8 text-gray-400 mb-2" />
              <span class="text-sm text-gray-500">点击选择文件(可多选)</span>
              <input
                type="file"
                multiple
                class="hidden"
                onChange={(e) => addFiles(e.currentTarget.files)}
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
            </Show>
          </section>

          {/* Parse options */}
          <section class="bg-white rounded-lg shadow p-6 flex flex-col gap-4">
            <h2 class="text-lg font-semibold">解析选项</h2>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium text-gray-700">后端</span>
                <select
                  value={backend()}
                  onChange={(e) => setBackend(e.currentTarget.value as MineruBackend)}
                  class={inputCls}
                >
                  <For each={MINERU_BACKENDS}>
                    {(b) => <option value={b}>{b}</option>}
                  </For>
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium text-gray-700">解析方式</span>
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
                <span class="text-sm font-medium text-gray-700">Effort</span>
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

            <Show when={needsServerUrl(backend())}>
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium text-gray-700">Server URL</span>
                <input
                  type="url"
                  required
                  value={serverUrl()}
                  onInput={(e) => setServerUrl(e.currentTarget.value)}
                  placeholder="https://…"
                  class={inputCls}
                />
              </label>
            </Show>

            <div>
              <div class="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                语言(可多选)
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
                      {MINERU_LANGUAGE_LABELS[lang]}
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
                公式识别
              </label>
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={tableEnable()}
                  onChange={(e) => setTableEnable(e.currentTarget.checked)}
                />
                表格识别
              </label>
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={imageAnalysis()}
                  onChange={(e) => setImageAnalysis(e.currentTarget.checked)}
                />
                图像分析
              </label>
              <label class="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={responseZip()}
                  onChange={(e) => setResponseZip(e.currentTarget.checked)}
                />
                Zip 格式下载
              </label>
            </div>
          </section>

          <button
            type="submit"
            disabled={isSubmitting() || files().length === 0}
            class="self-start bg-blue-600 text-white rounded px-6 py-2 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting() ? '提交中…' : `提交任务(${files().length} 个文件)`}
          </button>
        </form>
      </Show>
    </div>
  );
}
