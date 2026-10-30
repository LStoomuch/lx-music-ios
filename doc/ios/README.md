# LX Music 移动版 — iOS 适配说明

> 本文档对应分支 `feat_ios_support`。上游仓库明确「目前没有计划支持 iOS」，`ios/` 目录只是  
> React Native 0.73 模板残留、从未维护。本分支补齐了 iOS 侧缺失的原生实现与平台适配，  
> 使工程可以在 macOS 上 `pod install` + 编译出可运行的 iOS App。

---

## 一、先说结论：三个硬约束

| 约束                    | 说明                                                            | 影响                                                                |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| **编译必须用 macOS（可以租云）** | iOS 编译依赖 Xcode 与 CocoaPods，Windows 无任何可用替代                    | 用云 macOS（GitHub Actions 免费 / Codemagic）；本仓库已附带两种 CI 配置，一次配好就能反复出包 |
| **无法上架 App Store**    | 本项目大量依赖「自定义源」脚本，音频来自第三方接口，不符合 App Store 审核要求                  | 只能侧载：Sideloadly + 你自己的 Apple ID（免费账号 7 天签名、付费开发者账号 1 年）           |
| **桌面歌词不可实现**          | iOS 不给第三方 App 系统级悬浮窗权限，仅系统级 Live Activity / PiP 可用，无法承载逐字歌词渲染 | 该功能在 iOS 上关闭：设置分类与播放入口均隐藏，原生模块只保留空实现以防崩溃                          |

### 目标设备与工具链选择（重要）

目标机型 **iPhone 15 / iOS 26**，本机只有 **Windows**、无 Mac、无 Wi-Fi。这三条决定了下面的技术选择：

| 问题                          | 结论                                                   | 依据                                                                            |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| iOS 26 是否要求用 iOS 26 SDK 构建？ | **不要求**。这只是 App Store **上传**的门槛（2026-04-28 起），侧载不受限制 | Apple「Upcoming Requirements」明确该要求只针对上传到 App Store Connect 的包                  |
| 那用什么 Xcode 编？               | **Xcode 16（macOS 15 运行器）**                           | RN 0.73 是 2023 年底版本，官方支持窗口是 Xcode 15/16；Xcode 26 上 fmt / Clang 等已停止维护的问题会集中爆发 |
| 为什么不用 Xcode 15？             | 用不了了                                                 | GitHub 的 `macos-14`（唯一带 Xcode 15 的镜像）已于 **2026-11-02 退役**                     |
| 部署目标能留 13.4 吗？              | **不能**                                               | Xcode 26 起 Deployment Target 最低 iOS 15；本分支已统一抬到 **15.0**                      |

除此之外，播放、歌单、搜索、自定义源、歌词、下载、数据同步等核心功能均可在 iOS 上工作。

---

## 二、改动清单

### 2.1 新增：iOS 原生模块（本地 CocoaPods 子模块）

目录 `ios/LxModules/`，以 `pod 'LxModules', :path => './LxModules'` 形式接入，  
**不需要手改 pbxproj 添加源文件**，降低冲突概率。

| iOS 文件                            | 对应 Android 实现                                                      | 说明                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `LXUtilsModule.m`                 | `utils/UtilsModule.java`                                           | 退出、架构、屏幕常亮、WiFi IP、设备名、通知权限、分享、系统语言、屏幕状态、窗口尺寸、电池优化（iOS 无此概念，返回「已忽略」）                                                                 |
| `LXCryptoModule.m` + `LXCrypto.m` | `crypto/CryptoModule.java`、`AES.java`、`RSA.java`                   | AES（CBC/PKCS7、ECB/NoPadding）+ RSA（OAEP-SHA1、PKCS1）+ SHA1/MD5；密钥格式与 Java `getEncoded()` 对齐（公钥 X.509 SPKI、私钥 PKCS#8）                   |
| `LXCacheModule.m`                 | `cache/CacheModule.java`                                           | 统计/清理 Caches 与 tmp 占用                                                                                                                |
| `LXUserApiModule.m`               | `userApi/UserApiModule.java` + `QuickJS.java` + `JsHandler.java` 等 | **自定义源脚本引擎**：改用系统内置 `JavaScriptCore` 创建独立 JSContext（不受 Hermes 影响）；脚本 ABI 直接复用 `Resources/user-api-preload.js`（从 Android assets 原样复制） |
| `LXLyricModule.m`                 | `lyric/LyricModule.java`                                           | iOS 空实现，方法与 JS 侧同签名，保证调用不抛错                                                                                                          |

