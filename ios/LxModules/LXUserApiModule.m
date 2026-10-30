//
//  LXUserApiModule.m
//  LxModules
//
//  对应 Android: cn.toside.music.mobile.userApi.{UserApiModule,JavaScriptThread,QuickJS,JsHandler,Console}
//
//  实现说明：
//  1. Android 使用 QuickJS（第三方 .so）；iOS 直接使用系统内置的 JavaScriptCore 创建独立 JSContext，
//     与 App 自身的 Hermes 运行时互不影响。
//  2. 自定义源脚本的 ABI 完全由 android/app/src/main/assets/script/user-api-preload.js 定义，
//     该文件已原样复制到本 Pod 的 Resources 目录，通过 __lx_native_call__* 全局函数与原生通信，
//     因此 iOS 侧只需提供同名原生函数即可复用同一套脚本生态。
//  3. 所有 JS 执行严格串行在 _jsQueue 上，避免 JSContext 跨线程访问崩溃。
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import <JavaScriptCore/JavaScriptCore.h>

#import "LXCrypto.h"

static NSString *const LXUserApiEventName = @"api-action";

static NSString *const LXNativeCall = @"__lx_native_call__";
static NSString *const LXNativeConsole = @"__lx_console__";
static NSString *const LXNativeSetTimeout = @"__lx_native_call__set_timeout";
static NSString *const LXNativeStr2B64 = @"__lx_native_call__utils_str2b64";
static NSString *const LXNativeB642Buf = @"__lx_native_call__utils_b642buf";
static NSString *const LXNativeStr2Md5 = @"__lx_native_call__utils_str2md5";
static NSString *const LXNativeAesEncrypt = @"__lx_native_call__utils_aes_encrypt";
static NSString *const LXNativeRsaEncrypt = @"__lx_native_call__utils_rsa_encrypt";

/// console 由原生注入：JSC 不提供 console，且 block 桥接对可变参数不友好，故用 JS 侧包装
static NSString *const LXConsoleBootstrap =
  @"(function(){"
  @"  var emit = globalThis.__lx_console__;"
  @"  if (typeof emit !== 'function') return;"
  @"  var build = function(type){"
  @"    return function(){"
  @"      var parts = [];"
  @"      for (var i = 0; i < arguments.length; i++) {"
  @"        var v = arguments[i];"
  @"        parts.push(typeof v === 'string' ? v : (function(){ try { return JSON.stringify(v) } catch (e) { return String(v) } })());"
  @"      }"
  @"      try { emit(type, parts.join(' ')) } catch (e) {}"
  @"    }"
  @"  };"
  @"  globalThis.console = { log: build('log'), info: build('info'), warn: build('warn'), error: build('error'), debug: build('log') };"
  @"})();";

@interface LXUserApiModule : RCTEventEmitter <RCTBridgeModule>
@end

/// 私有方法前置声明，避免 @implementation 内前向调用时的隐式声明告警
@interface LXUserApiModule ()
- (void)createEnvironmentWithInfo:(NSDictionary *)info;
- (void)callScriptWithAction:(NSString *)action args:(NSArray *)args;
- (void)handleNativeCall:(NSString *)action data:(NSString *)data;
- (void)emitAction:(NSString *)action data:(NSString *)data;
- (void)emitLog:(NSString *)type message:(NSString *)message;
- (void)emitInitFailed:(NSString *)message;
- (NSString *)stringValueForKey:(NSString *)key;
- (NSString *)stringValueForKey:(NSString *)key fallback:(NSString *)fallback;
@end

@implementation LXUserApiModule {
  dispatch_queue_t _jsQueue;
  JSContext *_ctx;
  NSString *_scriptKey;
  NSMutableDictionary *_scriptInfo;
  BOOL _inited;
  NSUInteger _generation;
}

RCT_EXPORT_MODULE(UserApiModule)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _jsQueue = dispatch_queue_create("cn.toside.lx.music.userapi", DISPATCH_QUEUE_SERIAL);
    dispatch_set_target_queue(_jsQueue, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
    _generation = 0;
    _inited = NO;
  }
  return self;
}

