/**
 * react-native-track-player 的 iOS 兼容层
 * ---------------------------------------------------------------------------
 * 上游在 Android 侧对 react-native-track-player 做过定制（lyswhut fork），但 iOS
 * 侧只保留了上游 2.1.2 的原生实现，两边 API 并不一致。这里统一做差异收敛，
 * 避免 iOS 上出现「方法不存在」或「参数个数不匹配」的问题。
 *
 * 关键坑（已实测）：
 * iOS 原生 `updateNowPlayingMetadata` 只声明了 1 个业务参数
 * （`updateNowPlayingMetadata:resolver:rejecter:` → 3 个参数块），
 * 而 fork 的 JS 封装固定传 2 个参数（metadata, playing）。旧架构下
 * Release 包不校验参数个数，RCTModuleMethod 会按下标去取参数处理 block，
 * 于是多出来的第 4 个参数触发 `-[__NSArrayM objectAtIndexedSubscript:]:
 * index 3 beyond bounds [0 .. 2]` 直接闪退（播放时必崩）。
 * 因此 iOS 上必须绕开 JS 封装，直接把 1 个参数的调用发给原生模块。
 */
import { Image, NativeModules, Platform } from 'react-native'
import TrackPlayer from 'react-native-track-player'

export const isIos = Platform.OS === 'ios'

/** 原生模块实例（fork 的 JS 层从 NativeModules.TrackPlayerModule 取到它） */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const nativeTrackPlayer: Record<string, any> = (NativeModules as any).TrackPlayerModule ?? {}

/** JS 封装层是否有该方法（Android 定制方法在 iOS 上不存在） */
export const sdkHas = (name: string): boolean => typeof (TrackPlayer as any)[name] === 'function'

/** 原生层是否有该方法 */
export const nativeHas = (name: string): boolean => typeof nativeTrackPlayer[name] === 'function'

/**
 * 把 RN 资源 id / 资源对象解析成可被原生播放器直接使用的 URL。
 * metro 对 require('x.mp3') 返回的是数字资源 id，iOS 原生播放器只认字符串
 * URL（MediaURL 内部是 `object as! String` 强转，拿到 NSNumber 会直接崩溃）。
 */
export const resolveAssetUrl = (asset: any): string | undefined => {
  if (!asset) return undefined
  if (typeof asset === 'string') return asset
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const source = (Image as any).resolveAssetSource(asset) as { uri?: string } | null
    if (source?.uri) return source.uri
  } catch {
    // 忽略：解析失败交由调用方兜底
  }
  return undefined
}

export const updateNowPlayingMetadataCompat = async(metadata: Record<string, any>, playing: boolean): Promise<void> => {
  if (isIos) {
    // 只传 1 个参数，多传会越界崩溃（见文件头说明）
    if (!nativeHas('updateNowPlayingMetadata')) return
    await nativeTrackPlayer.updateNowPlayingMetadata(metadata)
    return
  }
  if (!sdkHas('updateNowPlayingMetadata')) return
  await (TrackPlayer as any).updateNowPlayingMetadata(metadata, playing)
}

export const updateNowPlayingTitlesCompat = async(titles: Record<string, any>): Promise<void> => {
  // iOS 原生没有实现该定制方法（用于蓝牙/通知栏歌词）
  if (isIos || !sdkHas('updateNowPlayingTitles')) return
  await (TrackPlayer as any).updateNowPlayingTitles(titles)
}

export const isCachedCompat = async(url: string): Promise<boolean> => {
  // iOS 原生没有实现缓存查询，按「未缓存」处理，不影响在线播放
  if (isIos || !sdkHas('isCached')) return false
  return (TrackPlayer as any).isCached(url) as Promise<boolean>
}

export const getCacheSizeCompat = async(): Promise<number> => {
  if (isIos || !sdkHas('getCacheSize')) return 0
  return (TrackPlayer as any).getCacheSize() as Promise<number>
}

export const clearCacheCompat = async(): Promise<void> => {
  if (isIos || !sdkHas('clearCache')) return
  await (TrackPlayer as any).clearCache()
}
