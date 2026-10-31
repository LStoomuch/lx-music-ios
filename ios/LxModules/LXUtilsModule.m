//
//  LXUtilsModule.m
//  LxModules
//
//  对应 Android: cn.toside.music.mobile.utils.UtilsModule
//  JS 侧 src/utils/nativeModules/utils.ts 的全部方法在此实现；
//  iOS 无对应能力的接口保留同名方法并返回「无操作/无限制」语义，避免 JS 侧抛错。
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

#import <arpa/inet.h>
#import <ifaddrs.h>
#import <net/if.h>

#import "LXFontLoader.h"

@interface LXUtilsModule : RCTEventEmitter <RCTBridgeModule>
@end

/// 私有方法前置声明，避免 @implementation 内前向调用 / @selector 的隐式声明告警
@interface LXUtilsModule ()
- (NSString *)wifiIPv4Address;
- (void)handleNotificationSettings:(void (^)(BOOL enabled))completion;
- (UIViewController *)topViewController;
- (CGSize)currentWindowSize;
- (void)handleWindowSizeChanged:(NSNotification *)notification;
- (void)handleScreenStateOn:(NSNotification *)notification;
- (void)handleScreenStateOff:(NSNotification *)notification;
@end

@implementation LXUtilsModule {
  BOOL _observing;
}

RCT_EXPORT_MODULE(UtilsModule)

+ (BOOL)requiresMainQueueSetup
{
  // 兜底：确保图标字体在任何 JS 渲染之前完成注册（+load 里已注册过一次，此处幂等）
  [LXFontLoader registerBundledFonts];
  return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"screen-state", @"screen-size-changed" ];
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - 生命周期/退出

/// Android 侧会 finishAndRemoveTask + System.exit(0)；
/// iOS 官方不建议主动退出，此处保持「用户主动退出」语义，仅在主线程执行 exit(0)。
RCT_EXPORT_METHOD(exitApp)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    exit(0);
  });
}

RCT_EXPORT_METHOD(getSupportedAbis:(RCTPromiseResolveBlock)resolve
                          rejecter:(RCTPromiseRejectBlock)reject)
{
  // iOS 真机/模拟器统一按 arm64 暴露，供 JS 侧判断架构相关的展示逻辑
  resolve(@[ @"arm64" ]);
}

/// iOS 不允许应用内静默安装应用（需经过 App Store 或 TestFlight），此处直接 reject。
RCT_EXPORT_METHOD(installApk:(NSString *)filePath
      fileProviderAuthority:(NSString *)fileProviderAuthority
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)
{
  reject(@"unsupported", @"iOS 不支持应用内安装更新，请通过 App Store/TestFlight 或重新侧载更新", nil);
}

#pragma mark - 屏幕常亮

RCT_EXPORT_METHOD(screenkeepAwake)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = YES;
  });
}

RCT_EXPORT_METHOD(screenUnkeepAwake)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = NO;
  });
}

#pragma mark - 网络/设备信息

RCT_EXPORT_METHOD(getWIFIIPV4Address:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self wifiIPv4Address] ?: @"0.0.0.0");
}

- (NSString *)wifiIPv4Address
{
  struct ifaddrs *interfaces = NULL;
  if (getifaddrs(&interfaces) != 0) return nil;

  NSString *address = nil;
  for (struct ifaddrs *cursor = interfaces; cursor != NULL; cursor = cursor->ifa_next) {
    if (cursor->ifa_addr == NULL) continue;
    if (cursor->ifa_addr->sa_family != AF_INET) continue;
    NSString *name = [NSString stringWithUTF8String:cursor->ifa_name] ?: @"";
    // en0 为 Wi-Fi，pdp_ip0 为蜂窝网络，iOS 上优先取 en0
    if (!([name isEqualToString:@"en0"] || [name isEqualToString:@"pdp_ip0"])) continue;

    char buffer[INET_ADDRSTRLEN] = { 0 };
    struct sockaddr_in *ipv4 = (struct sockaddr_in *)cursor->ifa_addr;
    if (inet_ntop(AF_INET, &ipv4->sin_addr, buffer, sizeof(buffer)) != NULL) {
      NSString *candidate = [NSString stringWithUTF8String:buffer];
      if ([name isEqualToString:@"en0"]) {
        address = candidate;
        break;
      }
      if (address == nil) address = candidate;
    }
  }

  freeifaddrs(interfaces);
  return address;
}

RCT_EXPORT_METHOD(getDeviceName:(RCTPromiseResolveBlock)resolve
                       rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *name = UIDevice.currentDevice.name;
    resolve(name.length > 0 ? name : @"Unknown");
  });
}

