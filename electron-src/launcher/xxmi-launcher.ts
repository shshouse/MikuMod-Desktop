import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { spawn, ChildProcess } from 'child_process'
import { shell } from 'electron'
import { getAppBaseDir } from '../mod-manager/state'
import { ensureDir, pathExists, copyFileSafe, copyDirectoryContents, removePath, extractArchive, resolveContentRoot, createId } from '../mod-manager/utils'
import {
  XXMI_LAUNCHER_EXE,
  XXMI_MI_RUNTIME_NAMES,
  XXMI_MI_GAME_MAP,
  XXMI_GAME_RUNTIME_NAMES,
  XXMI_FRAMEWORKS_DIR,
  XXMI_FRAMEWORK_DIR,
  type XxmiRuntimeName,
  type XxmiFrameworkInfo,
  type XxmiImportResult,
  type XxmiLaunchResult,
  type XxmiMiStatus,
  type XxmiGameBinding,
  type XxmiShortcutResult,
} from './launcher-types'

// --- 路径计算 ---

function getFrameworksDir(app: Electron.App): string {
  return path.join(getAppBaseDir(app), XXMI_FRAMEWORKS_DIR)
}

function getXxmiDir(app: Electron.App): string {
  return path.join(getFrameworksDir(app), XXMI_FRAMEWORK_DIR)
}

function getLauncherExe(app: Electron.App): string {
  return path.join(getXxmiDir(app), XXMI_LAUNCHER_EXE)
}

function getMiDir(app: Electron.App, miName: string): string {
  return path.join(getXxmiDir(app), miName)
}

function getMiModsDir(app: Electron.App, miName: string): string {
  return path.join(getMiDir(app, miName), 'Mods')
}

// --- 绑定存储 ---

const BINDINGS_FILE = 'xxmi-game-bindings.json'

function getBindingsPath(app: Electron.App): string {
  return path.join(getFrameworksDir(app), BINDINGS_FILE)
}

async function loadBindings(app: Electron.App): Promise<XxmiGameBinding[]> {
  const filePath = getBindingsPath(app)
  if (!(await pathExists(filePath))) return []
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as XxmiGameBinding[]
  } catch {
    return []
  }
}

async function saveBindings(app: Electron.App, bindings: XxmiGameBinding[]): Promise<void> {
  await ensureDir(getFrameworksDir(app))
  await fsPromises.writeFile(getBindingsPath(app), JSON.stringify(bindings, null, 2), 'utf-8')
}

// --- 运行时目录检测 ---

function findMiRuntimeNames(xxmiDir: string): XxmiRuntimeName[] {
  if (!fs.existsSync(xxmiDir)) return []
  return (fs.readdirSync(xxmiDir, { withFileTypes: true }) as fs.Dirent[])
    .filter(e => e.isDirectory() && XXMI_MI_RUNTIME_NAMES.includes(e.name as XxmiRuntimeName))
    .map(e => e.name as XxmiRuntimeName)
}

function getMiVersion(miDir: string): string | null {
  const coreDir = path.join(miDir, 'Core', path.basename(miDir))
  const versionFile = path.join(coreDir, 'main.ini')
  if (!fs.existsSync(versionFile)) {
    if (miDir.includes('WWMI')) {
      const wwVersionFile = path.join(coreDir, 'WuWa-Model-Importer.ini')
      if (fs.existsSync(wwVersionFile)) return readIniValue(wwVersionFile, 'Version', 'version') ?? null
    }
    return null
  }
  return readIniValue(versionFile, 'Version', 'version') ?? null
}

function readIniValue(filePath: string, section: string, key: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    let inSection = false
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === `[${section}]`) { inSection = true; continue }
      if (trimmed.startsWith('[') && inSection) break
      if (inSection) {
        const eq = trimmed.indexOf('=')
        if (eq > 0 && trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim()
      }
    }
  } catch {}
  return null
}

function countMiMods(modsDir: string): number {
  if (!fs.existsSync(modsDir)) return 0
  return fs.readdirSync(modsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '__pycache__').length
}

// --- 核心 API ---