- (void)dealloc
{
  _ctx = nil;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ LXUserApiEventName ];
}

#pragma mark - 预加载脚本

static NSString *LxLoadPreloadScript(void)
{
  Class cls = NSClassFromString(@"LXUserApiModule");
  NSBundle *bundle = cls != Nil ? [NSBundle bundleForClass:cls] : [NSBundle mainBundle];
  NSURL *url = [bundle URLForResource:@"user-api-preload" withExtension:@"js"];

  if (url == nil) {
    NSURL *resourceBundleURL = [[NSBundle mainBundle] URLForResource:@"LxModules" withExtension:@"bundle"];
    if (resourceBundleURL != nil) {
      url = [[NSBundle bundleWithURL:resourceBundleURL] URLForResource:@"user-api-preload" withExtension:@"js"];
    }
  }
  if (url == nil) return nil;

  return [NSString stringWithContentsOfURL:url encoding:NSUTF8StringEncoding error:NULL];
}

#pragma mark - 事件

- (void)emitAction:(NSString *)action data:(NSString *)data
{
  NSDictionary *body = @{
    @"action": action ?: @"",
    @"data": data ?: @"",
  };
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:LXUserApiEventName body:body];
  });
}

- (void)emitLog:(NSString *)type message:(NSString *)message
{
  NSDictionary *body = @{
    @"action": @"log",
    @"type": type ?: @"log",
    @"log": message ?: @"",
  };
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:LXUserApiEventName body:body];
  });
}

/// 与 JsHandler.sendInitFailedEvent 保持一致：data 为固定 JSON 字符串
- (void)emitInitFailed:(NSString *)message
{
  NSDictionary *body = @{
    @"action": @"init",
    @"errorMessage": message ?: @"Create JavaScript Env Failed",
    @"data": @"{ \"info\": null, \"status\": false, \"errorMessage\": \"Create JavaScript Env Failed\" }",
  };
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:LXUserApiEventName body:body];
  });
  [self emitLog:@"error" message:message];
}

#pragma mark - 导出方法

RCT_EXPORT_METHOD(loadScript:(NSDictionary *)data)
{
  NSMutableDictionary *info = [NSMutableDictionary dictionaryWithDictionary:data ?: @{}];
  dispatch_async(_jsQueue, ^{
    [self createEnvironmentWithInfo:info];
  });
}

RCT_EXPORT_METHOD(sendAction:(NSString *)action info:(NSString *)info)
{
  dispatch_async(_jsQueue, ^{
    [self callScriptWithAction:action args:info != nil ? @[ info ] : @[ @"" ]];
  });
}

RCT_EXPORT_METHOD(destroy)
{
  dispatch_async(_jsQueue, ^{
    self->_generation += 1;
    self->_ctx = nil;
    self->_scriptKey = nil;
    self->_inited = NO;
  });
}

#pragma mark - 环境搭建

