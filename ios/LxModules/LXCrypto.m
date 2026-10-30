//
//  LXCrypto.m
//  LxModules
//

#import "LXCrypto.h"

#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>

static NSString *const LxCryptoErrorDomain = @"cn.toside.lx.crypto";

static NSString *LxErrorText(NSString *message)
{
  return message ?: @"unknown error";
}

static void LxAssignError(NSError **error, NSString *message)
{
  if (error == NULL) return;
  *error = [NSError errorWithDomain:LxCryptoErrorDomain
                               code:-1
                           userInfo:@{ NSLocalizedDescriptionKey: LxErrorText(message) }];
}

#pragma mark - Base64

static NSData *_Nullable LxDecodeBase64(NSString *string)
{
  if (string.length == 0) return nil;
  // Java 侧使用 Base64.DEFAULT（允许换行、忽略空白），NSData 默认实现会忽略未知字符
  return [[NSData alloc] initWithBase64EncodedString:string options:NSDataBase64DecodingIgnoreUnknownCharacters];
}

static NSString *LxEncodeBase64(NSData *data)
{
  // 对应 Java 的 Base64.NO_WRAP
  return [data base64EncodedStringWithOptions:0];
}

#pragma mark - Digest

NSString *LXHexFromData(NSData *data)
{
  if (data.length == 0) return @"";
  const uint8_t *bytes = data.bytes;
  NSMutableString *hex = [NSMutableString stringWithCapacity:data.length * 2];
  for (NSUInteger i = 0; i < data.length; i++) {
    [hex appendFormat:@"%02x", bytes[i]];
  }
  return hex;
}

