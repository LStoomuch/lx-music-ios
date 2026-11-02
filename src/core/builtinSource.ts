import { addUserApi, getUserApiList, removeUserApi } from '@/utils/data'
import { getData, saveData } from '@/plugins/storage'
import { setUserApiList } from '@/core/userApi'
import { builtinUserApiName, builtinUserApiScript } from '@/config/builtinUserApi'
import { updateSetting } from './common'
import settingState from '@/store/setting/state'

/**
 * 洛雪本身不内置任何音源：没有自定义源时，所有在线歌曲都取不到播放地址，
 * 表现为「点播放没声音、底部一直闪、每 5 秒跳下一首」。
 *
 * 这里在首次启动时自动导入一份内置音源（直连酷我官方取址接口），
 * 让应用开箱即可播放。用户在「设置 → 音乐来源 → 自定义源管理」里
 * 换成自己的源、或把源删掉，都不会被再次塞回来（用 seeded 标记记住）。
 */

// v2 = 酷我直连（v1 是第三方聚合 API，已因配额/地域问题失效）
const SEEDED_KEY = '@builtin_source_seeded_v2'
// 历史版本内置进来的第三方聚合源，升级时顺手清掉，免得用户选错
const LEGACY_BUILTIN_NAMES = ['聚合API接口 (CF)']

/** 供自检读取的初始化轨迹，出问题时不用靠猜 */
export const builtinSourceDiag = {
  list: -1,
  picked: '',
  seeded: false,
  reason: '',
}

const selectApi = async(id: string) => {
  await updateSetting({ 'common.apiSource': id })
  settingState.setting['common.apiSource'] = id
}

const dropLegacyBuiltin = async(list: LX.UserApi.UserApiInfo[]) => {
  const ids = list.filter(api => LEGACY_BUILTIN_NAMES.includes(api.name)).map(api => api.id)
  if (!ids.length) return
  try {
    await removeUserApi(ids)
    // removeUserApi 只改持久化数据，内存列表要重新同步
    setUserApiList(await getUserApiList())
  } catch (err) {
    console.log('drop legacy builtin source failed', err)
  }
}

export const ensureBuiltinUserApi = async(): Promise<string | null> => {
  const list = await getUserApiList()
  builtinSourceDiag.list = list.length
  const current = settingState.setting['common.apiSource']
  const currentValid = !!current && list.some(api => api.id === current)

  const builtin = list.find(api => api.name === builtinUserApiName)
  if (builtin) {
    // 内置源已就位，只需保证它被选中
    if (!currentValid) {
      await selectApi(builtin.id)
      builtinSourceDiag.picked = builtin.id
      builtinSourceDiag.reason = 'builtin-reselect'
      return builtin.id
    }
    await dropLegacyBuiltin(list)
    builtinSourceDiag.reason = 'builtin-present'
    return null
  }

  if (await getData<boolean>(SEEDED_KEY)) {
    // 用户自己把内置源删了。此时如果还留着别的源，至少保证有一个被选中，
    // 否则用户会处于「有音源但等于没有」的状态：点播放没反应。
    if (list.length && !currentValid) {
      const pick = list[0].id
      await selectApi(pick)
      builtinSourceDiag.picked = pick
      builtinSourceDiag.reason = 'reselect-other'
      return pick
    }
    builtinSourceDiag.reason = 'seeded-before-but-missing'
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
  await selectApi(info.id)
  // 关键：setApiSource → setUserApi 是从 store 的 state.list 里按 id 找源的，
  // 而 initUserApi 是在本函数之前跑的（那时还没有任何源，列表为空）。
  // 不同步这份内存列表的话，会直接抛 "api not found"，
  // 于是「源已经导入了、却永远不生效」，表现仍是点播放没声音。
  setUserApiList(await getUserApiList())
  await dropLegacyBuiltin(await getUserApiList())
  builtinSourceDiag.seeded = true
  builtinSourceDiag.picked = info.id
  builtinSourceDiag.reason = 'seeded'
  return info.id
}
