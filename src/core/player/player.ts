import { isInitialized, initial as playerInitial, isEmpty, setPause, setPlay, setResource, setStop, initTrackInfo } from '@/plugins/player'
import {
  setStatusText,
} from '@/core/player/playStatus'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import {
  getList,
  setPlayMusicInfo,
  setMusicInfo,
  setPlayListId,
} from '@/core/player/playInfo'
import {
  clearPlayedList,
  addPlayedList,
  removePlayedList,
} from '@/core/player/playedList'
import {
  clearTempPlayeList,
  removeTempPlayList,
} from '@/core/player/tempPlayList'
import { getMusicUrl, getPicPath, getLyricInfo } from '@/core/music'
import { requestMsg } from '@/utils/message'
import { getRandom } from '@/utils/common'
import { filterList } from './utils'
import BackgroundTimer from 'react-native-background-timer'
import { checkIgnoringBatteryOptimization, checkNotificationPermission, debounceBackgroundTimer, toast } from '@/utils/tools'
import { LIST_IDS } from '@/config/constant'
import { addListMusics, removeListMusics } from '@/core/list'
import { addDislikeInfo } from '@/core/dislikeList'

// import { checkMusicFileAvailable } from '@renderer/utils/music'

const createDelayNextTimeout = (delay: number) => {
  let timeout: number | null
  const clearDelayNextTimeout = () => {
    // console.log(this.timeout)
    if (timeout) {
      BackgroundTimer.clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    timeout = BackgroundTimer.setTimeout(() => {
      timeout = null
      if (global.lx.isPlayedStop) return
      console.log('delay next timeout timeout', delay)
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { clearDelayNextTimeout } = createDelayNextTimeout(5000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(100000)

const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}
/**
 * 检查音乐信息是否已更改
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  // return curMusicInfo !== playerState.playMusicInfo.musicInfo || playerState.isPlay
  return createGettingUrlId(curMusicInfo) != global.lx.gettingUrlId || curMusicInfo.id != playerState.playMusicInfo.musicInfo?.id || playerState.isPlay
}

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<string | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<string | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setStatusText(global.i18n.t('player__getting_url_delay_retry', { time }))
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true).then((result) => {
        cancelDelayRetry = null
        resolve(result)
      }).catch(async(err: any) => {
        cancelDelayRetry = null
        reject(err)
      })
    }, time * 1000)
    cancelDelayRetry = () => {
      clearTimeout(tiemout)
      cancelDelayRetry = null
      resolve(null)
    }
  })
}
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false): Promise<string | null> => {
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  setStatusText(global.i18n.t('player__getting_url'))
  addLoadTimeout()

  // const type = getPlayType(settingState.setting['player.isPlayHighQuality'], musicInfo)
  let toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo

  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh,
    allowToggleSource: false,
  }) : Promise.reject(new Error('not found'))).catch(async() => {
    return getMusicUrl({
      musicInfo,
      isRefresh,
      onToggleSource(mInfo) {
        if (diffCurrentMusicInfo(musicInfo)) return
        setStatusText(global.i18n.t('toggle_source_try'))
      },
    })
  }).then(url => {
    if (global.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return null

    return url
  }).catch(async err => {
    // console.log('err', err.message)
    if (global.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo) ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh)

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true)

    throw err
  })
}

// 连续取播放地址失败计数。
// 旧逻辑每次失败都会 addDelayNextTimeout()（5 秒后自动下一首），
// 在没有可用音源/网络不通时会变成「一直闪、一直跳、永远没声音」的死循环。
// 这里改成：连续失败两次就停下并给出明确原因。
// 注意：这个计数不能被「切歌」清零，否则熔断永远触发不到——
// 失败驱动的自动切歌正是要把计数累加起来的场景。
let playUrlFailCount = 0
const MAX_PLAY_URL_FAIL = 2
export const resetPlayUrlFailCount = () => {
  playUrlFailCount = 0
}
// preload 会对脚本返回的地址做校验（必须是 1~2048 字符的 http(s) 串），
// 不通过时只抛一句 "failed"。这属于「音源拿不出可用地址」，按音源问题处理，
// 否则会先白跳一首歌（底部闪一下）才停，正是用户反馈的那个现象。
const isSourceMissingError = (message: string) => /Api is not found|source init failed|api not found|^failed$/i.test(message)

export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean) => {
  // addLoadTimeout()
  if (!diffCurrentMusicInfo(musicInfo)) return
  if (cancelDelayRetry) cancelDelayRetry()
  global.lx.gettingUrlId = createGettingUrlId(musicInfo)
  void getMusicPlayUrl(musicInfo, isRefresh).then((url) => {
    if (!url) return
    playUrlFailCount = 0
    setResource(musicInfo, url, playerState.progress.nowPlayTime)
  }).catch((err: any) => {
    console.log(err)
    const message = (err?.message as string) ?? ''
    global.app_event.error()
    if (isSourceMissingError(message)) {
      setStatusText(global.i18n.t('player__no_usable_source'))
      toast(global.i18n.t('player__no_usable_source'), 'long')
      return
    }
    playUrlFailCount++
    // 连续失败到上限：停在这里并说明原因。
    // 绝不能在这里排「自动下一首」——取不到地址时跳歌只会跳进下一首继续失败，
    // 表现就是底部播放栏一直闪、永远没声音（用户反馈的那个现象）。
    if (playUrlFailCount >= MAX_PLAY_URL_FAIL) {
      setStatusText(global.i18n.t('player__get_url_failed_stop'))
      return
    }
    setStatusText(message)
  }).finally(() => {
    if (musicInfo === playerState.playMusicInfo.musicInfo) {
      global.lx.gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

// 恢复上次播放的状态
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playerState.playMusicInfo.musicInfo
  if (!musicInfo) return

  setTimeout(() => {
    global.app_event.setProgress(settingState.setting['player.isSavePlayTime'] ? restorePlayInfo.time : 0, restorePlayInfo.maxTime)
  })

  const playMusicInfo = playerState.playMusicInfo

  void initTrackInfo(musicInfo, playerState.musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url
    ) return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    global.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setStatusText(global.i18n.t('lyric__load_error'))
  })

  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)
}


const debouncePlay = debounceBackgroundTimer((musicInfo: LX.Player.PlayMusic) => {
  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playerState.playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playerState.playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url) return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    global.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
    setStatusText(global.i18n.t('lyric__load_error'))
  })
}, 200)

// 处理音乐播放
const handlePlay = async() => {
  if (!isInitialized()) {
    await checkNotificationPermission()
    void checkIgnoringBatteryOptimization()
    try {
      await playerInitial({
        volume: settingState.setting['player.volume'],
        playRate: settingState.setting['player.playbackRate'],
        cacheSize: settingState.setting['player.cacheSize'] ? parseInt(settingState.setting['player.cacheSize']) : 0,
        isHandleAudioFocus: settingState.setting['player.isHandleAudioFocus'],
        isEnableAudioOffload: settingState.setting['player.isEnableAudioOffload'],
      })
    } catch (err) {
      // 初始化失败时继续往下走只会让 add/skip 连带失败，界面停在「加载中」且没有任何提示；
      // 这里直接复位状态，让用户看到失败而不是假死（原生侧已用浮层展示具体原因）
      console.log('player init error', err)
      global.app_event.error()
      return
    }
  }

  global.lx.isPlayedStop &&= false
  // 这里不能重置 playUrlFailCount：自动切歌也是走 handlePlay()，
  // 清零会让「连续失败就停」的熔断永远触发不到，形成 失败→切歌→再失败 的死循环。
  resetRandomNextMusicInfo()

  if (global.lx.restorePlayInfo) {
    void handleRestorePlay(global.lx.restorePlayInfo)
    global.lx.restorePlayInfo = null
    return
  }

  const playMusicInfo = playerState.playMusicInfo
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return

  // 队列里什么都没有、也没在播时，native stop() 只会让播放栏白抖一下
  if (!isEmpty()) await setStop()
  global.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()


  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)

  debouncePlay(musicInfo)
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param id 歌曲id
 */
export const playListById = async(listId: string, id: string) => {
  const prevListId = playerState.playInfo.playerListId
  setPlayListId(listId)
  const musicInfo = getList(listId).find(m => m.id == id)
  if (!musicInfo) return
  setPlayMusicInfo(listId, musicInfo)
  if (settingState.setting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  // 用户主动点播：重新给满容错次数
  resetPlayUrlFailCount()
  await handlePlay()
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param index 播放的歌曲位置
 */
export const playList = async(listId: string, index: number) => {
  const prevListId = playerState.playInfo.playerListId
  setPlayListId(listId)
  setPlayMusicInfo(listId, getList(listId)[index])
  if (settingState.setting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  // 用户主动点播：重新给满容错次数
  resetPlayUrlFailCount()
  await handlePlay()
}

const handleToggleStop = async() => {
  await stop()
  setTimeout(() => {
    setPlayMusicInfo(null, null)
  })
}


const randomNextMusicInfo = {
  info: null as LX.Player.PlayMusicInfo | null,
  // index: -1,
}
export const resetRandomNextMusicInfo = () => {
  if (randomNextMusicInfo.info) {
    randomNextMusicInfo.info = null
    // randomNextMusicInfo.index = -1
  }
}

export const getNextPlayMusicInfo = async(): Promise<LX.Player.PlayMusicInfo | null> => {
  if (playerState.tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = playerState.tempPlayList[0]
    return playMusicInfo
  }

  if (playerState.playMusicInfo.musicInfo == null) return null

  if (randomNextMusicInfo.info) return randomNextMusicInfo.info

  const playMusicInfo = playerState.playMusicInfo
  const playInfo = playerState.playInfo
  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return null
  const currentList = getList(currentListId)

  const playedList = playerState.playedList
  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo!.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return null
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = settingState.setting['player.togglePlayMethod']
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      return null
  }
  if (nextIndex < 0) return null

  const nextPlayMusicInfo = {
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  }

  if (togglePlayMethod == 'random') {
    randomNextMusicInfo.info = nextPlayMusicInfo
    // randomNextMusicInfo.index = nextIndex
  }
  return nextPlayMusicInfo
}

const handlePlayNext = async(playMusicInfo: LX.Player.PlayMusicInfo) => {
  setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  await handlePlay()
}
// 「自动切歌风暴」熔断：正常情况下自动切歌由「一首歌播完」触发，
// 频率不可能高。若短时间内连续自动切了很多次，说明链路里有人在自激
// （典型是取地址失败→自动下一首→再失败），此时必须停下来，
// 否则底部播放栏会一直闪、永远出不了声。
const autoNextTimes: number[] = []
const AUTO_NEXT_WINDOW = 20000
const AUTO_NEXT_LIMIT = 6
const isAutoNextStorm = () => {
  const now = Date.now()
  while (autoNextTimes.length && now - autoNextTimes[0] > AUTO_NEXT_WINDOW) autoNextTimes.shift()
  autoNextTimes.push(now)
  return autoNextTimes.length > AUTO_NEXT_LIMIT
}
export const resetAutoNextStorm = () => { autoNextTimes.length = 0 }

/**
 * 下一曲
 * @param isAutoToggle 是否自动切换
 * @returns
 */
export const playNext = async(isAutoToggle = false): Promise<void> => {
  if (isAutoToggle) {
    if (isAutoNextStorm()) {
      console.log('auto next storm, stop')
      setStatusText(global.i18n.t('player__get_url_failed_stop'))
      return
    }
  } else {
    resetAutoNextStorm()
  }

  if (playerState.tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = playerState.tempPlayList[0]
    removeTempPlayList(0)
    await handlePlayNext(playMusicInfo)
    return
  }

  const playMusicInfo = playerState.playMusicInfo
  const playInfo = playerState.playInfo
  if (playMusicInfo.musicInfo == null) return handleToggleStop()

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return handleToggleStop()
  const currentList = getList(currentListId)

  const playedList = playerState.playedList

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) {
      await handlePlayNext(playedList[index])
      return
    }
  }
  if (randomNextMusicInfo.info) {
    await handlePlayNext(randomNextMusicInfo.info)
    return
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return handleToggleStop()
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = settingState.setting['player.togglePlayMethod']
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
        togglePlayMethod = 'listLoop'
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      nextIndex = -1
      return
  }
  if (nextIndex < 0) return

  await handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 上一曲
 */
export const playPrev = async(isAutoToggle = false): Promise<void> => {
  const playMusicInfo = playerState.playMusicInfo
  if (playMusicInfo.musicInfo == null) return handleToggleStop()
  const playInfo = playerState.playInfo

  const currentListId = playInfo.playerListId
  if (!currentListId) return handleToggleStop()
  const currentList = getList(currentListId)

  const playedList = playerState.playedList
  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) - 1; index > -1; index--) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index > -1) {
      await handlePlayNext(playedList[index])
      return
    }
  }

  // const isCheckFile = findNum > 2
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: false,
  })
  if (!filteredList.length) return handleToggleStop()

  // let currentIndex = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex
  if (!playMusicInfo.isTempPlay) {
    let togglePlayMethod = settingState.setting['player.togglePlayMethod']
    if (!isAutoToggle) {
      switch (togglePlayMethod) {
        case 'list':
        case 'singleLoop':
        case 'none':
          togglePlayMethod = 'listLoop'
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
        nextIndex = playerIndex === 0 ? filteredList.length - 1 : playerIndex - 1
        break
      case 'singleLoop':
        break
      default:
        nextIndex = -1
        return
    }
    if (nextIndex < 0) return
  }


  await handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 恢复播放
 */
export const play = () => {
  if (playerState.playMusicInfo.musicInfo == null) return
  if (isEmpty()) {
    if (createGettingUrlId(playerState.playMusicInfo.musicInfo) != global.lx.gettingUrlId) setMusicUrl(playerState.playMusicInfo.musicInfo)
    return
  }
  void setPlay()
}

/**
 * 暂停播放
 */
export const pause = async() => {
  await setPause()
}

/**
 * 停止播放
 */
export const stop = async() => {
  await setStop()
  setTimeout(() => {
    global.app_event.stop()
  })
}

/**
 * 播放、暂停播放切换
 */
export const togglePlay = () => {
  global.lx.isPlayedStop &&= false
  // 用户主动点播放/暂停：重置失败熔断，让「再试一次」真的能再试
  resetPlayUrlFailCount()
  resetAutoNextStorm()
  if (playerState.isPlay) {
    void pause()
  } else {
    play()
  }
}

/**
 * 收藏当前播放的歌曲
 */
export const collectMusic = () => {
  if (!playerState.playMusicInfo.musicInfo) return
  void addListMusics(LIST_IDS.LOVE, [
    'progress' in playerState.playMusicInfo.musicInfo
      ? playerState.playMusicInfo.musicInfo.metadata.musicInfo
      : playerState.playMusicInfo.musicInfo,
  ], settingState.setting['list.addMusicLocationType'])
}

/**
 * 取消收藏当前播放的歌曲
 */
export const uncollectMusic = () => {
  if (!playerState.playMusicInfo.musicInfo) return
  void removeListMusics(LIST_IDS.LOVE, [
    'progress' in playerState.playMusicInfo.musicInfo
      ? playerState.playMusicInfo.musicInfo.metadata.musicInfo.id
      : playerState.playMusicInfo.musicInfo.id,
  ])
}

/**
 * 不喜欢当前播放的歌曲
 */
export const dislikeMusic = async() => {
  if (!playerState.playMusicInfo.musicInfo) return
  const minfo = 'progress' in playerState.playMusicInfo.musicInfo ? playerState.playMusicInfo.musicInfo.metadata.musicInfo : playerState.playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  await playNext(true)
}

