/**
 * iOS 工程需要排除的两个纯 Android 依赖：
 *  - react-native-file-system：没有 ios/ 源码目录（podspec 里 s.source_files 指不到文件），pod install 会失败
 *  - react-native-local-media-metadata：基于 Android media3 + jaudiotagger 解析本地音频标签，无 iOS 实现
 *
 * 两者的 iOS 等价能力分别在以下位置补齐：
 *  - src/utils/fs.ios.ts                （基于 react-native-fs + pako）
 *  - src/utils/localMediaMetadata.ios.ts（iOS 上降级为空实现）
 */
const androidOnlyDependencies = [
  'react-native-file-system',
  'react-native-local-media-metadata',
]

module.exports = {
  dependencies: Object.fromEntries(
    androidOnlyDependencies.map(name => [name, { platforms: { ios: null } }]),
  ),
}
