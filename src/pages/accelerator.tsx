import { useCallback, useEffect, useState } from "react"
import { DEFAULT_DOMAINS } from "@/lib/accelerate-domains"
import {
  Zap, ZapOff, RefreshCw, CheckCircle2, XCircle,
  Loader2, Shield, Check, Square
} from "lucide-react"

interface AccelerateDomain {
  id: string
  group_name: string
  group_icon: string | null
  name: string
  match_domain: string
  forward_ip: string | null
  sni_value: string | null
  enabled: boolean
  sort_order: number
  parent_id: string | null
}

interface ResolvedMap {
  [domain: string]: string
}

type AcceleratorProxyMode = "system" | "hosts" | null

const CHECKED_STORAGE_KEY = "mmd_accelerator_checked"
const CHECKED_STORAGE_VERSION_KEY = "mmd_accelerator_checked_version"
const CHECKED_STORAGE_VERSION = "5"
const DEFAULT_SAFE_ACCELERATOR_DOMAINS = new Set([
  "steamcdn-a.akamaihd.net",
  "cdn.akamai.steamstatic.com",
  "steamcommunity-a.akamaihd.net",
  "media.steampowered.com",
  "steamcommunity.com",
  "store.steampowered.com",
  "api.steampowered.com",
  "login.steampowered.com",
  "help.steampowered.com",
])

const getRootItems = (domains: AccelerateDomain[]) =>
  domains.filter(d => !d.parent_id)

const getChildren = (parentId: string, domains: AccelerateDomain[]) =>
  domains.filter(d => d.parent_id === parentId)

const readSavedCheckedItems = () => {
  try {
    const cache = localStorage.getItem(CHECKED_STORAGE_KEY)
    const cacheVersion = localStorage.getItem(CHECKED_STORAGE_VERSION_KEY)
    if (!cache || cacheVersion !== CHECKED_STORAGE_VERSION) return null
    const parsed = JSON.parse(cache)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) return null
    return parsed as Record<string, boolean>
  } catch {
    return null
  }
}

const writeSavedCheckedItems = (checked: Record<string, boolean>) => {
  try {
    localStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(checked))
    localStorage.setItem(CHECKED_STORAGE_VERSION_KEY, CHECKED_STORAGE_VERSION)
  } catch { return }
}

const buildCheckedItems = (domainList: AccelerateDomain[]) => {
  const nextChecked: Record<string, boolean> = {}
  domainList.forEach((domain) => {
    nextChecked[domain.id] = Boolean(domain.enabled)
  })
  return nextChecked
}

const buildDefaultCheckedItems = (domainList: AccelerateDomain[]) => {
  const nextChecked: Record<string, boolean> = {}
  domainList.forEach((domain) => {
    nextChecked[domain.id] = DEFAULT_SAFE_ACCELERATOR_DOMAINS.has(domain.match_domain)
  })
  return nextChecked
}

const isEveryDomainChecked = (checked: Record<string, boolean>, domainList: AccelerateDomain[]) =>
  domainList.length > 0 && domainList.every((domain) => checked[domain.id] === true)

