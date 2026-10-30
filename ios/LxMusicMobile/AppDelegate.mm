#import "AppDelegate.h"
#import <ReactNativeNavigation/ReactNativeNavigation.h>

#import <React/RCTBridge.h>
#import <React/RCTLog.h>
#import <React/RCTBundleURLProvider.h>

#import <objc/runtime.h>

/// 取当前活跃的窗口场景，iOS 15 之后手动创建的 UIWindow 必须挂到场景上才会显示
static UIWindowScene *LXActiveWindowScene(void)
{
  for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    if (scene.activationState == UISceneActivationStateForegroundActive) return (UIWindowScene *)scene;
  }
  for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
    if ([scene isKindOfClass:[UIWindowScene class]]) return (UIWindowScene *)scene;
  }
  return nil;
}

#pragma mark - 轻量诊断浮层
//
// iOS 26 封死了 syslog / lockdown 通道，出问题时拿不到任何日志。
// 这里提供一个极简的原生浮层：默认不显示，只有 JS 主动调用
// UtilsModule.showDiag() 或检测到原生模块参数不匹配时才短暂出现，
// 便于直接截图定位问题，平时不遮挡界面。

@interface LXBootOverlay : NSObject
@property (nonatomic, strong) UIWindow *overlayWindow;
@property (nonatomic, strong) UILabel *label;
@property (nonatomic, assign) BOOL isHidden;
@property (nonatomic, assign) BOOL autoHideScheduled;
@end

@implementation LXBootOverlay

+ (instancetype)shared
{
  static LXBootOverlay *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [LXBootOverlay new];
  });
  return shared;
}

- (void)setupIfNeeded
{
  if (self.overlayWindow != nil) return;

  UIWindow *window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  window.windowLevel = UIWindowLevelStatusBar + 10;
  window.backgroundColor = [UIColor clearColor];
  window.userInteractionEnabled = NO;
  UIWindowScene *scene = LXActiveWindowScene();
  if (scene != nil) window.windowScene = scene;

  UIViewController *controller = [UIViewController new];
  controller.view.backgroundColor = [UIColor clearColor];

  UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
  label.numberOfLines = 0;
  label.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
  label.textColor = [UIColor whiteColor];
  label.backgroundColor = [UIColor colorWithWhite:0 alpha:0.82];
  [controller.view addSubview:label];

  window.rootViewController = controller;
  window.hidden = NO;

  self.overlayWindow = window;
  self.label = label;
}

/// 显示一段诊断文字（最多 8 行），delay 秒后自动隐藏
- (void)showText:(NSString *)text autoHideAfter:(NSTimeInterval)delay
{
  if (text.length == 0) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self setupIfNeeded];

    self.isHidden = NO;
    self.overlayWindow.hidden = NO;

    NSMutableArray<NSString *> *lines = [NSMutableArray arrayWithArray:
      [text componentsSeparatedByString:@"\n"]];
    while (lines.count > 8) [lines removeObjectAtIndex:0];

    self.label.text = [lines componentsJoinedByString:@"\n"];
    CGFloat width = self.overlayWindow.bounds.size.width;
    CGSize fitted = [self.label sizeThatFits:CGSizeMake(width, CGFLOAT_MAX)];
    CGFloat top = self.overlayWindow.safeAreaInsets.top;
    self.label.frame = CGRectMake(0, top, width, MAX(fitted.height, 20));

    if (self.autoHideScheduled) return;
    self.autoHideScheduled = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      self.autoHideScheduled = NO;
      [self hide];
    });
  });
}

/// 启动阶段的进度信息，仅在浮层尚未隐藏时追加显示
- (void)appendBootLine:(NSString *)text
{
  if (text.length == 0) return;
  if (self.isHidden) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.isHidden) return;
    NSString *current = self.label.text.length > 0 ? self.label.text : @"";
    NSString *next = current.length > 0 ? [current stringByAppendingFormat:@"\n%@", text] : text;
    [self showText:next autoHideAfter:6];
  });
}

- (void)hide
{
  dispatch_async(dispatch_get_main_queue(), ^{
    self.isHidden = YES;
    self.overlayWindow.hidden = YES;
    self.label.text = @"";
  });
}

@end

#pragma mark - 轻量 toast
//
// RN 的 ToastAndroid 在 iOS 上只是个 console.warn 的空实现，
// 而洛雪的交互提示大量依赖 toast（播放失败、下载完成、设置保存等），
// 这里补一个最小可用的原生 toast，避免 iOS 上「点了没反应」。

@interface LXToast : NSObject
@property (nonatomic, strong) UIWindow *window;
@property (nonatomic, strong) UILabel *label;
@end

@implementation LXToast

+ (instancetype)shared
{
  static LXToast *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [LXToast new];
  });
  return shared;
}

