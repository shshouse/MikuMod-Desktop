import path from 'path'
import fsPromises from 'fs/promises'
import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { ipcMain } from 'electron'
import { authorizeBaseDir } from '../core/security'
import { IpcChannels } from '@shared/ipc-channels'

const exec = promisify(execCallback)

async function getSteamPath() {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await exec('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', { encoding: 'utf-8' })
    const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim()
  } catch {}
  const defaults = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam']
  for (const p of defaults) {
    try { await fsPromises.access(p); return p } catch {}
  }
  return null
}

async function getLibraryFolders(steamPath: string) {
  const folders = [steamPath]
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf')
  try {
    await fsPromises.access(vdfPath)
    const content = await fsPromises.readFile(vdfPath, 'utf-8')
    const regex = /"path"\s+"([^"]+)"/g
    let m
    while ((m = regex.exec(content)) !== null) {
      const p = m[1].replace(/\\\\/g, '\\')
      if (!folders.includes(p)) folders.push(p)
    }
  } catch {}
  return folders
}

function parseVdfValue(content: string, key: string) {
  const m = content.match(new RegExp(`"${key}"\\s+"([^"]+)"`, 'i'))
  return m ? m[1] : null
}

const PATH_FIXES: Record<string, string> = {
  '12210': 'GTAIV',
}

export function registerSteamIPC() {
  ipcMain.handle(IpcChannels.steam.scan, async () => {
    try {
      const steamPath = await getSteamPath()
      if (!steamPath) return []

      const libraries = await getLibraryFolders(steamPath)
      const results: { appId: string; name: string; installPath: string }[] = []

      for (const lib of libraries) {
        const steamapps = path.join(lib, 'steamapps')
        let files: string[]
        try { files = await fsPromises.readdir(steamapps) } catch { continue }

        for (const file of files) {
          if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue
          try {
            const content = await fsPromises.readFile(path.join(steamapps, file), 'utf-8')
            const appId = parseVdfValue(content, 'appid')
            const name = parseVdfValue(content, 'name')
            const installDir = parseVdfValue(content, 'installdir')
            if (appId && installDir) {
              let installPath = path.join(steamapps, 'common', installDir)
              const fix = PATH_FIXES[String(appId)]
              if (fix) installPath = path.join(installPath, fix)
              authorizeBaseDir(installPath)
              results.push({ appId, name: name || installDir, installPath })
            }
          } catch {}
        }
      }

      return results
    } catch (error) {
      console.error('scan-steam-games general fault:', error)
      return []
    }
  })
}
