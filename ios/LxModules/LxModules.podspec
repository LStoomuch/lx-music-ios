Pod::Spec.new do |s|
  s.name         = 'LxModules'
  s.version      = '1.0.0'
  s.summary      = 'LX Music Mobile iOS native modules'
  s.description  = 'iOS 侧补齐 Android 自建原生模块（Utils/Crypto/Cache/Lyric/UserApi）的实现。'
  s.homepage     = 'https://github.com/lyswhut/lx-music-mobile'
  s.license      = { :type => 'Apache-2.0' }
  s.author       = { 'lx-music-mobile' => 'lyswhut@qq.com' }
  s.platforms    = { :ios => '13.4' }
  s.source       = { :path => '.' }

  s.source_files = '*.{h,m}'
  s.public_header_files = 'LXCrypto.h'

  # 自定义源脚本引擎依赖 JavaScriptCore 提供的独立 JS 运行时（不受 Hermes 影响）
  # icomoon.ttf 是 src/resources/fonts/selection.json 对应的自定义图标字体，
  # iOS 需要在运行时用 CTFontManagerRegisterFontsForURL 注册（见 LXFontLoader.m）
  s.resource_bundles = {
    'LxModules' => ['Resources/*.js', 'Resources/*.ttf']
  }

  s.frameworks = 'Foundation', 'UIKit', 'JavaScriptCore', 'Security', 'CoreText'
  s.requires_arc = true

  s.dependency 'React-Core'
end
