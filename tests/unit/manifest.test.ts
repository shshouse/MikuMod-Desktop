import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildManifest,
  indexManifest,
  readManifest,
  writeManifest,
} from '../../src/main/mod-manager/manifest'
import type { ModRecord } from '../../src/main/mod-manager/types'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-desktop-manifest-'))

function record(): ModRecord {
  return {
    id: 'm1',
    name: '测试模组',
    gameId: 'genshin',
    gameName: '原神',
    sourceType: 'local',
    importedAt: '2026-01-01T00:00:00.000Z',
    installed: false,
    installedAt: null,
    fileCount: 0,
    libraryPath: root,
    folderName: '测试模组',
    platformModId: null,
    platformVersionId: null,
    modNumber: null,
    lastGamePath: null,
    miTargetDir: null,
  }
}

describe('mod manifest', () => {
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  it('构建时排除管理文件与保留目录', async () => {
    const source = path.join(root, 'source')
    fs.mkdirSync(path.join(source, 'sub'), { recursive: true })
    fs.mkdirSync(path.join(source, '_system'), { recursive: true })
    fs.writeFileSync(path.join(source, 'a.txt'), 'a')
    fs.writeFileSync(path.join(source, 'sub', 'b.txt'), 'b')
    fs.writeFileSync(path.join(source, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(source, 'original.zip'), 'zip')
    fs.writeFileSync(path.join(source, '_system', 'x.txt'), 'x')

    const manifest = await buildManifest(record())
    expect(manifest.fileCount).toBe(2)
    expect(manifest.files.map((f) => f.relativePath)).toEqual(['a.txt', 'sub/b.txt'])
    expect(manifest.files.every((f) => f.sha256.length === 64)).toBe(true)
  })

  it('写入后可读回，索引大小写不敏感', async () => {
    const manifest = await buildManifest(record())
    await writeManifest(root, manifest)
    expect(await readManifest(record())).toEqual(manifest)

    const index = indexManifest({
      ...manifest,
      files: [
        { relativePath: 'A/B.txt', size: 1, sha256: 'x' },
        { relativePath: 'c.txt', size: 1, sha256: 'y' },
      ],
    })
    expect(index.filesByKey.get('a/b.txt')?.relativePath).toBe('A/B.txt')
    expect(index.filesByKey.get('c.txt')?.relativePath).toBe('c.txt')
  })
})
