import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { bundleJavaScriptSource, generateBrowserIife, generateIife } from './rollupBundle.ts'

const replaceExactlyOnce = (source: string, search: string, replacement: string, label: string): string => {
  const firstIndex = source.indexOf(search)
  if (firstIndex === -1) {
    throw new Error(`Could not patch ${label}`)
  }
  if (source.includes(search, firstIndex + search.length)) {
    throw new Error(`Patch for ${label} matched more than once`)
  }
  return `${source.slice(0, firstIndex)}${replacement}${source.slice(firstIndex + search.length)}`
}

const replaceExactlyOncePattern = (source: string, pattern: RegExp, replacement: string, label: string): string => {
  const matches = source.match(new RegExp(pattern, `${pattern.flags}g`)) ?? []
  if (matches.length !== 1) {
    throw new Error(`Patch for ${label} matched ${matches.length} times`)
  }
  return source.replace(pattern, () => replacement)
}

const directRpcSource = `
const __lvceCreateDirectRpc = (commandMap) => {
  const invoke = (method, ...params) => {
    const command = commandMap[method]
    if (!command) {
      throw new Error(\`Direct LVCE command not found: \${method}\`)
    }
    return command(...params)
  }
  return {
    dispose: async () => undefined,
    invoke,
    invokeAndTransfer: invoke,
    send: invoke,
  }
}
`

const syntaxMain = `const main = async () => {
  await listen();
};

main();`

const createSyntaxBundle = (source: string): string => {
  const withEmbeddedTokenizer = replaceExactlyOnce(
    source,
    'const tokenizer = await import(tokenizePath);',
    "const tokenizer = tokenizePath === 'embedded:html' ? embeddedHtmlTokenizer : await import(tokenizePath);",
    'syntax-highlighting worker tokenizer import',
  )
  const withoutWorkerMain = replaceExactlyOnce(
    withEmbeddedTokenizer,
    syntaxMain,
    'return commandMap;',
    'syntax-highlighting worker main',
  )
  return `const __lvceSyntaxCommands = ((embeddedHtmlTokenizer) => {\n${withoutWorkerMain}\n})(__lvceHtmlTokenizer);\n`
}

const createSyntaxRpc = `const createSyntaxHighlightingWorkerRpc = async () => {
  return __lvceCreateDirectRpc(__lvceSyntaxCommands);
};`

const editorMain = `const main = async () => {
  setupUnhandledErrorHandling(globalThis);
  await listen();
  registerWidgets();
};

main();`

const createEditorBundle = (source: string): string => {
  const withDirectSyntax = replaceExactlyOncePattern(
    source,
    /^const createSyntaxHighlightingWorkerRpc = async \(\) => \{[\s\S]*?^};/m,
    createSyntaxRpc,
    'editor worker syntax-highlighting RPC',
  )
  const withoutWorkerMain = replaceExactlyOnce(
    withDirectSyntax,
    editorMain,
    `registerWidgets();
return {
  commands: commandMap,
  configureRenderer(rendererCommands) {
    set$b(__lvceCreateDirectRpc(rendererCommands));
  }
};`,
    'editor worker main',
  )
  return `const __lvceEditorWorker = (() => {\n${withoutWorkerMain}\n})();\n`
}

const startRenderer = `
__lvceRenderer.main(async (name, url, commandMap) => {
  if (name === 'Syntax Highlighting Worker') {
    return __lvceCreateDirectRpc(__lvceSyntaxCommands);
  }
  if (name === 'Editor Worker') {
    __lvceEditorWorker.configureRenderer(commandMap);
    return __lvceCreateDirectRpc(__lvceEditorWorker.commands);
  }
  throw new Error(\`Unsupported single-thread LVCE worker: \${name}\`);
});
`

export interface SingleThreadLvceBundleOptions {
  readonly editorWorkerPath: string
  readonly htmlTokenizerPath: string
  readonly outputPath: string
  readonly rendererProcessPath: string
  readonly syntaxHighlightingWorkerPath: string
}

export const bundleSingleThreadLvce = async (options: SingleThreadLvceBundleOptions): Promise<void> => {
  const rawEditorSource = replaceExactlyOncePattern(
    await readFile(options.editorWorkerPath, 'utf8'),
    /^export \{[^}]+\};$/m,
    '',
    'unused editor worker exports',
  )
  const editorSource = rawEditorSource.replaceAll(/import\((['"])(\.\/[^'"]+)\1\)/g, (_match, quote: string, relativePath: string) => {
    return `import(${quote}${resolve(dirname(options.editorWorkerPath), relativePath.slice(2))}${quote})`
  })
  const rendererSource = await generateBrowserIife(options.rendererProcessPath, '__lvceRenderer')
  const syntaxSource = await readFile(options.syntaxHighlightingWorkerPath, 'utf8')
  const tokenizerSource = await generateIife(options.htmlTokenizerPath, '__lvceHtmlTokenizer')
  const bundle = [
    directRpcSource,
    tokenizerSource,
    createSyntaxBundle(syntaxSource),
    createEditorBundle(editorSource),
    rendererSource,
    startRenderer,
  ].join('\n')
  await bundleJavaScriptSource(bundle, options.outputPath)
}

export const getSingleThreadLvceBundlePaths = (root: string, lvceAssetDirectory: string, output: string): SingleThreadLvceBundleOptions => ({
  editorWorkerPath: join(root, 'node_modules', '@lvce-editor', 'editor-worker', 'dist', 'editorWorkerMain.js'),
  htmlTokenizerPath: join(lvceAssetDirectory, 'extensions', 'builtin.language-basics-html', 'src', 'tokenizeHtml.js'),
  outputPath: join(output, 'index.js'),
  rendererProcessPath: join(root, 'fixtures', 'lvce', 'main.ts'),
  syntaxHighlightingWorkerPath: join(
    root,
    'node_modules',
    '@lvce-editor',
    'syntax-highlighting-worker',
    'dist',
    'syntaxHighlightingWorkerMain.js',
  ),
})