### 2.2 修改：工程配置

| 文件                                            | 改动                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ios/Podfile`                                 | ① 接入 `LxModules` 本地 Pod；② `platform :ios, '15.0'`，并把所有 pod 的部署目标兜底抬到 15.0；③ `post_install` 里移除冗余的 `RCT-Folly.common`（RN 0.73 Release 下会撞 folly.framework 重复产出）；④ 全局关闭 `ENABLE_USER_SCRIPT_SANDBOXING`（Hermes 脚本需在构建期写文件）；⑤ 幂等修补 `fmt` 的 `FMT_USE_CONSTEVAL`（Xcode 26 的 Clang 会走死循环分支） |
| `ios/LxMusicMobile/Info.plist`                | 后台播放 `UIBackgroundModes=audio`；文件共享 `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace`；ATS 放开（自定义源常见 http）；媒体库、本地网络权限说明；显示名「洛雪音乐」；`UIRequiredDeviceCapabilities` 由 `armv7` 改为 `arm64`                                                                                       |
| `ios/LxMusicMobile.xcodeproj/project.pbxproj` | Bundle ID `cn.toside.music.mobile`（测试目标加 `.tests` 后缀）；`MARKETING_VERSION=1.9.1`；`CURRENT_PROJECT_VERSION=78`，与 `package.json` 对齐；`IPHONEOS_DEPLOYMENT_TARGET` 13.4 → **15.0**；新增 `ENABLE_USER_SCRIPT_SANDBOXING=NO`                                                                   |
| `react-native.config.js` **（新增）**             | 排除 `react-native-file-system`、`react-native-local-media-metadata` 的 iOS pod —— 两者没有 `ios/` 源码目录，不排除会导致 `pod install` 失败                                                                                                                                                               |
| `.github/workflows/ios-unsigned.yml` **（新增）** | GitHub Actions 云构建（macos-15 + 自动选最新 Xcode 16.x），出未签名 ipa，并附带 `build-log`                                                                                                                                                                                                              |
| `codemagic.yaml` **（新增，备选）**                  | Codemagic 云构建；其共享池只保留 Xcode 26.x，RN 0.73 风险较高，仅作备选                                                                                                                                                                                                                                    |

### 2.3 修改：JS 平台适配

| 文件                                              | 改动                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/fs.ts`                               | 改为平台分发：Android 仍用 `react-native-file-system`（惰性 `require`，因为该库在 import 阶段就会读原生常量，iOS 上直接 import 会抛错）；iOS 改用 `react-native-fs` + `pako` 实现同名 API。iOS 的「受管目录」固定为沙盒 `Documents`（可在「文件」App 中访问） |
| `src/utils/localMediaMetadata.ts`               | 同上改为惰性 require；iOS 端标签读取降级为空实现                                                                                                                                                              |
| `src/core/version.ts`                           | iOS 跳过版本检查与 apk 下载（无应用内安装通道）                                                                                                                                                                |
| `src/screens/Home/Views/Setting/Main.tsx`       | iOS 隐藏「桌面歌词」设置分类                                                                                                                                                                            |
| `src/screens/PlayDetail/**/DesktopLyricBtn.tsx` | iOS 隐藏桌面歌词按钮                                                                                                                                                                                |

---

## 三、功能矩阵

| 功能                   | iOS   | 说明                                                                  |
| -------------------- | ----- | ------------------------------------------------------------------- |
| 在线播放 / 音质切换 / 缓存     | ✅     | `react-native-track-player` 原生支持 iOS                                |
| 后台播放 / 锁屏控制          | ✅     | 依赖 `UIBackgroundModes=audio`，已配置                                    |
| 自定义源（脚本）             | ✅     | JavaScriptCore 版引擎，脚本可直接复用现有源                                       |
| 歌单 / 收藏 / 搜索 / 排行榜   | ✅     | 纯 JS                                                                |
| 应用内歌词 / 桌面歌词按钮       | ✅ / ❌ | 应用内正常；桌面歌词按约束关闭                                                     |
| 数据同步（自建 sync server） | ✅     | Crypto 模块已实现 AES/RSA                                                |
| 备份 / 恢复              | ✅     | gzip 改为 pako，格式与 Android 一致（gzip+Base64）                            |
| 下载到本地                | ✅     | 下载目录为沙盒 Documents                                                   |
| 本地音乐扫描               | ⚠️    | 目录可扫描（`Documents`），但音频标签解析无 iOS 实现，条目会全部计为「解析失败」。需补 AVFoundation 实现 |
| 应用内更新                | ❌     | iOS 禁止，需重新侧载或走 TestFlight                                           |
| 桌面歌词                 | ❌     | 系统限制                                                                |