- (void)show:(NSString *)message duration:(NSTimeInterval)duration
{
  if (message.length == 0) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindowScene *scene = LXActiveWindowScene();
    CGRect bounds = scene != nil ? scene.coordinateSpace.bounds : [UIScreen mainScreen].bounds;

    if (self.window == nil) {
      UIWindow *window = [[UIWindow alloc] initWithFrame:bounds];
      window.windowLevel = UIWindowLevelAlert + 10;
      window.backgroundColor = [UIColor clearColor];
      window.userInteractionEnabled = NO;

      UIViewController *controller = [UIViewController new];
      controller.view.backgroundColor = [UIColor clearColor];

      UILabel *label = [UILabel new];
      label.numberOfLines = 0;
      label.font = [UIFont systemFontOfSize:14];
      label.textColor = [UIColor whiteColor];
      label.backgroundColor = [UIColor colorWithWhite:0 alpha:0.82];
      label.textAlignment = NSTextAlignmentCenter;
      label.layer.cornerRadius = 12;
      label.clipsToBounds = YES;
      [controller.view addSubview:label];

      window.rootViewController = controller;
      self.window = window;
      self.label = label;
    }

    if (scene != nil) self.window.windowScene = scene;
    self.window.frame = bounds;
    self.window.hidden = NO;

    self.label.text = message;
    CGFloat maxWidth = bounds.size.width - 64;
    CGSize fitted = [self.label sizeThatFits:CGSizeMake(maxWidth, CGFLOAT_MAX)];
    CGFloat width = MIN(fitted.width + 32, maxWidth);
    CGFloat height = fitted.height + 20;
    self.label.frame = CGRectMake((bounds.size.width - width) / 2,
                                  CGRectGetMaxY(bounds) - height - 140,
                                  width,
                                  height);

    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(hide) object:nil];
    [self performSelector:@selector(hide) withObject:nil afterDelay:MAX(duration, 1.0)];
  });
}

- (void)hide
{
  self.window.hidden = YES;
  self.label.text = @"";
}

@end

#pragma mark - 原生模块参数校验（防越界闪退）
//
// RN 旧架构的 Release 构建不做参数个数校验（RCTModuleMethod 里的
// RCTAssert 只在 DEBUG 生效）。当 JS 传入的参数比原生声明多时，
// `_argumentBlocks[index]` 会越界抛 NSRangeException 直接闪退，
// 报错形如：-[__NSArrayM objectAtIndexedSubscript:]: index 3 beyond bounds [0 .. 2]。
// 这里在调用前做一次校验：不匹配就拦下来并显示出来，避免整个 App 崩掉。

static void LXInstallModuleMethodArgGuard(void)
{
  static BOOL installed = NO;
  if (installed) return;
  installed = YES;

  Class cls = NSClassFromString(@"RCTModuleMethod");
  if (cls == nil) return;

  SEL selector = NSSelectorFromString(@"invokeWithBridge:module:arguments:");
  Method method = class_getInstanceMethod(cls, selector);
  if (method == NULL) return;

  IMP originalIMP = method_getImplementation(method);
  SEL methodNameSelector = NSSelectorFromString(@"methodName");

  id (^replacement)(id, id, id, NSArray *) = ^id(id self, id bridge, id module, NSArray *arguments) {
    NSArray *argumentBlocks = nil;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    @try {
      // 先触发一次方法签名解析，否则首次调用时参数块数组还是空的
      [self performSelector:methodNameSelector];
      argumentBlocks = [self valueForKey:@"argumentBlocks"];
    } @catch (__unused NSException *exception) {
    }
#pragma clang diagnostic pop

    if (argumentBlocks != nil && arguments.count > argumentBlocks.count) {
      NSString *methodName = @"?";
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      @try { methodName = [self performSelector:methodNameSelector]; } @catch (__unused NSException *exception) {
      }
#pragma clang diagnostic pop

      NSString *message = [NSString stringWithFormat:@"参数个数不匹配已拦截\n%@.%@ 收到 %lu 个参数，原生声明 %lu 个",
                           NSStringFromClass([module class]), methodName,
                           (unsigned long)arguments.count, (unsigned long)argumentBlocks.count];
      RCTLogWarn(@"%@", message);
      [[NSNotificationCenter defaultCenter] postNotificationName:@"LXBootOverlayShow"
                                                          object:nil
                                                        userInfo:@{ @"text": message }];
      return nil;
    }

    return ((id (*)(id, SEL, id, id, NSArray *))originalIMP)(self, selector, bridge, module, arguments);
  };

  method_setImplementation(method, imp_implementationWithBlock(replacement));
}

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  LXInstallModuleMethodArgGuard();

  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  [center addObserverForName:@"LXBootOverlayHide" object:nil queue:[NSOperationQueue mainQueue]
                  usingBlock:^(NSNotification *note) {
    [[LXBootOverlay shared] hide];
  }];
  [center addObserverForName:@"LXBootOverlayShow" object:nil queue:[NSOperationQueue mainQueue]
                  usingBlock:^(NSNotification *note) {
    NSString *text = note.userInfo[@"text"];
    [[LXBootOverlay shared] showText:text autoHideAfter:10];
  }];
  [center addObserverForName:@"LXToastShow" object:nil queue:[NSOperationQueue mainQueue]
                  usingBlock:^(NSNotification *note) {
    NSString *text = note.userInfo[@"text"];
    NSNumber *duration = note.userInfo[@"duration"];
    [[LXToast shared] show:text duration:duration != nil ? duration.doubleValue : 2.0];
  }];

  self.initialProps = @{};

  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];

  [ReactNativeNavigation bootstrapWithBridge:bridge];

  return YES;
}

- (NSArray<id<RCTBridgeModule>> *)extraModulesForBridge:(RCTBridge *)bridge {
  return [ReactNativeNavigation extraModulesForBridge:bridge];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self getBundleURL];
}
- (NSURL *)getBundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
