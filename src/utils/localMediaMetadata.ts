import { Platform } from 'react-native'

import { temporaryDirectoryPath, readDir, unlink, extname } from '@/utils/fs'

export type {
  MusicMetadata,
  MusicMetadataFull,
} from 'react-native-local-media-metadata'

/**
 * 平台差异说明
 * ---------------------------------------------------------------
 * Android：react-native-local-media-metadata 基于 media3 + jaudiotagger 解析本地音频标签，
 *          其 JS 入口在 import 阶段即读取原生常量，故这里改为惰性 require。
 * iOS    ：该库没有 iOS 实现。第一版 iOS 端先降级为空实现（读不到标签 -> 本地音乐条目
 *          会被计入失败列表），后续可用 AVFoundation / AVAsset 补齐 readMetadata 与 readPic
 *          （见 doc/ios/README.md「后续可补齐项」）。
 */
const isAndroid = Platform.OS === 'android'

let androidMediaModule: any = null
const androidMedia = () => {
  if (androidMediaModule == null) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    androidMediaModule = require('react-native-local-media-metadata')
  }
  return androidMediaModule
}

let cleared = false
const picCachePath = temporaryDirectoryPath + '/local-media-metadata'

export const scanAudioFiles = async(dirPath: string) => {
  const files = await readDir(dirPath)
  return files.filter(file => {
    if (file.mimeType?.startsWith('audio/')) return true
    if (extname(file?.name ?? '') === 'ogg') return true
    return false
  }).map(file => file)
}

const clearPicCache = async() => {
  await unlink(picCachePath)
  cleared = true
}

export const readPic = async(filePath: string): Promise<string> => {
  if (!isAndroid) return ''
  if (!cleared) await clearPicCache()
  return androidMedia().readPic(filePath, picCachePath)
}

export const readMetadata = async(filePath: string): Promise<any> => {
  if (!isAndroid) return null
  return androidMedia().readMetadata(filePath)
}

export const writeMetadata = async(...args: any[]): Promise<any> => {
  if (!isAndroid) return null
  return androidMedia().writeMetadata(...args)
}

export const writePic = async(...args: any[]): Promise<any> => {
  if (!isAndroid) return null
  return androidMedia().writePic(...args)
}

export const readLyric = async(filePath: string, isFromFile?: boolean): Promise<string> => {
  if (!isAndroid) return ''
  return androidMedia().readLyric(filePath, isFromFile)
}

export const writeLyric = async(...args: any[]): Promise<any> => {
  if (!isAndroid) return null
  return androidMedia().writeLyric(...args)
}
