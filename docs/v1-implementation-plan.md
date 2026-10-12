# yue-token-cost v1 实现计划

> 状态：**可执行计划**（本文件不包含实现代码）
> 范围：3 个已冻结工具 + stdio MCP server + DSH 配置型 bundle + npm 发布 + CI
> 前提：`README.md` / `BENCHMARK.md` / `bench/testset.json` / `bench/generate_benchmark.py` / `docs/tool-schemas.json` 已存在且不改语义

---

## 0. 计划前已在本机核实的事实（决定了下面所有选型）

这些不是推测，是本次规划时跑出来的（临时脚手架已删除，仓库已恢复原状）：

| # | 结论 | 证据 |
|---|---|---|
| V1 | **JS 侧唯一能拿到"每个 token 的原始字节"的库是 `js-tiktoken`**，通过其内部 `textMap`（`id → Uint8Array`），与 Python `tiktoken.decode_single_token_bytes` **逐字节一致**：406/406 个 id 完全相同，测试集里 939 个 token id 全部有值。 | 实测比对脚本 |
| V2 | `gpt-tokenizer` 的 `decode([id])` **对单个 token 不可靠**：`o.decode([165])` 有时返回 `""` 有时返回 `"\uFFFD"`；`cl100k.decode(encode("饿"))` 返回 `"\uFFFD饿"`。它无法用于 `explain_split`。 | 实测 |
| V3 | **token 数字已完全复现 BENCHMARK.md**（`js-tiktoken` 0.14 等价的 o200k/cl100k）：o200k `en 83 / zh_s 83 / zh_t 98 / yue 103`，cl100k `en 84 / zh_s 128 / zh_t 149 / yue 150`；o200k 逐行 `partial` 合计 `0 / 10 / 14 / 24`，也与 BENCHMARK.md 一致。 | 实测 |
| V4 | 归因口径必须基于 **`textMap` 的原始字节 + 字符边界判定**（见 §3.4）。用"逐字符 encode 推算偏移"的替代方案会得到错误的 partial（o200k zh_s 只有 5 而不是 10）。 | 实测 |
| V5 | MCP 官方 TS SDK `@modelcontextprotocol/sdk@1.32.1`：`registerTool` **只接受 Zod schema**（传普通 JSON Schema 对象会绕过校验，且 `inputSchema` 不产出 `additionalProperties: false`）；`z.object({...}).strict()` 才会得到冻结 schema 要求的严格模式，并且实际拒绝未声明字段（`MCP error -32602: ... Unrecognized key: "extra"`）。 | 实测 |
| V6 | 官方 SDK 的 stdio 客户端用 `cross-spawn`，Windows 上 `npx.cmd` 能解析；DSH 的 `scrubbedParentEnv()` **保留 PATH**。所以 bundle 里写 `command: npx` 可行。 | 读 `packages/mcp/mcp-client/src/transport.ts` + `packages/subprocess/subprocess/src/index.ts` + SDK `dist/esm/client/stdio.js` |
| V7 | 若在 `connect()` 之前做慢速 top-level await（约 1.5s 懒加载），SDK 不会丢字节，请求仍能正常应答。 | 实测 |
| V8 | `js-tiktoken` 对含 `<|endoftext|>` 字面量的文本会 **throw**（o200k 2 个、cl100k 5 个特殊标记）。必须自己接住并转成干净的校验错误。 | 实测 |
| V9 | 测试集中 `holiday-pay` 一项 `zh_s === zh_t`（字符串完全相同）；`法定假期薪酬是否已包含在月薪中？` 在 cl100k 下是 22 tokens。 | 实测 |
| V10 | 依赖事实：`js-tiktoken@1.0.21`（MIT，唯一依赖 `base64-js`）、`@modelcontextprotocol/sdk@1.32.1`（MIT，16 个直接依赖，含 express/hono/ajv/jose）、`zod@4.6.5`；`yue-token-cost` 在 npm 上 **未被占用**（404）。本机环境：Node v24.21.0、pnpm 11.7.0、bundled Python（tiktoken 需 `pip install tiktoken==0.14.0`）。 | npm registry + 本机 |

**由此得出的三条硬约束（后续不可回退）：**

1. 分词器一律走 `js-tiktoken`，`gpt-tokenizer` 出局（V2）。
2. 数学核心必须是**零依赖**的纯模块，唯一外部依赖是 `js-tiktoken`（+ SDK 只在 server 层）。
3. 工具 schema 用 Zod 定义，并且必须写成 `.strict()`，否则与冻结 schema 的 `additionalProperties: false` 不符（V5）。

---

## 1. 里程碑分解

> 工时按"熟练实现者、有本计划在手"估，单位为人时。总估 **13–19 h**（约 2–3 个工作日）。

### M1 — 打通 DSH bundle 的 stdio 链路（2–3 h）

**产出物**
- `package.json`（含 `bin`、`dsh.bundle.patch`、`engines`）
- `cordis.patch.yml`（`transport: stdio`、`serverName: yue-token-cost`、`command: npx`、`args: ["-y","yue-token-cost"]`、`failOnStartupError: true`）
- `server.mjs` 的**空壳版**：只注册一个 `count_tokens`，恒定返回 `{tokens: 0}`
- `scripts/mcp-smoke.mjs`：用官方 SDK client 以 stdio 拉起 `server.mjs`，listTools + callTool + 未知字段报错三条断言

