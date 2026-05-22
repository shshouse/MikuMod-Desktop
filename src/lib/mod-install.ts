import { fetchModDetail, getDownloadToken } from "@/lib/api"
import type { ModDetailSummary, ModDependencySummary } from "@/lib/api"
import { listManagedMods, installManagedMod } from "@/lib/mod-manager"
import type { ManagedModSummary } from "@/lib/mod-manager"
import { useDownloadStore } from "@/store/download"
import { showToast } from "@/lib/toast"
import { showConfirm } from "@/lib/confirm"

function formatSize(bytes?: number | null) {
  return bytes ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : "未知"
}

function originalFileName(fileName?: string) {
  const ext = fileName?.match(/\.(zip|rar|7z)$/i)?.[0] || ".zip"
  return `original${ext.toLowerCase()}`
}

async function queueDownload(input: {
  modId: string
  modNumber?: string | number | null
  title: string
  gameId: string
  gameName: string
  gamePath: string
  versionId?: string
  autoInstallAfterTaskIds?: string[]
}) {
  const token = await getDownloadToken(input.modId, input.versionId)
  const taskId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const result = await useDownloadStore.getState().addDownload({
    id: taskId,
    name: input.title,
    gameId: input.gameId,
    game: input.gameName,
    url: token.url,
    fileName: originalFileName(token.fileName),
    archiveFileName: token.fileName,
    size: formatSize(token.fileSize),
    platformModId: input.modId,
    platformVersionId: input.versionId,
    modNumber: input.modNumber ? String(input.modNumber) : undefined,
    autoInstallGamePath: input.gamePath,
    autoInstallAfterTaskIds: input.autoInstallAfterTaskIds,
  })
  return result?.taskId ?? taskId
}

export interface OneClickInstallInput {
  detail: { mod: ModDetailSummary; versions: { id: string }[] }
  selectedVersionId?: string | null
  resolveGamePath: (gameId: string) => Promise<string | null | undefined>
}

export type OneClickInstallResult = { status: "ok" | "cancelled" }

export async function queueOneClickInstall({ detail, selectedVersionId, resolveGamePath }: OneClickInstallInput): Promise<OneClickInstallResult> {
  const { mod, versions } = detail
  const gameId = mod.game?.id || mod.game_id
  const gameName = mod.game?.name || "未知游戏"
  if (!gameId) throw new Error("模组缺少游戏信息")
  const gamePath = await resolveGamePath(gameId)
  if (!gamePath) return { status: "cancelled" }
  const deps = (mod.dependencies || []).filter((d: ModDependencySummary) => d.dependency_type === "required" && d.mod_id)
  let managed: ManagedModSummary[] = []
  try { managed = await listManagedMods(gameId, gameName) } catch { /* empty */ }
  const managedByPlatformId = new Map(managed.filter((m) => m.platformModId).map((m) => [m.platformModId!, m]))
  const needInstall: ManagedModSummary[] = []
  const needDownload: ModDependencySummary[] = []
  for (const dep of deps) {
    const local = managedByPlatformId.get(dep.mod_id)
    if (local?.installed) continue
    if (local && !local.installed) { needInstall.push(local); continue }
    needDownload.push(dep)
  }
  const missing = [...needInstall.map((m) => m.name), ...needDownload.map((d) => d.title || d.mod_id)]
  if (missing.length > 0) {
    const confirmed = await showConfirm({
      title: "前置模组未安装",
      message: `该模组有 ${missing.length} 个前置模组未安装:\n${missing.join("\n")}\n\n是否一并下载并安装?`,
      confirmText: "一并安装",
      cancelText: "取消",
    })
    if (!confirmed) return { status: "cancelled" }
  }
  for (const local of needInstall) {
    const result = await installManagedMod({ gameId, gameName, modId: local.id, gamePath })
    if (!result.ok) throw new Error(result.error || `前置模组安装失败: ${local.name}`)
  }
  const depTaskIds: string[] = []
  for (const dep of needDownload) {
    const tid = await queueDownload({ modId: dep.mod_id, modNumber: dep.mod_number, title: dep.title || dep.mod_id, gameId, gameName, gamePath })
    depTaskIds.push(tid)
  }
  await queueDownload({
    modId: mod.id,
    modNumber: mod.mod_number,
    title: mod.title,
    gameId,
    gameName,
    gamePath,
    versionId: selectedVersionId || versions[0]?.id,
    autoInstallAfterTaskIds: depTaskIds.length > 0 ? depTaskIds : undefined,
  })
  showToast({ message: needDownload.length > 0 ? `已加入下载队列 (含 ${needDownload.length} 个前置)，完成后自动安装` : "已加入下载队列，完成后自动安装", type: "success" })
  return { status: "ok" }
}

export async function queueOneClickInstallByModNumber(input: {
  modNumber: string | number
  resolveGamePath: (gameId: string) => Promise<string | null | undefined>
}) {
  const detail = await fetchModDetail(String(input.modNumber))
  if (!detail) throw new Error("模组不存在或未通过审核")
  return queueOneClickInstall({ detail, resolveGamePath: input.resolveGamePath })
}

export function showOneClickInstallError(error: unknown) {
  const msg = error instanceof Error ? error.message : "未知错误"
  showToast({ message: `安装失败: ${msg}`, type: "error" })
}
