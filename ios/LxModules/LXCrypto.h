//
//  LXCrypto.h
//  LxModules
//
//  Android 侧 cn.toside.music.mobile.crypto.{AES,RSA} 的 iOS 等价实现。
//  契约（与 JS 层 src/utils/nativeModules/crypto.ts 一一对应）：
//    - AES 的 data / key / iv 均为 Base64 字符串，输出 Base64（不换行）
//    - RSA 的 key 为 DER 的 Base64：公钥 X.509 SubjectPublicKeyInfo、私钥 PKCS#8
//      （与 Java PublicKey.getEncoded() / PrivateKey.getEncoded() 保持一致）
//    - 任一步骤失败返回 nil / 空串，与 Java 侧 catch 后返回 "" 的语义一致
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// AES 加解密。
/// @param isECB YES 对应 Java 的 "AES"（ECB/NoPadding），NO 对应 "AES/CBC/..."。
/// @param pkcs7 YES 对应 PKCS5/PKCS7 填充。
FOUNDATION_EXPORT NSData *_Nullable LXAESProcess(NSData *data,
                                                 NSData *key,
                                                 NSData *_Nullable iv,
                                                 BOOL encrypt,
                                                 BOOL isECB,
                                                 BOOL pkcs7,
                                                 NSError *_Nullable *_Nullable error);

FOUNDATION_EXPORT NSString *LXHexFromData(NSData *data);
FOUNDATION_EXPORT NSString *LXSHA1Hex(NSString *input);
FOUNDATION_EXPORT NSString *LXMD5Hex(NSString *input);

/// 生成 2048 位 RSA 密钥对，返回 @{ publicKey: base64(X.509 SPKI), privateKey: base64(PKCS#8) }
FOUNDATION_EXPORT NSDictionary *_Nullable LXGenerateRSAKeyPair(NSError *_Nullable *_Nullable error);

/// padding 取 Java 风格名称："RSA/ECB/OAEPWithSHA1AndMGF1Padding"、"RSA/ECB/PKCS1Padding"
FOUNDATION_EXPORT NSData *_Nullable LXRSAEncrypt(NSData *plain,
                                                 NSString *publicKeyBase64,
                                                 NSString *padding,
                                                 NSError *_Nullable *_Nullable error);

FOUNDATION_EXPORT NSData *_Nullable LXRSADecrypt(NSData *cipher,
                                                 NSString *privateKeyBase64,
                                                 NSString *padding,
                                                 NSError *_Nullable *_Nullable error);

NS_ASSUME_NONNULL_END
