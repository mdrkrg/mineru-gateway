# MinerU API 参考

本文档适用于 mineru-gateway 前后端开发，描述了 MinerU 解析引擎的请求参数、响应格式、任务状态等约定。

## 解析参数

以下参数通过 `POST /tasks` 或 `POST /file_parse` 的 `multipart/form-data` 传递。

### 参数表

| 参数 | 类型 | 默认值 | 语义解释 |
|------|------|--------|----------|
| `backend` | `str` | `"hybrid-engine"` | 解析后端。`pipeline`: 通用多语言，无幻觉；`vlm-engine`: 本地 VLM 高精度，仅中英文；`vlm-http-client`: 远程 VLM（兼容 OpenAI），仅中英文；`hybrid-engine`: 本地混合解析（pipeline+VLM），多语言，可调 effort；`hybrid-http-client`: 远程混合+少量本地算力，多语言 |
| `parse_method` | `str` | `"auto"` | PDF 解析方式（仅 pipeline/hybrid 有效）。`auto`: 自动判断；`txt`: 文本提取；`ocr`: OCR 识别（适用于扫描件） |
| `effort` | `str` | `"medium"` | 混合解析强度（仅 hybrid 后端有效）。`medium`: 较快，平衡精度与效率，禁用图片/图表分析；`high`: 更高精度，启用图片/图表分析，但耗时更长 |
| `lang_list` | `list[str]` | `["ch"]` | OCR 语言列表（仅 pipeline 后端有效），指定 PDF 中的语言以提升识别准确率。可选：`ch`/`ch_server`/`korean`/`ta`/`te`/`ka`/`th`/`el`/`arabic`/`east_slavic`/`cyrillic`/`devanagari` |
| `formula_enable` | `bool` | `True` | 启用公式解析。禁用后行间公式以图片展示，行内公式不检测 |
| `table_enable` | `bool` | `True` | 启用表格识别。禁用后表格以图片展示 |
| `image_analysis` | `bool` | `True` | 启用图片/图表 VLM 分析（仅 VLM/hybrid 后端有效）。hybrid medium effort 下自动禁用 |
| `return_md` | `bool` | `True` | 在响应中返回 markdown 内容。`client_side_output_generation=True` 时强制为 `False` |
| `return_middle_json` | `bool` | `False` | 在响应中返回中间 JSON（版面分析原始结果） |
| `return_model_output` | `bool` | `False` | 在响应中返回模型输出的 JSON |
| `return_content_list` | `bool` | `False` | 在响应中返回内容列表 JSON |
| `return_images` | `bool` | `False` | 在响应中返回提取的图片。如 markdown 含图片引用但 zip 中无图片，请检查此参数 |
| `response_format_zip` | `bool` | `False` | 以 ZIP 文件代替 JSON 返回结果。`True` 时 `return_original_file` 才生效 |
| `return_original_file` | `bool` | `False` | 将原始输入文件打包进 ZIP 结果。仅在 `response_format_zip=true` 时生效 |
| `client_side_output_generation` | `bool` | `False` | 将最终的 markdown/content-list 生成推迟到客户端执行。服务端只返回中间 JSON、模型输出和图片，客户端根据这些本地生成最终产物 |
| `server_url` | `Optional[str]` | `None` | OpenAI 兼容服务端地址，仅 `<vlm/hybrid>-http-client` 后端需要，如 `http://127.0.0.1:30000` |
| `start_page_id` | `int` | `0` | PDF 解析起始页，从 0 开始计数 |
| `end_page_id` | `int` | `99999` | PDF 解析结束页，从 0 开始计数。API 默认 99999 即解析到文档末尾 |

### 参数依赖关系

```
backend ─┬─ pipeline ─── parse_method, lang_list 有效
         │               effort 无效
         │
         ├─ vlm-engine ───── image_analysis 有效
         │                   parse_method, lang_list, effort 无效
         │
         ├─ hybrid-engine ── parse_method, lang_list, effort 有效
         │                   image_analysis 在 medium 下自动禁用
         │
         ├─ vlm-http-client ── server_url 必填
         │                     与 vlm-engine 参数规则相同
         │
         └─ hybrid-http-client ── server_url 必填
                                  与 hybrid-engine 参数规则相同
```

### 后端布尔参数处理

后端通过 `_BOOL_FIELDS` 列表识别布尔参数，支持 `"1"`/`"true"`/`"yes"`/`"on"` 作为 `True`。前端通过 `createParseFormData()` 统一使用 `String(boolValue)` 转换为 `"true"`/`"false"`。

## 任务状态

### 状态枚举

| 状态 | 语义 | 是否终态 |
|------|------|----------|
| `pending` | 任务已提交，等待上游处理 | 否 |
| `processing` | 上游正在处理中 | 否 |
| `retry_pending` | 上游不可达，等待重试 | 否 |
| `completed` | 处理成功，可下载结果 | 是 |
| `failed` | 处理失败 | 是 |
| `cancelled` | 用户取消 | 是 |

### 上游状态映射

`status_sync` 后台循环将上游返回的状态映射为网关内部状态：

| 上游原始状态 | 映射后状态 |
|-------------|-----------|
| `pending` / `queued` | `pending` |
| `processing` / `running` | `processing` |
| `completed` / `success` / `done` | `completed` |
| `failed` / `error` | `failed` |
| `cancelled` / `canceled` | `cancelled` |

### 状态转换

```
提交 → pending ──→ processing ──→ completed
               │          ├─→ failed
               │          └─→ cancelled
               │
               └─→ retry_pending ──→ processing (重试成功)
                                     └─→ failed  (重试耗尽)
```
