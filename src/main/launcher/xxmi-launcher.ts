import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { spawn } from 'child_process'
import { shell } from 'electron'
import { getAppBaseDir } from '../mod-manager/state'
import { ensureDir, pathExists, copyFileSafe, copyDirectoryContents, removePath, extractArchive, resolveContentRoot, createId } from '../mod-manager/utils'
import {
  XXMI_LAUNCHER_EXE,
  XXMI_MI_RUNTIME_NAMES,
  XXMI_MI_GAME_MAP,
  XXMI_FRAMEWORKS_DIR,
  XXMI_FRAMEWORK_DIR,
  resolveMiNameByGameName,
  type XxmiRuntimeName,
  type XxmiFrameworkInfo,
  type XxmiImportResult,
  type XxmiLaunchResult,
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
  return path.join(getXxmiDir(app), 'Resources', 'Bin', XXMI_LAUNCHER_EXE)
}

function getMiDir(app: Electron.App, miName: string): string {
  return path.join(getXxmiDir(app), miName)
}

function getMiModsDir(app: Electron.App, miName: string): string {
  return path.join(getMiDir(app, miName), 'Mods')
}

// --- XXMI Config.json 读写 (唯一真相源) ---

function getConfigPath(app: Electron.App): string {
  return path.join(getXxmiDir(app), 'XXMI Launcher Config.json')
}

async function readXxmiConfig(app: Electron.App): Promise<Record<string, any> | null> {
  const configPath = getConfigPath(app)
  if (!(await pathExists(configPath))) return null
  try {
    const raw = await fsPromises.readFile(configPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeXxmiConfig(app: Electron.App, config: Record<string, any>): Promise<void> {
  const configPath = getConfigPath(app)
  await fsPromises.writeFile(configPath, JSON.stringify(config, null, 4), 'utf-8')
}

// --- 游戏 exe 名称映射 (XXMI validate_game_exe_path 用这些名称匹配) ---

const MI_GAME_EXE_NAMES: Record<XxmiRuntimeName, string[]> = {
  GIMI: ['GenshinImpact.exe', 'YuanShen.exe'],
  SRMI: ['StarRail.exe'],
  WWMI: ['Wuthering Waves.exe'],
  ZZMI: ['ZenlessZoneZero.exe', 'ZenlessZoneZeroBeta.exe'],
  EFMI: ['Endfield.exe'],
  HIMI: ['BH3.exe'],
}

// 在给定路径下查找游戏 exe, 找到返回 true
function hasGameExe(miName: XxmiRuntimeName, dirPath: string): boolean {
  const exeNames = MI_GAME_EXE_NAMES[miName]
  for (const exe of exeNames) {
    if (fs.existsSync(path.join(dirPath, exe))) return true
  }
  // 往子目录找一层 (如启动器目录下的 games/Arknights Endfield/)
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      for (const exe of exeNames) {
        if (fs.existsSync(path.join(dirPath, entry.name, exe))) return true
      }
    }
  } catch {}
  return false
}

// 查找包含游戏 exe 的子目录 (如 games/Arknights Endfield/)
function findGameExeDir(miName: XxmiRuntimeName, dirPath: string): string | null {
  const exeNames = MI_GAME_EXE_NAMES[miName]
  // 当前目录直接有 exe
  for (const exe of exeNames) {
    if (fs.existsSync(path.join(dirPath, exe))) return dirPath
  }
  // 往子目录找
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const subDir = path.join(dirPath, entry.name)
      for (const exe of exeNames) {
        if (fs.existsSync(path.join(subDir, exe))) return subDir
      }
      // 再往下一层
      const subEntries = fs.readdirSync(subDir, { withFileTypes: true })
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory()) continue
        const subSubDir = path.join(subDir, subEntry.name)
        for (const exe of exeNames) {
          if (fs.existsSync(path.join(subSubDir, exe))) return subSubDir
        }
      }
    }
  } catch {}
  return null
}

// --- 游戏路径写入 XXMI Config (替代旧的 bindings.json) ---

export async function writeGameFolderToConfig(
  app: Electron.App,
  gameName: string,
  gameFolderPath: string,
): Promise<{ success: boolean; error?: string }> {
  const miName = resolveMiNameByGameName(gameName)
  if (!miName) {
    return { success: false, error: `不支持的游戏: ${gameName}` }
  }

  const config = await readXxmiConfig(app)
  if (!config) {
    return { success: false, error: 'XXMI Launcher Config.json 不存在或损坏，请先导入 XXMI 便携包' }
  }

  if (!config.Importers?.[miName]?.Importer) {
    return { success: false, error: `XXMI Config 中未找到 ${miName} 配置节` }
  }

  // 验证路径: 用户给的可能是启动器目录而非游戏 exe 所在目录
  // 如 E:/EndField/Hypergryph Launcher/ 但 exe 在 games/Arknights Endfield/
  let resolvedPath = gameFolderPath
  if (!hasGameExe(miName, gameFolderPath)) {
    const found = findGameExeDir(miName, gameFolderPath)
    if (found) {
      resolvedPath = found
    }
    // 找不到也不报错, 让 XXMI 自己检测, 至少写入用户指定的路径
  }

  config.Importers[miName].Importer.game_folder = resolvedPath
  await writeXxmiConfig(app, config)
  return { success: true }
}