RCT_EXPORT_METHOD(getSystemLocales:(RCTPromiseResolveBlock)resolve
                          rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLocale *locale = [NSLocale currentLocale];
  NSString *language = [locale.languageCode lowercaseString] ?: @"";
  NSString *country = [locale.countryCode lowercaseString] ?: @"";
  if (language.length == 0) {
    resolve(@"");
    return;
  }
  // 与 Android 侧保持一致：zh_cn / en_us
  resolve(country.length > 0 ? [NSString stringWithFormat:@"%@_%@", language, country] : language);
}

- (void)handleNotificationSettings:(void (^)(BOOL enabled))completion
{
  [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    UNAuthorizationStatus status = settings.authorizationStatus;
    BOOL enabled = status == UNAuthorizationStatusAuthorized ||
                   status == UNAuthorizationStatusProvisional ||
                   status == UNAuthorizationStatusEphemeral;
    if (completion) completion(enabled);
  }];
}

RCT_EXPORT_METHOD(isNotificationsEnabled:(RCTPromiseResolveBlock)resolve
                                rejecter:(RCTPromiseRejectBlock)reject)
{
  [self handleNotificationSettings:^(BOOL enabled) {
    resolve(@(enabled));
  }];
}

/// 首次调用会弹出系统授权框；已拒绝则跳转系统设置页
RCT_EXPORT_METHOD(openNotificationPermissionActivity:(RCTPromiseResolveBlock)resolve
                                            rejecter:(RCTPromiseRejectBlock)reject)
{
  [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
    if (settings.authorizationStatus == UNAuthorizationStatusNotDetermined) {
      [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                                                                         completionHandler:^(BOOL granted, NSError *error) {
        resolve(@(granted));
      }];
      return;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
      NSURL *url = [NSURL URLWithString:UIApplicationOpenSettingsURLString];
      if (url == nil || ![[UIApplication sharedApplication] canOpenURL:url]) {
        resolve(@NO);
        return;
      }
      [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:^(BOOL success) {
        resolve(@(success));
      }];
    });
  }];
}

RCT_EXPORT_METHOD(shareText:(NSString *)shareTitle
                      title:(NSString *)title
                       text:(NSString *)text)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *content = text.length > 0 ? text : (title ?: @"");
    if (content.length == 0) return;

    UIActivityViewController *controller = [[UIActivityViewController alloc]
      initWithActivityItems:@[ content ]
      applicationActivities:nil];
    if (shareTitle.length > 0) controller.title = shareTitle;

    UIViewController *host = [self topViewController];
    if (host == nil) return;

    // iPad 上必须以 popover 形式呈现，否则会崩溃
    if (controller.popoverPresentationController != nil) {
      controller.popoverPresentationController.sourceView = host.view;
      controller.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(host.view.bounds),
                                                                       CGRectGetMidY(host.view.bounds),
                                                                       0,
                                                                       0);
      controller.popoverPresentationController.permittedArrowDirections = 0;
    }
    [host presentViewController:controller animated:YES completion:nil];
  });
}

- (UIViewController *)topViewController
{
  UIWindow *window = nil;
  for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *candidate in windowScene.windows) {
      if (candidate.isKeyWindow) {
        window = candidate;
        break;
      }
    }
    if (window != nil) break;
  }
  if (window == nil) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    window = [UIApplication sharedApplication].keyWindow;
#pragma clang diagnostic pop
  }

  UIViewController *controller = window.rootViewController;
  while (controller.presentedViewController != nil) {
    controller = controller.presentedViewController;
  }
  return controller;
}

#pragma mark - 窗口尺寸

- (CGSize)currentWindowSize
{
  for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *window in windowScene.windows) {
      if (window.isKeyWindow) return window.bounds.size;
    }
    if (windowScene.windows.count > 0) return windowScene.windows.firstObject.bounds.size;
  }
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  return [UIApplication sharedApplication].keyWindow.bounds.size;
#pragma clang diagnostic pop
}

RCT_EXPORT_METHOD(getWindowSize:(RCTPromiseResolveBlock)resolve
                       rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    CGSize size = [self currentWindowSize];
    // JS 侧 windowSizeTools 会把返回值再除以 Dimensions.scale，Android 返回的是像素，
    // iOS 的 bounds 是点，这里乘上 scale 对齐两个平台的语义
    CGFloat scale = [UIScreen mainScreen].scale;
    resolve(@{ @"width": @(size.width * scale), @"height": @(size.height * scale) });
  });
}

/// iOS 上 RN 没有 StatusBar.currentHeight，这里返回安全区顶部高度（单位：pt，与 RN 布局单位一致），
/// 供 JS 侧 SizeView 计算页面顶部留白，避免内容被灵动岛/状态栏遮挡。
RCT_EXPORT_METHOD(getStatusBarHeight:(RCTPromiseResolveBlock)resolve
                            rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    CGFloat height = 0;
    for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) continue;
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      UIWindow *keyWindow = nil;
      for (UIWindow *candidate in windowScene.windows) {
        if (candidate.isKeyWindow) {
          keyWindow = candidate;
          break;
        }
      }
      if (keyWindow == nil) keyWindow = windowScene.windows.firstObject;
      if (keyWindow != nil) {
        if (@available(iOS 11.0, *)) {
          height = keyWindow.safeAreaInsets.top;
        }
        if (height <= 0) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
          height = windowScene.statusBarManager.statusBarFrame.size.height;
#pragma clang diagnostic pop
        }
      }
      break;
    }
    resolve(@(height));
  });
}