NSString *LXSHA1Hex(NSString *input)
{
  NSData *data = [input dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
  uint8_t digest[CC_SHA1_DIGEST_LENGTH] = { 0 };
  CC_SHA1(data.bytes, (CC_LONG)data.length, digest);
  return LXHexFromData([NSData dataWithBytes:digest length:CC_SHA1_DIGEST_LENGTH]);
}

NSString *LXMD5Hex(NSString *input)
{
  NSData *data = [input dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
  uint8_t digest[CC_MD5_DIGEST_LENGTH] = { 0 };
  // CC_MD5 在 iOS 13+ 标记为 deprecated，但签名与结果稳定，这里保留以对齐 Java MessageDigest("MD5")
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  CC_MD5(data.bytes, (CC_LONG)data.length, digest);
#pragma clang diagnostic pop
  return LXHexFromData([NSData dataWithBytes:digest length:CC_MD5_DIGEST_LENGTH]);
}

#pragma mark - AES

NSData *LXAESProcess(NSData *data,
                     NSData *key,
                     NSData *iv,
                     BOOL encrypt,
                     BOOL isECB,
                     BOOL pkcs7,
                     NSError **error)
{
  BOOL validKeyLength = key.length == kCCKeySizeAES128 ||
                        key.length == kCCKeySizeAES192 ||
                        key.length == kCCKeySizeAES256;
  if (data == nil || !validKeyLength) {
    LxAssignError(error, @"invalid AES key length");
    return nil;
  }

  // Java 侧把 IV 补齐到 16 字节，不足补 0
  uint8_t ivBytes[kCCBlockSizeAES128] = { 0 };
  if (!isECB && iv.length > 0) {
    memcpy(ivBytes, iv.bytes, MIN((NSUInteger)kCCBlockSizeAES128, iv.length));
  }

  CCOptions options = 0;
  if (pkcs7) options |= kCCOptionPKCS7Padding;
  if (isECB) options |= kCCOptionECBMode;

  size_t bufferSize = data.length + kCCBlockSizeAES128;
  NSMutableData *buffer = [NSMutableData dataWithLength:bufferSize];
  if (buffer == nil) {
    LxAssignError(error, @"out of memory");
    return nil;
  }

  size_t moved = 0;
  CCCryptorStatus status = CCCrypt(encrypt ? kCCEncrypt : kCCDecrypt,
                                   kCCAlgorithmAES,
                                   options,
                                   key.bytes,
                                   key.length,
                                   isECB ? NULL : ivBytes,
                                   data.bytes,
                                   data.length,
                                   buffer.mutableBytes,
                                   bufferSize,
                                   &moved);
  if (status != kCCSuccess) {
    LxAssignError(error, [NSString stringWithFormat:@"CCCrypt failed: %d", (int)status]);
    return nil;
  }
  [buffer setLength:moved];
  return buffer;
}

#pragma mark - DER helpers

/// 读取一个 TLV，返回内容区间；offset 前移
static BOOL LxReadTLV(const uint8_t *bytes,
                      NSUInteger length,
                      NSUInteger *offset,
                      uint8_t *tag,
                      NSRange *content)
{
  NSUInteger cursor = *offset;
  if (cursor + 2 > length) return NO;

  uint8_t type = bytes[cursor++];
  NSUInteger len = bytes[cursor++];
  if (len & 0x80) {
    NSUInteger byteCount = len & 0x7F;
    if (byteCount == 0 || byteCount > 4 || cursor + byteCount > length) return NO;
    len = 0;
    for (NSUInteger i = 0; i < byteCount; i++) {
      len = (len << 8) | bytes[cursor++];
    }
  }
  if (cursor + len > length) return NO;

  if (tag) *tag = type;
  if (content) *content = NSMakeRange(cursor, len);
  *offset = cursor + len;
  return YES;
}

/// X.509 SubjectPublicKeyInfo -> PKCS#1 RSAPublicKey
static NSData *_Nullable LxStripSPKI(NSData *spki)
{
  const uint8_t *bytes = spki.bytes;
  NSUInteger length = spki.length;
  NSUInteger offset = 0;
  uint8_t tag = 0;
  NSRange outer = NSMakeRange(0, 0);

  if (!LxReadTLV(bytes, length, &offset, &tag, &outer) || tag != 0x30) return nil;

  NSUInteger cursor = outer.location;
  NSUInteger end = NSMaxRange(outer);
  NSRange item = NSMakeRange(0, 0);

  // 第一项：AlgorithmIdentifier SEQUENCE
  if (!LxReadTLV(bytes, end, &cursor, &tag, &item) || tag != 0x30) return nil;
  // 第二项：BIT STRING，首字节为未使用位数（RSA 恒为 0）
  if (!LxReadTLV(bytes, end, &cursor, &tag, &item) || tag != 0x03 || item.length < 2) return nil;

  return [spki subdataWithRange:NSMakeRange(item.location + 1, item.length - 1)];
}

/// PKCS#8 PrivateKeyInfo -> PKCS#1 RSAPrivateKey
static NSData *_Nullable LxStripPKCS8(NSData *pkcs8)
{
  const uint8_t *bytes = pkcs8.bytes;
  NSUInteger length = pkcs8.length;
  NSUInteger offset = 0;
  uint8_t tag = 0;
  NSRange outer = NSMakeRange(0, 0);

  if (!LxReadTLV(bytes, length, &offset, &tag, &outer) || tag != 0x30) return nil;

  NSUInteger cursor = outer.location;
  NSUInteger end = NSMaxRange(outer);
  NSRange item = NSMakeRange(0, 0);

  while (cursor < end) {
    if (!LxReadTLV(bytes, end, &cursor, &tag, &item)) return nil;
    if (tag == 0x04) {
      return [pkcs8 subdataWithRange:item];
    }
  }
  return nil;
}

/// PKCS#1 RSAPublicKey -> X.509 SubjectPublicKeyInfo
static NSData *LxWrapPKCS1ToSPKI(NSData *pkcs1)
{
  NSUInteger keyLength = pkcs1.length;
  NSUInteger outerLength = 20 + keyLength; // 15(alg) + 4(bitstring header) + 1(unused bits) + key
  NSUInteger bitLength = 1 + keyLength;

  uint8_t prefix[24] = {
    0x30, 0x82, 0x00, 0x00,
    0x30, 0x0D, 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01, 0x05, 0x00,
    0x03, 0x82, 0x00, 0x00, 0x00
  };
  prefix[2] = (uint8_t)((outerLength >> 8) & 0xFF);
  prefix[3] = (uint8_t)(outerLength & 0xFF);
  prefix[21] = (uint8_t)((bitLength >> 8) & 0xFF);
  prefix[22] = (uint8_t)(bitLength & 0xFF);

  NSMutableData *result = [NSMutableData dataWithBytes:prefix length:sizeof(prefix)];
  [result appendData:pkcs1];
  return result;
}

/// PKCS#1 RSAPrivateKey -> PKCS#8 PrivateKeyInfo
static NSData *LxWrapPKCS1ToPKCS8(NSData *pkcs1)
{
  NSUInteger keyLength = pkcs1.length;
  NSUInteger outerLength = 22 + keyLength; // 3(version) + 15(alg) + 4(octet string header) + key

  uint8_t prefix[26] = {
    0x30, 0x82, 0x00, 0x00,
    0x02, 0x01, 0x00,
    0x30, 0x0D, 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01, 0x05, 0x00,
    0x04, 0x82, 0x00, 0x00
  };
  prefix[2] = (uint8_t)((outerLength >> 8) & 0xFF);
  prefix[3] = (uint8_t)(outerLength & 0xFF);
  prefix[24] = (uint8_t)((keyLength >> 8) & 0xFF);
  prefix[25] = (uint8_t)(keyLength & 0xFF);

  NSMutableData *result = [NSMutableData dataWithBytes:prefix length:sizeof(prefix)];
  [result appendData:pkcs1];
  return result;
}

#pragma mark - RSA

NSDictionary *LXGenerateRSAKeyPair(NSError **error)
{
  NSDictionary *attributes = @{
    (__bridge NSString *)kSecAttrKeyType: (__bridge NSString *)kSecAttrKeyTypeRSA,
    (__bridge NSString *)kSecAttrKeySizeInBits: @2048,
    (__bridge NSString *)kSecAttrIsPermanent: @NO, // 仅内存保存，不写入 Keychain
  };

  CFErrorRef cfError = NULL;
  SecKeyRef privateKey = SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &cfError);
  if (privateKey == NULL) {
    NSString *message = cfError ? CFBridgingRelease(CFErrorCopyDescription(cfError)) : @"SecKeyCreateRandomKey failed";
    if (cfError) CFRelease(cfError);
    LxAssignError(error, message);
    return nil;
  }

  NSData *privatePKCS1 = CFBridgingRelease(SecKeyCopyExternalRepresentation(privateKey, NULL));
  SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
  NSData *publicPKCS1 = publicKey ? CFBridgingRelease(SecKeyCopyExternalRepresentation(publicKey, NULL)) : nil;

  if (privatePKCS1.length == 0 || publicPKCS1.length == 0) {
    if (publicKey) CFRelease(publicKey);
    CFRelease(privateKey);
    LxAssignError(error, @"export RSA key failed");
    return nil;
  }

  NSData *spki = LxWrapPKCS1ToSPKI(publicPKCS1);
  NSData *pkcs8 = LxWrapPKCS1ToPKCS8(privatePKCS1);

  if (publicKey) CFRelease(publicKey);
  CFRelease(privateKey);

  if (spki == nil || pkcs8 == nil) {
    LxAssignError(error, @"wrap RSA key failed");
    return nil;
  }

  return @{
    @"publicKey": LxEncodeBase64(spki),
    @"privateKey": LxEncodeBase64(pkcs8),
  };
}

static SecKeyAlgorithm LxKeyAlgorithm(NSString *padding)
{
  if (padding.length == 0) return NULL;
  if ([padding rangeOfString:@"OAEP" options:NSCaseInsensitiveSearch].location != NSNotFound) {
    return kSecKeyAlgorithmRSAEncryptionOAEPSHA1;
  }
  if ([padding rangeOfString:@"PKCS1" options:NSCaseInsensitiveSearch].location != NSNotFound) {
    return kSecKeyAlgorithmRSAEncryptionPKCS1;
  }
  // Java 侧另有 "RSA/ECB/NoPadding"，Security.framework 无对应算法，故不支持
  return NULL;
}

static SecKeyRef _Nullable LxCreateRSAKey(NSString *keyBase64, BOOL isPublic, NSError **error)
{
  NSData *der = LxDecodeBase64(keyBase64);
  if (der.length == 0) {
    LxAssignError(error, @"invalid RSA key");
    return NULL;
  }

  NSData *pkcs1 = isPublic ? LxStripSPKI(der) : LxStripPKCS8(der);
  if (pkcs1.length == 0) {
    // 兼容直接传入 PKCS#1 的情况
    pkcs1 = der;
  }

  NSDictionary *attributes = @{
    (__bridge NSString *)kSecAttrKeyType: (__bridge NSString *)kSecAttrKeyTypeRSA,
    (__bridge NSString *)kSecAttrKeyClass: isPublic
      ? (__bridge NSString *)kSecAttrKeyClassPublic
      : (__bridge NSString *)kSecAttrKeyClassPrivate,
  };

  CFErrorRef cfError = NULL;
  SecKeyRef key = SecKeyCreateWithData((__bridge CFDataRef)pkcs1,
                                       (__bridge CFDictionaryRef)attributes,
                                       &cfError);
  if (key == NULL) {
    NSString *message = cfError ? CFBridgingRelease(CFErrorCopyDescription(cfError)) : @"SecKeyCreateWithData failed";
    if (cfError) CFRelease(cfError);
    LxAssignError(error, message);
  }
  return key;
}

NSData *LXRSAEncrypt(NSData *plain, NSString *publicKeyBase64, NSString *padding, NSError **error)
{
  SecKeyAlgorithm algorithm = LxKeyAlgorithm(padding);
  if (algorithm == NULL) {
    LxAssignError(error, [NSString stringWithFormat:@"unsupported padding: %@", padding]);
    return nil;
  }

  SecKeyRef key = LxCreateRSAKey(publicKeyBase64, YES, error);
  if (key == NULL) return nil;
  if (!SecKeyIsAlgorithmSupported(key, kSecKeyOperationTypeEncrypt, algorithm)) {
    CFRelease(key);
    LxAssignError(error, @"algorithm not supported for public key");
    return nil;
  }

  CFErrorRef cfError = NULL;
  CFDataRef result = SecKeyCreateEncryptedData(key, algorithm, (__bridge CFDataRef)plain, &cfError);
  CFRelease(key);

  if (result == NULL) {
    NSString *message = cfError ? CFBridgingRelease(CFErrorCopyDescription(cfError)) : @"encrypt failed";
    if (cfError) CFRelease(cfError);
    LxAssignError(error, message);
    return nil;
  }
  return CFBridgingRelease(result);
}

NSData *LXRSADecrypt(NSData *cipher, NSString *privateKeyBase64, NSString *padding, NSError **error)
{
  SecKeyAlgorithm algorithm = LxKeyAlgorithm(padding);
  if (algorithm == NULL) {
    LxAssignError(error, [NSString stringWithFormat:@"unsupported padding: %@", padding]);
    return nil;
  }

  SecKeyRef key = LxCreateRSAKey(privateKeyBase64, NO, error);
  if (key == NULL) return nil;
  if (!SecKeyIsAlgorithmSupported(key, kSecKeyOperationTypeDecrypt, algorithm)) {
    CFRelease(key);
    LxAssignError(error, @"algorithm not supported for private key");
    return nil;
  }

  CFErrorRef cfError = NULL;
  CFDataRef result = SecKeyCreateDecryptedData(key, algorithm, (__bridge CFDataRef)cipher, &cfError);
  CFRelease(key);

  if (result == NULL) {
    NSString *message = cfError ? CFBridgingRelease(CFErrorCopyDescription(cfError)) : @"decrypt failed";
    if (cfError) CFRelease(cfError);
    LxAssignError(error, message);
    return nil;
  }
  return CFBridgingRelease(result);
}