**验收标准**
- `node scripts/mcp-smoke.mjs` 退出码 0，且 `tools/list` 名字恰为 `count_tokens`
- 在一个**临时隔离 profile** 里验证 bundle 真能被 DSH 装配（用隔离的 `DSH_HOME`，不要污染现有 `desktop`/`web` profile）：
  - `DSH_HOME=<tmp> node <checkout>/apps/cli/src/bin.ts plugin --profile smoke add <repo>`（或 `pnpm dsh plugin --profile smoke add <repo>`）
  - `DSH_HOME=<tmp> ... --profile smoke --dump-config` 输出里出现 `mcp-client(yue-token-cost)` 行
  - 注意：`dsh plugin` 即使带 `--help`/`--profile` 也会**初始化 profile**，所以必须用隔离 `DSH_HOME`，跑完删掉
- **把这条路径是否可行写进 README**：若本机 `npx` 不在 PATH 或离线环境，bundle 需退回 `command: node` + 绝对路径 `args`（本计划不为此写自动探测逻辑）

**风险点（M1 唯一未实测项）**：`command: npx -y yue-token-cost` 在 Windows 上取决于 `npx.cmd` 可解析 —— V6 已确认 SDK 用 `cross-spawn` 且 PATH 被保留，但**没有真的 `npx` 包可装**，所以 M1 必须用本地路径版本（`command: node`、`args: ["<repo>/server.mjs"]`）先跑通 `--dump-config`，再换 `npx` 形式复测一次。

---

### M2 — 数学核心 + 3 个工具（5–7 h）

**产出物**
- `lib/tokenizers.mjs`：`loadEncoder(name)`、`rawTokenBytes(encoder, id)`、`estimateUsd(tokens, usdPerMillion)`
- `lib/analyse.mjs`：`analyseText(encoderName, text)` → `{tokens, chars, bytes, partial_char_tokens, single_cjk_tokens, multi_cjk_tokens, pieces[]}`
- `lib/tools.mjs`：三个工具的实现函数 + Zod schema（`count_tokens` / `compare_scripts` / `explain_split`）
- `server.mjs` 完整版：注册 3 个工具、`structuredContent`、错误转 `isError`
- `bench/reproduce.mjs`：读取 `bench/testset.json` + 硬编码的 BENCHMARK 基线，逐行比对（见 §4）

**验收标准**
- `node bench/reproduce.mjs` 全绿：24 行 × 2 tokenizer 的 tokens 与 o200k 的 `partial/single_cjk/multi_cjk` 与 `BENCHMARK.md` **逐行相等**
- `node scripts/mcp-smoke.mjs` 覆盖 3 个工具的 happy path + 4 类边界（§4）
- `count_tokens("我有多少天带薪年假？")` → `tokens 9 / chars 10 / bytes 30 / usd_estimate null`
- 同一输入连续调用 100 次结果恒等（确定性）

---

### M3 — 测试套件（3–4 h）

**产出物**
- `tests/analyse.test.mjs`、`tests/tools.test.mjs`（`node:test` + `node:assert/strict`）
- `npm test` = `node --test tests/`

**验收标准**
- §4 列出的**每一条断言**都存在且通过
- 故意改坏 `partial` 判定（例如改成"字节数 < 3 就算 partial"）能让至少 2 条测试失败 —— 这是"测试真的有效"的证明，必须做一次并回滚
- `npm test` 不联网、不依赖 Python、5 秒内跑完

---

### M4 — CI + 基准回归（2–3 h）

**产出物**
- `.github/workflows/ci.yml`：两个 job
  - `node`：bundled/官方 Node 20 → `pnpm install --frozen-lockfile` → `npm test`
  - `bench`：Python 3.12 → `pip install tiktoken==0.14.0` → `python bench/generate_benchmark.py` → 断言 `git diff --exit-code BENCHMARK.md` → `node bench/reproduce.mjs`
- `bench/README.md`（可选，3 行）：说明基准是**契约**，改动需走 §6 流程

**验收标准**
- CI 在 PR 上跑通；把 `BENCHMARK.md` 里任意一个数字手改 +1，CI **必须变红**
- 在 CI 里 `node -e "import('js-tiktoken/lite')"` 无需网络（离线 rank 是包内 JS 字符串）

---

### M5 — 打包与发布（1–2 h）

**产出物**
- `README.md` 增补真实安装章节（`npx` 形式 + `dsh plugin add` 形式 + 示例输出）
- npm 发布：`0.1.0`
- git tag `v0.1.0`

**验收标准**
- `npx -y yue-token-cost` 在一个干净目录可被 MCP 客户端连上（用 `scripts/mcp-smoke.mjs` 指向已发布的全局包验证）
- `dsh plugin add yue-token-cost` 在隔离 profile 中生效，`mcp__yue-token-cost__count_tokens` 可调用
- `npm pack` 产物包含：`server.mjs`、`lib/**`、`cordis.patch.yml`、`README.md`、`BENCHMARK.md`；**不包含** `tests/`、`bench/`、`.github/`

---

## 2. 仓库文件布局（v1 完整清单）

