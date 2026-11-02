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
import playerState from '@/store/player/state'
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
import settingState from '@/store/setting/state'

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
  // 用户反馈的问题恰好发生在「点播放之后」：底部一直闪、没有声音。
  // 所以这条链路必须在设备上真跑一遍：搜索 → 入列表 → 播放 → 读状态与进度。
  // 本地播放：走 App 自己的「本地音乐」通道（列表面 → 播放器 → 原生），验证能否真的出声。
  // 千万不要直接操作原生队列（add/skip）：JS 侧的曲目表会与原生队列脱节，
  // 事件里的 getCurrentTrackId 取到 undefined，实测会触发 10 万次 stop 的死循环。
  // 本地音乐不依赖网络，因此不受音源服务地域限制，是最稳的「出声」证据。
  items.push(await runItem('本地播放', async() => {
    const flag = await getData<boolean>('@lx_ci_playback').catch(() => null)
    if (flag !== true) return 'skipped（仅 CI 开启）'
    const assetUri = resolveDefaultTrackUrl()
    if (!assetUri) throw new Error('内置音频未解析出 uri')
    // 去掉 file:// 前缀即可得到可直接 stat 的绝对路径（不要用正则，容易转义出错）
    const filePath = decodeURIComponent(assetUri.startsWith('file://') ? assetUri.slice(7) : assetUri)
    const { addListMusics } = await import('@/core/list')
    const { playListById } = await import('@/core/player/player')
    const { LIST_IDS } = await import('@/config/constant')
    const info = {
      id: 'local__lx_selftest',
      name: '自检音轨',
      singer: 'CI',
      source: 'local',
      interval: '00:02',
      meta: { songId: filePath, albumName: '', filePath, ext: 'mp3' },
    } as LX.Music.MusicInfoLocal
    // 先确认内置文件真的能按路径 stat 到，否则本地播放必然静默失败
    const { existsFile } = await import('@/utils/fs')
    const fileExists = await existsFile(filePath).catch(() => false)
    await addListMusics(LIST_IDS.DEFAULT, [info], 'top')
    await playListById(LIST_IDS.DEFAULT, info.id)
    // core/list 没有导出 getList（上一轮就是栽在这句，直接 undefined is not a function），
    // 改从播放器状态读当前曲目，这本来就是「到底切没切过去」的判定依据
    const playingId = String(playerState.playMusicInfo?.musicInfo?.id ?? '')
    // 内置文件只有 2 秒，播完位置会归零，必须轮询取峰值而不是只采样一次
    const TrackPlayer = (await import('react-native-track-player')).default
    let state = ''
    let position = 0
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => { setTimeout(resolve, 300) })
      state = String(await withTimeout(Promise.resolve(TrackPlayer.getState()), 5000, 'getState'))
      const pos = Number(await withTimeout(Promise.resolve(TrackPlayer.getPosition()), 5000, 'getPosition'))
      if (Number.isFinite(pos) && pos > position) position = pos
      if (position > 0.6) break
    }
    if (!(position > 0)) {
      const queue = await withTimeout(Promise.resolve(TrackPlayer.getQueue()), 5000, 'getQueue').catch(() => [])
      throw new Error(
        `播放位置未前进：state=${state} pos=${position}` +
        `｜文件=${fileExists ? '存在' : '缺失'}｜当前曲目=${playingId || '空'}` +
        `｜队列=${Array.isArray(queue) ? queue.length : '?'}` +
        `｜状态文案=${String(playerState.statusText || '空').slice(0, 40)}`,
      )
    }
    return `state=${state} 位置=${position.toFixed(2)}s`
  }, { soft: true, timeout: 40000 }))

  items.push(await runItem('自动播放', async() => {
    const flag = await getData<boolean>('@lx_ci_autoplay').catch(() => null)
    if (flag !== true) return 'skipped（仅 CI 开启）'
    const { search } = await import('@/core/search/music')
    const list = await search('告白气球', 1, 'kw')
    if (!list.length) throw new Error('搜索无结果')
    const { addListMusics } = await import('@/core/list')
    const { playListById } = await import('@/core/player/player')
    const { LIST_IDS } = await import('@/config/constant')
    const target = list[0]
    await addListMusics(LIST_IDS.DEFAULT, [target], 'top')
    await playListById(LIST_IDS.DEFAULT, target.id)
    await new Promise<void>((resolve) => { setTimeout(resolve, 6000) })
    const TrackPlayer = (await import('react-native-track-player')).default
    const state = await withTimeout(Promise.resolve(TrackPlayer.getState()), 5000, 'getState')
    const pos = Number(await withTimeout(Promise.resolve(TrackPlayer.getPosition()), 5000, 'getPosition'))
    const dur = Number(await withTimeout(Promise.resolve(TrackPlayer.getDuration()), 5000, 'getDuration'))
    const title = `${String(target.name).slice(0, 12)}`
    if (dur <= 0) throw new Error(`${title} 未加载音频：state=${String(state)} dur=${dur}`)
    return `${title} state=${String(state)} pos=${pos.toFixed(2)}s dur=${dur.toFixed(1)}s`
  }, { soft: true, timeout: 60000 }))

  items.push(await runItem('音源链路', async() => {
    const flag = await getData<boolean>('@lx_ci_source').catch(() => null)
    if (flag !== true) return 'skipped（仅 CI 开启）'
    // 音源脚本在独立 JSContext 里异步初始化，这里等它就绪（最多 20s）
    const deadline = Date.now() + 30000
    let api = (global as any).lx?.apis?.kw
    while (!api?.getMusicUrl && Date.now() < deadline) {
      await new Promise<void>((resolve) => { setTimeout(resolve, 500) })
      api = (global as any).lx?.apis?.kw
    }
    if (!api?.getMusicUrl) {
      const st = (global as any).__lx_source_state
      const bk = (global as any).__lx_source_diag
      throw new Error(
        `音源未就绪[apiSource=${String(settingState.setting['common.apiSource'] ?? '')}` +
        ` list=${String(bk?.list)} pick=${String(bk?.picked)} why=${String(bk?.reason)}` +
        ` init=${st ? `${st.status}/${st.errorMessage}` : 'no-event'}` +
        ` apis=${Object.keys((global as any).lx?.apis ?? {}).join(',') || '空'}]`,
      )
    }
    const musicInfo = {
      songmid: '228908',
      hash: '228908',
      name: '自检歌曲',
      singer: '自检',
      source: 'kw',
      interval: '04:29',
      _types: {},
      typeUrl: {},
      meta: { songId: '228908', albumName: '', picUrl: '', qualitys: [], _qualitys: {} },
    }
    // 先探一下音源服务端在设备侧是否可达，失败时能区分「网络不通」和「脚本报错」
    let net = ''
    try {
      const ping = await fetch('https://api.music.lerd.dpdns.org/init.conf')
      net = `init.conf=${ping.status}`
    } catch (err) {
      net = `init.conf=FAIL(${errText(err)})`
    }
    // 分阶段定位：音源脚本自己会发起「接口请求 → 二次请求」，最后我们还要下载音频，
    // 任何一步失败都只报一句 "Network request failed"，必须带上阶段才知道卡在哪。
    let stage = 'getUrl'
    try {
      const res = (await (api.getMusicUrl as any)(musicInfo, '128k').promise) as { url: string }
      if (!res?.url || !/^https?:/.test(res.url)) throw new Error('返回地址非法：' + String(res?.url).slice(0, 80))
      stage = 'download'
      const audio = await fetch(res.url, { headers: { Range: 'bytes=0-2047' } })
      if (!audio.ok && audio.status !== 206) throw new Error('音频不可下载 HTTP ' + audio.status)
      return `${net} ${res.url.slice(0, 32)}… HTTP ${audio.status} ${audio.headers.get('content-type') ?? ''}`
    } catch (err: any) {
      throw new Error(`${net} [${stage}] ${errText(err)}`)
    }
  }, { soft: true, timeout: 70000 }))


  items.push(await runItem('网络', async() => {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 6000)
    try {
      const res = await fetch('https://music.163.com/api/search/get/web?s=test&type=1&limit=1', {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // 音源脚本会请求 http（明文）接口，而 iOS 的 ATS 可能只放行 https。
      // 这里顺带探一条明文请求，失败时给出明确归因，避免误判成「音源坏了」。
      let plain = ''
      try {
        const r2 = await fetch('http://search.kuwo.cn/r.s?client=kt&all=test&pn=0&rn=1&encoding=utf8&rformat=json')
        plain = ` | http=${r2.status}`
      } catch (err) {
        plain = ` | http=FAIL(${errText(err)})`
      }
      return `HTTP ${res.status}${plain}`
    } finally {
      clearTimeout(timer)
    }
  }, { soft: true, timeout: 15000 }))

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