/// 关闭原生启动诊断浮层（AppDelegate 里挂的临时窗口），JS 根视图推送成功后调用。
RCT_EXPORT_METHOD(hideBootOverlay)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [[NSNotificationCenter defaultCenter] postNotificationName:@"LXBootOverlayHide" object:nil];
  });
}

/// 把一段诊断信息显示在屏幕顶部（约 10 秒自动消失）。
/// iOS 26 上没有可用的日志通道（syslog 端口被关闭），出错时用它替代 console 输出。
RCT_EXPORT_METHOD(showDiag:(NSString *)text)
{
  if (text.length == 0) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [[NSNotificationCenter defaultCenter] postNotificationName:@"LXBootOverlayShow"
                                                        object:nil
                                                      userInfo:@{ @"text": text }];
  });
}

/// iOS 版 toast：RN 的 ToastAndroid 在 iOS 上是空实现，这里补一个原生提示。
RCT_EXPORT_METHOD(showToast:(NSString *)text
                    duration:(double)duration)
{
  if (text.length == 0) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [[NSNotificationCenter defaultCenter] postNotificationName:@"LXToastShow"
                                                        object:nil
                                                      userInfo:@{
                                                        @"text": text,
                                                        @"duration": @(duration),
                                                      }];
  });
}

/// 把启动自检的结论落盘 + 走 NSLog 输出。
///
/// 为什么需要单独一条通道：Release 构建下 RN 会把 JS 的 console.log 裁掉，
/// 而 iOS 26 又封掉了 syslog 抓取，于是「自检到底过了没有」在设备上无从得知。
/// 这里同时做两件事——
///   1) 写入沙盒 tmp/lx-selftest-result.txt，CI 可用 simctl get_app_container 取回；
///   2) NSLog 打一条带 BEGIN/END 标记的日志，--console-pty / Console.app 都能直接读。
RCT_EXPORT_METHOD(writeSelftestResult:(NSString *)text)
{
  if (text.length == 0) return;

  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:@"lx-selftest-result.txt"];
  NSError *error = nil;
  BOOL written = [text writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:&error];
  NSLog(@"[LXSELFTEST]BEGIN\n%@\n[LXSELFTEST]END written=%d path=%@ error=%@",
        text, written, path, error.localizedDescription ?: @"-");
}

RCT_EXPORT_METHOD(listenWindowSizeChanged)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_observing) return;
    self->_observing = YES;

    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self
               selector:@selector(handleWindowSizeChanged:)
                   name:UIApplicationDidChangeStatusBarOrientationNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleWindowSizeChanged:)
                   name:UIDeviceOrientationDidChangeNotification
                 object:nil];
    [center addObserver:self
               selector:@selector(handleWindowSizeChanged:)
                   name:UIApplicationDidBecomeActiveNotification
                 object:nil];
  });
}

- (void)handleWindowSizeChanged:(NSNotification *)notification
{
  CGSize size = [self currentWindowSize];
  CGFloat scale = [UIScreen mainScreen].scale;
  [self sendEventWithName:@"screen-size-changed"
                     body:@{ @"width": @(size.width * scale), @"height": @(size.height * scale) }];
}

#pragma mark - 屏幕状态

- (void)startObserving
{
  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  [center addObserver:self
             selector:@selector(handleScreenStateOn:)
                 name:UIApplicationDidBecomeActiveNotification
               object:nil];
  [center addObserver:self
             selector:@selector(handleScreenStateOff:)
                 name:UIApplicationWillResignActiveNotification
               object:nil];
}

- (void)stopObserving
{
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:UIApplicationDidBecomeActiveNotification
                                                object:nil];
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:UIApplicationWillResignActiveNotification
                                                object:nil];
}

- (void)handleScreenStateOn:(NSNotification *)notification
{
  [self sendEventWithName:@"screen-state" body:@{ @"state": @"ON" }];
}

- (void)handleScreenStateOff:(NSNotification *)notification
{
  [self sendEventWithName:@"screen-state" body:@{ @"state": @"OFF" }];
}

#pragma mark - 电池优化（Android 专属概念）

/// iOS 不存在「忽略电池优化」白名单，直接视为已忽略，避免设置页出现无效引导
RCT_EXPORT_METHOD(isIgnoringBatteryOptimization:(RCTPromiseResolveBlock)resolve
                                       rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@YES);
}

RCT_EXPORT_METHOD(requestIgnoreBatteryOptimization:(RCTPromiseResolveBlock)resolve
                                          rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@YES);
}

@end