```
yue-token-cost/
├── README.md                      ✅ 已存在（M5 增补安装/示例章节）
├── BENCHMARK.md                   ✅ 已存在（生成物，CI 校验，禁止手改）
├── LICENSE                        🆕 MIT（README 已声明 MIT，缺文件）
├── package.json                   🆕 bin / files / dsh.bundle.patch / engines
├── pnpm-lock.yaml                 🆕 提交，CI 用 --frozen-lockfile
├── server.mjs                     🆕 MCP stdio 入口（#! 不需要，靠 bin 壳）
├── bin/
│   └── yue-token-cost.mjs         🆕 仅 `import('../server.mjs')` 的 bin 入口
├── lib/
│   ├── tokenizers.mjs             🆕 编码器加载 + 原始字节 + 成本换算
│   ├── analyse.mjs                🆕 归因核心（partial / single_cjk / multi_cjk / pieces）
│   ├── tools.mjs                  🆕 三个工具：输入 Zod schema + 输出组装
│   └── errors.mjs                 🆕 输入校验错误 → 稳定错误消息（含特殊标记场景）
├── cordis.patch.yml               🆕 DSH 配置型 bundle 层
├── scripts/
│   └── mcp-smoke.mjs              🆕 用官方 SDK client 端到端拉起 stdio server
├── tests/
│   ├── analyse.test.mjs           🆕
│   └── tools.test.mjs             🆕
├── bench/
│   ├── testset.json               ✅ 已存在（单一真源，Node/Python 都读它）
│   ├── generate_benchmark.py      ✅ 已存在，**不重写**（CI 只跑它）
│   └── reproduce.mjs              🆕 Node 侧复现 BENCHMARK 的基线断言
├── docs/
│   └── tool-schemas.json          ✅ 已存在（冻结；Zod schema 的对照物，由测试比对）
└── .github/
    └── workflows/
        └── ci.yml                 🆕
```

**package.json 关键字段**

```jsonc
{
  "name": "yue-token-cost",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "bin": { "yue-token-cost": "./bin/yue-token-cost.mjs" },
  "files": ["bin", "lib", "server.mjs", "cordis.patch.yml", "README.md", "BENCHMARK.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.32.1",
    "js-tiktoken": "^1.0.21",
    "zod": "^4.0.0"
  }
}
```

> `zod` 必须显式声明：SDK 把它当 peer（`^3.25 || ^4.0`），不声明会在用户机器上 `ERR_MODULE_NOT_FOUND`（本次实测踩到）。

`cordis.patch.yml`：

```yaml
- insert:
    - id: yue-token-cost-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: yue-token-cost
        transport: stdio
        command: npx
        args: ['-y', 'yue-token-cost']
        failOnStartupError: true
```

---

## 3. 实现方案

### 3.1 运行时与 SDK 选择

**运行时：Node（ESM，`>= 20`）。**
理由：① 包要经 `npx` 一行装好，Python 分发做不到这一点（且本机 bundled Python 里连 `tiktoken` 都没有，`pip install` 才有 —— 实测）；② `js-tiktoken` 提供离线可用的同源词表（V3 证明数字与 Python 完全一致）；③ 唯一运行入口，不存在"两个 Python 环境"问题。`bench/generate_benchmark.py` 继续用 Python，只在开发/CI 侧存在，**进入最终用户安装路径的只有 Node**。

**MCP SDK：官方 `@modelcontextprotocol/sdk`（`^1.32.1`）。**
理由：JSON-RPC 2.0 + stdio 分帧 + initialize 协商 + `tools/list` 缓存与错误码是规范面，重写风险大于收益；SDK 自带 `ajv` 做输入校验，`.strict()` 能给出与冻结 schema 一致的 `additionalProperties: false`（V5）。
代价要说清楚：SDK 带 16 个直接依赖（express / hono / ajv / jose / cors …），远重于"三个纯函数"。**如果** M5 时发现安装体积或依赖审计是阻塞项，唯一可接受的替代是手写一个仅支持 `initialize` / `tools/list` / `tools/call` 的 stdio JSON-RPC 服务（约 120 行，零依赖），并同样用 `scripts/mcp-smoke.mjs` 通过官方 client 验证 —— 这是**备选方案 B**，默认不做。

**分词器：`js-tiktoken/lite` + `js-tiktoken/ranks/{o200k_base,cl100k_base}`。**
理由见 V1/V2/V3：只有它能给出与 Python `tiktoken` 逐字节一致的单 token 字节。`js-tiktoken/lite` 不预装词表，按需 import rank，避免把两个 2.3MB 词表塞进首屏。

### 3.2 stdio 传输

- `server.mjs` 只做：加载 rank → 建 `McpServer` → `registerTool` × 3 → `server.connect(new StdioServerTransport())`。
- **stdout 只能有协议数据**：所有诊断信息走 `console.error`。禁止 `console.log`（加一条 lint 级别的约定，写在 `server.mjs` 顶部注释）。
- 支持 `--version` / `--help`：读 `package.json` 打印到 **stderr** 后退出（不能污染 stdout）。
- 慢启动已验证安全（V7），因此词表用 top-level await 懒加载即可，不需要预热逻辑。
- 不实现 reconnect / HTTP 传输 / 会话状态：进程无状态，一次调用即一次纯计算。

### 3.3 请求校验与错误处理

分层，且**只在信任边界校验一次**：

1. **协议层（SDK + Zod）**：每个工具的 `inputSchema` 用 `z.object({...}).strict()`。
   - `count_tokens`: `{ text: z.string(), tokenizer: z.enum([...]).default('o200k_base'), usd_per_million: z.number().optional() }`
   - `compare_scripts`: `{ texts: z.array(z.object({label: z.string(), text: z.string()}).strict()).min(2), tokenizers: z.array(z.enum([...])).default(['o200k_base']) }`
   - `explain_split`: `{ text: z.string(), tokenizer: z.enum([...]).default('o200k_base') }`
   - 未声明字段 → SDK 自动返回 `isError: true` + `MCP error -32602`（V5 实测），不需要自己写。
