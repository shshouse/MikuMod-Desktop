/**
 * Electron 主进程构建脚本
 *
 * - .ts 入口由 esbuild 编译为 electron/*.cjs
 * - .cjs 源文件（尚未迁移的）原样拷贝到 electron/
 *
 * 全量迁移完成后移除 copy 逻辑。
 */
import { build } from 'esbuild'
import { readdirSync, copyFileSync, mkdirSync } from 'fs'
import path from 'path'

const srcDir = 'electron-src'
const outDir = 'electron'

mkdirSync(outDir, { recursive: true })

// 1. 拷贝未迁移的 .cjs 文件
const cjsFiles = readdirSync(srcDir).filter(f => f.endsWith('.cjs'))
for (const f of cjsFiles) {
  copyFileSync(path.join(srcDir, f), path.join(outDir, f))
}
if (cjsFiles.length > 0) {
  console.log(`Copied ${cjsFiles.length} .cjs file(s): ${cjsFiles.join(', ')}`)
}

// 2. esbuild 编译 .ts 入口
const tsEntries = readdirSync(srcDir)
  .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
  .map(f => path.join(srcDir, f))

if (tsEntries.length > 0) {
  await build({
    entryPoints: tsEntries,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outdir: outDir,
    outExtension: { '.js': '.cjs' },
    external: [
      'electron',
      'electron-updater',
      'node-forge',
    ],
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  })
}
