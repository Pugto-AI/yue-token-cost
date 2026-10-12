/**
 * End-to-end smoke test: drives server.mjs over real stdio with the official MCP client.
 * Verifies the transport-level contract that unit tests cannot see
 * (tools/list shape, strict-schema rejection, structuredContent mirroring).
 *
 * Run: node scripts/mcp-smoke.mjs   (exit code 0 = pass)
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverPath = path.join(here, '..', 'server.mjs')

const checks = []
function check(name, fn) {
  checks.push([name, fn])
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: 'inherit',
})
const client = new Client({ name: 'yue-token-cost-smoke', version: '0.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
const names = tools.map((t) => t.name).sort()

check('tools/list exposes exactly the three tools', () => {
  assert.deepEqual(names, ['compare_scripts', 'count_tokens', 'explain_split'])
})

check('every tool declares a strict input schema and an output schema', () => {
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name}: inputSchema.type`)
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name}: additionalProperties`)
    assert.ok(tool.outputSchema, `${tool.name}: outputSchema present`)
  }
})

check('inputSchema contract matches docs/tool-schemas.json', async () => {
  const frozen = (await import('../docs/tool-schemas.json', { with: { type: 'json' } })).default
  for (const spec of frozen.tools) {
    const live = tools.find((t) => t.name === spec.name)
    assert.ok(live, `${spec.name}: present`)
    assert.deepEqual(
      Object.keys(live.inputSchema.properties).sort(),
      Object.keys(spec.inputSchema.properties).sort(),
      `${spec.name}: property names`,
    )
    assert.deepEqual(
      [...(live.inputSchema.required ?? [])].sort(),
      [...(spec.inputSchema.required ?? [])].sort(),
      `${spec.name}: required`,
    )
    assert.equal(live.inputSchema.additionalProperties, false, `${spec.name}: additionalProperties`)
  }
})

const counted = await client.callTool({
  name: 'count_tokens',
  arguments: { text: '我有多少天带薪年假？' },
})

check('count_tokens returns the benchmarked count and mirrors content<->structuredContent', () => {
  assert.equal(counted.isError, undefined)
  assert.equal(counted.structuredContent.tokens, 9)
  assert.equal(counted.structuredContent.chars, 10)
  assert.deepEqual(JSON.parse(counted.content[0].text), counted.structuredContent)
})

check('count_tokens honours usd_per_million', async () => {
  const r = await client.callTool({
    name: 'count_tokens',
    arguments: { text: '我有多少天带薪年假？', usd_per_million: 1_000_000 },
  })
  assert.equal(r.structuredContent.usd_estimate, 9)
})

check('compare_scripts keeps tokenizers in request order and never averages them', async () => {
  const r = await client.callTool({
    name: 'compare_scripts',
    arguments: {
      texts: [
        { label: 'en', text: 'How many days of paid annual leave am I entitled to?' },
        { label: 'yue', text: '我有幾多日有薪年假？' },
      ],
      tokenizers: ['cl100k_base', 'o200k_base'],
    },
  })
  assert.equal(r.isError, undefined)
  assert.deepEqual(
    r.structuredContent.results.map((x) => x.tokenizer),
    ['cl100k_base', 'o200k_base'],
  )
  for (const block of r.structuredContent.results) {
    assert.equal(block.rows.length, 2)
    assert.ok(block.rows.some((row) => row.delta_vs_cheapest_pct === 0), 'one row is the cheapest')
  }
})

check('explain_split reports the half-character split of 饿', async () => {
  const r = await client.callTool({ name: 'explain_split', arguments: { text: '饿' } })
  assert.equal(r.structuredContent.tokens, 2)
  assert.deepEqual(
    r.structuredContent.pieces.map((p) => p.bytes),
    ['e9', 'a5bf'],
  )
  assert.ok(r.structuredContent.pieces.every((p) => p.partial === true))
})

check('undeclared fields are rejected, not ignored', async () => {
  let message = ''
  try {
    const r = await client.callTool({ name: 'count_tokens', arguments: { text: 'x', extra: 1 } })
    message = r.isError ? r.content[0].text : JSON.stringify(r)
  } catch (err) {
    message = String(err && err.message ? err.message : err)
  }
  assert.match(message, /Unrecognized key|additionalProperties|extra/i)
})

check('reserved special tokens produce a clean caller error', async () => {
  const r = await client.callTool({ name: 'count_tokens', arguments: { text: '<|endoftext|>' } })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /reserved special token/)
  assert.doesNotMatch(r.content[0].text, /at .*\.mjs:\d+/)
})

let failed = 0
for (const [name, fn] of checks) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${name}`)
    console.log(`      ${err && err.message ? err.message : err}`)
  }
}

await client.close()

console.log(`\n${checks.length - failed}/${checks.length} smoke checks passed`)
process.exit(failed === 0 ? 0 : 1)