---

## 四、构建

### 4.1 本地（有 Mac 时）

```bash
# 环境：macOS 14+、Xcode 16.x（不要用 Xcode 26）、Node 18/20、Ruby 3.x、CocoaPods 1.16+
node -v            # >= 18
npm ci
cd ios && pod install --repo-update && cd ..

# 打开工作区
open ios/LxMusicMobile.xcworkspace
# Xcode 中选择 Team（免费 Apple ID 也可），Run 到真机
```

命令行构建（需已配置好签名）：

```bash
xcodebuild -workspace ios/LxMusicMobile.xcworkspace \
  -scheme LxMusicMobile -configuration Release -sdk iphoneos \
  -derivedDataPath build build
```

### 4.2 云构建（无 Mac，推荐）

**首选 GitHub Actions**（公开仓库 macOS 分钟免费）：

1. 仓库推到 GitHub → **Actions** → `iOS unsigned ipa` → **Run workflow**，分支 `feat_ios_support`。
2. Runner 固定 `macos-15`，工作流会自动挑选镜像内最新的 **Xcode 16.x**（可用 `xcode` 输入框指定具体版本）。
3. 产物两个 artifact：
   - `lx-music-ios-unsigned` → 未签名 ipa； 
   - `build-log` → `xcodebuild.log` + `Podfile.lock`（构建失败时看这个）。

**备选 Codemagic**：共享机池目前只保留可用于 App Store 提交的 Xcode（26.x），RN 0.73 在上面失败概率明显更高，  
仅在前者不可用时用。

核心构建参数（两处一致）：

```
CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" ARCHS=arm64
-destination 'generic/platform=iOS'
```

未签名产物打成 `Payload/*.ipa`，并在打包时删掉残留的 `_CodeSignature` 目录，交给侧载工具签名。

> 为什么是 Xcode 16 而不是 26：iOS 26 **不要求** App 由 iOS 26 SDK 构建（那是 App Store 上传的门槛），  
> 而 RN 0.73 在 Xcode 26 上会撞 fmt / consteval 等已停止维护的编译问题。用 iOS 18 SDK 出的包在 iOS 26 上正常安装运行。

### 4.3 安装到 iPhone（Windows 侧）

完整可执行步骤（含 iOS 26 开发者模式、免费账号 7 天续签、常见报错排查）见 **[WINDOWS-SIDELOAD.md](./WINDOWS-SIDELOAD.md)**。

三步速记：

1. Sideloadly（Windows，需官网桌面版 iTunes，**不要** Microsoft Store 版）→ 拖入 ipa → 填 Apple ID → Start。
2. iPhone：设置 → 通用 → VPN 与设备管理 → 信任你的开发者证书。
3. 7 天到期后：USB 连线 → 同一个 ipa 再 Start 一次（覆盖安装，数据不丢）。

签名有效期：

| 账号类型           | 有效期         | 限制                           |
| -------------- | ----------- | ---------------------------- |
| 免费 Apple ID    | 7 天，到期需重新侧载 | 最多 3 个 App、每 7 天 10 个 App ID |
| 付费开发者（99 美元/年） | 1 年         | 无 7 天限制                      |

---

## 五、验证状态（重要）