2. **业务层（`lib/errors.mjs`）**：只处理 SDK 接不住的语义错误，统一转成**调用方看得懂**的 `isError` 文本：
   - 输入含被禁特殊标记字面量（V8：o200k 的 `<|endoftext|>`/`<|endofprompt|>`，cl100k 再加 3 个 fim 标记）→ 捕获后返回 `"text contains a reserved special token (<|endoftext|>); it cannot be measured as plain text"`。
   - `texts` 里的 `label` 重复 → 拒绝（否则 `delta_vs_cheapest_pct` 归属歧义）。
   - `usd_per_million` 为负数或 `NaN`/`Infinity` → 拒绝（`z.number().finite().nonnegative()`）。
   - `tokenizers` 为空数组或含重复项 → 拒绝。
3. **兜底**：`server.mjs` 里给每个 handler 包一层 try/catch，未预期异常 → `isError: true`，消息为 `"internal error: <err.message>"`，并且 `console.error` 完整堆栈到 stderr。**不回传堆栈给客户端**。
4. 明确不做：超时、重试、限流、日志文件、指标上报。

### 3.4 归因核心（唯一"有算法"的地方，写清楚）

**输入**：`encoderName`（`o200k_base` | `cl100k_base`）、`text`。

**步骤**

1. `bytes = Buffer.from(text, 'utf8')`；`ids = encoder.encode(text)`。
2. **字符起点集合** `starts = {0} ∪ {每个字符结束后的累计字节偏移}`。用 `[...text]`（码点）迭代，不是 UTF-16 码元。
3. 对每个 id 取**原始字节**：`raw = encoder.textMap.get(id)`（`Uint8Array`）。
   - `textMap` 是 `js-tiktoken` 未在 `.d.ts` 里声明的内部表，实测与 Python `decode_single_token_bytes` 逐字节一致（V1）。
   - 该访问必须**集中在一个函数**里，并留一条明确的注释标记这个已知天花板：
     `// ponytail: js-tiktoken's textMap is undeclared in its .d.ts but is the only per-token byte source; if it disappears, vendor the parsed rank table (see tests/tokenizers.test.mjs for the shape we rely on)`
   - 退化路径（`textMap` 缺失）：用 `Buffer.from(encoder.decode([id]), 'utf8')`。这条路径**不保证对 partial token 正确**，因此必须有测试：拿测试集出现过的 id，用退化路径重建字节并与 `textMap` 结果比对（见 §4 附加断言）。若退化路径比对失败 → 直接抛错，绝不静默给出错误数字。
4. 累加偏移得每个 token 的 `[start, end)`；`partial = !(starts.has(start) && starts.has(end))`。
   - 这就是"半个字"的**可复现定义**：token 的字节范围没有与 UTF-8 字符边界对齐。`饿 = [e9] | [a5bf]` → 两个都 partial；`僱 = [e583] | [b1]` → 两个都 partial。
   - 同时断言 `pieces.map(bytes).join('') === bytes.toString('hex')`：字节拼回去必须等于原文，否则偏移算错了。这条断言在测试里对**全部 24 条基准文本**都要成立。
5. 分类（只对非 partial 的 token 计）：
   - `single_cjk_tokens`：解出的字符恰好 1 个，且在 `[\u4e00-\u9fff]`。
   - `multi_cjk_tokens`：解出的字符 ≥2 个，且**全部**在 `[\u4e00-\u9fff]`。
   - 其余（拉丁、标点、空格、emoji、混合）不计入任何一类。
   - 不变式：`partial + single_cjk + multi_cjk ≤ tokens`，测试断言。
6. `decoded`：非 partial 用原始字节做 UTF-8 解码；**partial 一律 `""`**（`docs/tool-schemas.json` 明确要求）。

**函数签名（JSDoc 形式，实现时照抄）**

```js
/** @param {'o200k_base'|'cl100k_base'} name @returns {import('js-tiktoken/lite').Tiktoken} */
export function loadEncoder(name)

/** 单个 token 的原始字节。partial token 也返回真实字节（不是替换字符）。 */
/** @param {Tiktoken} encoder @param {number} id @returns {Buffer} */
export function rawTokenBytes(encoder, id)

/** @typedef {{index:number,id:number,bytes:string,decoded:string,partial:boolean}} Piece */
/** @typedef {{tokens:number,chars:number,bytes:number,partial_char_tokens:number,single_cjk_tokens:number,multi_cjk_tokens:number,pieces:Piece[]}} Analysis */

/** 归因核心：token 数、字符数、字节数、三类归因、逐 token 明细。纯函数，无副作用。 */
/** @param {'o200k_base'|'cl100k_base'} encoderName @param {string} text @returns {Analysis} */
export function analyseText(encoderName, text)
```

**派生量（`compare_scripts` 用）**

```js
/** 相对最便宜一行的百分比差；四舍五入到 1 位小数（仅展示用）。 */
/** @param {number} tokens @param {number} cheapestTokens @returns {number} */
export function deltaVsCheapestPct(tokens, cheapestTokens)  // = round((tokens/cheapest - 1) * 1000) / 10

/** 一行归因的可读解释，模板固定以保证确定性。 */
/** @param {Analysis} a @param {number} cheapestTokens @returns {string} */
export function explainRow(a, cheapestTokens)
```

`explainRow` 模板（固定，测试按前缀断言）：

```
"<tokens> tokens (<delta>% vs cheapest <cheapest>): <partial> half-character, <single> single-character, <multi> multi-character"
```

`delta === 0` 时写成 `"0%"`（不要 `"0.0%"`、不要 `"-0%"`）。**注意**：`delta_vs_cheapest_pct` 仅由 tokens 决定，所以当两行文本完全相同时它必然完全相同 —— 这是"简繁相同不能虚报差值"的结构性保证，测试据此断言。

### 3.5 成本估算

