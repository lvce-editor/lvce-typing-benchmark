import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { bundleJavaScriptFile, bundleJavaScriptSource } from '../src/rollupBundle.ts'

test('preserves dynamic imports and emits their chunks for both worker bundle paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lvce-worker-chunks-'))
  try {
    const dependency = join(root, 'dependency.js')
    const entry = join(root, 'entry.js')
    await writeFile(dependency, 'export const value = 42;')
    await writeFile(entry, "export const load = () => import('./dependency.js');")
    const outputs = [join(root, 'worker', 'index.js'), join(root, 'single-thread', 'index.js')]
    await bundleJavaScriptFile(entry, outputs[0]!)
    await bundleJavaScriptSource(`export const load = () => import(${JSON.stringify(dependency)});`, outputs[1]!)
    for (const output of outputs) {
      const source = await readFile(output, 'utf8')
      const chunks = Array.from(source.matchAll(/import\(["']\.\/([^"']+\.js)["']\)/g), (match) => match[1]!)
      assert.equal(chunks.length, 1)
      const chunk = await readFile(join(dirname(output), chunks[0]!), 'utf8')
      assert.match(chunk, /42/)
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
