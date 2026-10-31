import '@/utils/errorHandle'
import { init as initLog } from '@/utils/log'
import { bootLog, getBootLog } from '@/utils/bootLog'
import '@/config/globalData'
import { getFontSize } from '@/utils/data'
import { exitApp, hideBootOverlay } from './utils/nativeModules/utils'
import { windowSizeTools } from './utils/windowSizeTools'
import { listenLaunchEvent } from '@/navigation/regLaunchedEvent'
import { tipDialog } from '@/utils/tools'
import { Alert, Platform } from 'react-native'

// ==== iOS 启动诊断（临时，定位白屏问题后移除）====
// 现象：iOS 上启动后白屏。原因是启动失败时的提示用了 tipDialog，而 tipDialog 依赖
// react-native-navigation 的根视图；根视图没推上去时提示自身也显示不出来，于是只剩白屏。
// 这里改为用原生 Alert（不依赖导航）把失败步骤与 Boot Log 直接显示出来。
const diagSteps: string[] = []
const diag = (step: string) => {
  diagSteps.push(step)
  console.log('[LXDIAG]', step)
}
const bootLogSafe = () => {
  try {
    return getBootLog()
  } catch {
    return '(读取 Boot Log 失败)'
  }
}
const isIos = Platform.OS === 'ios'
let rootPushed = false
const showBootError = (title: string, message: string) => {
  if (isIos) {
    Alert.alert(title, message, [{ text: '退出', onPress: exitApp }], { cancelable: false })
    return
  }
  void tipDialog({
    title,
    message,
    btnText: 'Exit',
    bgClose: false,
  }).then(() => {
    exitApp()
  })
}
if (isIos) {
  diag('JS 启动')
}

/**
 * iOS 启动自检：界面出来后跑一遍关键能力的真实调用。
 * 只有出现「硬失败」才弹窗打扰，全部通过只给一条短提示。
 */
const scheduleSelfTest = () => {
  setTimeout(() => {
    void import('@/utils/selfTest').then(async({ runSelfTest, summarize }) => {
      const items = await runSelfTest()
      const result = summarize(items)
      console.log('[LXSELFTEST]', result.text)
      // Release 构建会裁掉上面的 console.log，再走一条原生通道落盘 + NSLog，
      // 供 CI（iOS 模拟器）和真机侧排查读取每一项的真实结果
      const { writeSelftestResult } = await import('@/utils/nativeModules/utils')
      writeSelftestResult(`${result.text}\n--- items ---\n` +
        items.map(i => `${i.ok ? 'PASS' : (i.soft ? 'WARN' : 'FAIL')}\t${i.name}\t${i.detail}`).join('\n'))
      if (result.hardFailed > 0) {
        Alert.alert(
          `自检未通过（${result.passed}/${result.total}）`,
          result.text,
          [{ text: '知道了' }],
        )
      } else {
        const { toast } = await import('@/utils/tools')
        toast(result.text)
      }
    }).catch((err: any) => {
      console.log('[LXSELFTEST] 执行失败', err?.message ?? err)
    })
  }, 2500)
}
// ==== 诊断代码结束 ====

console.log('starting app...')
listenLaunchEvent()
diag('已注册 launch 监听')

void Promise.all([getFontSize(), windowSizeTools.init()]).then(async([fontSize]) => {
  global.lx.fontSize = fontSize
  bootLog('Font size setting loaded.')
  diag('字号/窗口尺寸就绪')

  let isInited = false
  let handlePushedHomeScreen: () => void | Promise<void>

  const tryGetBootLog = () => bootLogSafe()

  const handleInit = async() => {
    if (isInited) return
    void initLog()
    const { default: init } = await import('@/core/init')
    diag('开始 core/init')
    try {
      handlePushedHomeScreen = await init()
    } catch (err: any) {
      diag(`core/init 抛出异常: ${err?.message ?? err}`)
      showBootError('初始化失败 (Init Failed)', `Boot Log:\n${tryGetBootLog()}\n\n${(err.stack ?? err.message) as string}`)
      return
    }
    isInited ||= true
    diag('core/init 完成')
  }
  const { init: initNavigation, navigations } = await import('@/navigation')

  initNavigation(async() => {
    diag('appLaunched 事件已触发')
    await handleInit()
    if (!isInited) return
    // import('@/utils/nativeModules/cryptoTest')

    await navigations.pushHomeScreen().then(() => {
      rootPushed = true
      diag('根视图已推送')
      // 根视图已就位，延迟一小会儿撤掉原生诊断浮层，避免遮挡界面
      if (isIos) setTimeout(hideBootOverlay, 3000)
      void handlePushedHomeScreen()
      if (isIos) scheduleSelfTest()
    }).catch((err: any) => {
      diag(`pushHomeScreen 失败: ${err?.message ?? err}`)
      showBootError('Error', err.message)
    })
  })
}).catch((err) => {
  diag(`启动前置阶段失败: ${err?.message ?? err}`)
  showBootError('初始化失败 (Init Failed)', `Boot Log:\n\n${(err.stack ?? err.message) as string}`)
})
