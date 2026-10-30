# 无 Mac 侧载安装指南（Windows + iPhone 15 / iOS 26）

> 适用条件：只有一台 Windows 电脑 + 一台 iPhone（本文按 iPhone 15 / iOS 26 写），没有 Mac、
> 电脑也没有 Wi-Fi（只有有线/蓝牙）。全程不需要 Mac、不需要越狱、不需要 Wi-Fi。

---

## 一、先看清楚你这套配置的边界

| 事项 | 你的情况 | 结论 |
| --- | --- | --- |
| 编译 iOS | 无 Mac | **必须用云 macOS**（GitHub Actions 免费），本机只负责下载 ipa + 侧载 |
| iOS 26 能不能装旧 SDK 编的 App | 能 | 用 Xcode 16（iOS 18 SDK）编的包在 iOS 26 上正常安装运行。App Store 的「必须用 iOS 26 SDK」只约束**上传**，不约束侧载 |
| 装好后能用多久 | 免费 Apple ID | **7 天**，到期后 App 打不开，需重新连 USB 签一次（本文第六节） |
| 能不能长期不折腾 | 免费 Apple ID | 不能。想免续签只有付费开发者账号（99 美元/年，有效期 1 年） |
| 无线侧载 / 自动续签 | 没有 Wi-Fi | 用不了，Sideloadly 的 Wi-Fi 刷新与 AltStore 都依赖同一局域网。**走 USB，每周插一次线** |
| 能上架 App Store | 不能 | 依赖「自定义源」取音频，不符合审核规则，只能自签自用 |

---

## 二、准备（一次性，约 15 分钟）

### 2.1 Windows 侧

| 软件 | 说明 |
| --- | --- |
| **Sideloadly** | 从 <https://sideloadly.io/> 下载 Windows 64 位版。负责用你的 Apple ID 给 ipa 签名并装进手机 |
| **iTunes（桌面版）** | 必需，Sideloadly 依赖它提供设备通信组件。<br>**必须是 Apple 官网下载的 .exe 版本**；Microsoft Store 版本要先卸载，否则 Sideloadly 报找不到设备 |
| iCloud（可选） | 只在登录环节报错时再装 |

> Apple 官网 iTunes 页面：<https://www.apple.com/itunes/download/win64>（选「Windows 版 iTunes」，
> 不要点 Microsoft Store 链接）。

### 2.2 iPhone 侧

1. **数据线连接电脑**，手机弹「要信任此电脑吗」→ 点**信任** → 输入锁屏密码。
2. **打开开发者模式**：设置 → 隐私与安全性 → 开发者模式 → 打开 → 重启 → 重启后再确认一次。
   - 如果列表里**没有**这一项：先做一次第五节第 3 步的安装尝试，安装完成回到设置里就会出现。
3. 关掉「查找」不是必须的，但**Apple ID 必须开启双重认证**（免费账号也一样），否则签名会失败。

---

## 三、拿到 ipa（云端编译，约 15–25 分钟）

1. 把本仓库推到你的 GitHub（**公开仓库**，macOS 分钟数免费）。
2. 打开仓库 → **Actions** → 左侧 `iOS unsigned ipa` → 右侧 **Run workflow** → 分支选 `feat_ios_support` → 运行。
3. 跑完后在该次运行页面底部下载产物 **`lx-music-ios-unsigned`**（zip，解压得到
   `lx-music-ios-unsigned.ipa`）。
4. 如果失败：同页面下载 **`build-log`** artifact，里面的 `xcodebuild.log` 就是完整编译日志——
   把关键报错段落贴给我，我按报错改工程。

> 构建用的是 **macos-15 + Xcode 16**，不是最新的 Xcode 26。原因见 `README.md` 第四节：
> React Native 0.73 只支持到 Xcode 16，而 iOS 26 设备**不要求**用 iOS 26 SDK 构建。

---

## 四、Sideloadly 参数怎么填

