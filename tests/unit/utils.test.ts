import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  createStableHash,
  deepClone,
  sanitizeSegment,
  toRelativePosix,
} from '../../src/main/mod-manager/utils'

describe('mod manager utils', () => {
  it('清理非法文件名字符并限制长度', () => {
    expect(sanitizeSegment('a/b:c*?"<>|')).toBe('a_b_c______')
    expect(sanitizeSegment('  name.  ')).toBe('name')
    expect(sanitizeSegment('')).toBe('Unknown')
    expect(sanitizeSegment('_system')).toBe('Unknown')
    expect(sanitizeSegment('x'.repeat(100))).toHaveLength(80)
  })

  it('生成稳定哈希', () => {
    expect(createStableHash('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(createStableHash('abc')).toBe(createStableHash('abc'))
  })

  it('相对路径统一为 POSIX 并拒绝越界', () => {
    const root = path.resolve('tmp-root')
    expect(toRelativePosix(root, path.join(root, 'a', 'b.txt'))).toBe('a/b.txt')
    expect(() => toRelativePosix(root, path.join(root, '..', 'escape.txt'))).toThrow(/非法文件路径/)
  })

  it('深拷贝保留 Date 并处理循环引用', () => {
    const source = { a: 1, nested: { b: 2 }, when: new Date('2026-01-01T00:00:00Z') } as {
      a: number
      nested: { b: number }
      when: Date
      self?: unknown
    }
    source.self = source
    const cloned = deepClone(source)
    expect(cloned).not.toBe(source)
    expect(cloned.nested).not.toBe(source.nested)
    expect(cloned.when).toBeInstanceOf(Date)
    expect(cloned.when.getTime()).toBe(source.when.getTime())
    expect(cloned.self).toBe(cloned)
  })
})
