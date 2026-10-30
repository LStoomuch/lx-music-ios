import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Platform, View, type LayoutChangeEvent, type StyleProp, type ViewStyle, type ReactElement, type ReactNode } from 'react-native'
// import { getWindowSise } from '@/utils/tools'
import { usePageVisible } from '@/store/common/hook'
import { type COMPONENT_IDS } from '@/config/constant'
import LxDrawer from './LxDrawer'
import type { LxDrawerHandle } from './lxDrawerTypes'

interface Props {
  visibleNavNames: COMPONENT_IDS[]
  widthPercentage: number
  widthPercentageMax?: number
  drawerPosition?: 'left' | 'right'
  drawerBackgroundColor?: string
  style?: StyleProp<ViewStyle>
  renderNavigationView: () => ReactElement
  children?: ReactNode
}

export interface DrawerLayoutFixedType {
  openDrawer: () => void
  closeDrawer: () => void
  fixWidth: () => void
}

const DrawerLayoutFixed = forwardRef<DrawerLayoutFixedType, Props>(({ visibleNavNames, widthPercentage, widthPercentageMax, children, ...props }, ref) => {
  const drawerLayoutRef = useRef<LxDrawerHandle>(null)
  const [w, setW] = useState<number | `${number}%`>('100%')
  const [drawerWidth, setDrawerWidth] = useState(0)
  const changedRef = useRef({ width: 0, changed: false })

  const fixDrawerWidth = useCallback(() => {
    // 「宽度 -1 再还原」是为了强制 Android 原生 DrawerLayout 重新测量，
    // iOS 用的是纯 JS 抽屉，不需要这套 dance；而且 handleLayout 会把新宽度
    // 写回 changedRef.width，继续执行会导致每次页面可见都再窄 1pt（累积收缩）。
    if (Platform.OS != 'android') return
    if (!changedRef.current.width) return
    changedRef.current.changed = true
    // console.log('usePageVisible', visible, changedRef.current.width)
    setW(changedRef.current.width - 1)
  }, [])

  // 修复 DrawerLayoutAndroid 在导航到其他屏幕再返回后无法打开的问题（仅 Android 需要）
  usePageVisible(visibleNavNames, useCallback((visible) => {
    if (!visible || !changedRef.current.width) return
    fixDrawerWidth()
  }, [fixDrawerWidth]))

  useImperativeHandle(ref, () => ({
    openDrawer() {
      drawerLayoutRef.current?.openDrawer()
    },
    closeDrawer() {
      drawerLayoutRef.current?.closeDrawer()
    },
    fixWidth() {
      fixDrawerWidth()
    },
  }), [fixDrawerWidth])


  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    // console.log('handleLayout', e.nativeEvent.layout.width, changedRef.current.width)
    const width = e.nativeEvent.layout.width
    const calcDrawerWidth = (containerWidth: number) => {
      const wp = Math.floor(containerWidth * widthPercentage)
      // console.log(wp, widthPercentageMax)
      return widthPercentageMax ? Math.min(wp, widthPercentageMax) : wp
    }

    // iOS 的抽屉是纯 JS 实现，不需要「宽度 -1 再还原」来强制 DrawerLayoutAndroid 重排
    if (Platform.OS != 'android') {
      if (changedRef.current.width == width) return
      changedRef.current.width = width
      setDrawerWidth(calcDrawerWidth(width))
      return
    }

    if (changedRef.current.changed) {
      // setW(e.nativeEvent.layout.width - 1)
      setW('100%')
      changedRef.current.changed = false
    } else {
      if (changedRef.current.width == width) return
      changedRef.current.width = width

      // 重新设置面板宽度
      setDrawerWidth(calcDrawerWidth(width))

      // 强制触发渲染以应用更改
      changedRef.current.changed = true
      setW(width - 1)
    }
  }, [widthPercentage, widthPercentageMax])

  return (
    <View
      onLayout={handleLayout}
      style={{ width: w, flex: 1 }}
    >
      <LxDrawer
        ref={drawerLayoutRef}
        keyboardDismissMode="on-drag"
        drawerWidth={drawerWidth}
        {...props}
      >
        <View style={{ marginRight: w == '100%' ? 0 : -1, flex: 1 }}>
          {children}
        </View>
      </LxDrawer>
    </View>
  )
})

// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
// })

export default DrawerLayoutFixed