```js
/** @param {number} tokens @param {number|undefined} usdPerMillion @returns {number|null} */
export function estimateUsd(tokens, usdPerMillion) {
  if (usdPerMillion === undefined) return null
  return (tokens / 1_000_000) * usdPerMillion   // 不做四舍五入：调用方要原始数值
}
```

**不内置任何价格表**（价格会变）。`usd_estimate` 只在传了 `usd_per_million` 时是数字，否则 `null`（schema 要求 `["number","null"]`）。

### 3.6 工具组装要点

- 三个工具一律返回 **`structuredContent`**（SDK 声明了 `outputSchema` 时客户端只认它）+ 一份 `content[0].text` 的 JSON 字符串（兼容旧客户端）。两者内容必须一致，测试断言。
- `compare_scripts` 的 `results` **按请求里的 tokenizer 顺序**输出，每个 tokenizer 一组 `rows`；**绝不跨 tokenizer 平均**（README 已承诺）。
- `rows` 顺序 = 请求 `texts` 顺序（不稳定排序会让 CI 抖动）。
- `explain_split` 的 `pieces[].index` 从 0 连续递增，长度 == `tokens`。
- 输出 schema 用 `z.object({...}).strict()` 定义（`.int()` 会带 `minimum/maximum`，这是可接受的额外约束；冻结 schema 只约束输入严格相等，见 §4）。

---

## 4. 测试计划

框架：`node:test` + `node:assert/strict`（Node 内置，零依赖）。**不用 fixture 框架，不做 per-function 套件**。

### 4.1 必须在的断言（防回归清单）

**A. 基准契约（`bench/reproduce.mjs`，24 行 × 2 tokenizer）**
- A1. 对 `bench/testset.json` 每一项、每一种书写系统、每一个 tokenizer，`analyseText().tokens` **等于** BENCHMARK.md 中的值。基线在文件里写成显式表格（`{itemId, script, tokenizer, tokens, partial, single, multi}`），**不解析 Markdown**。
- A2. o200k 的 `partial` 逐行等于 BENCHMARK.md 归因表（含 0 的行）。
- A3. 列合计：o200k `83/83/98/103`、`partial 0/10/14/24`；cl100k `84/128/149/150`。
- A4. 每一行的 `pieces.map(p => p.bytes).join('') === utf8Hex(text)`（偏移正确性的硬断言）。

**B. 四类指定用例**

| # | 用例 | 断言 |
|---|---|---|
| B1 | **半个字** `explain_split("饿")`（o200k） | `tokens === 2`；`pieces[0] = {id:165, bytes:"e9", partial:true, decoded:""}`；`pieces[1] = {id:12297, bytes:"a5bf", partial:true, decoded:""}`；两者 `bytes` 拼起来 == `"e9a5bf"` |
| B1b | 半个字（繁体）`explain_split("僱")` | `tokens === 2`；`bytes === ["e583","b1"]`；两个 `partial === true`；（对照 cl100k：`tokens === 2`，`bytes === ["e583","b1"]` 但 id 不同 —— 至少断言 `partial` 与字节） |
| B1c | 边界：**完整汉字**不能误判 | `explain_split("我")` → 1 token、`partial === false`、`decoded === "我"`、`single_cjk_tokens === 1` |
| B2 | **数字被切分** `explain_split("1,234,567")`（o200k） | `tokens === 5`；`decoded === ["1",",","234",",","567"]`；全部 `partial === false`；`compare_scripts` 里该行 `multi_cjk_tokens === 0`（数字不计入 CJK） |
| B2b | 无分隔数字 `"1234567"` | `tokens === 3`（`123` / `456` / `7` 形式），与 B2 的 5 不等 —— 证明数字切分是真实的，不是格式化的产物 |
| B3 | **前导空格 token 不同** | `count_tokens("hello").tokens === 1`（id 24912）；`count_tokens(" hello").tokens === 1`（id 40617，即 `" hello"` 是**另一个** token）→ 断言两者 token id 不同、tokens 相同；再断言 `explain_split(" hello").pieces[0].decoded === " hello"`（空格被并进 token，不单独成片） |
| B3b | 尾随空格 | `"hello "` → 2 tokens，第二片 `decoded === " "` |
| B4 | **简繁相同不能虚报差值** `compare_scripts` 用测试集 `holiday-pay` 的 `zh_s` / `zh_t`（两串完全相同） | 对**每个** tokenizer：两行 `tokens` 相等、`delta_vs_cheapest_pct` **严格相等**、`explanation` 也相等；并且 `tokens` 与 BENCHMARK 一致（o200k 15，cl100k 22）。再加一条：把 `zh_s` / `zh_t` 互换顺序，结果不变（顺序无关） |

**C. 工具契约**
- C1. `compare_scripts` 传 `tokenizers: ['cl100k_base','o200k_base']` → `results` 顺序与请求一致；同一 tokenizer 的结果**不含**另一个 tokenizer 的数字（防"平均"回归）。
- C2. `compare_scripts` 请求 4 种书写系统（en/zh_s/zh_t/yue）→ 每行 `delta_vs_cheapest_pct >= 0`，且**至少一行严格等于 0**。
- C3. `count_tokens` 不传 `usd_per_million` → `usd_estimate === null`；传 `1_000_000` → `usd_estimate === tokens`。
- C4. Zod schema 对照 `docs/tool-schemas.json`：三个工具的 `inputSchema` 经 SDK `tools/list` 产出后，其 `properties` 键集合、`required`、`enum`、`default` 与冻结文件一致，且 `additionalProperties === false`。
- C5. 未知字段 `{text:"x", extra:1}` → `isError === true`，消息含 `Unrecognized key: "extra"`。
- C6. `texts` 只有 1 项 → 拒绝（`min(2)`）。
- C7. `label` 重复 → 拒绝（错误消息含 `duplicate label`）。
- C8. 输入 `"<|endoftext|>"` → `isError === true`，消息**不包含**堆栈，且包含 `reserved special token`。
- C9. `structuredContent` 与 `content[0].text` 的 JSON 解析结果深度相等。
- C10. 确定性：同一输入连调 3 次，三段 JSON 字符串完全一致。