- (void)createEnvironmentWithInfo:(NSDictionary *)info
{
  _generation += 1;
  NSUInteger generation = _generation;

  _ctx = nil;
  _inited = NO;
  _scriptInfo = [info mutableCopy];
  _scriptKey = [[NSUUID UUID] UUIDString];

  NSString *preload = LxLoadPreloadScript();
  if (preload.length == 0) {
    [self emitInitFailed:@"Create JavaScript Env Failed: preload script not found"];
    return;
  }

  JSContext *context = [[JSContext alloc] init];
  if (context == nil) {
    [self emitInitFailed:@"Create JavaScript Env Failed: cannot create JSContext"];
    return;
  }

  __weak typeof(self) weakSelf = self;
  NSString *scriptKey = _scriptKey;

  // 脚本 -> 原生：动作/请求/日志
  context[LXNativeCall] = ^id(JSValue *key, JSValue *action, JSValue *data) {
    __strong typeof(self) strongSelf = weakSelf;
    if (strongSelf == nil) return nil;
    if (![[key toString] isEqualToString:scriptKey]) {
      [strongSelf emitLog:@"error" message:@"script key mismatch"];
      return nil;
    }
    [strongSelf handleNativeCall:[action toString] data:[data toString]];
    return nil;
  };

  // 原生注入的 console
  context[LXNativeConsole] = ^id(JSValue *type, JSValue *text) {
    __strong typeof(self) strongSelf = weakSelf;
    [strongSelf emitLog:[type toString] message:[text toString]];
    return nil;
  };

  // setTimeout：回调统一回到 _jsQueue 执行
  context[LXNativeSetTimeout] = ^id(JSValue *timerId, JSValue *timeout) {
    __strong typeof(self) strongSelf = weakSelf;
    if (strongSelf == nil) return nil;
    NSNumber *identifier = @([timerId toInt32]);
    double delayMs = [timeout toDouble];
    if (delayMs < 0) delayMs = 0;

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delayMs * NSEC_PER_MSEC)), strongSelf->_jsQueue, ^{
      if (strongSelf->_generation != generation) return; // 脚本已销毁，丢弃定时器
      [strongSelf callScriptWithAction:@"__set_timeout__" args:@[ identifier ]];
    });
    return nil;
  };

  // utils.str2b64
  context[LXNativeStr2B64] = ^id(JSValue *input) {
    NSString *text = [input toString] ?: @"";
    NSData *bytes = [text dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
    return [bytes base64EncodedStringWithOptions:0];
  };

  // utils.b642buf：返回 JSON 数字数组（与 Android 侧拼接方式一致，元素为有符号字节）
  context[LXNativeB642Buf] = ^id(JSValue *input) {
    NSString *text = [input toString] ?: @"";
    NSData *bytes = [[NSData alloc] initWithBase64EncodedString:text
                                                       options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (bytes == nil) return @"[]";

    const int8_t *raw = (const int8_t *)bytes.bytes;
    NSMutableString *json = [NSMutableString stringWithString:@"["];
    for (NSUInteger i = 0; i < bytes.length; i++) {
      if (i > 0) [json appendString:@","];
      [json appendFormat:@"%d", (int)raw[i]];
    }
    [json appendString:@"]"];
    return json;
  };

  // utils.str2md5：先做 URL 解码（Java 侧使用 URLDecoder.decode）
  context[LXNativeStr2Md5] = ^id(JSValue *input) {
    NSString *text = [input toString] ?: @"";
    NSString *decoded = [text stringByReplacingOccurrencesOfString:@"+" withString:@" "];
    decoded = [decoded stringByRemovingPercentEncoding] ?: decoded;
    return LXMD5Hex(decoded);
  };

  // utils.aesEncrypt(data, key, iv, mode) —— 参数均为 Base64
  context[LXNativeAesEncrypt] = ^id(JSValue *data, JSValue *key, JSValue *iv, JSValue *mode) {
    NSData *dataBytes = [[NSData alloc] initWithBase64EncodedString:[data toString] ?: @""
                                                           options:NSDataBase64DecodingIgnoreUnknownCharacters];
    NSData *keyBytes = [[NSData alloc] initWithBase64EncodedString:[key toString] ?: @""
                                                          options:NSDataBase64DecodingIgnoreUnknownCharacters];
    NSData *ivBytes = [[NSData alloc] initWithBase64EncodedString:[iv toString] ?: @""
                                                         options:NSDataBase64DecodingIgnoreUnknownCharacters];
    NSString *modeText = [mode toString] ?: @"AES/CBC/PKCS7Padding";
    BOOL isECB = [modeText isEqualToString:@"AES"];
    BOOL pkcs7 = !isECB;

    NSData *result = LXAESProcess(dataBytes, keyBytes, ivBytes, YES, isECB, pkcs7, NULL);
    if (result == nil) return @"";
    return [result base64EncodedStringWithOptions:0];
  };

  // utils.rsaEncrypt(base64Text, base64PublicKey, padding)
  context[LXNativeRsaEncrypt] = ^id(JSValue *text, JSValue *key, JSValue *padding) {
    NSData *plain = [[NSData alloc] initWithBase64EncodedString:[text toString] ?: @""
                                                        options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (plain == nil) return @"";
    NSData *cipher = LXRSAEncrypt(plain, [key toString] ?: @"", [padding toString] ?: @"", NULL);
    if (cipher == nil) return @"";
    return [cipher base64EncodedStringWithOptions:0];
  };

  // console / 全局对象注入
  [context evaluateScript:LXConsoleBootstrap];
  context.exception = nil;

  [context evaluateScript:preload];
  if (context.exception != nil) {
    NSString *message = [[context.exception toString] ?: @"preload script error" copy];
    context.exception = nil;
    [self emitInitFailed:[NSString stringWithFormat:@"Create JavaScript Env Failed: %@", message]];
    return;
  }

  JSValue *setup = context[@"lx_setup"];
  if (setup == nil || ![setup isObject] || [setup isUndefined]) {
    [self emitInitFailed:@"Create JavaScript Env Failed: lx_setup not found"];
    return;
  }

  NSArray *setupArgs = @[
    scriptKey,
    [self stringValueForKey:@"id"],
    [self stringValueForKey:@"name" fallback:@"Unknown"],
    [self stringValueForKey:@"description"],
    [self stringValueForKey:@"version"],
    [self stringValueForKey:@"author"],
    [self stringValueForKey:@"homepage"],
    [self stringValueForKey:@"script"],
  ];
  [setup callWithArguments:setupArgs];
  if (context.exception != nil) {
    NSString *message = [[context.exception toString] ?: @"lx_setup error" copy];
    context.exception = nil;
    [self emitInitFailed:[NSString stringWithFormat:@"Create JavaScript Env Failed: %@", message]];
    return;
  }

  _ctx = context;

  // 执行用户脚本（与 Android 一致：lx_setup 只负责初始化 ABI，脚本正文单独执行）
  NSString *script = [self stringValueForKey:@"script"];
  [context evaluateScript:script];
  if (context.exception != nil) {
    NSString *message = [[context.exception toString] ?: @"script error" copy];
    context.exception = nil;

    JSValue *runError = context[@"__run_error__"];
    if (runError != nil && ![runError isUndefined]) [runError callWithArguments:@[]];

    if (_inited) {
      [self emitLog:@"error" message:[NSString stringWithFormat:@"load script error: %@", message]];
      return;
    }
    _inited = YES;
    [self emitInitFailed:message];
    return;
  }

  [self emitLog:@"log" message:@"script loaded"];
}

- (NSString *)stringValueForKey:(NSString *)key
{
  return [self stringValueForKey:key fallback:@""];
}

- (NSString *)stringValueForKey:(NSString *)key fallback:(NSString *)fallback
{
  id value = _scriptInfo[key];
  if ([value isKindOfClass:[NSString class]]) return value;
  if (value == nil) return fallback;
  return [value description] ?: fallback;
}

#pragma mark - 脚本调用

- (void)handleNativeCall:(NSString *)action data:(NSString *)data
{
  if ([action isEqualToString:@"init"]) {
    if (_inited) return;
    _inited = YES;
  }
  [self emitAction:action data:data];
}

- (void)callScriptWithAction:(NSString *)action args:(NSArray *)args
{
  if (_ctx == nil) return;

  JSValue *function = _ctx[@"__lx_native__"];
  if (function == nil || [function isUndefined]) return;

  NSMutableArray *params = [NSMutableArray arrayWithCapacity:args.count + 2];
  [params addObject:_scriptKey ?: @""];
  [params addObject:action ?: @""];
  [params addObjectsFromArray:args ?: @[]];

  [function callWithArguments:params];

  if (_ctx.exception == nil) return;

  NSString *message = [NSString stringWithFormat:@"Call script error: %@", [_ctx.exception toString] ?: @"unknown"];
  _ctx.exception = nil;
  if (message.length > 1024) {
    message = [[message substringToIndex:1024] stringByAppendingString:@"..."];
  }
  [self emitLog:@"error" message:message];

  if (!_inited) {
    _inited = YES;
    [self emitInitFailed:message];
  }
}

@end
