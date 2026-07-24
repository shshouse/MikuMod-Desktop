import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
import type { DownloadResumeData, MultiDownloadSegment } from '@shared/electron-api'

const MAX_CONNECTIONS = 8
const MIN_SEGMENT_SIZE = 8 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 500
const HEAD_TIMEOUT_MS = 15000
const SEGMENT_TIMEOUT_MS = 30000
const SEGMENT_MAX_RETRIES = 3

interface MultiDownloadCallbacks {
  onProgress: (data: { receivedBytes: number; totalBytes: number; percent: number }) => void
  onPaused: (resumeData: DownloadResumeData) => void
  onDone: (savePath: string) => void
  onError: (error: string) => void
}

export interface MultiDownloadOptions extends MultiDownloadCallbacks {
  url: string
  fileName: string
  saveDir: string
  resumeData?: DownloadResumeData
}

interface HeadResult {
  totalLength: number
  acceptRanges: boolean
}

export class MultiDownload {
  private segments: MultiDownloadSegment[] = []
  private requests: http.ClientRequest[] = []
  private partPath = ''
  private savePath = ''
  private totalLength = 0
  private paused = false
  private cancelled = false
  private lastEmit = 0
  private receivedBytes = 0
  private opts: MultiDownloadOptions

  constructor(opts: MultiDownloadOptions) {
    this.opts = opts
  }

  async start(): Promise<void> {
    try {
      this.savePath = path.join(this.opts.saveDir, this.opts.fileName)
      this.partPath = this.savePath + '.mmdpart'

      if (this.opts.resumeData) {
        if (!fs.existsSync(this.partPath)) {
          throw new Error('临时文件不存在，无法恢复')
        }
        const stat = fs.statSync(this.partPath)
        if (stat.size !== this.opts.resumeData.totalLength) {
          throw new Error('临时文件大小不匹配，无法恢复')
        }
        this.totalLength = this.opts.resumeData.totalLength
        this.segments = this.opts.resumeData.segments.map(s => ({ ...s }))
      } else {
        const { totalLength, acceptRanges } = await this.head()
        this.totalLength = totalLength
        // ponytail: CF 边缘缓存命中时 Range 请求会返回 200 完整文件，
        // 多段写入会数据错位。先探测是否真正返回 206，再决定分段。
        const rangeSupported = acceptRanges && await this.probeRangeSupport()
        this.segments = this.buildSegments(totalLength, rangeSupported)
        if (!fs.existsSync(this.opts.saveDir)) {
          fs.mkdirSync(this.opts.saveDir, { recursive: true })
        }
        const fd = fs.openSync(this.partPath, 'w')
        fs.ftruncateSync(fd, totalLength)
        fs.closeSync(fd)
      }

      this.receivedBytes = this.segments.reduce((sum, s) => sum + s.received, 0)
      this.emitProgress(true)

      await Promise.all(this.segments.map(seg => this.downloadSegmentWithRetry(seg)))

      if (this.cancelled) {
        this.cleanupPartFile()
        return
      }
      if (this.paused) {
        this.opts.onPaused(this.buildResumeData())
        return
      }

      const totalReceived = this.segments.reduce((sum, s) => sum + s.received, 0)
      if (totalReceived < this.totalLength) {
        this.opts.onPaused(this.buildResumeData())
        return
      }

      fs.renameSync(this.partPath, this.savePath)
      this.opts.onDone(this.savePath)
    } catch (err: any) {
      for (const req of this.requests) {
        try { req.destroy() } catch {}
      }
      if (this.cancelled) {
        this.cleanupPartFile()
        return
      }
      if (this.paused) {
        this.opts.onPaused(this.buildResumeData())
        return
      }
      this.opts.onError(err?.message || '下载失败')
    }
  }

  pause(): void {
    if (this.paused || this.cancelled) return
    this.paused = true
    for (const req of this.requests) {
      try { req.destroy() } catch {}
    }
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.paused = false
    for (const req of this.requests) {
      try { req.destroy() } catch {}
    }
  }

  private cleanupPartFile(): void {
    try { fs.unlinkSync(this.partPath) } catch {}
  }

