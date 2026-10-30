import { Platform } from 'react-native'
import RNFS from 'react-native-fs'
import pako from 'pako'

export interface FileType {
  /** Name of the file or directory */
  name: string
  /** Storage path for the file */
  path: string
  isDirectory: boolean
  isFile: boolean
  /** Last modified date of the file or directory */
  lastModified: number
  canRead: boolean
  /** data read from the file */
  data: string
  /** mime type of the file */
  mimeType: string
  size: number
}

export type Encoding = 'base64' | 'utf8'
export type HashAlgorithm = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512'

export interface OpenDocumentOptions {
  mimeTypes?: string[]
  extTypes?: string[]
  multi?: boolean
  toPath?: string
  encoding?: Encoding
}

/**
 * 平台差异说明
 * ---------------------------------------------------------------
 * Android：使用 react-native-file-system（上游 fork），提供 scoped storage、
 *          下载、gzip、外置存储等能力。
 * iOS    ：该库没有 iOS 实现，且其 JS 入口在 import 阶段就会读取原生常量，
 *          在 iOS 上直接 import 会抛错，因此这里改为惰性 require + RNFS/pako 等价实现。
 *          iOS 沙盒模型下没有「外置存储」与「目录授权」概念，统一以 App 沙盒
 *          Documents 目录作为「音乐库目录」，用户可通过「文件」App 往里导入文件。
 */
const isAndroid = Platform.OS === 'android'

let androidFileSystem: any = null
const androidFs = () => {
  if (androidFileSystem == null) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    androidFileSystem = require('react-native-file-system')
  }
  return androidFileSystem
}

const audioMimeTypes: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ape: 'audio/x-ape',
  wv: 'audio/x-wavpack',
  opus: 'audio/opus',
  m4r: 'audio/mp4',
  aif: 'audio/x-aiff',
  aiff: 'audio/x-aiff',
  dsf: 'audio/x-dsf',
  dff: 'audio/x-dff',
}

const mimeTypeOf = (name: string) => {
  const ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase()
  return audioMimeTypes[ext] ?? 'application/octet-stream'
}

const iosFileInfo = (path: string, name: string, size: number, mtime: number, isDirectory: boolean): FileType => ({
  name,
  path,
  isDirectory,
  isFile: !isDirectory,
  lastModified: mtime,
  canRead: true,
  data: '',
  mimeType: isDirectory ? 'inode/directory' : mimeTypeOf(name),
  size,
})

const iosStatToFileType = async(path: string): Promise<FileType> => {
  const info = await RNFS.stat(path)
  return iosFileInfo(info.path, info.name ?? path.split('/').pop() ?? '', Number(info.size) || 0,
    info.mtime ? new Date(info.mtime).getTime() : 0, info.isDirectory())
}

/** iOS 沙盒内唯一可写的持久目录，同时是「文件」App 中可见的音乐库目录 */
const iosManagedFolder = RNFS.DocumentDirectoryPath

export const extname = (name: string) => name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1) : ''

export const temporaryDirectoryPath: string = isAndroid
  ? androidFs().Dirs.CacheDir
  : RNFS.CachesDirectoryPath

export const externalStorageDirectoryPath: string = isAndroid
  ? androidFs().Dirs.SDCardDir
  : RNFS.DocumentDirectoryPath

export const privateStorageDirectoryPath: string = isAndroid
  ? androidFs().Dirs.DocumentDir
  : RNFS.DocumentDirectoryPath

export const getExternalStoragePaths = async(is_removable?: boolean): Promise<string[]> => {
  if (!isAndroid) return []
  return androidFs().getExternalStoragePaths(is_removable)
}

/**
 * iOS 不使用 SAF 授权模型：直接以沙盒 Documents 作为受管目录，
 * 保证「设置 - 存储位置 / 本地音乐扫描」等调用链在 iOS 上不会拿到 null。
 */
export const selectManagedFolder = async(isPersist: boolean = false): Promise<FileType> => {
  if (isAndroid) return androidFs().AndroidScoped.openDocumentTree(isPersist)
  const info = await iosStatToFileType(iosManagedFolder)
  return info
}

export const selectFile = async(options: OpenDocumentOptions): Promise<FileType[] | null> => {
  if (isAndroid) return androidFs().AndroidScoped.openDocument(options)
  // iOS 的文件选择需引入 UIDocumentPicker 原生扩展，第一版未实现
  return null
}

export const removeManagedFolder = async(path: string) => {
  if (isAndroid) return androidFs().AndroidScoped.releasePersistableUriPermission(path)
  // iOS 沙盒目录无法被「释放」，此处为空操作
}

export const getManagedFolders = async(): Promise<string[]> => {
  if (isAndroid) return androidFs().AndroidScoped.getPersistedUriPermissions()
  return [iosManagedFolder]
}