**D. 分词器退化路径**
- D1. 对测试集里出现过的所有 token id，用退化路径（`decode([id])`）重建的字节与 `textMap` 路径结果比对；**比对失败必须抛错**。这条测试的作用是：把"`textMap` 消失"这件事从静默错误变成显式错误。
- D2. `rawTokenBytes` 对每个 id 都返回非空 `Buffer`（939 个 id 全覆盖）。

### 4.2 明确不测的东西（避免膨胀）
- 不测 SDK 自身的 `tools/list` 分页、协议版本协商、断线重连。
- 不测 npm 安装、CI 配置本身（那是 M4/M5 的人工验收）。
- 不给 `estimateUsd` 写多组用例，一条断言足够。
- 不做属性测试 / 模糊测试（v1 输入空间是确定文本，收益低）。

### 4.3 测试必须"真的有效"的证明步骤（M3 验收项）
按顺序做一次：把 `partial` 判定从"字符边界对齐"改成"字节数 < 3"，预期 A2/B1/B1c 中至少两条变红；然后改回。不做这一步等于没验证测试。

---

## 5. DSH bundle 与 npm 打包步骤

**顺序：本地 link 验证 → tarball 验证 → npm 发布 → `dsh plugin add` 线上验证。** 每一步都有具体命令与通过判据。

### 步骤 0：本地就绪
```bash
# 依赖（本机用 harness 提供的 node/pnpm，不要假设系统装了）
pnpm install
npm test
node scripts/mcp-smoke.mjs          # 判据：exit 0，tools/list 含三个工具
```

### 步骤 1：本地 link 进隔离 profile（不污染 desktop/web）
```bash
# Windows PowerShell：$env:DSH_HOME='<repo>/.tmp-dsh'; 然后
pnpm dsh plugin --profile smoke add <repo 绝对路径>
pnpm dsh --profile smoke --dump-config | Select-String 'yue-token-cost'   # 判据：出现 mcp-client 行
```
- 判据：`--dump-config` 输出里能看到 `@deepseek-ai/dsh-mcp-client` 行且 `serverName: yue-token-cost`。
- 注意：`dsh plugin` 会**初始化** profile（实测：连 `--help` 都会建目录），所以务必用隔离 `DSH_HOME`，验证完 `Remove-Item -Recurse` 删除。
- 若此时 `command: npx` 起不来（离线/PATH 问题），改 `command: node` + 绝对路径 `args` 复测，并在 README 记录该退化写法。

### 步骤 2：tarball 验证（模拟真实安装，不依赖 registry）
```bash
pnpm pack                                # 产出 yue-token-cost-0.1.0.tgz
pnpm dsh plugin --profile smoke2 add ./yue-token-cost-0.1.0.tgz
# 判据：dump-config 出现该行；再在真实 DSH 会话里调用 mcp__yue-token-cost__count_tokens 成功
```

### 步骤 3：npm 发布
```bash
npm whoami                               # 判据：已登录
npm publish --access public              # 名字 yue-token-cost 在 registry 上未被占用（已核实）
npx -y yue-token-cost --version          # 判据：stderr 打印 0.1.0，stdout 为空
```

### 步骤 4：线上 bundle 验证（"别人装一行就能用"的最终判据）
```bash
dsh plugin add yue-token-cost            # 默认 profile
# 新会话里：mcp__yue-token-cost__count_tokens
```
- 判据：工具可调用，且 `count_tokens("我有多少天带薪年假？")` 返回 `tokens: 9`（与 BENCHMARK 一致）。
- 若失败：**修同一个 bundle，不要建新 bundle**（`mcp-bundle.md` 的明确要求）。

### 步骤 5：其它 MCP 客户端（README 的一行安装）
```jsonc
{ "mcpServers": { "yue-token-cost": { "command": "npx", "args": ["-y", "yue-token-cost"] } } }
```
判据：在至少一个非 DSH 客户端（如 VS Code 或 Claude Code）里跑通 `count_tokens`。

**未决（见 §7 R6）**：GitHub 安装路径（`dsh plugin add github:...`）需要 `prepare` 脚本 + 用户 `allowBuilds` 允许，本计划**不**走这条路，只走 npm 与 tarball。

---

## 6. CI

### Job 1：`node`（每次 push / PR）
```yaml
- run: pnpm install --frozen-lockfile
- run: npm test
- run: node scripts/mcp-smoke.mjs
```
不联网（`js-tiktoken` 词表是包内 JS 字符串，已实测离线可用）。

### Job 2：`bench`（每次 push / PR）
```yaml
- run: pip install tiktoken==0.14.0        # 精确 pin！
- run: python bench/generate_benchmark.py
- run: git diff --exit-code BENCHMARK.md   # 生成物必须与提交的一致
- run: node bench/reproduce.mjs            # Node 与 Python 数字逐行相等
```

### 基准数字变化时：**失败**，不是自动更新

**判断：基准是契约，必须让 CI 变红，由人显式更新。**

