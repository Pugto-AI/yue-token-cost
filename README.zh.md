# yue-token-cost

[English](./README.md) | **中文**

**量出中文/粤语实际花掉多少 token —— 以及为什么。**

MCP server + DSH 插件。不需要 GPU、不需要语料、不训练模型：只做确定性的文本测量。

> 状态：**v0.1.0，已实现并在本地验证。** 18 个测试 + 9 项 stdio 端到端检查 + Node 与 Python 的基准逐行交叉验证（48 行）全部通过；DSH bundle 已在隔离 profile 中完成装配。尚未发布到 npm。

## 为什么需要它

同一个意思，不同写法，账单差很远。下面是 [`BENCHMARK.md`](./BENCHMARK.md) 里 6 条香港劳资/法律问句的实测结果：

| Tokenizer | English | 简体 | 繁體 | 粵語 |
|---|---|---|---|---|
| `o200k_base`（GPT-4o 及之后） | 83 | 83 | **98** | **103** |
| `cl100k_base`（GPT-4 那一代） | 84 | **128** | **149** | **150** |

普通计数器不会告诉你的两件事：

1. **现代 tokenizer 上，繁體/粵語仍比简体贵 18–24%**；而在旧一代上，中文整体比英文贵 **52%（简）到 79%（粤）**。
2. **换 tokenizer 世代比改文字更省**：同一段简体文本从 `cl100k` 到 `o200k`，**128 → 83 token（−35%）**。

现有工具只对一个字符串、一个 tokenizer 计数；它们不比较书写系统，也不解释**多出来的 token 从哪来**。这个工具做这两件事。

## 安装

通用 MCP 客户端（Cursor / Claude Code / VS Code / 任何 stdio MCP 宿主）：

```jsonc
{ "mcpServers": { "yue-token-cost": { "command": "npx", "args": ["-y", "yue-token-cost"] } } }
```

DSH（纯配置型 bundle；server 本身还是同一个 npm 包）：

```bash
dsh plugin add yue-token-cost
# 之后：mcp__yue-token-cost__count_tokens
```

如果 `npx` 不可用（离线机器或固定版本的 checkout），直接把客户端指向入口文件：
`{ "command": "node", "args": ["/abs/path/to/yue-token-cost/server.mjs"] }`。

首次 npm 发布之前，可以直接从 GitHub 安装（不需要 registry）：

```bash
npx -y --allow-git=all github:Pugto-AI/yue-token-cost
```

部分 npm 配置默认禁止 git 依赖，`--allow-git=all` 用来放开。

## 已验证

本仓库的每个说法都能核验。以下是真的跑过的，以及怎么跑：

| 检查 | 命令 | 证明了什么 |
|---|---|---|
| 单元 + 契约测试 | `npm test` | 18 个测试：归因边界（半个字、数字切分、前导空格）、schema 严格性、确定性 |
| stdio 端到端 | `npm run smoke` | 9 项检查，用官方 MCP client 真实驱动 `server.mjs`：工具列表、严格 schema 拒绝未声明字段、`structuredContent` 与文本镜像 |
| 基准契约 | `npm run bench` | 48 行与 Python `tiktoken` 基线逐行一致 —— Node 与 Python 是两套独立实现 |
| 词表数字 | `python bench/vocab_stats.py` | 200,019 / 105,898 / 7,532 —— 发布帖里解释"为什么贵"用的数字 |
| DSH 自己的 MCP 客户端 | `node scripts/dsh-e2e.mjs --target github`（需要 `DSH_CHECKOUT`） | 用 DSH 的 stdio transport 工厂通过 `npx` 拉起 server，三个工具全部调通（4/4） |
| 打包后的 tarball | `npm pack`，再在隔离的 `DSH_HOME` 里 `dsh plugin add <tgz>` | 发布文件集是完整的：bundle 能装配出 `mcp-client(serverName: yue-token-cost)` |

CI 每次 push 跑前四项（两个 job，Node 22）。

**尚未验证**：`npx -y yue-token-cost`。npm 包还没发布，所以 bundle 里那个确切的参数字符串还没被真正执行过；`--target github` 是同一套机制、不同的字符串。

## 开发

需要 Node ≥ 22 才能用 pnpm 11 安装（pnpm 自身会 import `node:sqlite`）；发布出去的包在运行期仍支持 Node ≥ 20。

```bash
pnpm install
npm test              # 18 个单元 + 契约测试，不联网
npm run smoke         # 用官方 MCP client 真实驱动 server.mjs
npm run bench         # Node 结果 vs Python 基线（跨运行时校验）
```

基准的 Python 侧（仅开发/CI 用 —— **使用**这个工具时永远不需要）：

```bash
pip install tiktoken==0.14.0
python bench/generate_benchmark.py   # 重新生成 BENCHMARK.md
python bench/make_baseline.py        # 重新生成 bench/baseline.json
```

## 三个工具

| 工具 | 输入 | 输出 |
|---|---|---|
| `count_tokens` | `text`、`tokenizer?`、`usd_per_million?` | tokens / chars / bytes，给了单价则附成本 |
| `compare_scripts` | `texts[]`（同义、不同写法）、`tokenizers[]?` | 并排计数 + 差值 + **归因** |
| `explain_split` | `text`、`tokenizer?` | 逐 token 明细，标出半个字、数字切分、前导空格差异 |

例子（对 `饿` 调 `explain_split`）：

```json
{ "text": "饿", "tokenizer": "o200k_base", "tokens": 2,
  "pieces": [{ "id": 165, "bytes": "e9", "partial": true }, { "id": 12297, "bytes": "a5bf", "partial": true }] }
```

Schema：[`docs/tool-schemas.json`](./docs/tool-schemas.json)。

## v1 明确不做

不做粵拼（[`tinci-mcp`](https://github.com/liyb-gz/tinci-mcp) 已覆盖 —— 需要时依赖 `tojyutping`）、不做词典、不做 ASR、不训练模型、不做 Web UI、不做"自动改写省 token"。

## 基准

[`BENCHMARK.md`](./BENCHMARK.md) 是生成物，不是手写的：

```bash
pip install tiktoken && python bench/generate_benchmark.py
```

README 里每个数字都出自那个文件。范围与诚实的说明（覆盖了哪些 tokenizer、为什么比值不是普适常数、为什么保留简体/繁體完全相同的那一条）写在文件末尾。

其他 tokenizer 家族单独测量：[`docs/deepseek-tokenizer.md`](./docs/deepseek-tokenizer.md) —— DeepSeek V3/V4 的同一测试集结果，以及为什么 V3→V4 不改变你的 token 账单。

## 路线图

- **v1** —— 上面 3 个工具、`o200k_base` + `cl100k_base`、npm + DSH bundle、测试、生成的基准表。
- **v2** —— 本地模型 tokenizer 作为独立行（`hf:<repo>`）、术语表感知的"更省 token 的等价措辞"建议。
- **v3** —— 可选的 `cantonese_asr`（本地 `whisper-small-cantonese`）—— 第一个需要 GPU 的功能。

## 许可

MIT。
