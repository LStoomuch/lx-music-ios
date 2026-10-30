//
//  LXCacheModule.m
//  LxModules
//
//  对应 Android: cn.toside.music.mobile.cache.CacheModule
//  JS 侧 src/utils/nativeModules/cache.ts 只用到 getAppCacheSize / clearAppCache。
//

#import <React/RCTBridgeModule.h>

static unsigned long long LxDirectorySize(NSURL *directory)
{
  if (directory == nil) return 0;

  NSFileManager *manager = [NSFileManager defaultManager];
  NSArray<NSURL *> *contents = [manager contentsOfDirectoryAtURL:directory
                                      includingPropertiesForKeys:@[ NSURLFileSizeKey, NSURLIsDirectoryKey ]
                                                         options:NSDirectoryEnumerationSkipsHiddenFiles
                                                           error:NULL];
  unsigned long long total = 0;
  for (NSURL *url in contents) {
    NSDictionary *values = [url resourceValuesForKeys:@[ NSURLFileSizeKey, NSURLIsDirectoryKey ] error:NULL];
    if ([values[NSURLIsDirectoryKey] boolValue]) {
      total += LxDirectorySize(url);
    } else {
      total += [values[NSURLFileSizeKey] unsignedLongLongValue];
    }
  }
  return total;
}

static void LxClearDirectory(NSURL *directory)
{
  if (directory == nil) return;

  NSFileManager *manager = [NSFileManager defaultManager];
  NSArray<NSURL *> *contents = [manager contentsOfDirectoryAtURL:directory
                                      includingPropertiesForKeys:nil
                                                         options:NSDirectoryEnumerationSkipsHiddenFiles
                                                           error:NULL];
  for (NSURL *url in contents) {
    [manager removeItemAtURL:url error:NULL];
  }
}

@interface LXCacheModule : NSObject <RCTBridgeModule>
@end

@implementation LXCacheModule

RCT_EXPORT_MODULE(CacheModule)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_global_queue(QOS_CLASS_UTILITY, 0);
}

/// 统计沙盒内 Caches 与 tmp 的占用（Android 对应 getCacheDir + externalCacheDir）
RCT_EXPORT_METHOD(getAppCacheSize:(RCTPromiseResolveBlock)resolve
                         rejecter:(RCTPromiseRejectBlock)reject)
{
  NSFileManager *manager = [NSFileManager defaultManager];
  NSURL *caches = [[manager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask] firstObject];
  NSURL *tmp = [NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES];

  unsigned long long total = LxDirectorySize(caches) + LxDirectorySize(tmp);
  // JS 侧对返回值做了 Math.trunc，字符串数字可被正确转换
  resolve([NSString stringWithFormat:@"%llu", total]);
}

RCT_EXPORT_METHOD(clearAppCache:(RCTPromiseResolveBlock)resolve
                       rejecter:(RCTPromiseRejectBlock)reject)
{
  NSFileManager *manager = [NSFileManager defaultManager];
  NSURL *caches = [[manager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask] firstObject];
  NSURL *tmp = [NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES];

  LxClearDirectory(caches);
  LxClearDirectory(tmp);

  // 仅清理 WebKit 的磁盘缓存目录，避免误删应用本地音乐等业务数据
  NSURL *webKitCache = [caches URLByAppendingPathComponent:@"WebKit" isDirectory:YES];
  LxClearDirectory(webKitCache);

  resolve(nil);
}

@end
