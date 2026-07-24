export const STATE_VERSION = 1
export const JUNK_NAMES = new Set(['Thumbs.db', 'desktop.ini', '.DS_Store'])
export const SKIPPED_INSTALL_FILENAMES = new Set(['license.txt', 'readme.txt'])
export const ARCHIVE_EXTENSION_PATTERN = /(\.tar\.gz|\.tgz|\.zip|\.rar|\.7z|\.tar|\.gz)$/i

// ponytail: manifest 构建时要排除的管理文件 (非 mod 内容)
// original.* = 原压缩包备份 (importExternalMod 写入); manifest.json = 状态文件; _system = 保留目录
export const MANIFEST_BUILD_EXCLUDE_FILES = new Set(['manifest.json'])
export const MANIFEST_BUILD_EXCLUDE_FILE_PREFIXES = ['original.']
export const MANIFEST_BUILD_EXCLUDE_DIRS = new Set(['_system'])
