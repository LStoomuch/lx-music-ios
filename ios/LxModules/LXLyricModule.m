//
//  LXLyricModule.m
//  LxModules
//
//  对应 Android: cn.toside.music.mobile.lyric.LyricModule
//
//  ⚠️ 能力差异：Android 通过 SYSTEM_ALERT_WINDOW 把歌词绘制在系统级悬浮窗（LyricView/LyricTextView），
//  iOS 不存在任何第三方应用可用的全局悬浮窗 API（仅系统 Picture in Picture / Live Activity 可用，
//  且无法承载逐字渲染的歌词视图）。因此本模块在 iOS 上只保留与 JS 侧同签名的空实现，
//  保证 src/utils/nativeModules/lyricDesktop.ts 的调用不会抛错；桌面歌词功能在 iOS 上关闭，
//  UI 入口已由 JS 侧按平台隐藏。
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface LXLyricModule : RCTEventEmitter <RCTBridgeModule>
@end

@implementation LXLyricModule

RCT_EXPORT_MODULE(LyricModule)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"set-position", @"lyric-line-play" ];
}

#pragma mark - 歌词文本事件

RCT_EXPORT_METHOD(setSendLyricTextEvent:(BOOL)isSend
                               resolver:(RCTPromiseResolveBlock)resolve
                               rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

#pragma mark - 悬浮窗

RCT_EXPORT_METHOD(showDesktopLyric:(NSDictionary *)options
                          resolver:(RCTPromiseResolveBlock)resolve
                          rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(hideDesktopLyric:(RCTPromiseResolveBlock)resolve
                          rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(checkOverlayPermission:(RCTPromiseResolveBlock)resolve
                                rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(openOverlayPermissionActivity:(RCTPromiseResolveBlock)resolve
                                       rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

#pragma mark - 播放进度同步

RCT_EXPORT_METHOD(play:(double)time
              resolver:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(pause:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setLyric:(NSString *)lyric
               translation:(NSString *)translation
                    romalrc:(NSString *)romalrc
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setPlaybackRate:(double)rate
                         resolver:(RCTPromiseResolveBlock)resolve
                         rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

#pragma mark - 样式

RCT_EXPORT_METHOD(toggleTranslation:(BOOL)isShowTranslation
                           resolver:(RCTPromiseResolveBlock)resolve
                           rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(toggleRoma:(BOOL)isShowRoma
                    resolver:(RCTPromiseResolveBlock)resolve
                    rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(toggleLock:(BOOL)isLock
                    resolver:(RCTPromiseResolveBlock)resolve
                    rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setColor:(NSString *)unplayColor
               playedColor:(NSString *)playedColor
               shadowColor:(NSString *)shadowColor
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setAlpha:(double)alpha
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setTextSize:(double)size
                    resolver:(RCTPromiseResolveBlock)resolve
                    rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setShowToggleAnima:(BOOL)isShowToggleAnima
                            resolver:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setSingleLine:(BOOL)isSingleLine
                       resolver:(RCTPromiseResolveBlock)resolve
                       rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setPosition:(double)x
                            y:(double)y
                     resolver:(RCTPromiseResolveBlock)resolve
                     rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setMaxLineNum:(NSInteger)maxLineNum
                       resolver:(RCTPromiseResolveBlock)resolve
                       rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setWidth:(double)width
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(setLyricTextPosition:(NSString *)textX
                                 textY:(NSString *)textY
                              resolver:(RCTPromiseResolveBlock)resolve
                              rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

@end
