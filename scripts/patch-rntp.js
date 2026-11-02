/**
 * 修补 react-native-track-player（lyswhut fork）iOS 端的一处数组越界崩溃。
 *
 * 原生 `RNTrackPlayer.handleAudioPlayerQueueIndexChange` 收到 queueIndex 事件时，
 * 直接用 `player.items[nextIndex]` 取元素，**没有边界检查**：
 *
 *     if let nextIndex = nextIndex {
 *         let track = player.items[nextIndex]      // ← 队列被 remove/skip 缩短后，旧索引在这里越界
 *
 * Swift 数组下标越界不是抛异常，而是直接 SIGTRAP：
 *     Swift runtime failure: Index out of range
 *     RNTrackPlayer.handleAudioPlayerQueueIndexChange(previousIndex:nextIndex:)
 * 表现为播放/切歌过程中应用突然闪退。
 *
 * 同文件的 getTrack / updateMetadataForTrack 都已做了边界检查，只有这处漏了。
 * 这里在 npm install 之后自动补上，幂等，可重复执行。
 */
const fs = require('fs')
const path = require('path')

const REL = path.join('node_modules', 'react-native-track-player', 'ios', 'RNTrackPlayer', 'RNTrackPlayer.swift')

const target = path.join(__dirname, '..', REL)

if (!fs.existsSync(target)) {
  // Android 环境或依赖尚未安装：静默跳过，不影响安装流程
  process.exit(0)
}

const raw = fs.readFileSync(target, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'

// 已经打过补丁
if (raw.includes('nextIndex < player.items.count')) {
  console.log('[patch-rntp] 已是最新，跳过')
  process.exit(0)
}

const from = `if let nextIndex = nextIndex {${eol}            let track = player.items[nextIndex]`
const to = `if let nextIndex = nextIndex, nextIndex >= 0, nextIndex < player.items.count {${eol}            let track = player.items[nextIndex]`

if (!raw.includes(from)) {
  console.warn('[patch-rntp] 未匹配到目标代码（依赖版本可能已变），跳过')
  process.exit(0)
}

fs.writeFileSync(target, raw.replace(from, to), 'utf8')
console.log('[patch-rntp] 已修复 handleAudioPlayerQueueIndexChange 的数组越界')