export async function importXxmiPackage(
  app: Electron.App,
  zipPath: string,
): Promise<XxmiImportResult> {
  if (!(await pathExists(zipPath))) {
    return { success: false, launcherPath: null, version: null, importedMiNames: [], error: '压缩包不存在' }
  }

  const xxmiDir = getXxmiDir(app)
  await ensureDir(getFrameworksDir(app))
  await ensureDir(xxmiDir)

  // 解压到临时目录
  const tempRoot = path.join(xxmiDir, '.import-temp', createId('xxmi'))
  const tempExtractDir = path.join(tempRoot, 'extract')
  const tempSourceDir = path.join(tempRoot, 'source')

  try {
    await ensureDir(tempExtractDir)
    await extractArchive(zipPath, tempExtractDir)
    const contentRoot = await resolveContentRoot(tempExtractDir)
    await copyDirectoryContents(contentRoot, tempSourceDir)

    // 验证结构：必须有 XXMI Launcher.exe
    const launcherCandidate = path.join(tempSourceDir, XXMI_LAUNCHER_EXE)
    if (!(await pathExists(launcherCandidate))) {
      return {
        success: false,
        launcherPath: null,
        version: null,
        importedMiNames: [],
        error: `压缩包中未找到 ${XXMI_LAUNCHER_EXE}，请确认这是 XXMI 便携包`,
      }
    }

    // 提取版本
    let version: string | null = null
    const configPath = path.join(tempSourceDir, 'XXMI Launcher Config.json')
    if (await pathExists(configPath)) {
      try {
        const config = JSON.parse(await fsPromises.readFile(configPath, 'utf-8'))
        version = config?.Launcher?.version ?? config?.version ?? null
      } catch {}
    }

    // 复制到目标目录（只复制顶层文件和目录，跳过 .import-temp 自身）
    const entries = await fsPromises.readdir(tempSourceDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.import-temp') continue
      const src = path.join(tempSourceDir, entry.name)
      const dest = path.join(xxmiDir, entry.name)
      if (entry.isDirectory()) {
        await copyDirectoryContents(src, dest)
      } else {
        await copyFileSafe(src, dest)
      }
    }

    // 确认 MI 目录
    const importedMiNames = findMiRuntimeNames(xxmiDir)

    return {
      success: true,
      launcherPath: getLauncherExe(app),
      version,
      importedMiNames,
    }
  } finally {
    await removePath(tempRoot)
  }
}

export async function getXxmiFrameworkInfo(app: Electron.App): Promise<XxmiFrameworkInfo> {
  const xxmiDir = getXxmiDir(app)
  const launcherPath = getLauncherExe(app)
  const installed = await pathExists(launcherPath)

  let version: string | null = null
  if (installed) {
    const configPath = path.join(xxmiDir, 'XXMI Launcher Config.json')
    if (await pathExists(configPath)) {
      try {
        const config = JSON.parse(await fsPromises.readFile(configPath, 'utf-8'))
        version = config?.Launcher?.version ?? config?.version ?? null
      } catch {}
    }
  }

  const miStatuses: XxmiMiStatus[] = XXMI_MI_RUNTIME_NAMES.map(miName => {
    const miDir = getMiDir(app, miName)
    const modsDir = getMiModsDir(app, miName)
    const hasDll = fs.existsSync(path.join(miDir, 'd3d11.dll'))
    const installed = hasDll || fs.existsSync(path.join(miDir, 'Core', miName))
    return {
      runtimeName: miName,
      gameName: XXMI_MI_GAME_MAP[miName],
      installed,
      modsCount: installed ? countMiMods(modsDir) : 0,
      modsDir: installed ? modsDir : null,
    }
  })

  return {
    installed,
    version,
    launcherExe: installed ? launcherPath : null,
    frameworksDir: getFrameworksDir(app),
    miStatuses,
  }
}

export async function bindGameToMi(
  app: Electron.App,
  gameName: string,
  miName: XxmiRuntimeName,
  gameExePath: string,
): Promise<void> {
  const bindings = await loadBindings(app)
  const gameRootDir = path.dirname(gameExePath)
  const existing = bindings.findIndex(b => b.gameName === gameName)
  const binding: XxmiGameBinding = { gameName, miName, gameExePath, gameRootDir }
  if (existing >= 0) {
    bindings[existing] = binding
  } else {
    bindings.push(binding)
  }
  await saveBindings(app, bindings)
}

export async function getGameBinding(
  app: Electron.App,
  gameName: string,
): Promise<XxmiGameBinding | null> {
  const bindings = await loadBindings(app)
  return bindings.find(b => b.gameName === gameName) ?? null
}

export async function getMiVersionForGame(
  app: Electron.App,
  gameName: string,
): Promise<string | null> {
  const binding = await getGameBinding(app, gameName)
  if (!binding) return null
  const miDir = getMiDir(app, binding.miName)
  return getMiVersion(miDir)
}

