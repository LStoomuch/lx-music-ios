//
//  LXFontLoader.h
//  LxModules
//

#import <Foundation/Foundation.h>

@interface LXFontLoader : NSObject

/// 注册随 Pod 打包的自定义图标字体（icomoon.ttf）。可重复调用，内部只执行一次。
+ (void)registerBundledFonts;

@end
