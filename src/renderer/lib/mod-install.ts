import { fetchModDetail, getDownloadToken } from "@/lib/api"
import type { ModDetailSummary, ModDependencySummary, ModVersionSummary } from "@/lib/api"
import { listManagedMods, installManagedMod } from "@/lib/mod-manager"
import type { ManagedModSummary } from "@/lib/mod-manager"
import { useDownloadStore, XXMI_IMPORT_MARKER } from "@/store/download"
import { showToast } from "@/lib/toast"
import { showConfirm } from "@/lib/confirm"

const XXMI_GAME_ID = "__xxmi__"
const XXMI_GAME_NAME = "XXMI"

function formatSize(bytes?: number | null) {
  return bytes ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : "未知"
}

async function queueDownload(input: {
  modId: string
  modNumber?: string | number | null
  title: string
  gameId: string
  gameName: string
  versionId?: string
  versionString?: string
  autoInstallAfterTaskIds?: string[]
  /** 下载保存目录路径，不填则走默认逻辑 */
  saveDir?: string
}) {
  const token = await getDownloadToken(input.modId, input.versionId)
  const platformModId: string | undefined = input.modId
  const isXxmi = input.gameId === XXMI_GAME_ID || String(input.modNumber) === "9"
  const saveDirMarker = isXxmi ? XXMI_IMPORT_MARKER : input.saveDir

  const taskId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const result = await useDownloadStore.getState().addDownload({
    id: taskId,
    name: input.title,
    gameId: input.gameId,
    game: input.gameName,
    url: token.url,
    // ponytail: XXMI 下载保存为 original.<ext>, 其他保留原名
    fileName: isXxmi
      ? `original${(token.fileName?.match(/\.(zip|rar|7z)$/i)?.[0] || '.zip').toLowerCase()}`
      : token.fileName,
    archiveFileName: token.fileName,
    size: formatSize(token.fileSize),
    platformModId,
    platformVersionId: input.versionId,
    modNumber: input.modNumber ? String(input.modNumber) : undefined,
    versionString: input.versionString,
    autoInstallGamePath: saveDirMarker,
    autoInstallAfterTaskIds: input.autoInstallAfterTaskIds,
  })
  return result?.taskId ?? taskId
}

export interface OneClickInstallInput {
  detail: { mod: ModDetailSummary; versions: ModVersionSummary[] }
  selectedVersionId?: string | null
  resolveGamePath: (gameId: string) => Promise<string | null | undefined>
}

export type OneClickInstallResult = { status: "ok" | "cancelled" }

export async function queueOneClickInstall({ detail, selectedVersionId, resolveGamePath }: OneClickInstallInput): Promise<OneClickInstallResult> {
  const { mod, versions } = detail

  // ponytail: modNumber=9 是 XXMI 框架包, 走 XXMI 导入, 不走普通 mod 安装
  // API 返回 mod_number 是数字, 必须用 String() 统一类型
  if (String(mod.mod_number) === "9") {
    const result = await queueXxmiInstall({ detail, selectedVersionId })
    return { status: result.status === "ok" ? "ok" : "cancelled" }
  }

  const gameId = mod.game?.id || mod.game_id
  const gameName = mod.game?.name || "未知游戏"
  if (!gameId) throw new Error("模组缺少游戏信息")
  const gamePath = await resolveGamePath(gameId)
  if (!gamePath) return { status: "cancelled" }
  // ponytail: 查 versionString 用于版本分层目录
  const selectedVersion = versions.find((v) => v.id === (selectedVersionId || versions[0]?.id)) || versions[0]
  const versionString = selectedVersion?.version || undefined
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
    const isXxmiDep = String(dep.mod_number) === "9"
    const tid = await queueDownload({
      modId: dep.mod_id,
      modNumber: dep.mod_number,
      title: dep.title || dep.mod_id,
      gameId: isXxmiDep ? XXMI_GAME_ID : gameId,
      gameName: isXxmiDep ? XXMI_GAME_NAME : gameName,
      versionId: undefined,
      versionString: undefined,
      saveDir: isXxmiDep ? undefined : gamePath,
    })
    depTaskIds.push(tid)
  }
  await queueDownload({
    modId: mod.id,
    modNumber: mod.mod_number,
    title: mod.title,
    gameId,
    gameName,
    versionId: selectedVersionId || versions[0]?.id,
    versionString,
    saveDir: gamePath,
    autoInstallAfterTaskIds: depTaskIds.length > 0 ? depTaskIds : undefined,
  })
  showToast({ message: needDownload.length > 0 ? `已加入下载队列 (含 ${needDownload.length} 个前置)，完成后自动安装` : "已加入下载队列，完成后自动安装", type: "success" })
  return { status: "ok" }
}

export async function queueXxmiInstall(input: {
  detail: { mod: ModDetailSummary; versions: ModVersionSummary[] }
  selectedVersionId?: string | null
}): Promise<{ status: "ok" | "cancelled" | "already_installed" }> {
  const { mod, versions } = input.detail
  const deps = (mod.dependencies || []).filter((d: ModDependencySummary) => d.dependency_type === "required" && d.mod_id)
  if (deps.length > 0) {
    showToast({ message: "XXMI 包含前置模组，请通过普通安装流程安装", type: "info" })
    return { status: "cancelled" }
  }
  const managed = await listManagedMods(XXMI_GAME_ID, XXMI_GAME_NAME).catch(() => [])
  const local = managed.find((m) => m.platformModId === mod.id)
  if (local?.installed) {
    showToast({ message: "XXMI 已安装", type: "info" })
    return { status: "already_installed" }
  }
  await queueDownload({
    modId: mod.id,
    modNumber: mod.mod_number,
    title: mod.title,
    gameId: XXMI_GAME_ID,
    gameName: XXMI_GAME_NAME,
    versionId: input.selectedVersionId || versions[0]?.id,
    versionString: (versions.find((v) => v.id === (input.selectedVersionId || versions[0]?.id)) || versions[0])?.version || undefined,
  })
  showToast({ message: "已加入下载队列，下载完成后自动导入", type: "success" })
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