理由：
1. 这个项目的对外承诺就是**可被引用的基准表**（BENCHMARK.md 里的数字被 README 引用、被他人复制）。自动 `git commit` 新数字等于让"对外承诺"在没有人类判断的情况下漂移 —— 那不是确定性工具该有的行为。
2. 数字变化只有三种真因，每一种都需要人判断，不能自动化：
   - `tiktoken` 版本升级（词表变了）→ 需要重新说明"这是哪个 tokenizer 版本"，并决定是否同步升级 `js-tiktoken`；
   - 测试集文本被改 → 需要检查是不是"手写句子"变成了机翻；
   - 归因算法被改 → 这是最危险的一种，必须有人确认新口径是否仍然符合 README 里的 `partial` 定义。
3. 自动更新会把"Node 侧与 Python 侧不一致"这类真 bug 直接刷掉 —— 而 Node/Python 数字一致正是 Job 2 存在的全部意义。

配套流程（写进 `bench/README.md`，5 行）：
1. CI 红 → 先看 `git diff BENCHMARK.md` 到底变了什么；
2. 判定是上述哪一种真因；
3. 若确认要更新：改 `bench/generate_benchmark.py`（如确需）或测试集 → 本地重跑 → 同时更新 `bench/reproduce.mjs` 的基线表与 `README.md` 里的引用数字 → **同一个 commit** 提交，commit message 必须写明"为什么数字变了"；
4. `tiktoken` 版本变化必须同时出现在 commit message 与 `BENCHMARK.md` 的生成说明里。

**版本锁定策略**：CI 里 pin 精确版本 `tiktoken==0.14.0`（不用 `>=`）。`js-tiktoken` 用 `^1.0.21`，但 Job 2 的跨运行时断言会在它跳版本导致数字漂移时立刻抓到。

---

## 7. 风险与未决项

只列真实存在的。

| # | 风险 | 影响 | 应对（写在哪） |
|---|---|---|---|
| **R1** | **`js-tiktoken` 内部 `textMap` 未在 `.d.ts` 声明**，是归因功能的唯一字节来源（V1）。上游改内部结构 → `explain_split` 与 `partial` 失效。 | 高（核心差异化功能） | ① 访问集中在 `rawTokenBytes` 一个函数；② 退化路径 + D1/D2 测试把"静默错误"变成"显式抛错"；③ `package.json` 里 pin `^1.0.21` 并写一条职责说明；④ 在 README 的 Non-goals 附近加一行已知依赖说明。**绝不**为了绕过这一点去自研 BPE。 |
| **R2** | **两份词表实现可能长期分叉**：Node 侧 `js-tiktoken` 与 Python 侧 `tiktoken`。数字今天一致（V3），未来可能不一致。 | 中（基准可信度） | Job 2 的 `bench/reproduce.mjs` 就是为此存在；一旦不一致 CI 必红（§6）。 |
| **R3** | **SDK 依赖重**（16 个直接依赖，含 express/hono）。与"依赖越少越好"的初衷有张力。 | 中（安装体积、审计、供应链） | 已记录备选方案 B（手写 120 行 stdio JSON-RPC），并保留 `scripts/mcp-smoke.mjs` 作为它未来替换时的验收工具。**只有在**安装体积/审计成为阻塞项时才启动。 |
| **R4** | **`command: npx` 在 stdio bundle 里的可解析性未实测**（V6 只证明了机制可行，没有真实的 registry 包可试）。 | 中（DSH 一行安装可能直接失败） | M1 必须先跑通 `--dump-config`；README 里同时给出 `command: node` + 绝对路径的退化写法。 |
| **R5** | **`partial` 定义在旧 tokenizer 上会给出很大的绝对数**（cl100k 合计 205 个）。数量级可能让读者误以为"cl100k 到处都是半个字"。 | 低（叙述风险，非 bug） | BENCHMARK.md 目前只发布 o200k 的归因表；若扩展 `generate_benchmark.py` 增加 cl100k 归因表，必须同时补一句范围说明，并保持逐行合计（cl100k 为 `0 / 57 / 90 / 98`，本计划已实测）。 |
| **R6** | **发现渠道未知**：目前只有 README + GitHub，没有分发计划（发布到 MCP server 目录、awesome 列表、HN/Reddit、中文社区）。这是**非技术风险**，但决定项目是否有人用。 | 中（对"别人装一行就能用"是致命前提） | 应对位置：M5 之后新建 `docs/distribution.md`（或 README 的 "Where to find this" 段），记录候选渠道与提交话术。**本计划不写内容**，只锁定位置与归属里程碑。另：npm 上 `yue-token-cost` 未被占用（已核实），这是可发布的前提，不构成风险。 |
| **R7** | **"为什么贵"的解释深度有限**：v1 只说"词表未收录 vs 半个字拆分"，不给"更便宜的等价措辞"建议。用户可能觉得不够。 | 低（预期管理） | README 的 Roadmap 已经写了 v2 才做 glossary 建议；M5 检查 README 与实现一致。 |
| **R8** | **中文分词粒度 ≠ token 粒度**，容易被误读成"分词器在切词"。 | 低（叙述风险） | `explain_split` 的输出字段名保持 `pieces`（不是 `words`）；README 示例用 `饿` 而非词语。 |

---

## 8. 不应做的事（v1 范围外，防止膨胀）