export const getPersistedUriList = async(): Promise<string[]> => {
  if (isAndroid) return androidFs().AndroidScoped.getPersistedUriPermissions()
  return [iosManagedFolder]
}

export const readDir = async(path: string): Promise<FileType[]> => {
  if (isAndroid) return androidFs().FileSystem.ls(path)

  const items = await RNFS.readDir(path)
  return items.map(item => iosFileInfo(item.path, item.name, Number(item.size) || 0,
    item.mtime ? new Date(item.mtime).getTime() : 0, item.isDirectory()))
}

export const unlink = async(path: string) => {
  if (isAndroid) return androidFs().FileSystem.unlink(path)

  // 上游行为等价于「存在则删除」，这里对齐：路径不存在时静默返回
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path)
  } catch (err) {
    // 忽略删除失败，例如目录非空或权限不足
  }
}

export const mkdir = async(path: string) => {
  if (isAndroid) return androidFs().FileSystem.mkdir(path)
  await RNFS.mkdir(path)
}

export const stat = async(path: string): Promise<FileType> => {
  if (isAndroid) return androidFs().FileSystem.stat(path)
  return iosStatToFileType(path)
}

/**
 * iOS 未实现文件级哈希（Android 侧走 MessageDigest 流式计算）。
 * 当前业务代码未使用该方法；如后续需要，建议在 LxModules 中补 CommonCrypto 实现。
 */
export const hash = async(path: string, algorithm: HashAlgorithm): Promise<string> => {
  if (isAndroid) return androidFs().FileSystem.hash(path, algorithm)
  throw new Error('hash() is not implemented on iOS yet')
}

export const readFile = async(path: string, encoding?: Encoding): Promise<string> => {
  if (isAndroid) return androidFs().FileSystem.readFile(path, encoding)
  return RNFS.readFile(path, encoding ?? 'utf8')
}

export const moveFile = async(fromPath: string, toPath: string) => {
  if (isAndroid) return androidFs().FileSystem.mv(fromPath, toPath)
  await RNFS.moveFile(fromPath, toPath)
}

const gzipToBase64 = (data: Uint8Array) => Buffer.from(pako.gzip(data)).toString('base64')

export const gzipFile = async(fromPath: string, toPath: string) => {
  if (isAndroid) return androidFs().FileSystem.gzipFile(fromPath, toPath)

  const base64 = await RNFS.readFile(fromPath, 'base64')
  await RNFS.writeFile(toPath, gzipToBase64(Buffer.from(base64, 'base64')), 'base64')
}

export const unGzipFile = async(fromPath: string, toPath: string) => {
  if (isAndroid) return androidFs().FileSystem.unGzipFile(fromPath, toPath)

  const base64 = await RNFS.readFile(fromPath, 'base64')
  const raw = pako.ungzip(Buffer.from(base64, 'base64'))
  await RNFS.writeFile(toPath, Buffer.from(raw).toString('base64'), 'base64')
}

export const gzipString = async(data: string, encoding?: Encoding): Promise<string> => {
  if (isAndroid) return androidFs().FileSystem.gzipString(data, encoding)

  // 与 Android 实现保持一致的传输格式：UTF-8/Base64 原文 -> gzip -> Base64
  const source = encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8')
  return gzipToBase64(source)
}

export const unGzipString = async(data: string, encoding?: Encoding): Promise<string> => {
  if (isAndroid) return androidFs().FileSystem.unGzipString(data, encoding)

  const raw = Buffer.from(pako.ungzip(Buffer.from(data, 'base64')))
  return encoding === 'base64' ? raw.toString('base64') : raw.toString('utf8')
}

export const existsFile = async(path: string): Promise<boolean> => {
  if (isAndroid) return androidFs().FileSystem.exists(path)
  return RNFS.exists(path)
}

export const rename = async(path: string, name: string) => {
  if (isAndroid) return androidFs().FileSystem.rename(path, name)

  const directory = path.substring(0, path.lastIndexOf('/'))
  await RNFS.moveFile(path, `${directory}/${name}`)
}

export const writeFile = async(path: string, data: string, encoding?: Encoding) => {
  if (isAndroid) return androidFs().FileSystem.writeFile(path, data, encoding)
  await RNFS.writeFile(path, data, encoding ?? 'utf8')
}

export const appendFile = async(path: string, data: string, encoding?: Encoding) => {
  if (isAndroid) return androidFs().FileSystem.appendFile(path, data, encoding)
  await RNFS.appendFile(path, data, encoding ?? 'utf8')
}

export const downloadFile = (url: string, path: string, options: Omit<RNFS.DownloadFileOptions, 'fromUrl' | 'toFile'> = {}) => {
  if (!options.headers) {
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
    }
  }
  return RNFS.downloadFile({
    fromUrl: url, // URL to download file from
    toFile: path, // Local filesystem path to save the file to
    ...options,
  })
}

export const stopDownload = (jobId: number) => {
  RNFS.stopDownload(jobId)
}
