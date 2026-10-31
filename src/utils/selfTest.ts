/**
 * 启动自检
 * ---------------------------------------------------------------------------
 * 目的：交付前无法在 Windows 上真机运行 iOS，因此把「功能是否正确」的判断
 * 交给设备自己执行——App 启动后会跑一遍关键能力的实际调用，把失败项直接显示出来。
 *
 * 原则：
 *   - 只做「调用 + 校验返回值」，不改动播放器队列、不写业务数据（写入的文件立即删除）；
 *   - 每一项独立 try/catch + 超时，任一项失败不影响其它项，也不会中断启动；
 *   - 网络类检查标记为 soft，失败只提示不算错误（可能是网络环境问题）。
 */
import { Image, NativeModules } from 'react-native'

import { getWindowSize } from '@/utils/windowSizeTools'
import { getStatusBarHeight, getSystemLocales } from '@/utils/nativeModules/utils'
import { readFile, unlink, writeFile, temporaryDirectoryPath } from '@/utils/fs'
import {
  AES_MODE,
  RSA_PADDING,
  aesDecrypt,
  aesDecryptSync,
  aesEncrypt,
  aesEncryptSync,
  generateRsaKey,
  hashSHA1,
  rsaDecryptSync,
  rsaEncryptSync,
} from '@/utils/nativeModules/crypto'
import { defaultUrl } from '@/config'
import { getData } from '@/plugins/storage'

export interface SelfTestItem {
  name: string
  ok: boolean
  /** 失败原因 / 通过时的关键值 */
  detail: string
  /** 失败也不计入错误总数（例如依赖外网） */
  soft?: boolean
}

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { reject(new Error(`${label} 超时（${ms}ms）`)) }, ms)
  promise.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
})

const errText = (err: any) => (err?.message ?? String(err)).split('\n')[0].slice(0, 120)

/** 跑单项检查：内部异常统一转成失败项 */
const runItem = async(name: string, fn: () => Promise<string> | string, opts: { soft?: boolean, timeout?: number } = {}): Promise<SelfTestItem> => {
  try {
    const detail = await withTimeout(Promise.resolve().then(fn), opts.timeout ?? 6000, name)
    return { name, ok: true, detail: detail || 'ok', soft: opts.soft }
  } catch (err) {
    return { name, ok: false, detail: errText(err), soft: opts.soft }
  }
}

const resolveDefaultTrackUrl = () => {
  if (typeof defaultUrl === 'string') return defaultUrl
  const source = (Image as any).resolveAssetSource(defaultUrl) as { uri?: string } | null
  return source?.uri
}

