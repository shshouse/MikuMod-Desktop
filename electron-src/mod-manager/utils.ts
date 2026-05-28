import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { JUNK_NAMES, ARCHIVE_EXTENSION_PATTERN } from './constants'

// --- 路径与字符串 ---

export function sanitizeSegment(value: string | undefined) {
  const normalized = String(value || 'Unknown')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  return (!normalized || normalized === '_system') ? 'Unknown' : normalized
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
}

export function createStableHash(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

export function toRelativePosix(rootDir: string, filePath: string) {
  const relativePath = path.relative(rootDir, filePath)
  const normalized = relativePath.split(path.sep).join('/')
  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized) || normalized.includes('../')) {
    throw new Error(`非法文件路径: ${filePath}`)
  }
  return normalized
}

// --- 文件系统 ---

export async function pathExists(targetPath: string) {
  try { await fsPromises.access(targetPath); return true } catch { return false }
}

export async function ensureDir(dirPath: string) {
  await fsPromises.mkdir(dirPath, { recursive: true })
}

export async function removePath(targetPath: string) {
  await fsPromises.rm(targetPath, { recursive: true, force: true })
}

export async function removeFileIfExists(filePath: string) {
  try { await fsPromises.unlink(filePath) } catch (error: any) {
    if (error.code !== 'ENOENT') throw error
  }
}

export async function copyFileSafe(srcPath: string, destPath: string) {
  await ensureDir(path.dirname(destPath))
  await fsPromises.copyFile(srcPath, destPath)
}

export async function copyDirectoryContents(srcDir: string, destDir: string) {
  await ensureDir(destDir)
  const entries = await fsPromises.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    if (JUNK_NAMES.has(entry.name) || entry.name === '__MACOSX') continue
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    if (entry.isDirectory()) { await copyDirectoryContents(srcPath, destPath); continue }
    if (entry.isFile()) await copyFileSafe(srcPath, destPath)
  }
}

export async function listFilesRecursive(rootDir: string, currentDir = rootDir, files: string[] = []) {
  const entries = await fsPromises.readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (JUNK_NAMES.has(entry.name) || entry.name === '__MACOSX') continue
    const entryPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) { await listFilesRecursive(rootDir, entryPath, files); continue }
    if (entry.isFile()) files.push(entryPath)
  }
  return files
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

// --- 外部命令 ---

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) { resolve(); return }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`))
    })
  })
}

export async function extractArchive(sourcePath: string, destDir: string) {
  await ensureDir(destDir)
  try {
    await runCommand('tar', ['-xf', sourcePath, '-C', destDir])
    return
  } catch (error: any) {
    const ext = path.extname(sourcePath).toLowerCase()
    if (ext !== '.zip') throw new Error(`不支持的压缩包或解压失败: ${error.message}`)
  }
  const escapedSource = sourcePath.replace(/'/g, "''")
  const escapedDest = destDir.replace(/'/g, "''")
  const command = `Expand-Archive -LiteralPath '${escapedSource}' -DestinationPath '${escapedDest}' -Force`
  await runCommand('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command])
}

// --- 内容根检测 ---

export async function resolveContentRoot(extractDir: string) {
  let currentDir = extractDir
  for (let index = 0; index < 6; index += 1) {
    const entries = (await fsPromises.readdir(currentDir, { withFileTypes: true }))
      .filter(e => !JUNK_NAMES.has(e.name) && e.name !== '__MACOSX')
    const files = entries.filter(e => e.isFile())
    const directories = entries.filter(e => e.isDirectory())
    if (files.length === 0 && directories.length === 1) { currentDir = path.join(currentDir, directories[0].name); continue }
    break
  }
  return currentDir
}

function normalizeContentRootName(value: string) {
  return String(value || '')
    .replace(ARCHIVE_EXTENSION_PATTERN, '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
}

export async function resolveDownloadedContentRoot(extractDir: string, input: { archiveFileName?: string; modName?: string }) {
  const entries = (await fsPromises.readdir(extractDir, { withFileTypes: true }))
    .filter(e => !JUNK_NAMES.has(e.name) && e.name !== '__MACOSX')
  const files = entries.filter(e => e.isFile())
  const directories = entries.filter(e => e.isDirectory())
  if (files.length !== 0 || directories.length !== 1) return extractDir

  const wrapperName = normalizeContentRootName(directories[0].name)
  const expectedNames = [
    path.basename(input.archiveFileName || ''),
    path.basename(input.modName || ''),
  ].map(normalizeContentRootName).filter(Boolean)

  return expectedNames.includes(wrapperName) ? path.join(extractDir, directories[0].name) : extractDir
}
