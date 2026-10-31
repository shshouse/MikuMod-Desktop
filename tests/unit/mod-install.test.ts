import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
    shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn(async () => undefined) },
}))

import { importExternalMod, installManagedMod, uninstallManagedMod } from '../../src/main/mod-manager/operations'

function read(file: string) {
    return fs.readFileSync(path.join(root.dir, file), 'utf8')
}

describe('mod安装/卸载（临时目录）', () => {
    beforeEach(() => {
        root.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikumod-install-'))
    })

    afterEach(() => {
        fs.rmSync(root.dir, { recursive: true, force: true })
    })

    it('安装覆盖原文件，卸载恢复原内容并删除新增文件', async () => {
        const modsRoot = path.join(root.dir, 'mods')
        const backupsRoot = path.join(root.dir, 'backups')
        const gamePath = path.join(root.dir, 'game')
        const sourceDir = path.join(root.dir, 'src')

        fs.mkdirSync(path.join(sourceDir, 'sub'), { recursive: true })
        fs.writeFileSync(path.join(sourceDir, 'a.txt'), 'MOD_A')
        fs.writeFileSync(path.join(sourceDir, 'sub', 'b.txt'), 'MOD_B')
        fs.mkdirSync(gamePath, { recursive: true })
        fs.writeFileSync(path.join(gamePath, 'a.txt'), 'ORIGINAL_A')

        const app = { isPackaged: true, getPath: () => path.join(root.dir, 'app.exe') } as unknown as Electron.App
        const base = { gameId: 'g1', gameName: 'TestGame' }

        const imported = await importExternalMod(app, {
            ...base,
            sourcePath: sourceDir,
            sourceType: 'folder',
            modName: 'Demo',
        }, modsRoot, backupsRoot)
        expect(imported.id).toBeTruthy()

        const installed = await installManagedMod(app, {
            ...base,
            modId: imported.id,
            gamePath,
        }, modsRoot, backupsRoot)
        expect(installed.ok).toBe(true)
        expect(installed.installedPaths).toBe(2)
        expect(read('game/a.txt')).toBe('MOD_A')
        expect(read('game/sub/b.txt')).toBe('MOD_B')

        const uninstalled = await uninstallManagedMod(app, {
            ...base,
            modId: imported.id,
            gamePath,
        }, modsRoot, backupsRoot)
        expect(uninstalled.ok).toBe(true)
        expect(read('game/a.txt')).toBe('ORIGINAL_A')
        expect(fs.existsSync(path.join(gamePath, 'sub', 'b.txt'))).toBe(false)
    })

    it('重复安装同一文件不重复计费，卸载后仍能恢复最初内容', async () => {
        const modsRoot = path.join(root.dir, 'mods')
        const backupsRoot = path.join(root.dir, 'backups')
        const gamePath = path.join(root.dir, 'game')
        const sourceDir = path.join(root.dir, 'src')

        fs.mkdirSync(sourceDir, { recursive: true })
        fs.writeFileSync(path.join(sourceDir, 'a.txt'), 'MOD_A')
        fs.mkdirSync(gamePath, { recursive: true })
        fs.writeFileSync(path.join(gamePath, 'a.txt'), 'ORIGINAL_A')

        const app = { isPackaged: true, getPath: () => path.join(root.dir, 'app.exe') } as unknown as Electron.App
        const base = { gameId: 'g1', gameName: 'TestGame' }

        const imported = await importExternalMod(app, {
            ...base,
            sourcePath: sourceDir,
            sourceType: 'folder',
        }, modsRoot, backupsRoot)

        await installManagedMod(app, { ...base, modId: imported.id, gamePath }, modsRoot, backupsRoot)
        await installManagedMod(app, { ...base, modId: imported.id, gamePath }, modsRoot, backupsRoot)
        expect(read('game/a.txt')).toBe('MOD_A')
        await uninstallManagedMod(app, { ...base, modId: imported.id, gamePath }, modsRoot, backupsRoot)
        expect(read('game/a.txt')).toBe('ORIGINAL_A')
    })
})