| 字段 | 填什么 |
| --- | --- |
| IPA | 拖入 `lx-music-ios-unsigned.ipa` |
| Device | 选择你的 iPhone（USB 连接后自动出现） |
| Apple account | 你的 Apple ID（邮箱） |
| Password | Apple ID 密码；若提示需要「App 专用密码」，去 <https://account.apple.com> → 登录与安全 → App 专用密码 生成一个填进去 |
| Install mode | 保持默认 **Apple ID Sideload**（不要选 Normal Install） |

点 **Start**，过程约 1–3 分钟。期间手机可能弹 6 位验证码，填到电脑上。

---

## 五、装完第一次打开

1. 手机桌面出现「**洛雪音乐**」。
2. 首次点开若提示「**未受信任的开发者**」：
   设置 → 通用 → VPN 与设备管理 → **开发者 App** → 点你的 Apple ID → **信任**。
3. 再打开 App。若闪退，先看第六节「排查」。

装好后的可用能力与已知缺口见 `README.md` 第三节「功能矩阵」。

---

## 六、7 天到期怎么办（免 Wi-Fi 的续签流程）

免费证书 **7 天**过期，表现为：图标还在，点开立刻闪退（或提示无法验证 App）。

续签只要重复两步：

1. 数据线连电脑 → 打开 Sideloadly → 把**同一个 ipa** 再拖进去。
2. Start。Sideloadly 会用同一张证书重签并覆盖安装。

**关键：数据/歌单/设置不会丢**。App 的本地数据存在沙盒里，覆盖安装（同 Bundle ID）会保留；
只有**卸载**才会清空。所以尽量不要删 App，直接覆盖签。

> 如果你想彻底免掉每周折腾：付费 Apple Developer 账号（99 美元/年）签名有效期 1 年。
> 买之前注意：仍需每 1 年重签一次，且免费账号的「最多 3 个 App、7 天 10 个 App ID」限制会解除。

---

## 七、排查表（iOS 26 + 免费账号常见）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Sideloadly 看不到设备 | 装的是 Microsoft Store 版 iTunes / 没装 iTunes / 数据线只充电 | 卸载 Store 版，装官网桌面版；换线；手机重新点「信任」 |
| `Provision.cpp:166` / `Unable to verify` 一类签名失败 | Apple ID 未开双重认证，或密码里含特殊字符被转义 | 开 2FA；改用 App 专用密码 |
| `You have reached the maximum number of apps for free development profiles` | 免费账号同时最多 3 个自签 App | 删掉一个不用的自签 App 再装 |
| `The maximum number of apps for free development profiles has been reached`（7 天内 10 个 App ID 用尽） | 免费账号每 7 天只能注册 10 个 App ID | 等 7 天，或删 App 后间隔重试 |
| 安装成功但点开闪退 | 证书未信任 / 证书已过期（>7 天） | 先「信任开发者」，仍闪退则重新侧载 |
| 打开后白屏、只有状态栏 | JS bundle 没打进包（Release 打包阶段失败但没中断） | 看 CI 日志里是否有 `Bundle React Native code and images` 报错 |
| 提示「此 App 需要更新版本的 iOS」 | ipa 的 MinimumOSVersion 高于手机系统 | 本项目部署目标为 iOS 15，iOS 26 不会触发；若遇到，可在 Sideloadly 勾选 "Modify iOS Version" 降低 |
| 播放无声 / 后台被切 | 未授予音频后台能力或静音开关 | 检查侧边静音开关；设置 → 通用 → 后台 App 刷新 |

---

## 八、需要我接着做的事

1. **首次构建报错**：把 `build-log` artifact 里的报错发我，我改工程（RN 0.73 + 现代 Xcode
   的坑基本集中在 folly / hermes / fmt 三处，Podfile 里已预置三处补丁）。
2. **本地音乐标签解析**：iOS 侧目前是空实现，需要补 AVFoundation 的
   `readMetadata` / `readPic`（见 `README.md` 第六节）。
3. **文件导入**：用 `UIDocumentPickerViewController` 实现「从文件 App 导入音乐」。
