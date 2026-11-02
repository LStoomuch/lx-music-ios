import { addUserApi, getUserApiList } from '@/utils/data'
import { getData, saveData } from '@/plugins/storage'
import { setUserApiList } from '@/core/userApi'
import { builtinUserApiScript } from '@/config/builtinUserApi'
import { updateSetting } from './common'
import settingState from '@/store/setting/state'

/**
 * 洛雪本身不内置任何音源：没有自定义源时，所有在线歌曲都取不到播放地址，
 * 表现为「点播放没声音、底部一直闪、每 5 秒跳下一首」。
 *
 * 这里在「从未导入过任何音源」的首次启动时，自动导入一份内置的社区音源，
 * 让应用开箱即可播放。用户之后在「设置 → 音乐来源 → 自定义源管理」里
 * 换成自己的源、或把源全部删掉，都不会被再次塞回来（用 seeded 标记记住）。
 */
const SEEDED_KEY = '@builtin_source_seeded'

/** 供自检读取的初始化轨迹，出问题时不用靠猜 */
export const builtinSourceDiag = {
  list: -1,
  picked: '',
  seeded: false,
  reason: '',
}

export const ensureBuiltinUserApi = async(): Promise<string | null> => {
  const list = await getUserApiList()
  builtinSourceDiag.list = list.length
  const current = settingState.setting['common.apiSource']

  if (list.length) {
    // 有源但没选中（例如上次导入到一半被系统杀掉，@setting_v1 还没写入），
    // 这里补选中，否则用户会处于「有音源但等于没有」的状态：点播放没反应。
    if (!current || !list.some(api => api.id === current)) {
      const pick = list[0].id
      await updateSetting({ 'common.apiSource': pick })
      settingState.setting['common.apiSource'] = pick
      builtinSourceDiag.picked = pick
      builtinSourceDiag.reason = 'reselect'
      return pick
    }
    builtinSourceDiag.reason = 'already-selected'
    return null
  }
  if (await getData<boolean>(SEEDED_KEY)) {
    builtinSourceDiag.reason = 'seeded-before-but-empty'
    return null
  }

  let info: LX.UserApi.UserApiInfo
  try {
    info = await addUserApi(builtinUserApiScript)
  } catch (err) {
    builtinSourceDiag.reason = 'import-failed:' + String((err as any)?.message ?? err)
    console.log('builtin user api import failed', err)
    return null
  }
  await saveData(SEEDED_KEY, true)
  await updateSetting({ 'common.apiSource': info.id })
  settingState.setting['common.apiSource'] = info.id
  // 关键：setApiSource → setUserApi 是从 store 的 state.list 里按 id 找源的，
  // 而 initUserApi 是在本函数之前跑的（那时还没有任何源，列表为空）。
  // 不同步这份内存列表的话，会直接抛 "api not found"，
  // 于是「源已经导入了、却永远不生效」，表现仍是点播放没声音。
  setUserApiList(await getUserApiList())
  builtinSourceDiag.seeded = true
  builtinSourceDiag.picked = info.id
  builtinSourceDiag.reason = 'seeded'
  return info.id
}
