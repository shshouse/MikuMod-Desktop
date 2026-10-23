import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const state = vi.hoisted(() => ({
  base: `${process.env.TEMP ?? '/tmp'}/og-desktop-security`,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `${state.base}/${name}`,
  },
}))

vi.mock('../../src/main/core/paths', () => ({
  getDesktopPaths: () => ({
    appDir: `${state.base}/app`,
    dataDir: `${state.base}/data`,
    modsDir: `${state.base}/mods`,
    backupsDir: `${state.base}/backups`,
  }),
}))

import {
  authorizeBaseDir,
  isAllowedExternalUrl,
  isAllowedHttpDomain,
  isPathAllowed,
  normalizeBaseDir,
} from '../../src/main/core/security'

describe('security domains', () => {
  it('只放行白名单域名及其子域', () => {
    expect(isAllowedExternalUrl('https://mikumod.com/a')).toBe(true)
    expect(isAllowedExternalUrl('https://www.mikumod.com')).toBe(true)
    expect(isAllowedExternalUrl('https://sub.mikumod.com')).toBe(true)
    expect(isAllowedExternalUrl('http://github.com')).toBe(true)
    expect(isAllowedExternalUrl('https://mikumod.com.evil.com')).toBe(false)
    expect(isAllowedExternalUrl('ftp://mikumod.com')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  it('HTTP 域名额外放行 Supabase', () => {
    expect(isAllowedHttpDomain('https://abc.supabase.co/rest')).toBe(true)
    expect(isAllowedHttpDomain('https://abc.supabase.in')).toBe(true)
    expect(isAllowedHttpDomain('https://mikumod.com')).toBe(true)
    expect(isAllowedHttpDomain('https://github.com')).toBe(false)
  })
})

describe('security paths', () => {
  it('归一化基础目录，拒绝空白与根目录', () => {
    expect(normalizeBaseDir('')).toBeNull()
    expect(normalizeBaseDir('   ')).toBeNull()
    expect(normalizeBaseDir(path.parse(state.base).root)).toBeNull()
    expect(normalizeBaseDir(path.join(state.base, 'app'))).toBe(path.normalize(path.join(state.base, 'app')))
  })

  it('只允许预设目录与显式授权目录', () => {
    expect(isPathAllowed(path.join(state.base, 'app', 'file.txt'))).toBe(true)
    expect(isPathAllowed(path.join(state.base, 'mods', 'mod', 'a.pak'))).toBe(true)
    expect(isPathAllowed(path.join(state.base, 'user', 'certs', 'key.pem'))).toBe(false)
    expect(isPathAllowed(path.join(state.base, '..', 'outside.txt'))).toBe(false)
    expect(isPathAllowed(undefined)).toBe(false)

    const custom = path.join(state.base, 'custom')
    expect(authorizeBaseDir(custom)).toBe(path.normalize(custom))
    expect(isPathAllowed(path.join(custom, 'nested', 'file.txt'))).toBe(true)
  })
})