  private head(): Promise<HeadResult> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.opts.url)
      const lib = url.protocol === 'https:' ? https : http

      const req = lib.request(url, { method: 'HEAD', timeout: HEAD_TIMEOUT_MS }, (res) => {
        res.resume()
        if (res.statusCode !== 200) {
          reject(new Error(`HEAD 请求失败: ${res.statusCode}`))
          return
        }
        const len = parseInt(res.headers['content-length'] || '', 10)
        if (!Number.isFinite(len) || len <= 0) {
          reject(new Error('无法获取文件大小'))
          return
        }
        const acceptRanges = (res.headers['accept-ranges'] || '').toLowerCase().includes('bytes')
        resolve({ totalLength: len, acceptRanges })
      })

      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('HEAD 请求超时')))
      req.end()
    })
  }

  private probeRangeSupport(): Promise<boolean> {
    return new Promise((resolve) => {
      const url = new URL(this.opts.url)
      const lib = url.protocol === 'https:' ? https : http

      const req = lib.get(url, {
        headers: { Range: 'bytes=0-0' },
        timeout: HEAD_TIMEOUT_MS,
      }, (res) => {
        res.resume()
        resolve(res.statusCode === 206)
      })

      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
  }

  private buildSegments(total: number, acceptRanges: boolean): MultiDownloadSegment[] {
    if (!acceptRanges || total <= MIN_SEGMENT_SIZE) {
      return [{ start: 0, end: total - 1, received: 0 }]
    }
    const count = Math.min(MAX_CONNECTIONS, Math.ceil(total / MIN_SEGMENT_SIZE))
    const segSize = Math.ceil(total / count)
    const segs: MultiDownloadSegment[] = []
    for (let i = 0; i < count; i++) {
      const start = i * segSize
      const end = Math.min(start + segSize - 1, total - 1)
      segs.push({ start, end, received: 0 })
    }
    return segs
  }

  private async downloadSegmentWithRetry(seg: MultiDownloadSegment): Promise<void> {
    for (let attempt = 0; attempt <= SEGMENT_MAX_RETRIES; attempt++) {
      if (this.paused || this.cancelled) return
      try {
        await this.downloadSegment(seg)
        return
      } catch (err: any) {
        if (this.paused || this.cancelled) return
        if (attempt === SEGMENT_MAX_RETRIES) throw err
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)))
      }
    }
  }

  private downloadSegment(seg: MultiDownloadSegment): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStart = seg.start + seg.received
      if (writeStart > seg.end) { resolve(); return }

      const url = new URL(this.opts.url)
      const lib = url.protocol === 'https:' ? https : http

      const req = lib.get(url, {
        headers: {
          Range: `bytes=${writeStart}-${seg.end}`,
          'Accept-Encoding': 'identity',
        },
        timeout: SEGMENT_TIMEOUT_MS,
      }, (res) => {
        if (res.statusCode !== 206 && res.statusCode !== 200) {
          res.resume()
          if (this.paused || this.cancelled) { resolve(); return }
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }

        const writeStream = fs.createWriteStream(this.partPath, { start: writeStart, flags: 'r+' })
        let errored = false

        const onError = (err: Error) => {
          if (errored) return
          errored = true
          try { writeStream.destroy() } catch {}
          try { res.destroy() } catch {}
          if (this.paused || this.cancelled) { resolve(); return }
          reject(err)
        }

        res.on('data', (chunk: Buffer) => {
          seg.received += chunk.length
          this.receivedBytes += chunk.length
          this.emitProgress()
        })
        res.pipe(writeStream)

        writeStream.on('finish', () => {
          if (errored) return
          if (this.paused || this.cancelled) { resolve(); return }
          resolve()
        })
        res.on('error', onError)
        writeStream.on('error', onError)
      })

      req.on('error', (err) => {
        if (this.paused || this.cancelled) { resolve(); return }
        reject(err)
      })
      req.on('timeout', () => req.destroy(new Error('segment 下载超时')))

      this.requests.push(req)
    })
  }

  private emitProgress(force = false): void {
    if (this.paused || this.cancelled) return
    const now = Date.now()
    if (!force && now - this.lastEmit < PROGRESS_INTERVAL_MS) return
    this.lastEmit = now
    const percent = this.totalLength > 0 ? Math.min(100, (this.receivedBytes / this.totalLength) * 100) : 0
    this.opts.onProgress({
      receivedBytes: this.receivedBytes,
      totalBytes: this.totalLength,
      percent,
    })
  }

  private buildResumeData(): DownloadResumeData {
    return {
      version: 2,
      path: this.savePath,
      partPath: this.partPath,
      url: this.opts.url,
      totalLength: this.totalLength,
      segments: this.segments.map(s => ({ ...s })),
    }
  }
}
