import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
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
  steam: "https://cdn.simpleicons.org/steam/66c0f4",     // Steam 经典亮蓝
  twitch: "https://cdn.simpleicons.org/twitch/a970ff",   // Twitch 亮紫色
  origin: "https://cdn.simpleicons.org/origin/f56c2d",   // Origin 橙色
  uplay: "https://cdn.simpleicons.org/ubisoft/00b4ff",   // Ubisoft 蓝色
  github: "https://cdn.simpleicons.org/github/ffffff",   // 夜间模式下 Github 保持纯白最清晰
  docker: "https://cdn.simpleicons.org/docker/2496ed",   // Docker 蓝
  greasyfork: "https://cdn.simpleicons.org/greasyfork/e31c25", // 红色
  fandom: "https://cdn.simpleicons.org/fandom/00d6d6",   // Fandom 青色
}

const GROUP_ORDER = [
  "steam",
  "twitch",
  "origin",
  "uplay",
  "public_cdn",
  "captcha",
  "github",
  "nexusmods",
  "docker",
  "greasyfork",
  "fandom",
]

export function AcceleratorPage() {
  const [domains, setDomains] = useState<AccelerateDomain[]>([])
  const [resolved, setResolved] = useState<ResolvedMap>({})
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 记录每个域名的勾选状态（id -> boolean）
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({})
  const [latencies, setLatencies] = useState<Record<string, { before: number | null; after: number | null } | null>>({})
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [hasResidual, setHasResidual] = useState(false)

  // 初始化
  const fetchDomains = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchErr } = await supabase
        .from("accelerate_domains")
        .select("*")
        .eq("enabled", true)
        .order("group_name")
        .order("sort_order")

      if (fetchErr) throw fetchErr

      if (data && data.length > 0) {
        setDomains(data)
        await window.electronAPI?.acceleratorSetDomains(data)

        let savedChecked: Record<string, boolean> | null = null
        try {
          const cache = localStorage.getItem('mmd_accelerator_checked')
          if (cache) savedChecked = JSON.parse(cache)
        } catch {}

        if (savedChecked && Object.keys(savedChecked).length > 0) {
          setCheckedItems(savedChecked)
        } else {
          // 默认全选 github 和 steam
          const defaultChecked: Record<string, boolean> = {}
          data.forEach((d: AccelerateDomain) => {
            defaultChecked[d.id] = d.group_name === "github" || d.group_name === "steam"
          })
          setCheckedItems(defaultChecked)
          localStorage.setItem('mmd_accelerator_checked', JSON.stringify(defaultChecked))
        }
        setSelectedGroup("steam")
      } else {
        const cached = await window.electronAPI?.acceleratorGetDomains()
        if (cached?.length) {
          const items = cached as AccelerateDomain[]
          setDomains(items)
          
          let savedChecked: Record<string, boolean> | null = null
          try {
            const cacheStr = localStorage.getItem('mmd_accelerator_checked')
            if (cacheStr) savedChecked = JSON.parse(cacheStr)
          } catch {}

          if (savedChecked && Object.keys(savedChecked).length > 0) {
            setCheckedItems(savedChecked)
          } else {
            const defaultChecked: Record<string, boolean> = {}
            items.forEach((d) => { defaultChecked[d.id] = true })
            setCheckedItems(defaultChecked)
          }
        }
      }
    } catch {
      const cached = await window.electronAPI?.acceleratorGetDomains()
      if (cached?.length) {
        const items = cached as AccelerateDomain[]
        setDomains(items)
        
        let savedChecked: Record<string, boolean> | null = null
        try {
          const cacheStr = localStorage.getItem('mmd_accelerator_checked')
          if (cacheStr) savedChecked = JSON.parse(cacheStr)
        } catch {}

        if (savedChecked && Object.keys(savedChecked).length > 0) {
          setCheckedItems(savedChecked)
        } else {
          const defaultChecked: Record<string, boolean> = {}
          items.forEach((d) => { defaultChecked[d.id] = true })
          setCheckedItems(defaultChecked)
        }
      } else {
        setError("无法获取加速配置，请检查网络")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDomains()
    window.electronAPI?.acceleratorCheckHosts().then((has: boolean) => {
      setHasResidual(has)
      if (has) setRunning(true)
    })
    window.electronAPI?.acceleratorStatus().then((s: { running: boolean; resolved: ResolvedMap }) => {
      if (s) {
        setRunning(s.running)
        setResolved(s.resolved || {})
      }
    })
  }, [fetchDomains])

  // 按分组整理
  const groups = domains.reduce<Record<string, AccelerateDomain[]>>((acc, d) => {
    if (!acc[d.group_name]) acc[d.group_name] = []
    acc[d.group_name].push(d)
    return acc
  }, {})

  const sortedGroupNames = GROUP_ORDER.filter(g => groups[g])

  // 获取分组内的根项（无 parent_id 的）和子项
  const getRootItems = (groupDomains: AccelerateDomain[]) =>
    groupDomains.filter(d => !d.parent_id)
  const getChildren = (parentId: string, groupDomains: AccelerateDomain[]) =>
    groupDomains.filter(d => d.parent_id === parentId)

  // 分组勾选状态：全选 / 部分选 / 未选
  const getGroupCheckState = (groupName: string): "all" | "partial" | "none" => {
    const items = groups[groupName] || []
    const checked = items.filter(d => checkedItems[d.id])
    if (checked.length === 0) return "none"
    if (checked.length === items.length) return "all"
    return "partial"
  }

  // 统一更新状态和缓存
  const updateCheckedItems = (next: Record<string, boolean>) => {
    setCheckedItems(next)
    localStorage.setItem('mmd_accelerator_checked', JSON.stringify(next))
  }

  // 切换整个分组
  const toggleGroupCheck = (groupName: string) => {
    const items = groups[groupName] || []
    const state = getGroupCheckState(groupName)
    const next = { ...checkedItems }
    const newVal = state !== "all"
    items.forEach(d => { next[d.id] = newVal })
    updateCheckedItems(next)
  }

  // 切换单个项目（含级联子项）
  const toggleItem = (item: AccelerateDomain) => {
    const next = { ...checkedItems }
    const newVal = !next[item.id]
    next[item.id] = newVal
    // 级联子项
    const children = getChildren(item.id, domains)
    children.forEach(c => { next[c.id] = newVal })
    // 如果是子项，检查父级状态
    if (item.parent_id) {
      const siblings = getChildren(item.parent_id, domains)
      const allChecked = siblings.every(s => s.id === item.id ? newVal : next[s.id])
      const noneChecked = siblings.every(s => s.id === item.id ? !newVal : !next[s.id])
      // 保持父级与子项同步
      if (noneChecked) next[item.parent_id] = false
      else if (allChecked) next[item.parent_id] = true
    }
    updateCheckedItems(next)
  }

  // 获取勾选的域名列表（用于写 hosts）
  const getEnabledDomains = () =>
    domains.filter(d => checkedItems[d.id] && !d.match_domain.includes("/"))

  // DoH 解析
  const resolveAll = async () => {
    setResolving(true)
    const enabledDomains = getEnabledDomains()
    const result = await window.electronAPI?.acceleratorResolveAll(enabledDomains)
    if (result) {
      setResolved(prev => ({ ...prev, ...result }))

      // 并发双向 Ping 测速
      Object.entries(result).forEach(async ([domain, ip]) => {
        try {
          const both = await window.electronAPI?.acceleratorPingBoth(domain, ip)
          setLatencies(prev => ({ ...prev, [domain]: { before: both?.before ?? -1, after: both?.after ?? -1 } }))
        } catch {
          setLatencies(prev => ({ ...prev, [domain]: { before: -1, after: -1 } }))
        }
      })
    }
    setResolving(false)
  }

  // 启动
  const startAccelerator = async () => {
    setStarting(true)
    setError(null)
    const enabledDomains = getEnabledDomains()
    if (enabledDomains.length === 0) {
      setError("请至少选择一个加速项目")
      setStarting(false)
      return
    }
    const result = await window.electronAPI?.acceleratorStart(enabledDomains)
    if (result?.success) {
      setRunning(true)
      setHasResidual(true)
      if (result.hostsMap) setResolved(prev => ({ ...prev, ...result.hostsMap }))
    } else {
      setError(result?.error || "启动失败")
    }
    setStarting(false)
  }

  // 停止
  const stopAccelerator = async () => {
    setStarting(true)
    const result = await window.electronAPI?.acceleratorStop()
    if (result?.success) {
      setRunning(false)
      setHasResidual(false)
      setResolved({})
    } else {
      setError(result?.error || "停止失败")
    }
    setStarting(false)
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

      {/* 主体：左侧分组列表 + 右侧细项 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧分组列表 */}
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
                  {/* 三态勾选框 */}
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

        {/* 右侧细项列表 */}
        <div className="flex-1 overflow-y-auto bg-zinc-900/10">
          {selectedGroup ? (
            <div className="p-4">
              {/* 全部启用按钮 */}
              <div className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-lg bg-zinc-800/30">
                <button
                  onClick={() => toggleGroupCheck(selectedGroup)}
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
                <span className="text-sm font-medium text-zinc-300">全部启用</span>
              </div>

              {/* 域名项 */}
              <div className="space-y-0.5">
                {rootItems.map(item => {
                  const children = getChildren(item.id, currentGroupDomains)
                  const isChecked = checkedItems[item.id]
                  const ip = item.forward_ip || resolved[item.match_domain]
                  const hasChildren = children.length > 0

                  return (
                    <div key={item.id}>
                      {/* 父项 */}
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

                        <div className="flex-1 min-w-0">
                          <span className={`text-sm ${hasChildren ? "font-medium text-zinc-200" : "text-zinc-300"}`}>
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
                            <span className="text-[11px] font-mono text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded">
                              {ip}
                            </span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          </div>
                        )}
                      </div>

                      {/* 子项 */}
                      {hasChildren && children.map(child => {
                        const childChecked = checkedItems[child.id]
                        const childIp = child.forward_ip || resolved[child.match_domain]
                        return (
                          <div
                            key={child.id}
                            className="flex items-center gap-3 pl-10 pr-3 py-2 hover:bg-zinc-800/20 rounded-lg transition-colors"
                          >
                            <button
                              onClick={() => toggleItem(child)}
                              disabled={running}
                              className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${childChecked
                                  ? "bg-blue-500 border-blue-500"
                                  : "border-zinc-500 bg-transparent"
                                } disabled:opacity-50`}
                            >
                              {childChecked && <Check className="w-2.5 h-2.5 text-white" />}
                            </button>
                            <span className="flex-1 text-sm text-zinc-400">{child.name}</span>
                            {childIp && (
                              <div className="flex items-center gap-2 shrink-0">
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
                                <span className="text-[11px] font-mono text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded">
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

      {/* 底栏说明 */}
      <div className="shrink-0 px-6 py-2.5 border-t border-zinc-700/30 bg-zinc-900/50">
        <p className="text-[11px] text-zinc-600">
          通过 DoH 解析获取域名真实 IP，写入系统 hosts 文件绕过 DNS 污染。启动需管理员权限。不使用任何代理服务器，所有流量直连。
        </p>
      </div>
    </div>
  )
}
