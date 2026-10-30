// Android 版抽屉：直接包一层 RN 原生 DrawerLayoutAndroid，把命令式 API 统一成 LxDrawerHandle。
// iOS 平台不会加载本文件（Metro 按平台后缀优先解析 .android.tsx）。

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { DrawerLayoutAndroid } from 'react-native'
import type { LxDrawerHandle, LxDrawerProps } from './lxDrawerTypes'

const LxDrawer = forwardRef<LxDrawerHandle, LxDrawerProps>((props, ref) => {
  const innerRef = useRef<DrawerLayoutAndroid>(null)

  useImperativeHandle(ref, () => ({
    openDrawer() {
      innerRef.current?.openDrawer()
    },
    closeDrawer() {
      innerRef.current?.closeDrawer()
    },
  }), [])

  return <DrawerLayoutAndroid ref={innerRef} {...(props as any)} />
})

export default LxDrawer
