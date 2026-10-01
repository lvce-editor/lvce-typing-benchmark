import assert from 'node:assert/strict'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { setupFixtures } from '../src/setup.ts'

const assertMinified = async (path: string): Promise<void> => {
  const source = await readFile(path, 'utf8')
  assert.equal(source.trim().split('\n').length, 1, `${path} should contain one minified line`)
}

test('generates separate editor and IDE fixtures', async () => {
  const output = resolve('.tmp', 'setup-test-static')
  try {
    const manifest = await setupFixtures(output)
    const editorPackage = JSON.parse(
      await readFile(resolve('node_modules', '@lvce-editor', 'editor-worker', 'package.json'), 'utf8'),
    ) as { readonly version: string }
    const fixture = manifest.editors.find((editor) => editor.id === 'lvce-editor-minimal')
    assert.deepEqual(fixture, {
      id: 'lvce-editor-minimal',
      kind: 'static',
      label: 'LVCE Editor Only',
      path: 'lvce-editor-minimal/',
      version: editorPackage.version,
    })

    const files = await readdir(join(output, 'lvce-editor-minimal'))
    for (const file of ['editorWorkerMain.js', 'index.css', 'index.html', 'index.js', 'syntaxHighlightingWorkerMain.js', 'tokenizeHtml.js']) {
      assert.ok(files.includes(file), `${file} should be generated for the minimal LVCE fixture`)
    }
    const editorWorkerBundle = await readFile(join(output, 'lvce-editor-minimal', 'editorWorkerMain.js'), 'utf8')
    const relativeChunkNames = Array.from(editorWorkerBundle.matchAll(/import\(["']\.\/([^"']+\.js)["']\)/g), (match) => match[1] as string)
    assert.ok(relativeChunkNames.length > 0, 'editor worker chunks should be referenced from the entry bundle')
    for (const chunkName of relativeChunkNames) {
      assert.ok(files.includes(chunkName), `editor worker chunk ${chunkName} should be generated next to the entry bundle`)
    }
    assert.equal(
      files.some((file) => file.toLowerCase().includes('rendererworker')),
      false,
    )

    for (const fixtureId of ['lvce-editor-minimal', 'lvce-editor-single-thread']) {
      const css = await readFile(join(output, fixtureId, 'index.css'), 'utf8')
      assert.match(css, /\.EditorInput/)
      assert.match(css, /--EditorFontFamily/)
    }

    const html = await readFile(join(output, 'lvce-editor-minimal', 'index.html'), 'utf8')
    assert.match(html, /"editorWorkerUrl":"\.\/editorWorkerMain\.js"/)
    assert.match(html, /"syntaxHighlightingWorkerUrl":"\.\/syntaxHighlightingWorkerMain\.js"/)
    assert.doesNotMatch(html, /rendererWorkerUrl/)

    const singleThreadFixture = manifest.editors.find((editor) => editor.id === 'lvce-editor-single-thread')
    assert.deepEqual(singleThreadFixture, {
      id: 'lvce-editor-single-thread',
      kind: 'static',
      label: 'LVCE Editor Single Thread',
      path: 'lvce-editor-single-thread/',
      version: editorPackage.version,
    })
    const singleThreadFiles = await readdir(join(output, 'lvce-editor-single-thread'))
    for (const file of ['index.css', 'index.html', 'index.js']) {
      assert.ok(singleThreadFiles.includes(file), `${file} should be generated for the single-thread LVCE fixture`)
    }
    const singleThreadHtml = await readFile(join(output, 'lvce-editor-single-thread', 'index.html'), 'utf8')
    assert.match(singleThreadHtml, /"tokenizePath":"embedded:html"/)
    assert.doesNotMatch(singleThreadHtml, /WorkerUrl/)
    const singleThreadBundle = await readFile(join(output, 'lvce-editor-single-thread', 'index.js'), 'utf8')
    assert.match(singleThreadBundle, /Direct LVCE command not found/)
    assert.match(singleThreadBundle, /embedded:html/)
    const singleThreadChunks = Array.from(singleThreadBundle.matchAll(/import\(["']\.\/([^"']+\.js)["']\)/g), (match) => match[1] as string)
    assert.ok(singleThreadChunks.length > 0, 'single-thread editor worker chunks should be referenced from the entry bundle')
    for (const chunkName of singleThreadChunks) {
      assert.ok(singleThreadFiles.includes(chunkName), `single-thread chunk ${chunkName} should be generated next to the entry bundle`)
    }

    const acePackage = JSON.parse(await readFile(resolve('node_modules', 'ace-builds', 'package.json'), 'utf8')) as { readonly version: string }
    assert.deepEqual(manifest.editors.find((editor) => editor.id === 'ace-editor'), {
      id: 'ace-editor',
      kind: 'static',
      label: 'Ace Editor',
      path: 'ace-editor/',
      version: acePackage.version,
    })
    await assertMinified(join(output, 'ace-editor', 'index.js'))
    await assertMinified(join(output, 'codemirror5', 'index.js'))
    await assertMinified(join(output, 'codejar-prism', 'index.js'))
    await assertMinified(join(output, 'codemirror', 'index.js'))
    await assertMinified(join(output, 'monaco-editor', 'index.js'))
    await assertMinified(join(output, 'lvce-editor-minimal', 'index.js'))
    await assertMinified(join(output, 'lvce-editor-minimal', 'editorWorkerMain.js'))
    await assertMinified(join(output, 'lvce-editor-minimal', 'syntaxHighlightingWorkerMain.js'))
    await assertMinified(join(output, 'lvce-editor-minimal', 'tokenizeHtml.js'))
    await assertMinified(join(output, 'lvce-editor-single-thread', 'index.js'))

    const vscodeFixture = manifest.ides.find((ide) => ide.id === 'vscode')
    assert.deepEqual(vscodeFixture, {
      id: 'vscode',
      kind: 'static',
      label: 'VS Code',
      path: 'vscode-ide/',
      version: '1.132.1',
    })
    assert.deepEqual(
      manifest.editors.map((editor) => editor.id),
      ['lvce-editor-minimal', 'lvce-editor-single-thread', 'monaco-editor', 'codemirror', 'codemirror5', 'codejar-prism', 'ace-editor'],
    )
    assert.deepEqual(
      manifest.ides.map((ide) => ide.id),
      ['lvce-editor', 'vscode'],
    )
    const vscodeHtml = await readFile(join(output, 'vscode-ide', 'index.html'), 'utf8')
    assert.match(vscodeHtml, /workbench\.web\.main\.internal\.js/)
    assert.match(vscodeHtml, /benchmark\.code-workspace/)
    assert.equal(await readFile(join(output, 'vscode', 'nls.messages.js'), 'utf8').then(Boolean), true)
  } finally {
    await rm(output, { force: true, recursive: true })
  }
})

test('bundles fixtures sequentially', async () => {
  const setupSource = await readFile(resolve('src', 'setup.ts'), 'utf8')
  const singleThreadSource = await readFile(resolve('src', 'lvceSingleThreadBundle.ts'), 'utf8')
  assert.doesNotMatch(setupSource, /Promise\.all/)
  assert.doesNotMatch(singleThreadSource, /Promise\.all/)
})