export const runSelfTest = async(): Promise<SelfTestItem[]> => {
  const items: SelfTestItem[] = []

  items.push(await runItem('窗口尺寸', async() => {
    const size = await getWindowSize()
    if (!(size.width > 0 && size.height > 0)) throw new Error(`尺寸异常 ${size.width}x${size.height}`)
    return `${Math.round(size.width)}x${Math.round(size.height)}`
  }))

  items.push(await runItem('顶部安全区', async() => {
    const height = await getStatusBarHeight()
    if (!(height > 0)) throw new Error('取到 0，标题栏会被灵动岛遮挡')
    return `${Math.round(height)}pt`
  }))

  items.push(await runItem('系统语言', async() => {
    // getSystemLocales 返回的是 "zh_cn" 这样的字符串（Android/iOS 一致），不是数组
    const locale = await getSystemLocales()
    if (typeof locale !== 'string' || !locale.length) throw new Error(`取到空值：${String(locale)}`)
    return locale
  }))

  items.push(await runItem('内置音频资源', async() => {
    const url = resolveDefaultTrackUrl()
    if (!url) throw new Error('资源未解析出 uri')
    if (!/^file:\/\//.test(url)) throw new Error(`不是本地路径：${url}`)
    return url.split('/').pop() ?? 'ok'
  }))

  items.push(await runItem('文件读写', async() => {
    const file = `${temporaryDirectoryPath}/lx-selftest.txt`
    await writeFile(file, 'lx-music-ios')
    const content = await readFile(file)
    await unlink(file)
    if (content !== 'lx-music-ios') throw new Error(`读回内容不一致：${content}`)
    return 'ok'
  }))

  items.push(await runItem('SHA1', async() => {
    // 标准测试向量："abc" -> a9993e364706816aba3e25717850c26c9cd0d89d
    const digest = await hashSHA1('abc')
    if (digest !== 'a9993e364706816aba3e25717850c26c9cd0d89d') throw new Error(`结果错误：${digest}`)
    return 'ok'
  }))

  // 原生 AES/RSA 的入参契约是 base64，不是裸字符串：
  // src/plugins/sync/utils.ts 里明文先 btoa 再交给原生，key 本身就是 base64 密钥。
  // 传裸字符串会被按 base64 解成错误长度的字节（16 个字符 → 12 字节），
  // 密钥长度不合法时原生直接返回空串。
  // 另外注意方向不对称：加密吃 base64、吐 base64 密文；解密吐的是 UTF-8 明文。
  items.push(await runItem('AES(同步)', async() => {
    const b64Key = 'bHhtdXNpYzAxMjM0NTY3OA==' // base64('lxmusic012345678')，16 字节
    const expected = 'lx-selftest-2024'
    const b64Text = 'bHgtc2VsZnRlc3QtMjAyNA==' // base64(expected)，16 字节刚好一块
    const cipher = aesEncryptSync(b64Text, b64Key, '', AES_MODE.ECB_128_NoPadding)
    if (!cipher) throw new Error('加密返回空，密钥长度或模式不匹配')
    const back = aesDecryptSync(cipher, b64Key, '', AES_MODE.ECB_128_NoPadding)
    if (back !== expected) throw new Error(`往返不一致：${JSON.stringify(back)}`)
    return 'ok'
  }))

  items.push(await runItem('AES(异步)', async() => {
    const b64Key = 'bHhtdXNpYzAxMjM0NTY3OA=='
    const b64Iv = 'MTIzNDU2Nzg5MDEyMzQ1Ng==' // base64('1234567890123456')
    const expected = 'lx-selftest-2024'
    const b64Text = 'bHgtc2VsZnRlc3QtMjAyNA=='
    const cipher = await aesEncrypt(b64Text, b64Key, b64Iv, AES_MODE.CBC_128_PKCS7Padding)
    if (!cipher) throw new Error('加密返回空')
    const back = await aesDecrypt(cipher, b64Key, b64Iv, AES_MODE.CBC_128_PKCS7Padding)
    if (back !== expected) throw new Error(`往返不一致：${JSON.stringify(back)}`)
    return 'ok'
  }))

  items.push(await runItem('RSA 往返', async() => {
    const key = await generateRsaKey()
    if (!key.publicKey || !key.privateKey) throw new Error('生成密钥为空')
    const b64Plain = 'bHg=' // base64('lx')
    const cipher = rsaEncryptSync(b64Plain, key.publicKey, RSA_PADDING.OAEPWithSHA1AndMGF1Padding)
    if (!cipher) throw new Error('加密返回空')
    const plain = rsaDecryptSync(cipher, key.privateKey, RSA_PADDING.OAEPWithSHA1AndMGF1Padding)
    if (plain !== 'lx') throw new Error(`往返不一致：${JSON.stringify(plain)}`)
    return 'ok'
  }, { timeout: 10000 }))

  items.push(await runItem('缓存统计', async() => {
    // 原生返回的是字符串形式的字节数（JS 封装层用 Math.trunc 转换），
    // 刚安装时目录为空、返回 "0" 属于正常值，不能当异常
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const raw = await (NativeModules as any).CacheModule.getAppCacheSize() as number | string
    const size = Math.trunc(Number(raw))
    if (Number.isNaN(size) || size < 0) throw new Error(`返回值异常：${String(raw)}`)
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }))

  items.push(await runItem('播放器模块', async() => {
    const tp = (NativeModules as any).TrackPlayerModule
    if (!tp) throw new Error('TrackPlayerModule 未注册')
    // 曾经闪退的方法：必须存在（iOS 只接受 1 个业务参数）
    if (typeof tp.updateNowPlayingMetadata !== 'function') throw new Error('缺少 updateNowPlayingMetadata')
    if (typeof tp.setupPlayer !== 'function') throw new Error('缺少 setupPlayer')
    if (typeof tp.add !== 'function') throw new Error('缺少 add')
    return '方法齐全'
  }))

  // 播放器可能尚未初始化（初始化发生在进入首页后），此时 getState 取值属于
  // 「预期内的未知」，不能算失败——否则每次启动都会弹一个吓人的错误框。
  items.push(await runItem('播放器状态', async() => {
    const tp = (NativeModules as any).TrackPlayerModule
    if (!tp) throw new Error('TrackPlayerModule 未注册')
    const state = await withTimeout(Promise.resolve(tp.getState()), 4000, 'getState')
    const queue = await withTimeout(Promise.resolve(tp.getQueue()), 4000, 'getQueue')
    if (!Array.isArray(queue)) throw new Error('getQueue 未返回数组')
    return `state=${String(state)} 队列=${queue.length}`
  }, { soft: true }))

  // 播放链路：真正走一次 setupPlayer → add → play，并校验播放位置在前进。
  // 历史闪退（NSRangeException index 3 beyond bounds）就发生在「点播放」这一刻，
  // 空闲不点永远测不到，所以必须有这一项。
  // 默认不跑：只有 CI 预置了 @lx_ci_playback 才执行，避免交付版本一启动就出声。
  //
  // 注意：必须走 react-native-track-player 的 JS 封装，不能直接调 NativeModules：
  // 原生 add 声明的是 add(trackDicts, before, resolve, reject) 两个业务参数，
  // 封装层会自动补 -1；直接传 1 个参数会让桥接层把 resolve 回调错位塞进 before，
  // 随后 reject 调用到非函数指针，直接 SIGSEGV（实测崩溃栈已确认）。
  items.push(await runItem('播放链路', async() => {
    const flag = await getData<boolean>('@lx_ci_playback').catch(() => null)
    if (flag !== true) return 'skipped（仅 CI 开启）'
    const url = resolveDefaultTrackUrl()
    if (!url) throw new Error('内置音频未解析出 uri')
    const TrackPlayer = (await import('react-native-track-player')).default
    try {
      await withTimeout(TrackPlayer.setupPlayer({}), 8000, 'setupPlayer')
    } catch {
      // 播放器可能已被正常流程初始化，此时重复 setup 会抛错，属预期
    }
    await withTimeout(Promise.resolve(TrackPlayer.add([{
      id: 'ci-selftest',
      url,
      title: '自检音轨',
      artist: 'CI',
      duration: 2,
    }])), 8000, 'add')
    await withTimeout(Promise.resolve(TrackPlayer.play()), 8000, 'play')
    await new Promise<void>((resolve) => { setTimeout(resolve, 1500) })
    const state = await withTimeout(Promise.resolve(TrackPlayer.getState()), 5000, 'getState')
    const position = Number(await withTimeout(Promise.resolve(TrackPlayer.getPosition()), 5000, 'getPosition'))
    if (!(position > 0)) throw new Error(`播放位置未前进：state=${String(state)} pos=${String(position)}`)
    // 清理队列，避免这段测试影响后续界面状态
    try { await Promise.resolve(TrackPlayer.reset()) } catch { /* 忽略 */ }
    return `state=${String(state)} 位置=${position.toFixed(2)}s`
  }, { soft: true, timeout: 25000 }))

  items.push(await runItem('网络', async() => {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 6000)
    try {
      const res = await fetch('https://music.163.com/api/search/get/web?s=test&type=1&limit=1', {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return `HTTP ${res.status}`
    } finally {
      clearTimeout(timer)
    }
  }, { soft: true, timeout: 9000 }))

  return items
}

/** 汇总成一行文本，用于 toast / 日志 */
export const summarize = (items: SelfTestItem[]) => {
  const failed = items.filter(i => !i.ok)
  const hard = failed.filter(i => !i.soft)
  const passed = items.length - failed.length
  return {
    passed,
    total: items.length,
    hardFailed: hard.length,
    text: failed.length
      ? `自检 ${passed}/${items.length} 通过\n` + failed.map(i => `${i.soft ? '⚠' : '✗'} ${i.name}：${i.detail}`).join('\n')
      : `自检全部通过 ${passed}/${items.length}`,
  }
}
