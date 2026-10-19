import 'dart:convert';
import 'dart:developer' as developer;

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// What AWS said when asked to identify the holder of a key pair.
enum AwsIdentityResult {
  /// AWS recognised the key and the signature matched.
  valid,

  /// AWS recognised the request and refused the credential: unknown key id,
  /// wrong secret, key disabled. The one outcome that means "fix this".
  rejected,

  /// Nothing conclusive — offline, DNS failure, a 5xx, a timeout. Says
  /// nothing about the credential and must not be recorded as if it did.
  unknown,
}

/// Asks AWS STS `GetCallerIdentity` whether a key pair is currently good.
///
/// `GetCallerIdentity` is the right call for this and close to the only one:
/// every credential is allowed to make it regardless of IAM policy, so a
/// refusal is unambiguously about the credential rather than about what it is
/// permitted to do. A check built on any other API would fail identically for
/// "your key is wrong" and "your key is fine but lacks this permission", and
/// the badge would then be lying half the time.
///
/// Signed here rather than through an AWS SDK because this is the only AWS
/// call the Dart side makes at all — the pipeline does the real gateway work
/// in Python, with its own boto3. One request is not worth a dependency.
class AwsIdentityCheck {
  const AwsIdentityCheck({http.Client? client}) : _client = client;

  final http.Client? _client;

  static const _service = 'sts';
  static const _region = 'us-east-1';
  static const _host = 'sts.amazonaws.com';
  static const _body = 'Action=GetCallerIdentity&Version=2011-06-15';

  Future<AwsIdentityResult> check({
    required String accessKeyId,
    required String secretAccessKey,
  }) async {
    if (accessKeyId.trim().isEmpty || secretAccessKey.trim().isEmpty) {
      // Nothing entered is "not set up", which this project deliberately does
      // not treat as a credential problem.
      return AwsIdentityResult.unknown;
    }

    final client = _client ?? http.Client();
    try {
      final now = DateTime.now().toUtc();
      final amzDate = _amzDate(now);
      final dateStamp = amzDate.substring(0, 8);

      final headers = <String, String>{
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        'host': _host,
        'x-amz-date': amzDate,
      };
      final signedHeaders = (headers.keys.toList()..sort()).join(';');
      final canonicalHeaders = [
        for (final key in headers.keys.toList()..sort())
          '$key:${headers[key]!.trim()}\n',
      ].join();

      final canonicalRequest = [
        'POST',
        '/',
        '',
        canonicalHeaders,
        signedHeaders,
        _sha256Hex(utf8.encode(_body)),
      ].join('\n');

      final credentialScope = '$dateStamp/$_region/$_service/aws4_request';
      final stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        _sha256Hex(utf8.encode(canonicalRequest)),
      ].join('\n');

      final signature = _hex(
        _hmac(
            _signingKey(secretAccessKey, dateStamp), utf8.encode(stringToSign)),
      );

      final response = await client
          .post(
            Uri.https(_host, '/'),
            headers: {
              ...headers,
              'authorization': 'AWS4-HMAC-SHA256 '
                  'Credential=$accessKeyId/$credentialScope, '
                  'SignedHeaders=$signedHeaders, '
                  'Signature=$signature',
            },
            body: _body,
          )
          .timeout(const Duration(seconds: 20));

      return classify(response.statusCode, response.body);
    } catch (error, stackTrace) {
      developer.log(
        'AWS identity check could not complete; leaving the recorded verdict '
        'as it was.',
        name: 'gratovo.aws',
        level: 800,
        error: error,
        stackTrace: stackTrace,
      );
      return AwsIdentityResult.unknown;
    } finally {
      if (_client == null) client.close();
    }
  }

  /// STS answers a bad credential with 403 and an error code in the body.
  /// Split out so the mapping is testable without a network.
  @visibleForTesting
  static AwsIdentityResult classify(int statusCode, String body) {
    if (statusCode == 200) return AwsIdentityResult.valid;
    // 400 with these codes happens for a malformed key id; 403 for a good id
    // with a bad secret, a disabled key, or one that no longer exists.
    const credentialCodes = [
      'InvalidClientTokenId',
      'SignatureDoesNotMatch',
      'UnrecognizedClientException',
      'AuthFailure',
      'ExpiredToken',
      'InvalidAccessKeyId',
      'AccessDenied',
    ];
    if (statusCode == 401 ||
        statusCode == 403 ||
        (statusCode == 400 && credentialCodes.any(body.contains))) {
      return AwsIdentityResult.rejected;
    }
    // Throttling and 5xx are AWS having a moment, not a verdict on the key.
    return AwsIdentityResult.unknown;
  }

  static List<int> _signingKey(String secret, String dateStamp) {
    var key = _hmac(utf8.encode('AWS4$secret'), utf8.encode(dateStamp));
    key = _hmac(key, utf8.encode(_region));
    key = _hmac(key, utf8.encode(_service));
    return _hmac(key, utf8.encode('aws4_request'));
  }

  static List<int> _hmac(List<int> key, List<int> data) =>
      Hmac(sha256, key).convert(data).bytes;

  static String _hex(List<int> bytes) =>
      [for (final b in bytes) b.toRadixString(16).padLeft(2, '0')].join();

  static String _sha256Hex(List<int> bytes) => sha256.convert(bytes).toString();

  /// `20260918T134501Z` — the basic-format ISO 8601 AWS requires, which is
  /// `toIso8601String` with the separators and the fractional seconds taken
  /// back out.
  static String _amzDate(DateTime utc) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${utc.year}${two(utc.month)}${two(utc.day)}T'
        '${two(utc.hour)}${two(utc.minute)}${two(utc.second)}Z';
  }
}
