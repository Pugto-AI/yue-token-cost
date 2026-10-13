/**
 * End-to-end check through DSH's own MCP client, i.e. the code path a real DSH profile uses:
 * createTransport() from @deepseek-ai/dsh-mcp-client builds a stdio transport with
 * scrubbedParentEnv(), and the MCP SDK owns the spawn (cross-spawn on Windows).
 *
 * This is deliberately manual: it needs a DeepSeek Harness checkout, so CI does not run it.
 *
 *   $env:DSH_CHECKOUT = "E:\AI\AI_Agent\deepseek-harness"
 *   node scripts/dsh-e2e.mjs [--target npm|github]
 *
 *   npm    -> command: npx, args: ['-y','yue-token-cost']        (the shipped bundle config;
 *             only works after the package is published)
 *   github -> command: npx, args: ['-y','--allow-git=all','github:Pugto-AI/yue-token-cost']
 *             (same mechanism before the first release)
 *
 * Everything except the argument string is identical to the shipped cordis.patch.yml.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

const checkout = process.env.DSH_CHECKOUT
if (!checkout) {
  console.error('set DSH_CHECKOUT to the deepseek-harness checkout, e.g.')
  console.error('  $env:DSH_CHECKOUT = "E:\\AI\\AI_Agent\\deepseek-harness"')
  process.exit(2)
}

const targetArg = process.argv.indexOf('--target')
const target = targetArg === -1 ? 'npm' : process.argv[targetArg + 1]
const args =
  target === 'npm'
    ? ['-y', 'yue-token-cost']
    : target === 'github'
      ? ['-y', '--allow-git=all', 'github:Pugto-AI/yue-token-cost']
      : null
if (!args) {
  console.error(`unknown --target ${target} (use npm or github)`)
  process.exit(2)
}

const transportPath = path.join(checkout, 'packages', 'mcp', 'mcp-client', 'lib', 'types', 'transport.js')
const { createTransport } = await import(pathToFileURL(transportPath).href)

const transport = createTransport({ transport: 'stdio', command: 'npx', args })
const client = new Client({ name: 'yue-token-cost-dsh-e2e', version: '0.0.0' })

const failures = []
async function check(name, fn) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures.push(name)
    console.log(`FAIL  ${name}: ${err && err.message ? err.message : err}`)
  }
}

const started = Date.now()
await client.connect(transport)
console.log(`connected through DSH's transport in ${Date.now() - started} ms (target: ${target})\n`)

await check('tools/list exposes the three tools', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['compare_scripts', 'count_tokens', 'explain_split'],
  )
})

await check('count_tokens returns the benchmarked count', async () => {
  const r = await client.callTool({ name: 'count_tokens', arguments: { text: '我有多少天带薪年假？' } })
  assert.equal(r.structuredContent.tokens, 9)
  assert.equal(r.structuredContent.bytes, 30)
})

await check('explain_split reports the half-character split', async () => {
  const r = await client.callTool({ name: 'explain_split', arguments: { text: '饿' } })
  assert.deepEqual(
    r.structuredContent.pieces.map((p) => p.bytes),
    ['e9', 'a5bf'],
  )
})

await check('compare_scripts works over the wire', async () => {
  const r = await client.callTool({
    name: 'compare_scripts',
    arguments: {
      texts: [
        { label: 'zh_t', text: '我有多少天帶薪年假？' },
        { label: 'yue', text: '我有幾多日有薪年假？' },
      ],
    },
  })
  assert.equal(r.structuredContent.results[0].rows.length, 2)
})

await client.close()
console.log(`\n${4 - failures.length}/4 checks passed`)
process.exit(failures.length === 0 ? 0 : 1)
