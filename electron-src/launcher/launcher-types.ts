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

export const XXMI_PLATFORM_ID = 'xxmi'

export const XXMI_FRAMEWORKS_DIR = 'frameworks'
export const XXMI_FRAMEWORK_DIR = 'xxmi'

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
