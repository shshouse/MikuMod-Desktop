import path from 'path'

// --- XXMI Launcher 常量 ---

export const XXMI_LAUNCHER_EXE = 'XXMI Launcher.exe'

export const XXMI_MI_RUNTIME_NAMES = ['GIMI', 'SRMI', 'WWMI', 'ZZMI', 'EFMI', 'HIMI'] as const

export type XxmiRuntimeName = typeof XXMI_MI_RUNTIME_NAMES[number]

export const XXMI_MI_GAME_MAP: Record<XxmiRuntimeName, string> = {
  GIMI: 'Genshin Impact',
  SRMI: 'Honkai: Star Rail',
  WWMI: 'Wuthering Waves',
  ZZMI: 'Zenless Zone Zero',
  EFMI: 'Endfield',
  HIMI: 'Honkai Impact 3rd',
}

export const XXMI_GAME_RUNTIME_NAMES: Record<string, XxmiRuntimeName> = {
  'Genshin Impact': 'GIMI',
  'Honkai: Star Rail': 'SRMI',
  'Wuthering Waves': 'WWMI',
  'Zenless Zone Zero': 'ZZMI',
  'Endfield': 'EFMI',
  'Honkai Impact 3rd': 'HIMI',
}

// ponytail: 用模糊匹配做 gameName -> miName 映射
// 平台 DB 的游戏名可能中英混用/带版本号, 精确匹配不可靠
// 升级路径: 游戏多了可考虑用 DB 的 steam_app_id 或专门字段做精确映射
export function resolveMiNameByGameName(gameName: string): XxmiRuntimeName | null {
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

export const XXMI_PLATFORM_ID = 'xxmi'
export const XXMI_FRAMEWORKS_DIR = 'frameworks'
export const XXMI_FRAMEWORK_DIR = 'xxmi'

// ponytail: 纯路径计算 (不依赖 Electron), 供 mod-manager 复用
// 避免循环依赖: xxmi-launcher.ts -> mod-manager/state, 所以不能 import xxmi-launcher
export function getMiModsDirFromBase(appBaseDir: string, miName: XxmiRuntimeName): string {
  return path.join(appBaseDir, XXMI_FRAMEWORKS_DIR, XXMI_FRAMEWORK_DIR, miName, 'Mods')
}
export function getMiDirFromBase(appBaseDir: string, miName: XxmiRuntimeName): string {
  return path.join(appBaseDir, XXMI_FRAMEWORKS_DIR, XXMI_FRAMEWORK_DIR, miName)
}

// --- XXMI 运行时元信息 ---

export interface XxmiMiStatus {
  runtimeName: XxmiRuntimeName
  gameName: string
  installed: boolean
  modsCount: number
  modsDir: string | null
}

export interface XxmiFrameworkInfo {
  installed: boolean
  version: string | null
  launcherExe: string | null
  frameworksDir: string
  miStatuses: XxmiMiStatus[]
}

export interface XxmiImportResult {
  success: boolean
  launcherPath: string | null
  version: string | null
  importedMiNames: string[]
  error?: string
}

export interface XxmiLaunchResult {
  success: boolean
  processId?: number
  error?: string
}

export interface XxmiModInstallResult {
  success: boolean
  miName: XxmiRuntimeName
  targetDir: string
  modCount: number
  error?: string
}

// --- 游戏路径注册 ---

export interface XxmiGameBinding {
  gameName: string
  miName: XxmiRuntimeName
  gameExePath: string
  gameRootDir: string
}

export interface XxmiShortcutResult {
  success: boolean
  shortcutPath: string | null
  error?: string
}
