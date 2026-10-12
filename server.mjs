/**
 * yue-token-cost MCP server (stdio).
 *
 * stdout is protocol traffic only - never console.log() here. Diagnostics go to stderr.
 */
import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  compareScripts,
  compareScriptsOutputSchema,
  compareScriptsSchema,
  countTokens,
  countTokensOutputSchema,
  countTokensSchema,
  explainSplit,
  explainSplitOutputSchema,
  explainSplitSchema,
} from './lib/tools.mjs'
import { ValidationError } from './lib/errors.mjs'

const require = createRequire(import.meta.url)
const { version } = require('./package.json')

if (process.argv.includes('--version')) {
  console.error(version)
  process.exit(0)
}
if (process.argv.includes('--help')) {
  console.error(
    [
      'yue-token-cost - measure what Chinese/Cantonese costs in tokens, and why.',
      '',
      'This is an MCP server speaking JSON-RPC over stdio; it is not meant to be run by hand.',
      'Add it to an MCP client, e.g. npx -y yue-token-cost, or: dsh plugin add yue-token-cost',
      '',
      'Tools: count_tokens, compare_scripts, explain_split',
      'Docs:  README.md  |  Benchmark: BENCHMARK.md',
    ].join('\n'),
  )
  process.exit(0)
}

const server = new McpServer({ name: 'yue-token-cost', version })

/**
 * One handler shape for all tools: structured result + a JSON text mirror for older clients,
 * caller mistakes as clean errors, everything else as an internal error (stack to stderr only).
 */
function handler(run) {
  return async (args) => {
    try {
      const value = await run(args)
      return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value,
      }
    } catch (err) {
      if (!(err instanceof ValidationError)) {
        console.error('[yue-token-cost] internal error:', err)
      }
      return {
        content: [{ type: 'text', text: `error: ${err && err.message ? err.message : String(err)}` }],
        isError: true,
      }
    }
  }
}

server.registerTool(
  'count_tokens',
  {
    title: 'Count tokens',
    description:
      'Count tokens, characters and UTF-8 bytes for a text under one tokenizer. Returns an estimated cost when usd_per_million is supplied. Use this for a single string; use compare_scripts to compare scripts.',
    inputSchema: countTokensSchema,
    outputSchema: countTokensOutputSchema,
  },
  handler(countTokens),
)

server.registerTool(
  'compare_scripts',
  {
    title: 'Compare scripts',
    description:
      'Compare the same meaning written in different scripts (e.g. English, 简体, 繁體, 粵語). Returns per-input counts, the delta against the cheapest input, and an attribution breakdown (half-character tokens, single-character tokens, multi-character tokens) explaining where the extra tokens come from.',
    inputSchema: compareScriptsSchema,
    outputSchema: compareScriptsOutputSchema,
  },
  handler(compareScripts),
)

server.registerTool(
  'explain_split',
  {
    title: 'Explain token split',
    description:
      'Show exactly how a text is split into tokens: token ids, raw bytes, decoded pieces, and flags for half-characters (a Chinese character split across two tokens), digit splitting, and leading-space variants. Use this to answer "why is this string expensive".',
    inputSchema: explainSplitSchema,
    outputSchema: explainSplitOutputSchema,
  },
  handler(explainSplit),
)

await server.connect(new StdioServerTransport())