1. **不做粤拼（Jyutping）/ 简繁转换** —— v1 已明确排除（`tojyutping` / `opencc-python-reimplemented` 不引入）。
2. **不内置价格表**，不抓取任何 provider 定价页 —— 只接受调用方传入 `usd_per_million`。
3. **不做本地模型 tokenizer**（Qwen / Llama / Gemma / HF 下载）—— v2 且必须独立成行，永不合并平均。
4. **不做 Web UI、HTTP/SSE 传输、Docker 镜像** —— 只有 stdio。
5. **不做用户系统、数据库、缓存层、遥测、日志文件**。
6. **不做 "auto-rewrite to save tokens"**、不做措辞建议、不做 glossary。
7. **不做 ASR / 任何 GPU 相关功能**（v3 才考虑）。
8. **不重写 `bench/generate_benchmark.py`** —— 它已经工作；除非要新增 cl100k 归因表（属 scope 变更，需显式批准）。
9. **不跨 tokenizer 做平均、不做加权汇总、不输出"综合分"** —— 冻结语义明确要求分行报告。
10. **不为了让 README 好看而在服务端计算 ratio / 倍数** —— 倍数属于基准文档的语言，工具只输出原始计数与相对最便宜一行的 delta。
11. **不引入 TypeScript / 打包器 / lint 框架 / 测试框架** —— ESM + JSDoc + `node:test` 足够；编译步骤会破坏 `npx` 直跑。
12. **不做属性测试、性能基准、并发压测** —— 确定性纯函数，无收益。
13. **不做 `prepare`/`postinstall` 脚本** —— 会让 Git 安装路径要求用户 `allowBuilds`（§5 步骤 4 已排除该路径）。
14. **不给"未知 tokenizer 名"做模糊匹配或默认回退** —— 枚举之外的输入直接拒绝，避免静默给出错误数字。

---

## 附录 A：本次规划已实测的关键命令与结论（供实现者复现）

```bash
# 1) 跨运行时一致性（Python）
pip install tiktoken==0.14.0
python bench/generate_benchmark.py          # o200k totals en83/zh_s83/zh_t98/yue103
                                            # cl100k totals en84/zh_s128/zh_t149/yue150

# 2) JS 侧同源性与字节同源性
pnpm add js-tiktoken@1.0.21 gpt-tokenizer@4.0.0
node -e "import('js-tiktoken/lite').then(async l=>{const r=(await import('js-tiktoken/ranks/o200k_base')).default;const e=new l.Tiktoken(r);console.log(e.encode('饿'))})"
# -> [165, 12297]    与 Python tiktoken 完全一致
# -> encoder.textMap.get(165) === e9, .get(12297) === a5bf（与 Python decode_single_token_bytes 一致，406/406）

# 3) MCP SDK 行为
pnpm add @modelcontextprotocol/sdk@1.32.1 zod@^4
# z.object({...}).strict()  -> inputSchema 带 additionalProperties:false，未声明字段被拒（-32602）
# 慢启动（1.5s top-level await）后 connect() -> 不丢字节
```

## 附录 B：四类指定用例的实测期望值（可直接抄成断言）

`o200k_base`，均来自本次实测：

| 输入 | tokens | pieces（`id:bytes[partial]`） |
|---|---|---|
| `"饿"` | 2 | `165:e9*` \| `12297:a5bf*` |
| `"僱"` | 2 | `19169:e583*` \| `109:b1*` |
| `"我"` | 1 | `7522:e68891`（`partial:false`, `decoded:"我"`） |
| `"1,234,567"` | 5 | `16:31` \| `11:2c` \| `20771:323334` \| `11:2c` \| `34904:353637` |
| `"1234567"` | 3 | `7633:313233` \| `19354:343536` \| `22:37` |
| `"hello"` | 1 | `24912:68656c6c6f` |
| `" hello"` | 1 | `40617:2068656c6c6f`（前导空格并入同一 token） |
| `"hello "` | 2 | `24912:68656c6c6f` \| `220:20` |
| `"我有多少天带薪年假？"` | 9 | 7 个 single_cjk + `21727:"多少"`(multi) + `4802:"？"` |
| `holiday-pay` 的 `zh_s`（= `zh_t`） | 15 | partial 2 / single 10 / multi 2 |

`cl100k_base` 对照：

| 输入 | tokens | 备注 |
|---|---|---|
| `"饿"` | 2 | 第二个 id 是 `59198`（与 o200k 的 `12297` 不同），字节仍为 `e9` \| `a5bf` |
| `holiday-pay` 的 `zh_s` | 22 | 与 o200k 的 15 不同 —— B4 的"简繁等价"必须按 tokenizer 分别断言 |
| 测试集 partial 合计（en/zh_s/zh_t/yue） | 0 / 57 / 90 / 98 | 仅作记录；BENCHMARK.md 目前**不**发布 cl100k 归因表，所以这组数字**不要**写进 A2 的断言 |

`compare_scripts` 的 delta 由 tokens 唯一决定：`zh_s` 与 `zh_t` 为同一字符串时，两行的 `tokens`、`delta_vs_cheapest_pct`、`explanation` 必然完全相等（B4 据此断言）。

## 附录 C：术语与口径（写进代码注释，避免后人改错）

- **`partial`（半个字）**：该 token 的字节不是完整 UTF-8 字符，即 token 的 `[start, end)` 没有与字符边界对齐。`饿 = [e9] | [a5bf]`。
- **`single_cjk`**：一个完整汉字占一个 token。
- **`multi_cjk`**：多个汉字在同一个 token（便宜的那种）。
- 三者之和 **≤ tokens**；拉丁/标点/空格/emoji 不属于任何一类。
- **`chars`** = Unicode 码点数（`[...text].length`，与 Python `len(text)` 一致，**不是** UTF-16 长度）。
- **`bytes`** = 输入文本的 UTF-8 字节数（**不是** token 字节之和，虽然二者相等）。
