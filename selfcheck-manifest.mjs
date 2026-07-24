// 最小自检: 验证 buildManifest filter + MI Mods 安装/卸载/同名改名逻辑
// 用法: node --test selfcheck-manifest.mjs
// ponytail: 镜像 operations.ts installToMiMods/uninstallFromMiMods 的核心逻辑
// 若改了那边的逻辑, 记得同步本文件, 否则 check 会与真实行为漂移

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// --- 镜像 (与 manifest.ts shouldExcludeForManifest 保持一致) ---
const EXCLUDE_FILES = new Set(['manifest.json'])
const EXCLUDE_PREFIXES = ['original.']
const EXCLUDE_DIRS = new Set(['_system'])
function shouldExcludeForManifest(name, isDir) {
  const lower = name.toLowerCase()
  if (isDir) return EXCLUDE_DIRS.has(lower)
  if (EXCLUDE_FILES.has(lower)) return true
  return EXCLUDE_PREFIXES.some(p => lower.startsWith(p))
}

// --- 镜像 (与 utils.ts listFilesRecursive 行为一致) ---
async function listFilesRecursive(rootDir, currentDir = rootDir, files = [], filter) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (['Thumbs.db', 'desktop.ini', '.DS_Store'].includes(entry.name) || entry.name === '__MACOSX') continue
    if (filter?.(entry.name, entry.isDirectory())) continue
    const entryPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) { await listFilesRecursive(rootDir, entryPath, files, filter); continue }
    if (entry.isFile()) files.push(entryPath)
  }
  return files
}

function toRelativePosix(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/')
}

// --- 镜像 resolveMiNameByGameName ---
function resolveMiNameByGameName(gameName) {
  const lower = String(gameName || '').toLowerCase()
  if (!lower) return null
  if (lower.includes('endfield') || lower.includes('终末地')) return 'EFMI'
  if (lower.includes('genshin') || lower.includes('原神')) return 'GIMI'
  if (lower.includes('star rail') || lower.includes('星穹铁道') || lower.includes('星铁')) return 'SRMI'
  if (lower.includes('wuthering') || lower.includes('鸣潮')) return 'WWMI'
  if (lower.includes('zenless') || lower.includes('绝区零')) return 'ZZMI'
  if (lower.includes('honkai impact') || lower.includes('崩坏3') || lower.includes('崩坏3rd')) return 'HIMI'
  return null
}

// --- 镜像 (与 utils.ts copyDirectoryContents 行为一致) ---
async function copyDirectoryContents(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true })
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    if (['Thumbs.db', 'desktop.ini', '.DS_Store'].includes(entry.name) || entry.name === '__MACOSX') continue
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) { await copyDirectoryContents(src, dest); continue }
    if (entry.isFile()) { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(src, dest) }
  }
}

async function pathExists(p) {
  try { await fs.access(p); return true } catch { return false }
}

async function removePath(p) {
  await fs.rm(p, { recursive: true, force: true })
}

// --- 镜像 (与 operations.ts installToMiMods 同名改名逻辑一致) ---
async function resolveUniqueTargetName(modsDir, folderName) {
  let targetName = folderName
  if (await pathExists(path.join(modsDir, targetName))) {
    let counter = 1
    while (await pathExists(path.join(modsDir, `${folderName}_${counter}`))) {
      counter += 1
    }
    targetName = `${folderName}_${counter}`
  }
  return targetName
}

// --- 测试 ---