| 项                     | 状态                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| JS 侧改动（平台分发、降级、UI 隐藏） | 已按源码逐处核对；`main.jsbundle` 已在云构建中成功产出                                                                                        |
| iOS 原生模块（ObjC）        | ✅ **已编译通过**。首轮构建只有 1 处错误：`LXCrypto.m` 用了 Foundation 不存在的 `NSZeroRange`（应为 `NSMakeRange(0, 0)`），修正后 Release 构建成功            |
| 工具链与 CI 配置            | ✅ GitHub Actions `macos-15` + Xcode 16 实跑成功，产出未签名 ipa                                                                      |
| 5 个原生模块是否真被链接进二进制     | ✅ 已用字节扫描确认：`CryptoModule` / `UtilsModule` / `UserApiModule` / `CacheModule` / `LXLyricModule` 均在主可执行文件内                    |
| ipa 结构                | ✅ 可执行文件 9.6 MB、`main.jsbundle` 存在、`LxModules.bundle/user-api-preload.js` 已打包、无 `_CodeSignature`（符合未签名预期）                   |
| Info.plist            | ✅ bundle id `cn.toside.music.mobile`、显示名「洛雪音乐」、1.9.1(78)、`MinimumOSVersion 15.0`、`UIBackgroundModes=[audio]`、文件共享开启、ATS 放开 |
| 真机运行                  | **未验证**（目标机 iPhone 15 / iOS 26，待侧载后确认）                                                                                     |

首轮云构建的实际耗时与结果（供参考）：

| 阶段                               | 首轮                  | 修正后             |
| -------------------------------- | ------------------- | --------------- |
| `npm ci`                         | ~2 min              | ~2 min          |
| `pod install`（含 `--repo-update`） | ~8 min              | ~8 min          |
| `xcodebuild` Release             | 失败（LXCrypto.m 编译错误） | ✅ 成功            |
| 整轮总耗时                            | 20 min（failed）      | 16 min（success） |

已在 `Podfile` / `pbxproj` 里预置的三类补丁（对应 RN 0.73 在现代工具链上的已知冲突）：

| 症状                                                       | 根因                                    | 已预置的处理                                                  |
| -------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `Multiple commands produce '.../folly.framework'`        | RN 0.73.x 在 Release 下重复产出 folly       | `post_install` 移除 `RCT-Folly.common` target             |
| `PhaseScriptExecution ... rsync: deny(1) file-read-data` | Hermes 的替换脚本被用户脚本沙盒拦截                 | `ENABLE_USER_SCRIPT_SANDBOXING=NO`（app target 与全部 pods） |
| `error: consteval` / `FMT_USE_CONSTEVAL` 相关              | Xcode 26 的 Clang 声明 `__cpp_consteval` | `post_install` 幂等 patch `fmt/base.h`                    |

仍可能需要现场处理的：

1. **Pods 下载慢**：CI 上被限流时给 `pod install` 配镜像；首次 `--repo-update` 耗时较长属正常。
2. **JavaScriptCore 链接**：`LxModules.podspec` 已声明 `s.frameworks = 'JavaScriptCore'`，若报找不到头文件，  
   检查 Pods 中 `LxModules` target 的 Framework Search Paths。
3. **资源包**：`user-api-preload.js` 通过 `resource_bundles` 打包为 `LxModules.bundle`，  
   `LXUserApiModule.m` 内已做「主 bundle 找不到时回落资源 bundle」的处理。
4. **`RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD`**：用于 `rsaEncryptSync` 等同步方法，  
   旧架构（bridge）下可用；若启用新架构（Fabric/TurboModule）需改为 TurboModule 规范实现。
5. **Node 路径**：RN 0.73 的 Hermes 脚本依赖 `ios/.xcode.env.local` 里的 `NODE_BINARY`，  
   CI 已显式写入；本地构建若报 `PhaseScriptExecution` 失败，先删掉该文件重试。

---

## 六、后续可补齐项

1. **本地音乐元数据**：用 `AVURLAsset` + `AVAssetResourceLoader` 读 ID3/FLAC 标签与封面，  
   补齐 `readMetadata` / `readPic` / `readLyric` / `write*`，替代当前空实现。
2. **文件导入**：用 `UIDocumentPickerViewController` 实现 `selectFile`，把外部文件复制进沙盒。
3. **桌面歌词替代方案**：可考虑「灵动岛 / 锁屏 Live Activity」展示当前歌词行（非逐字），  
   或提供「应用内悬浮歌词」。
4. **签名自动化**：Codemagic 配置 App Store Connect API Key，直接产出可安装的签名 ipa 并上传 TestFlight。

---

## 七、许可与合规

上游为 Apache-2.0 附加条款（见仓库 `LICENSE`），本项目仅用于技术研究与学习交流，  
不得用于商业用途；使用过程中产生的版权数据请在 24 小时内清除。请尊重版权，支持正版。
