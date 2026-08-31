import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { ipcMain } from 'electron'
import { authorizeBaseDir } from '../core/security'
import { IpcChannels } from '@shared/ipc-channels'

// 终末地游戏检测
// 参考 XXMI-Launcher EFMI 实现: 注册表 MuiCache + Player.log + 已知路径
// XXMI 源码: ref/XXMI-Launcher-main/src/xxmi_launcher/core/packages/model_importers/efmi_package.py

const ENDFIELD_EXE = 'Endfield.exe'
const ENDFIELD_FOLDER_CHILDREN = ['Endfield_Data']
const GRYPHLINK_KNOWN_PATHS = [
  'C:\\Program Files\\GRYPHLINK\\games\\EndField Game',
  'D:\\GRYPHLINK\\games\\EndField Game',
]

interface DetectedGame {
  gameId: string
  name: string
  installPath: string
  exePath: string
}

// 读取注册表值(exec 同步包装为 Promise)
function regQuery(key: string, valueName?: string): Promise<string | null> {
  const args = valueName ? `/v ${valueName}` : '/s'
  return new Promise((resolve) => {
    exec(`reg query "${key}" ${args}`, { encoding: 'utf-8' }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(stdout || null)
    })
  })
}

// 读取注册表 MuiCache 中包含目标 exe 名的路径
// 对应 XXMI: reg_search_game_folders()
async function searchMuiCache(exeNames: string[]): Promise<string[]> {
  const cacheKeys = [
    'HKCR\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\AppSwitched',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FeatureUsage\\ShowJumpView',
  ]
  const paths: string[] = []
  for (const key of cacheKeys) {
    const out = await regQuery(key)
    if (!out) continue
    for (const line of out.split(/\r?\n/)) {
      // MuiCache 行格式: "C:\path\to\Endfield.exe.FriendlyAppName"="Endfield"
      // 或值名直接是路径
      for (const exe of exeNames) {
        if (!line.toLowerCase().includes(exe.toLowerCase())) continue
        const match = line.match(/([a-zA-Z]:[^"\r\n]*?\\[^"\r\n]*?\.exe)/i)
        if (match) {
          const candidate = path.dirname(match[1])
          if (!paths.some((p) => p.toLowerCase() === candidate.toLowerCase())) {
            paths.push(candidate)
          }
        }
      }
    }
  }
  return paths
}

// 从 Unity Player.log 提取路径
// 对应 XXMI: find_paths_in_file() + 'common' pattern
function findPathsInLogFile(logPath: string, keywords: string[]): string[] {
  const paths: string[] = []
  try {
    if (!fs.existsSync(logPath)) return paths
    const data = fs.readFileSync(logPath, 'utf-8')
    // 匹配含关键词的绝对路径
    const pattern = new RegExp(`([a-zA-Z]:[^:"'\\r\\n]*?(?:${keywords.join('|')})[^:"'\\r\\n]*?)(?:[\\/\\\\][^\\/\\\\\\r\\n]*)?$`, 'gm')
    let m: RegExpExecArray | null
    while ((m = pattern.exec(data)) !== null) {
      let p = m[1]
      // 截取到 Endfield 相关目录
      const endIdx = p.toLowerCase().indexOf(keywords[0].toLowerCase())
      if (endIdx !== -1) p = p.slice(0, endIdx + keywords[0].length)
      const dir = path.dirname(p)
      if (!paths.some((x) => x.toLowerCase() === dir.toLowerCase())) {
        paths.push(dir)
      }
    }
  } catch { /* ignore */ }
  return paths
}

// 验证目录是否为有效的游戏安装目录
// 对应 XXMI: validate_game_folders()
function validateGameFolder(dir: string): { exePath: string; mtime: number } | null {
  try {
    const exePath = path.join(dir, ENDFIELD_EXE)
    if (!fs.existsSync(exePath)) return null
    const stat = fs.statSync(exePath)
    if (!stat.isFile()) return null
    // 校验特征子目录存在(降低误报)
    for (const child of ENDFIELD_FOLDER_CHILDREN) {
      if (fs.existsSync(path.join(dir, child))) {
        return { exePath, mtime: stat.mtimeMs }
      }
    }
    return { exePath, mtime: stat.mtimeMs }
  } catch {
    return null
  }
}

function getPlayerLogPath(): string | null {
  const localLow = process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, 'AppData', 'LocalLow')
    : null
  if (!localLow) return null
  return path.join(localLow, 'Gryphline', 'Endfield', 'Player.log')
}

async function detectEndfield(): Promise<DetectedGame[]> {
  const candidates = new Set<string>()

  // 1. 已知路径
  for (const p of GRYPHLINK_KNOWN_PATHS) candidates.add(p)

  // 2. Player.log 解析
  const logPath = getPlayerLogPath()
  if (logPath) {
    for (const p of findPathsInLogFile(logPath, ['EndField', 'Endfield'])) {
      candidates.add(p)
    }
  }

  // 3. 注册表 MuiCache
  for (const p of await searchMuiCache([ENDFIELD_EXE])) {
    candidates.add(p)
  }

  // 4. 验证 + 排序(按 exe mtime 降序,最新版本优先)
  const validated: DetectedGame[] = []
  for (const dir of candidates) {
    const result = validateGameFolder(dir)
    if (result) {
      validated.push({
        gameId: 'endfield',
        name: 'Arknights: Endfield',
        installPath: dir,
        exePath: result.exePath,
      })
    }
  }
  validated.sort((a, b) => {
    const ta = fs.statSync(a.exePath).mtimeMs
    const tb = fs.statSync(b.exePath).mtimeMs
    return tb - ta
  })

  // 去重(按 installPath)
  const seen = new Set<string>()
  const unique: DetectedGame[] = []
  for (const g of validated) {
    const key = g.installPath.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    authorizeBaseDir(g.installPath)
    unique.push(g)
  }
  return unique
}

export function registerGameDetectIPC() {
  ipcMain.handle(IpcChannels.gameDetect.endfield, async () => {
    try {
      return await detectEndfield()
    } catch (error) {
      console.error('detect-endfield error:', error)
      return []
    }
  })
}
