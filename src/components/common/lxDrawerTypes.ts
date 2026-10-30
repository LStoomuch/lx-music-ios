// LxDrawer 的公共类型定义。
// Android 用 RN 原生 DrawerLayoutAndroid 实现，iOS 用 JS 实现（见 LxDrawer.tsx）。

import type { ReactNode, ReactElement, StyleProp, ViewStyle } from 'react'

export interface LxDrawerHandle {
  openDrawer: () => void
  closeDrawer: () => void
}

export interface LxDrawerProps {
  /** 抽屉面板宽度（RN 单位） */
  drawerWidth: number
  /** 抽屉从哪一侧滑出，默认 left */
  drawerPosition?: 'left' | 'right'
  /** 抽屉面板背景色 */
  drawerBackgroundColor?: string
  /** 抽屉内容 */
  renderNavigationView: () => ReactElement
  onDrawerOpen?: () => void
  onDrawerClose?: () => void
  /** 仅 Android 有意义，iOS 实现忽略 */
  keyboardDismissMode?: 'none' | 'on-drag' | 'interactive'
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}
