import { basename, dirname } from 'node:path'
import commonjsPlugin, { type RollupCommonJSOptions } from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import terserPlugin, { type Options as TerserOptions } from '@rollup/plugin-terser'
import { rollup, type OutputChunk, type Plugin } from 'rollup'
import css from 'rollup-plugin-css-only'
import ts from 'typescript'

const createCommonjsPlugin = commonjsPlugin as unknown as (options?: RollupCommonJSOptions) => Plugin

const createTerserPlugin = terserPlugin as unknown as (options?: TerserOptions) => Plugin

const getTerserPlugin = (): Plugin => {
  return createTerserPlugin({
    compress: {
      passes: 2,
    },
    format: {
      comments: false,
    },
    maxWorkers: 1,
    module: true,
  })
}

const typescriptTranspilePlugin = (): Plugin => {
  return {
    name: 'typescript-transpile',
    transform(code, id) {
      if (!id.endsWith('.ts')) {
        return undefined
      }
      const result = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2024,
        },
        fileName: id,
      })
      return {
        code: result.outputText,
        map: null,
      }
    },
  }
}

const writeBundle = async (
  input: string,
  outputPath: string,
  plugins: readonly Plugin[] = [],
  splitChunks = false,
): Promise<void> => {
  const bundle = await rollup({
    input,
    plugins: [...plugins],
    treeshake: true,
  })
  try {
    await bundle.write({
      compact: true,
      ...(splitChunks
        ? {
            chunkFileNames: '[name]-[hash].js',
            dir: dirname(outputPath),
            entryFileNames: basename(outputPath),
          }
        : { file: outputPath }),
      format: 'es',
      generatedCode: 'es2015',
      plugins: [getTerserPlugin()],
    })
  } finally {
    await bundle.close()
  }
}

export const bundleBrowserFixture = async (input: string, outputPath: string): Promise<void> => {
  await writeBundle(input, outputPath, [
    nodeResolve({ browser: true }),
    createCommonjsPlugin(),
    typescriptTranspilePlugin(),
    css({ fileName: 'index.css' }),
  ])
}

export const bundleJavaScriptFile = async (input: string, outputPath: string): Promise<void> => {
  await writeBundle(input, outputPath, [], true)
}

const virtualEntryId = '\0lvce-single-thread-entry'

export const bundleJavaScriptSource = async (source: string, outputPath: string): Promise<void> => {
  const virtualEntryPlugin: Plugin = {
    load(id) {
      return id === virtualEntryId ? source : undefined
    },
    name: 'virtual-lvce-single-thread-entry',
    resolveId(id) {
      return id === virtualEntryId ? id : undefined
    },
  }
  await writeBundle(virtualEntryId, outputPath, [virtualEntryPlugin], true)
}

export const generateIife = async (input: string, name: string, plugins: readonly Plugin[] = []): Promise<string> => {
  const bundle = await rollup({
    input,
    plugins: [...plugins],
    treeshake: true,
  })
  try {
    const generated = await bundle.generate({
      compact: true,
      format: 'iife',
      generatedCode: 'es2015',
      name,
    })
    const chunk = generated.output.find((item): item is OutputChunk => item.type === 'chunk')
    if (!chunk) {
      throw new Error(`Rollup produced no JavaScript for ${input}`)
    }
    return chunk.code
  } finally {
    await bundle.close()
  }
}

export const generateBrowserIife = async (input: string, name: string): Promise<string> => {
  return generateIife(input, name, [nodeResolve({ browser: true }), typescriptTranspilePlugin()])
}
