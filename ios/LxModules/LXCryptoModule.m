//
//  LXCryptoModule.m
//  LxModules
//
//  对应 Android: cn.toside.music.mobile.crypto.CryptoModule
//  模块名必须保持 "CryptoModule"，JS 侧 src/utils/nativeModules/crypto.ts 直接按名取用。
//

#import <React/RCTBridgeModule.h>

#import "LXCrypto.h"

static NSString *const LxAESModeCBC = @"AES/CBC";
static NSString *const LxAESModeECB = @"AES";

/// 将 Java 风格的 mode 字符串解析为 (isECB, pkcs7)
static BOOL LxParseAESMode(NSString *mode, BOOL *isECB, BOOL *pkcs7)
{
  NSString *value = mode.length > 0 ? mode : LxAESModeCBC;
  if ([value.uppercaseString hasPrefix:LxAESModeECB] && value.length <= 3) {
    // Java 侧 "AES" 等价于 AES/ECB/NoPadding
    if (isECB) *isECB = YES;
    if (pkcs7) *pkcs7 = NO;
    return YES;
  }
  if ([value.uppercaseString hasPrefix:LxAESModeCBC]) {
    if (isECB) *isECB = NO;
    if (pkcs7) *pkcs7 = YES;
    return YES;
  }
  return NO;
}

static NSData *_Nullable LxDecodeBase64String(NSString *string)
{
  if (string.length == 0) return nil;
  return [[NSData alloc] initWithBase64EncodedString:string
                                            options:NSDataBase64DecodingIgnoreUnknownCharacters];
}

@interface LXCryptoModule : NSObject <RCTBridgeModule>
@end

@implementation LXCryptoModule

RCT_EXPORT_MODULE(CryptoModule)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

#pragma mark - RSA

RCT_EXPORT_METHOD(generateRsaKey:(RCTPromiseResolveBlock)resolve
                         rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *error = nil;
  NSDictionary *keyPair = LXGenerateRSAKeyPair(&error);
  if (keyPair == nil) {
    reject(@"-1", error.localizedDescription ?: @"generateRsaKey failed", error);
    return;
  }
  resolve(keyPair);
}

RCT_EXPORT_METHOD(rsaEncrypt:(NSString *)text
                        key:(NSString *)key
                    padding:(NSString *)padding
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)
{
  // 与 Java 实现一致：失败时 resolve 空串，不 reject
  resolve([self encryptText:text key:key padding:padding] ?: @"");
}

RCT_EXPORT_METHOD(rsaDecrypt:(NSString *)text
                        key:(NSString *)key
                    padding:(NSString *)padding
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self decryptText:text key:key padding:padding] ?: @"");
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(rsaEncryptSync:(NSString *)text
                                                  key:(NSString *)key
                                              padding:(NSString *)padding)
{
  return [self encryptText:text key:key padding:padding] ?: @"";
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(rsaDecryptSync:(NSString *)text
                                                  key:(NSString *)key
                                              padding:(NSString *)padding)
{
  return [self decryptText:text key:key padding:padding] ?: @"";
}

- (NSString *)encryptText:(NSString *)text key:(NSString *)key padding:(NSString *)padding
{
  NSData *plain = LxDecodeBase64String(text);
  if (plain == nil) return @"";
  NSData *cipher = LXRSAEncrypt(plain, key, padding, NULL);
  if (cipher == nil) return @"";
  return [cipher base64EncodedStringWithOptions:0];
}

- (NSString *)decryptText:(NSString *)text key:(NSString *)key padding:(NSString *)padding
{
  NSData *cipher = LxDecodeBase64String(text);
  if (cipher == nil) return @"";
  NSData *plain = LXRSADecrypt(cipher, key, padding, NULL);
  if (plain == nil) return @"";
  return [[NSString alloc] initWithData:plain encoding:NSUTF8StringEncoding] ?: @"";
}

#pragma mark - AES

RCT_EXPORT_METHOD(aesEncrypt:(NSString *)text
                        key:(NSString *)key
                         iv:(NSString *)iv
                       mode:(NSString *)mode
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self encryptAESText:text key:key iv:iv mode:mode] ?: @"");
}

RCT_EXPORT_METHOD(aesDecrypt:(NSString *)text
                        key:(NSString *)key
                         iv:(NSString *)iv
                       mode:(NSString *)mode
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve([self decryptAESText:text key:key iv:iv mode:mode] ?: @"");
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(aesEncryptSync:(NSString *)text
                                                  key:(NSString *)key
                                                   iv:(NSString *)iv
                                                 mode:(NSString *)mode)
{
  return [self encryptAESText:text key:key iv:iv mode:mode] ?: @"";
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(aesDecryptSync:(NSString *)text
                                                  key:(NSString *)key
                                                   iv:(NSString *)iv
                                                 mode:(NSString *)mode)
{
  return [self decryptAESText:text key:key iv:iv mode:mode] ?: @"";
}

- (NSString *)encryptAESText:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode
{
  BOOL isECB = NO;
  BOOL pkcs7 = YES;
  if (!LxParseAESMode(mode, &isECB, &pkcs7)) return @"";

  NSData *data = LxDecodeBase64String(text);
  NSData *keyData = LxDecodeBase64String(key);
  NSData *ivData = LxDecodeBase64String(iv);
  if (data == nil || keyData == nil) return @"";

  NSData *result = LXAESProcess(data, keyData, ivData, YES, isECB, pkcs7, NULL);
  if (result == nil) return @"";
  return [result base64EncodedStringWithOptions:0];
}

- (NSString *)decryptAESText:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode
{
  BOOL isECB = NO;
  BOOL pkcs7 = YES;
  if (!LxParseAESMode(mode, &isECB, &pkcs7)) return @"";

  NSData *data = LxDecodeBase64String(text);
  NSData *keyData = LxDecodeBase64String(key);
  NSData *ivData = LxDecodeBase64String(iv);
  if (data == nil || keyData == nil) return @"";

  NSData *result = LXAESProcess(data, keyData, ivData, NO, isECB, pkcs7, NULL);
  if (result == nil) return @"";
  return [[NSString alloc] initWithData:result encoding:NSUTF8StringEncoding] ?: @"";
}

#pragma mark - SHA1

RCT_EXPORT_METHOD(sha1:(NSString *)input
                resolver:(RCTPromiseResolveBlock)resolve
                rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(LXSHA1Hex(input ?: @""));
}

@end