export async function launchGameWithXxmi(
  app: Electron.App,
  gameName: string,
  gameExePath: string,
): Promise<XxmiLaunchResult> {
  const launcherPath = getLauncherExe(app)
  if (!(await pathExists(launcherPath))) {
    return { success: false, error: `未找到 XXMI Launcher: ${launcherPath}` }
  }

  const gameRootDir = path.dirname(gameExePath)
  const miName = XXMI_GAME_RUNTIME_NAMES[gameName]
  if (!miName) {
    return { success: false, error: `不支持的游戏: ${gameName}` }
  }

  const miDir = getMiDir(app, miName)
  if (!fs.existsSync(path.join(miDir, 'd3d11.dll'))) {
    return { success: false, error: `XXMI ${miName} 未安装，请先导入 XXMI 便携包` }
  }

  // 保存或更新绑定
  await bindGameToMi(app, gameName, miName, gameExePath)

  return new Promise((resolve) => {
    const child = spawn(launcherPath, ['--nogui', '--xxmi', miName, gameExePath], {
      cwd: miDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    child.unref()

    if (child.pid) {
      resolve({ success: true, processId: child.pid })
    } else {
      child.on('error', (err) => resolve({ success: false, error: err.message }))
      resolve({ success: false, error: '启动进程创建失败' })
    }
  })
}

export async function installModToXxmiMi(
  app: Electron.App,
  miName: XxmiRuntimeName,
  modSourceDir: string,
  modName?: string,
): Promise<{ success: boolean; targetDir: string; error?: string }> {
  const miDir = getMiDir(app, miName)
  const modsDir = getMiModsDir(app, miName)

  const hasDll = fs.existsSync(path.join(miDir, 'd3d11.dll'))
  if (!hasDll) {
    return { success: false, targetDir: '', error: `XXMI ${miName} 未安装，请先导入 XXMI 便携包` }
  }

  const targetDir = path.join(modsDir, modName || path.basename(modSourceDir))
  await ensureDir(targetDir)
  await copyDirectoryContents(modSourceDir, targetDir)

  return { success: true, targetDir }
}

export async function getXxmiMiModsDir(
  app: Electron.App,
  miName: XxmiRuntimeName,
): Promise<string | null> {
  const modsDir = getMiModsDir(app, miName)
  const miDir = getMiDir(app, miName)
  const hasDll = fs.existsSync(path.join(miDir, 'd3d11.dll'))
  return hasDll ? modsDir : null
}

export async function getAllXxmiMiModsDirs(
  app: Electron.App,
): Promise<Record<XxmiRuntimeName, string | null>> {
  const result = {} as Record<XxmiRuntimeName, string | null>
  for (const miName of XXMI_MI_RUNTIME_NAMES) {
    result[miName] = await getXxmiMiModsDir(app, miName)
  }
  return result
}

export async function uninstallXxmiFramework(app: Electron.App): Promise<void> {
  const xxmiDir = getXxmiDir(app)
  await removePath(xxmiDir)
  const bindingsPath = getBindingsPath(app)
  await fsPromises.unlink(bindingsPath).catch(() => {})
}

export async function createGameShortcut(
  app: Electron.App,
  gameName: string,
  miName: XxmiRuntimeName,
  gameExePath: string,
): Promise<XxmiShortcutResult> {
  const launcherPath = getLauncherExe(app)
  if (!(await pathExists(launcherPath))) {
    return { success: false, shortcutPath: null, error: 'XXMI Launcher 未安装' }
  }

  const miDir = getMiDir(app, miName)
  if (!fs.existsSync(path.join(miDir, 'd3d11.dll'))) {
    return { success: false, shortcutPath: null, error: `${miName} 未安装` }
  }

  // 桌面路径
  const desktopPath = app.getPath('desktop')
  const shortcutName = `${gameName} (XXMI).lnk`
  const shortcutPath = path.join(desktopPath, shortcutName)

  // 启动参数
  const args = `--nogui --xxmi ${miName} "${gameExePath}"`

  try {
    shell.writeShortcutLink(shortcutPath, {
      target: launcherPath,
      args: args,
      workingDir: miDir,
      icon: gameExePath,
      iconIndex: 0,
      description: `Launch ${gameName} with XXMI ${miName}`,
    })
    return { success: true, shortcutPath }
  } catch (error: any) {
    return { success: false, shortcutPath: null, error: error.message || '创建快捷方式失败' }
  }
}
