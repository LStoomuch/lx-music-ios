// iOS 版抽屉（Android 见 LxDrawer.android.tsx）
//
// 为什么需要这个文件：RN 的 `DrawerLayoutAndroid` 在 iOS 上直接映射为
// `UnimplementedView`（一个空占位视图，没有任何原生实现），既不会报错也不会渲染内容。
// 首页的 Header / 列表 / 侧边菜单全都放在抽屉里，所以 iOS 上表现为「只剩底部播放栏、
// 上面一片空白」。
//
// 这里用 Animated + PanResponder 复刻 Android 抽屉的核心交互：
//   - 关闭态：从屏幕边缘向内滑动可以拉出；
//   - 展开态：点击遮罩或向反方向滑动可以关闭；
//   - 对外暴露 openDrawer / closeDrawer，语义与 DrawerLayoutAndroid 一致。

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import type { LxDrawerHandle, LxDrawerProps } from './lxDrawerTypes'

/** 关闭态下允许触发「滑动拉出」的边缘宽度 */
const EDGE_WIDTH = 26
const ANIM_DURATION = 220
const SCRIM_OPACITY = 0.36
/** 触发滑动的最小水平位移 */
const MIN_SWIPE_DISTANCE = 10

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const LxDrawer = forwardRef<LxDrawerHandle, LxDrawerProps>(({
  drawerWidth,
  drawerPosition = 'left',
  drawerBackgroundColor,
  renderNavigationView,
  onDrawerOpen,
  onDrawerClose,
  style,
  children,
}, ref) => {
  const progress = useRef(new Animated.Value(0)).current
  // progress 的镜像值：原生驱动动画期间 JS 拿不到实时值，滑动开始时用最近一次监听值作为起点
  const currentRef = useRef(0)
  const openedRef = useRef(false)
  const startRef = useRef(0)
  const [opened, setOpened] = useState(false)

  const widthRef = useRef(drawerWidth)
  widthRef.current = drawerWidth
  const positionRef = useRef(drawerPosition)
  positionRef.current = drawerPosition
  const containerWidthRef = useRef(0)
  const callbackRef = useRef({ onDrawerOpen, onDrawerClose })
  callbackRef.current = { onDrawerOpen, onDrawerClose }

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      currentRef.current = value
    })
    return () => {
      progress.removeListener(id)
    }
  }, [progress])

  const setOpenedState = useCallback((next: boolean) => {
    if (openedRef.current === next) return
    openedRef.current = next
    setOpened(next)
    if (next) callbackRef.current.onDrawerOpen?.()
    else callbackRef.current.onDrawerClose?.()
  }, [])

  const animateTo = useCallback((to: 0 | 1) => {
    Animated.timing(progress, {
      toValue: to,
      duration: ANIM_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) currentRef.current = to
    })
    setOpenedState(to === 1)
  }, [progress, setOpenedState])

  useImperativeHandle(ref, () => ({
    openDrawer() {
      animateTo(1)
    },
    closeDrawer() {
      animateTo(0)
    },
  }), [animateTo])

  const panResponder = useMemo(() => {
    // 左抽屉：手指右滑（dx > 0）是「打开」方向；右抽屉相反
    const direction = () => (positionRef.current === 'left' ? 1 : -1)
    const getScreenWidth = () => containerWidthRef.current || Dimensions.get('window').width

    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (evt, gesture) => {
        const { dx, dy } = gesture
        if (Math.abs(dx) < MIN_SWIPE_DISTANCE) return false
        if (Math.abs(dx) <= Math.abs(dy) * 1.2) return false

        const width = widthRef.current || 1
        const screenWidth = getScreenWidth()
        const startX = evt.nativeEvent.pageX - dx
        const dir = direction()

        if (openedRef.current) {
          // 展开时只处理遮罩区域上的滑动，抽屉内部的滑动交给抽屉内容自己处理
          const inDrawer = positionRef.current === 'left'
            ? startX <= width
            : startX >= screenWidth - width
          if (inDrawer) return false
          return dx * dir < 0
        }

        const fromEdge = positionRef.current === 'left'
          ? startX <= EDGE_WIDTH
          : startX >= screenWidth - EDGE_WIDTH
        if (!fromEdge) return false
        return dx * dir > 0
      },
      onPanResponderGrant: () => {
        startRef.current = currentRef.current
        progress.stopAnimation()
      },
      onPanResponderMove: (evt, gesture) => {
        const width = widthRef.current || 1
        const dir = direction()
        progress.setValue(clamp01(startRef.current + (gesture.dx * dir) / width))
      },
      onPanResponderRelease: (evt, gesture) => {
        const dir = direction()
        const velocity = gesture.vx * dir
        let to: 0 | 1
        if (velocity > 0.3) to = 1
        else if (velocity < -0.3) to = 0
        else to = currentRef.current > 0.5 ? 1 : 0
        animateTo(to)
      },
      onPanResponderTerminate: () => {
        animateTo(currentRef.current > 0.5 ? 1 : 0)
      },
      onPanResponderTerminationRequest: () => false,
    })
  }, [progress, animateTo])

  const translateX = useMemo(() => progress.interpolate({
    inputRange: [0, 1],
    outputRange: drawerPosition === 'left' ? [-drawerWidth, 0] : [drawerWidth, 0],
  }), [progress, drawerPosition, drawerWidth])

  const scrimOpacity = useMemo(() => progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCRIM_OPACITY],
  }), [progress])

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    containerWidthRef.current = e.nativeEvent.layout.width
  }, [])

  return (
    <View style={[styles.container, style]} onLayout={handleLayout} {...panResponder.panHandlers}>
      <View style={styles.content}>{children}</View>
      <Animated.View
        pointerEvents={opened ? 'auto' : 'none'}
        style={[styles.scrim, { opacity: scrimOpacity }]}
      >
        <Pressable style={styles.fill} onPress={() => { animateTo(0) }} />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          drawerPosition === 'left' ? styles.drawerLeft : styles.drawerRight,
          {
            width: drawerWidth,
            backgroundColor: drawerBackgroundColor,
            transform: [{ translateX }],
          },
        ]}
      >
        {renderNavigationView()}
      </Animated.View>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
  fill: {
    flex: 1,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  drawerLeft: {
    left: 0,
  },
  drawerRight: {
    right: 0,
  },
})

export default LxDrawer