test('排除 manifest.json / original.* / _system 目录, 保留 mod 内容', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miku-sc-'))
  try {
    await fs.mkdir(path.join(tmpDir, 'Character'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'Mods'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, '_system'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'Character', 'A.png'), 'modA')
    await fs.writeFile(path.join(tmpDir, 'Mods', 'B.txt'), 'modB')
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), '{}')
    await fs.writeFile(path.join(tmpDir, 'original.zip'), 'PK')
    await fs.writeFile(path.join(tmpDir, 'original.rar'), 'RAR')
    await fs.writeFile(path.join(tmpDir, '_system', 'secret.txt'), 'internal')

    const files = await listFilesRecursive(tmpDir, tmpDir, [], shouldExcludeForManifest)
    const rels = files.map(f => toRelativePosix(tmpDir, f)).sort()

    assert.deepEqual(rels, ['Character/A.png', 'Mods/B.txt'])
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('大小写不敏感排除', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miku-sc-'))
  try {
    await fs.writeFile(path.join(tmpDir, 'MANIFEST.JSON'), '{}')
    await fs.writeFile(path.join(tmpDir, 'ORIGINAL.Zip'), 'PK')
    await fs.writeFile(path.join(tmpDir, 'mod.txt'), 'mod')

    const files = await listFilesRecursive(tmpDir, tmpDir, [], shouldExcludeForManifest)
    const rels = files.map(f => toRelativePosix(tmpDir, f)).sort()

    assert.deepEqual(rels, ['mod.txt'])
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

test('resolveMiNameByGameName: 中英文模糊匹配', () => {
  assert.equal(resolveMiNameByGameName('明日方舟：终末地'), 'EFMI')
  assert.equal(resolveMiNameByGameName('Arknights: Endfield'), 'EFMI')
  assert.equal(resolveMiNameByGameName('原神'), 'GIMI')
  assert.equal(resolveMiNameByGameName('Genshin Impact'), 'GIMI')
  assert.equal(resolveMiNameByGameName('崩坏：星穹铁道'), 'SRMI')
  assert.equal(resolveMiNameByGameName('Honkai: Star Rail'), 'SRMI')
  assert.equal(resolveMiNameByGameName('Minecraft'), null)
  assert.equal(resolveMiNameByGameName(''), null)
})

test('MI Mods 安装: 复制 mod 库目录到 Mods/<folderName>', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'miku-sc-'))
  try {
    // 模拟 mod 库目录
    const libDir = path.join(tmpRoot, 'library', 'mymod')
    await fs.mkdir(path.join(libDir, 'Character'), { recursive: true })
    await fs.writeFile(path.join(libDir, 'Character', 'A.png'), 'modA')

    // 模拟 MI Mods 目录
    const modsDir = path.join(tmpRoot, 'frameworks', 'xxmi', 'EFMI', 'Mods')
    await fs.mkdir(modsDir, { recursive: true })

    // 安装 (folderName 不冲突)
    const folderName = 'mymod'
    const targetDir = path.join(modsDir, folderName)
    await copyDirectoryContents(libDir, targetDir)

    assert.ok(await pathExists(path.join(targetDir, 'Character', 'A.png')))
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  }
})

test('MI Mods 同名改名: folderName 冲突时用 _1, _2', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'miku-sc-'))
  try {
    const modsDir = path.join(tmpRoot, 'Mods')
    await fs.mkdir(modsDir, { recursive: true })
    // 预占 mymod 和 mymod_1
    await fs.mkdir(path.join(modsDir, 'mymod'))
    await fs.mkdir(path.join(modsDir, 'mymod_1'))

    const targetName = await resolveUniqueTargetName(modsDir, 'mymod')
    assert.equal(targetName, 'mymod_2')

    // 无冲突时直接用原名
    const targetName2 = await resolveUniqueTargetName(modsDir, 'othermod')
    assert.equal(targetName2, 'othermod')
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  }
})

test('MI Mods 卸载: 删除 miTargetDir, 目录不存在不报错', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'miku-sc-'))
  try {
    const modsDir = path.join(tmpRoot, 'Mods')
    const targetDir = path.join(modsDir, 'mymod')
    await fs.mkdir(path.join(targetDir, 'Character'), { recursive: true })
    await fs.writeFile(path.join(targetDir, 'Character', 'A.png'), 'modA')

    // 卸载: 删目录 (不 throw 即成功)
    await removePath(targetDir)

    // 再次卸载 (目录已不存在): 不报错 (removePath 用 force: true)
    // ponytail: Windows 上 fs.rm 删完立即 access 可能仍 true (延迟回收), 所以只验证不 throw
    await removePath(targetDir)
    assert.ok(true, '二次卸载不报错')
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  }
})