export function AcceleratorPage() {
  const [domains, setDomains] = useState<AccelerateDomain[]>([])
  const [resolved, setResolved] = useState<ResolvedMap>({})
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({})
  const [latencies, setLatencies] = useState<Record<string, { before: number | null; after: number | null } | null>>({})
  const [hasResidual, setHasResidual] = useState(false)
  const [proxyMode, setProxyMode] = useState<AcceleratorProxyMode>(null)

  const fetchDomains = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = DEFAULT_DOMAINS as AccelerateDomain[]
      const rawSavedChecked = readSavedCheckedItems()
      const shouldResetSavedChecked = rawSavedChecked && isEveryDomainChecked(rawSavedChecked, data)
      const savedChecked = shouldResetSavedChecked
        ? buildDefaultCheckedItems(data)
        : rawSavedChecked
      const mergedDomains = data.map((domain) => {
        const savedEnabled = savedChecked && typeof savedChecked[domain.id] === 'boolean'
          ? savedChecked[domain.id]
          : undefined
        return {
          ...domain,
          enabled: savedEnabled ?? DEFAULT_SAFE_ACCELERATOR_DOMAINS.has(domain.match_domain),
        }
      })
      const nextChecked = buildCheckedItems(mergedDomains)
      setDomains(mergedDomains)
      setCheckedItems(nextChecked)
      writeSavedCheckedItems(nextChecked)
      await window.electronAPI?.acceleratorSetDomains(mergedDomains)
    } catch (e) {
      setError("配置初始化失败：" + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDomains()
    const checkStatus = async () => {
      try {
        const has = await window.electronAPI?.acceleratorCheckHosts()
        if (has !== undefined) {
          setHasResidual(has)
          if (has) setRunning(true)
        }
        const s = await window.electronAPI?.acceleratorStatus()
        if (s) {
          setRunning(s.running)
          setResolved(s.resolved || {})
          setProxyMode(s.mode || null)
        }
      } catch {
        console.error("无法获取加速器状态")
      }
    }
    checkStatus()
  }, [fetchDomains])

  const updateCheckedItems = useCallback((next: Record<string, boolean>) => {
    const nextDomains = domains.map((domain) => ({
      ...domain,
      enabled: Boolean(next[domain.id]),
    }))
    setDomains(nextDomains)
    setCheckedItems(next)
    writeSavedCheckedItems(next)
    void window.electronAPI?.acceleratorSetDomains(nextDomains)
  }, [domains])

  const toggleSelectAll = useCallback(() => {
    const allChecked = domains.every(d => checkedItems[d.id])
    const next: Record<string, boolean> = {}
    domains.forEach(d => { next[d.id] = !allChecked })
    updateCheckedItems(next)
  }, [domains, checkedItems, updateCheckedItems])

  const toggleItem = useCallback((item: AccelerateDomain) => {
    const next = { ...checkedItems }
    const newVal = !next[item.id]
    next[item.id] = newVal

    const children = getChildren(item.id, domains)
    children.forEach(c => { next[c.id] = newVal })

    if (item.parent_id) {
      const siblings = getChildren(item.parent_id, domains)
      const allSiblingsChecked = siblings.every(s => s.id === item.id ? newVal : next[s.id])
      next[item.parent_id] = allSiblingsChecked
    }

    updateCheckedItems(next)
  }, [checkedItems, domains, updateCheckedItems])

  const getEnabledDomains = useCallback(() =>
    domains.filter(d => checkedItems[d.id] && !d.match_domain.includes("/")),
  [domains, checkedItems])

  const resolveAll = async () => {
    setResolving(true)
    try {
      const enabledDomains = getEnabledDomains()
      const result = await window.electronAPI?.acceleratorResolveAll(enabledDomains)
      if (result) {
        setResolved(prev => ({ ...prev, ...result }))
        const pingPromises = Object.entries(result).map(async ([domain, ip]) => {
          try {
            const both = await window.electronAPI?.acceleratorPingBoth(domain, ip)
            setLatencies(prev => ({ ...prev, [domain]: { before: both?.before ?? -1, after: both?.after ?? -1 } }))
          } catch {
            setLatencies(prev => ({ ...prev, [domain]: { before: -1, after: -1 } }))
          }
        })
        await Promise.allSettled(pingPromises)
      }
    } catch (e) {
      setError("测速遇到意外异常: " + (e as Error).message)
    } finally {
      setResolving(false)
    }
  }

  const startAccelerator = async () => {
    setStarting(true)
    setError(null)
    setNotice(null)
    const enabledDomains = getEnabledDomains()
    if (enabledDomains.length === 0) {
      setError("请至少选择一个加速项目")
      setStarting(false)
      return
    }
    try {
      const result = await window.electronAPI?.acceleratorStart(enabledDomains)
      if (result?.success) {
        setRunning(true)
        setHasResidual(true)
        setProxyMode(result.mode || null)
        if (result.hostsMap) setResolved(prev => ({ ...prev, ...result.hostsMap }))
        setNotice(result.warning || null)
      } else {
        setError(result?.error || "启动失败")
      }
    } catch (e) {
      setError("启动加速组件出错：" + (e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const stopAccelerator = async () => {
    setStarting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.electronAPI?.acceleratorStop()
      if (result?.success) {
        setRunning(false)
        setHasResidual(false)
        setResolved({})
        setProxyMode(null)
        setNotice(result.warning || null)
      } else {
        setError(result?.error || "停止失败")
      }
    } catch (e) {
      setError("停止加速组件出错：" + (e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const repairAccelerator = async () => {
    setRepairing(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.electronAPI?.acceleratorRepair()
      if (result?.success) {
        setRunning(false)
        setHasResidual(false)
        setResolved({})
        setProxyMode(null)
        setNotice(result.warning || null)
      } else {
        setError(result?.error || "网络修复失败")
      }
    } catch (e) {
      setError("网络修复出错：" + (e as Error).message)
    } finally {
      setRepairing(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    )
  }

  const rootItems = getRootItems(domains)
  const isCleanupMode = hasResidual && !running
  const proxyModeLabel = proxyMode === "system" ? "系统 PAC 代理" : proxyMode === "hosts" ? "hosts 兜底模式" : null
  const rootCheckedCount = rootItems.filter(d => checkedItems[d.id]).length
  const rootTotal = rootItems.length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className={`shrink-0 px-6 py-4 border-b border-zinc-700/30 ${running
        ? "bg-gradient-to-r from-emerald-950/40 to-zinc-900/80"
        : "bg-zinc-900/50"
        }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${running ? "bg-emerald-500/20" : "bg-zinc-700/40"}`}>
              {running
                ? <Zap className="w-6 h-6 text-emerald-400" />
                : <ZapOff className="w-6 h-6 text-zinc-500" />
              }
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {running ? "Steam 加速中" : "Steam 加速"}
              </h2>
              <p className="text-xs text-zinc-400">
                {running
                  ? `已加速 ${Object.keys(resolved).length} 个域名`
                  : "加速 Steam 社区/商店/图片等服务访问"
                }
              </p>
              {running && proxyModeLabel && (
                <p className="mt-1 text-[10px] text-emerald-300">
                  当前模式：{proxyModeLabel}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={resolveAll}
              disabled={resolving || running || repairing}
              className="px-3 py-2 rounded-lg bg-zinc-700/50 hover:bg-zinc-600/50 disabled:opacity-40 text-xs text-zinc-300 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${resolving ? "animate-spin" : ""}`} />
              测速
            </button>
            <button
              onClick={repairAccelerator}
              disabled={starting || repairing}
              className="px-3 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 disabled:opacity-40 text-xs text-amber-300 flex items-center gap-1.5 transition-colors"
            >
              {repairing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ZapOff className="w-3.5 h-3.5" />}
              网络修复
            </button>
            <button
              onClick={running || isCleanupMode ? stopAccelerator : startAccelerator}
              disabled={starting || repairing}
              className={`px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${running
                ? "bg-red-600/80 hover:bg-red-600 text-white"
                : isCleanupMode
                  ? "bg-amber-600 hover:bg-amber-500 text-white"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
                } disabled:opacity-50`}
            >
              {starting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : running || isCleanupMode ? (
                <ZapOff className="w-4 h-4" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {starting ? "处理中..." : running ? "停止加速" : isCleanupMode ? "清理残留" : "一键加速"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-zinc-300 text-xs flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 shrink-0" />
            {notice}
          </div>
        )}
        {hasResidual && !running && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 shrink-0" />
            检测到残留加速条目，建议点击"清理残留"或"网络修复"恢复系统网络
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-zinc-900/10">
        <div className="p-4">
          <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-lg bg-zinc-800/30 cursor-pointer w-fit"
            onClick={() => { if(!running) toggleSelectAll() }}>
            <button
              disabled={running}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${rootCheckedCount === rootTotal
                  ? "bg-blue-500 border-blue-500"
                  : rootCheckedCount > 0
                    ? "bg-blue-500 border-blue-500"
                    : "border-zinc-500 bg-transparent"
                } disabled:opacity-50`}
            >
              {rootCheckedCount === rootTotal ? <Check className="w-3.5 h-3.5 text-white" /> :
               rootCheckedCount > 0 ? <Square className="w-3.5 h-3.5 text-white" /> : null}
            </button>
            <span className="text-sm font-medium text-zinc-300 select-none">
              {rootCheckedCount === rootTotal ? "取消全选" : "全选 Steam 服务"}
            </span>
          </div>

          <div className="space-y-0.5">
            {rootItems.map(item => {
              const children = getChildren(item.id, domains)
              const isChecked = checkedItems[item.id]
              const ip = item.forward_ip || resolved[item.match_domain]
              const hasChildren = children.length > 0

              return (
                <div key={item.id}>
                  <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${hasChildren ? "bg-zinc-800/20" : "hover:bg-zinc-800/20"
                    }`}>
                    <button
                      onClick={() => toggleItem(item)}
                      disabled={running}
                      className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isChecked
                          ? "bg-blue-500 border-blue-500"
                          : "border-zinc-500 bg-transparent"
                        } disabled:opacity-50`}
                      style={{ width: 18, height: 18 }}
                    >
                      {isChecked && <Check className="w-3 h-3 text-white" />}
                    </button>

                    <div className="flex-1 min-w-0" onClick={() => { if(!hasChildren && !running) toggleItem(item) }}>
                      <span className={`text-sm cursor-pointer select-none ${hasChildren ? "font-medium text-zinc-200" : "text-zinc-300"}`}>
                        {item.name}
                      </span>
                    </div>

                    {ip && !hasChildren && (
                      <div className="flex items-center gap-2 shrink-0">
                        {latencies[item.match_domain] && (
                          <div className="flex items-center gap-1.5 mr-2">
                            <span className="text-[10px] text-red-400">
                              加速前 {latencies[item.match_domain]!.before === -1 ? '超时' : `${latencies[item.match_domain]!.before}ms`}
                            </span>
                            <span className="text-[10px] text-zinc-700">→</span>
                            <span className={`text-[11px] font-medium ${latencies[item.match_domain]!.after === -1 ? 'text-red-400'
                                : (latencies[item.match_domain]!.after! < 100 ? 'text-emerald-400' : 'text-amber-400')
                              }`}>
                              加速后 {latencies[item.match_domain]!.after === -1 ? '超时' : `${latencies[item.match_domain]!.after}ms`}
                            </span>
                          </div>
                        )}
                        <span className="text-[11px] font-mono text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded select-all">
                          {ip}
                        </span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      </div>
                    )}
                  </div>

                  {hasChildren && children.map(child => {
                    const childChecked = checkedItems[child.id]
                    const childIp = child.forward_ip || resolved[child.match_domain]
                    return (
                      <div
                        key={child.id}
                        className="flex items-center gap-3 pl-10 pr-3 py-2 hover:bg-zinc-800/20 rounded-lg transition-colors cursor-pointer"
                        onClick={() => { if(!running) toggleItem(child) }}
                      >
                        <button
                          disabled={running}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${childChecked
                              ? "bg-blue-500 border-blue-500"
                              : "border-zinc-500 bg-transparent"
                            } disabled:opacity-50`}
                        >
                          {childChecked && <Check className="w-2.5 h-2.5 text-white" />}
                        </button>
                        <span className="flex-1 text-sm text-zinc-400 select-none">{child.name}</span>
                        {childIp && (
                          <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                            {latencies[child.match_domain] && (
                              <div className="flex items-center gap-1.5 mr-2">
                                <span className="text-[10px] text-red-400">
                                  加速前 {latencies[child.match_domain]!.before === -1 ? '超时' : `${latencies[child.match_domain]!.before}ms`}
                                </span>
                                <span className="text-[10px] text-zinc-700">→</span>
                                <span className={`text-[11px] font-medium ${latencies[child.match_domain]!.after === -1 ? 'text-red-400'
                                    : (latencies[child.match_domain]!.after! < 100 ? 'text-emerald-400' : 'text-amber-400')
                                  }`}>
                                  加速后 {latencies[child.match_domain]!.after === -1 ? '超时' : `${latencies[child.match_domain]!.after}ms`}
                                </span>
                              </div>
                            )}
                            <span className="text-[11px] font-mono text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded select-all">
                              {childIp}
                            </span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
