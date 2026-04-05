import { useCallback, useEffect, useState, useMemo } from "react"
import { DEFAULT_DOMAINS } from "@/lib/accelerate-domains"
import {
  Zap, ZapOff, RefreshCw, CheckCircle2, XCircle,
  Loader2, Shield, ChevronDown, ChevronRight, Check, Minus, Globe
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

const GROUP_LABELS: Record<string, string> = {
  steam: "Steam 服务",
  twitch: "Twitch 直播",
  origin: "Origin",
  uplay: "Uplay",
  public_cdn: "公共 CDN",
  captcha: "国外验证码平台",
  github: "GitHub",
  nexusmods: "Nexus Mods",
  docker: "Docker Hub",
  greasyfork: "Greasyfork",
  fandom: "Fandom",
}

const GROUP_BRAND_ICONS: Record<string, string> = {
  steam: "https://cdn.simpleicons.org/steam/66c0f4",
  twitch: "https://cdn.simpleicons.org/twitch/a970ff",
  origin: "https://cdn.simpleicons.org/origin/f56c2d",
  uplay: "https://cdn.simpleicons.org/ubisoft/00b4ff",
  github: "https://cdn.simpleicons.org/github/ffffff",
  docker: "https://cdn.simpleicons.org/docker/2496ed",
  greasyfork: "https://cdn.simpleicons.org/greasyfork/e31c25",
  fandom: "https://cdn.simpleicons.org/fandom/00d6d6",
}

const GROUP_ORDER = [
  "steam",
  "github",
  "twitch",
  "origin",
  "uplay",
  "public_cdn",
  "captcha",
  "nexusmods",
  "docker",
  "greasyfork",
  "fandom",
]

// 提取辅助函数以避免每次渲染时重建
const getRootItems = (groupDomains: AccelerateDomain[]) =>
  groupDomains.filter(d => !d.parent_id)

const getChildren = (parentId: string, groupDomains: AccelerateDomain[]) =>
  groupDomains.filter(d => d.parent_id === parentId)

export function AcceleratorPage() {
  const [domains, setDomains] = useState<AccelerateDomain[]>([])
  const [resolved, setResolved] = useState<ResolvedMap>({})
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({})
  const [latencies, setLatencies] = useState<Record<string, { before: number | null; after: number | null } | null>>({})
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [hasResidual, setHasResidual] = useState(false)

  // 1. 初始化
  const fetchDomains = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = DEFAULT_DOMAINS as AccelerateDomain[]
      setDomains(data)
      await window.electronAPI?.acceleratorSetDomains(data)

      let savedChecked: Record<string, boolean> | null = null
      try {
        const cache = localStorage.getItem('mmd_accelerator_checked')
        if (cache) {
          const parsed = JSON.parse(cache)
          // 加强类型防御
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
            savedChecked = parsed
          }
        }
      } catch (err) {
        console.warn("解析本地缓存失败，回退到默认设置", err)
      }

      if (savedChecked) {
        setCheckedItems(savedChecked)
      } else {
        const defaultChecked: Record<string, boolean> = {}
        data.forEach((d) => {
          defaultChecked[d.id] = d.group_name === "github" || d.group_name === "steam"
        })
        setCheckedItems(defaultChecked)
        localStorage.setItem('mmd_accelerator_checked', JSON.stringify(defaultChecked))
      }
      setSelectedGroup("steam")
    } catch (e) {
      setError("配置初始化失败：" + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  // 2. 状态获取，增加 .catch 捕获异常
  useEffect(() => {
    fetchDomains()
    
    // 捕获异步异常
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
        }
      } catch (err) {
        console.error("无法获取加速器状态:", err)
      }
    }
    
    checkStatus()
  }, [fetchDomains])

  // 3. 性能优化：缓存高开销分组操作
  const { groups, sortedGroupNames } = useMemo(() => {
    const accGroups = domains.reduce<Record<string, AccelerateDomain[]>>((acc, d) => {
      if (!acc[d.group_name]) acc[d.group_name] = []
      acc[d.group_name].push(d)
      return acc
    }, {})
    const sortedNames = GROUP_ORDER.filter(g => accGroups[g])
    return { groups: accGroups, sortedGroupNames: sortedNames }
  }, [domains])

  const getGroupCheckState = useCallback((groupName: string): "all" | "partial" | "none" => {
    const items = groups[groupName] || []
    if (items.length === 0) return "none"
    const checked = items.filter(d => checkedItems[d.id])
    if (checked.length === 0) return "none"
    if (checked.length === items.length) return "all"
    return "partial"
  }, [groups, checkedItems])

  const updateCheckedItems = useCallback((next: Record<string, boolean>) => {
    setCheckedItems(next)
    localStorage.setItem('mmd_accelerator_checked', JSON.stringify(next))
  }, [])

  const toggleGroupCheck = useCallback((groupName: string) => {
    const items = groups[groupName] || []
    const state = getGroupCheckState(groupName)
    const next = { ...checkedItems }
    const newVal = state !== "all"
    items.forEach(d => { next[d.id] = newVal })
    updateCheckedItems(next)
  }, [groups, checkedItems, getGroupCheckState, updateCheckedItems])

  const toggleItem = useCallback((item: AccelerateDomain) => {
    const next = { ...checkedItems }
    const newVal = !next[item.id]
    next[item.id] = newVal
    
    // 级联子项
    const children = getChildren(item.id, domains)
    children.forEach(c => { next[c.id] = newVal })
    
    // 修复子节点改动影响父节点的逻辑：部分选定或未选定一律将父节点设为false
    if (item.parent_id) {
      const siblings = getChildren(item.parent_id, domains)
      const allSiblingsChecked = siblings.every(s => s.id === item.id ? newVal : next[s.id])
      next[item.parent_id] = allSiblingsChecked
    }
    
    updateCheckedItems(next)
  }, [checkedItems, domains, updateCheckedItems])

  // 获取勾选的域名列表
  const getEnabledDomains = useCallback(() => 
    domains.filter(d => checkedItems[d.id] && !d.match_domain.includes("/")),
  [domains, checkedItems])

  // 4. 重构测速逻辑，使用 Promise.allSettled 避免测速按钮状态过早重置
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
        if (result.hostsMap) setResolved(prev => ({ ...prev, ...result.hostsMap }))
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
    try {
      const result = await window.electronAPI?.acceleratorStop()
      if (result?.success) {
        setRunning(false)
        setHasResidual(false)
        setResolved({})
      } else {
        setError(result?.error || "停止失败")
      }
    } catch (e) {
      setError("停止加速组件出错：" + (e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    )
  }

  const currentGroupDomains = selectedGroup ? (groups[selectedGroup] || []) : []
  const rootItems = getRootItems(currentGroupDomains)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部操作栏 */}
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
                {running ? "加速中" : "网络加速"}
              </h2>
              <p className="text-xs text-zinc-400">
                {running
                  ? `已加速 ${Object.keys(resolved).length} 个域名`
                  : "加速 GitHub、Steam、Nexus Mods 等站点访问"
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={resolveAll}
              disabled={resolving || running}
              className="px-3 py-2 rounded-lg bg-zinc-700/50 hover:bg-zinc-600/50 disabled:opacity-40 text-xs text-zinc-300 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${resolving ? "animate-spin" : ""}`} />
              测速
            </button>
            <button
              onClick={running ? stopAccelerator : startAccelerator}
              disabled={starting}
              className={`px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${running
                ? "bg-red-600/80 hover:bg-red-600 text-white"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
                } disabled:opacity-50`}
            >
              {starting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : running ? (
                <ZapOff className="w-4 h-4" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {starting ? "处理中..." : running ? "停止加速" : "一键加速"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}
        {hasResidual && !running && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 shrink-0" />
            检测到残留加速条目，建议点击"停止加速"清理
          </div>
        )}
      </div>

      {/* 主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧 */}
        <div className="w-64 shrink-0 border-r border-zinc-700/30 overflow-y-auto bg-zinc-900/30">
          <div className="p-2 space-y-0.5">
            {sortedGroupNames.map(groupName => {
              const checkState = getGroupCheckState(groupName)
              const isActive = selectedGroup === groupName
              const items = groups[groupName] || []
              const checkedCount = items.filter(d => checkedItems[d.id]).length
              const brandUrl = GROUP_BRAND_ICONS[groupName]

              return (
                <div
                  key={groupName}
                  onClick={() => setSelectedGroup(groupName)}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-all ${isActive
                    ? "bg-zinc-700/50 border border-zinc-600/40"
                    : "hover:bg-zinc-800/50 border border-transparent"
                    }`}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleGroupCheck(groupName) }}
                    disabled={running}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${checkState === "all"
                        ? "bg-blue-500 border-blue-500"
                        : checkState === "partial"
                          ? "bg-blue-500 border-blue-500"
                          : "border-zinc-500 bg-transparent"
                      } disabled:opacity-50`}
                  >
                    {checkState === "all" && <Check className="w-3.5 h-3.5 text-white" />}
                    {checkState === "partial" && <Minus className="w-3.5 h-3.5 text-white" />}
                  </button>

                  <div className={`w-7 h-7 rounded shrink-0 flex items-center justify-center border ${
                    isActive ? "bg-zinc-800 border-zinc-600/50" : "bg-zinc-800/50 border-zinc-700/30"
                  }`}>
                    {brandUrl ? (
                      <img 
                        src={brandUrl} 
                        alt={groupName} 
                        className={`w-3.5 h-3.5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-40'}`} 
                        style={{ filter: isActive ? 'drop-shadow(0 0 6px rgba(255,255,255,0.25))' : 'none' }}
                      />
                    ) : (
                      <Globe className={`w-3.5 h-3.5 ${isActive ? "text-zinc-200" : "text-zinc-500"}`} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${isActive ? "text-white" : "text-zinc-300"}`}>
                      {GROUP_LABELS[groupName] || groupName}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {checkedCount}/{items.length} 项已选
                    </div>
                  </div>

                  <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform ${isActive ? "text-zinc-300" : ""}`} />
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧 */}
        <div className="flex-1 overflow-y-auto bg-zinc-900/10">
          {selectedGroup ? (
            <div className="p-4">
              <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-lg bg-zinc-800/30 cursor-pointer w-fit" onClick={() => { if(!running) toggleGroupCheck(selectedGroup) }}>
                <button
                  disabled={running}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${getGroupCheckState(selectedGroup) === "all"
                      ? "bg-blue-500 border-blue-500"
                      : getGroupCheckState(selectedGroup) === "partial"
                        ? "bg-blue-500 border-blue-500"
                        : "border-zinc-500 bg-transparent"
                    } disabled:opacity-50`}
                >
                  {getGroupCheckState(selectedGroup) === "all" && <Check className="w-3.5 h-3.5 text-white" />}
                  {getGroupCheckState(selectedGroup) === "partial" && <Minus className="w-3.5 h-3.5 text-white" />}
                </button>
                <span className="text-sm font-medium text-zinc-300 select-none">全部启用该分类</span>
              </div>

              <div className="space-y-0.5">
                {rootItems.map(item => {
                  const children = getChildren(item.id, currentGroupDomains)
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
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
              <div className="text-center">
                <ChevronDown className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>选择左侧分组查看细项</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底栏 */}
      <div className="shrink-0 px-6 py-2.5 border-t border-zinc-700/30 bg-zinc-900/50">
        <p className="text-[11px] text-zinc-600">
          基于本地特权 HTTPS 代理与 SNI 伪装无缝绕过深度连接阻断。不会干扰系统全局网络，不产生安全污染。
        </p>
      </div>
    </div>
  )
}