export async function getGameFolderFromConfig(
  app: Electron.App,
  gameName: string,
): Promise<string | null> {
  const miName = resolveMiNameByGameName(gameName)
  if (!miName) return null
  const config = await readXxmiConfig(app)
  if (!config?.Importers?.[miName]?.Importer) return null
  const folder = config.Importers[miName].Importer.game_folder
  return (folder && folder.trim()) ? folder.trim() : null
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

  const tempRoot = path.join(xxmiDir, '.import-temp', createId('xxmi'))
  const tempExtractDir = path.join(tempRoot, 'extract')
  const tempSourceDir = path.join(tempRoot, 'source')

  try {
    await ensureDir(tempExtractDir)
    await extractArchive(zipPath, tempExtractDir)
    const contentRoot = await resolveContentRoot(tempExtractDir)
    await copyDirectoryContents(contentRoot, tempSourceDir)

    const hasConfig = await pathExists(path.join(tempSourceDir, 'XXMI Launcher Config.json'))
    const hasMiDir = await Promise.all(
      XXMI_MI_RUNTIME_NAMES.map(mi => pathExists(path.join(tempSourceDir, mi)))
    )
    if (!hasConfig && !hasMiDir.some(Boolean)) {
      return {
        success: false,
        launcherPath: null,
        version: null,
        importedMiNames: [],
        error: `压缩包中未找到 XXMI 便携包标识 (XXMI Launcher Config.json 或 MI 目录), 请确认这是 XXMI 便携包`,
      }
    }

    let version: string | null = null
    const configPath = path.join(tempSourceDir, 'XXMI Launcher Config.json')
    if (await pathExists(configPath)) {
      try {
        const config = JSON.parse(await fsPromises.readFile(configPath, 'utf-8'))
        version = config?.Launcher?.version ?? config?.version ?? null
      } catch {}
    }

    // 复制到目标目录（跳过 .import-temp 自身）
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

  const miStatuses: XxmiFrameworkInfo['miStatuses'] = XXMI_MI_RUNTIME_NAMES.map(miName => {
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

export async function getMiVersionForGame(
  app: Electron.App,
  gameName: string,
): Promise<string | null> {
  const miName = resolveMiNameByGameName(gameName)
  if (!miName) return null
  return getMiVersion(getMiDir(app, miName))
}

export async function launchGameWithXxmi(
  app: Electron.App,
  gameName: string,
  gameExePath?: string,
): Promise<XxmiLaunchResult> {
  const launcherPath = getLauncherExe(app)
  if (!(await pathExists(launcherPath))) {
    return { success: false, error: `未找到 XXMI Launcher: ${launcherPath}` }
  }

  const miName = resolveMiNameByGameName(gameName)
  if (!miName) {
    return { success: false, error: `不支持的游戏: ${gameName}` }
  }

  const miDir = getMiDir(app, miName)
  if (!fs.existsSync(path.join(miDir, 'd3d11.dll'))) {
    return { success: false, error: `XXMI ${miName} 未安装，请先导入 XXMI 便携包` }
  }

  // 如果有游戏路径, 写入 XXMI Config.json 让 XXMI 自动识别
  // gameExePath 可能是 exe 路径 (如 D:\Games\GenshinImpact.exe) 或游戏目录 (如 D:\Games\Genshin Impact)
  if (gameExePath) {
    const gameRootDir = path.extname(gameExePath) ? path.dirname(gameExePath) : gameExePath
    await writeGameFolderToConfig(app, gameName, gameRootDir)
  }

  // XXMI Launcher 是 Python 编译应用, stdio: 'pipe' 会导致管道缓冲区死锁崩溃
  // 用 detached + stdio: 'ignore' 让 XXMI 独立运行, 短暂等待后判定是否启动成功
  const child = spawn(launcherPath, ['--nogui', '--xxmi', miName], {
    cwd: miDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })

  return new Promise((resolve) => {
    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })

    // 短暂等待: 如果进程创建后 3 秒内没崩溃, 认为启动成功
    // XXMI --nogui 模式成功后会启动游戏并自行退出 (auto_close=true)
    // 如果 3 秒内 exit 了, 要检查退出码
    const earlyExitTimer = setTimeout(() => {
      // 进程存活 3 秒, 认为 XXMI 已进入正常启动流程
      child.unref()
      resolve({ success: true })
    }, 3000)

    child.on('exit', (code) => {
      clearTimeout(earlyExitTimer)
      // exit code 0 = XXMI 正常退出 (启动游戏后自动关闭)
      if (code === 0) {
        resolve({ success: true })
      } else {
        // XXMI 崩溃: Python 异常或其他错误
        resolve({ success: false, error: `XXMI Launcher 启动失败 (退出码 ${code})` })
      }
    })
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

  // 写入游戏路径到 XXMI Config
  const gameRootDir = path.dirname(gameExePath)
  await writeGameFolderToConfig(app, gameName, gameRootDir)

  const desktopPath = app.getPath('desktop')
  const shortcutName = `${gameName} (XXMI).lnk`
  const shortcutPath = path.join(desktopPath, shortcutName)

  // 快捷方式只需 --nogui --xxmi MIName, XXMI 自己从 Config 读 game_folder
  const args = `--nogui --xxmi ${miName}`

  try {
    shell.writeShortcutLink(shortcutPath, {
      target: launcherPath,
      args: args,
      cwd: miDir,
      icon: gameExePath,
      iconIndex: 0,
      description: `Launch ${gameName} with XXMI ${miName}`,
    })
    return { success: true, shortcutPath }
  } catch (error: any) {
    return { success: false, shortcutPath: null, error: error.message || '创建快捷方式失败' }
  }
}
