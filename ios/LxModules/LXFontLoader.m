//
//  LXFontLoader.m
//  LxModules
//
//  作用：把随 Pod 打进 LxModules.bundle 的自定义图标字体（icomoon.ttf）注册到进程字体表。
//
//  背景：JS 侧 src/components/common/Icon.tsx 用 createIconSetFromIcoMoon(selection.json)，
//  其中的 fontFamily 是 "icomoon"。Android 侧靠 assets/fonts/icomoon.ttf 生效；
//  iOS 若不注册字体，UIFont 找不到 "icomoon"，会回退到系统字体，
//  图标字符就渲染成豆腐块（方框里的问号）。
//
//  iOS 常规做法是在 Info.plist 的 UIAppFonts 里登记，但那要求字体文件位于 main bundle 根目录；
//  这里改用 CoreText 运行时注册，免去改动 Xcode 工程文件的 Copy Bundle Resources。
//

#import <Foundation/Foundation.h>
#import <CoreText/CoreText.h>

#import "LXFontLoader.h"

@implementation LXFontLoader

+ (void)load
{
  [self registerBundledFonts];
}

+ (void)registerBundledFonts
{
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSBundle *mainBundle = [NSBundle mainBundle];
    NSMutableArray<NSBundle *> *bundles = [NSMutableArray arrayWithObject:mainBundle];

    // 资源打包在 LxModules.bundle 里（CocoaPods resource_bundles）
    NSURL *resourceBundleURL = [mainBundle URLForResource:@"LxModules" withExtension:@"bundle"];
    if (resourceBundleURL != nil) {
      NSBundle *resourceBundle = [NSBundle bundleWithURL:resourceBundleURL];
      if (resourceBundle != nil) [bundles insertObject:resourceBundle atIndex:0];
    }

    NSMutableArray<NSURL *> *urls = [NSMutableArray array];
    for (NSBundle *bundle in bundles) {
      // resource_bundles 可能会保留或抹平 Resources 这一层目录，两种都找一遍
      [urls addObjectsFromArray:[bundle URLsForResourcesWithExtension:@"ttf" subdirectory:nil]];
      [urls addObjectsFromArray:[bundle URLsForResourcesWithExtension:@"ttf" subdirectory:@"Resources"]];
    }

    if (urls.count == 0) {
      NSLog(@"[LXFontLoader] no ttf found in bundle, icon glyphs may fall back to system font");
      return;
    }

    for (NSURL *url in urls) {
      CFErrorRef error = NULL;
      BOOL ok = CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url, kCTFontManagerScopeProcess, &error);
      if (!ok) {
        NSLog(@"[LXFontLoader] register %@ failed: %@", url.lastPathComponent, error);
        if (error != NULL) CFRelease(error);
      } else {
        NSLog(@"[LXFontLoader] registered %@", url.lastPathComponent);
      }
    }
  });
}

@end
