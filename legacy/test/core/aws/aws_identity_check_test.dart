import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/aws/aws_identity_check.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Captures the one request the check makes and answers it with [status].
class _Capture {
  http.Request? request;
  int calls = 0;

  MockClient client({int status = 200, String body = ''}) =>
      MockClient((req) async {
        calls++;
        request = req;
        return http.Response(body, status);
      });
}

const _key = 'AKIAIOSFODNN7EXAMPLE';
const _secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

/// An independent SigV4 signing of the request the check is known to send,
/// keyed off the `x-amz-date` it chose. Written out longhand rather than
/// borrowed from the production code so a change to the header set, the
/// canonical ordering or the credential scope shows up as a mismatch here
/// instead of as a 403 from AWS in the field.
String _expectedSignature(String amzDate) {
  final dateStamp = amzDate.substring(0, 8);
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';
  final canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:application/x-www-form-urlencoded; charset=utf-8\n'
        'host:sts.amazonaws.com\n'
        'x-amz-date:$amzDate\n',
    'content-type;host;x-amz-date',
    sha256.convert(utf8.encode(body)).toString(),
  ].join('\n');
  final stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    '$dateStamp/us-east-1/sts/aws4_request',
    sha256.convert(utf8.encode(canonicalRequest)).toString(),
  ].join('\n');

  List<int> hmac(List<int> key, String data) =>
      Hmac(sha256, key).convert(utf8.encode(data)).bytes;
  var signingKey = hmac(utf8.encode('AWS4$_secret'), dateStamp);
  signingKey = hmac(signingKey, 'us-east-1');
  signingKey = hmac(signingKey, 'sts');
  signingKey = hmac(signingKey, 'aws4_request');
  final signature = hmac(signingKey, stringToSign);
  return [for (final b in signature) b.toRadixString(16).padLeft(2, '0')]
      .join();
}

void main() {
  group('classify', () {
    test('200 is a good key', () {
      expect(AwsIdentityCheck.classify(200, '<xml/>'), AwsIdentityResult.valid);
    });

    test('403 is a refused credential whatever the body says', () {
      expect(AwsIdentityCheck.classify(403, ''), AwsIdentityResult.rejected);
      expect(AwsIdentityCheck.classify(401, ''), AwsIdentityResult.rejected);
    });

    test('400 counts only when the body names a credential error', () {
      expect(
        AwsIdentityCheck.classify(
            400, '<Error><Code>InvalidClientTokenId</Code></Error>'),
        AwsIdentityResult.rejected,
      );
      expect(
        AwsIdentityCheck.classify(
            400, '<Error><Code>SignatureDoesNotMatch</Code></Error>'),
        AwsIdentityResult.rejected,
      );
      // A malformed request is our bug, not the key's.
      expect(
        AwsIdentityCheck.classify(
            400, '<Error><Code>MissingAction</Code></Error>'),
        AwsIdentityResult.unknown,
      );
    });

    test('throttling and 5xx say nothing about the key', () {
      expect(AwsIdentityCheck.classify(429, ''), AwsIdentityResult.unknown);
      expect(AwsIdentityCheck.classify(500, ''), AwsIdentityResult.unknown);
      expect(AwsIdentityCheck.classify(503, ''), AwsIdentityResult.unknown);
    });
  });

  group('check', () {
    test('sends a correctly signed GetCallerIdentity', () async {
      final capture = _Capture();
      final check = AwsIdentityCheck(client: capture.client());

      final result =
          await check.check(accessKeyId: _key, secretAccessKey: _secret);

      expect(result, AwsIdentityResult.valid);
      final req = capture.request!;
      expect(req.method, 'POST');
      expect(req.url.toString(), 'https://sts.amazonaws.com/');
      expect(req.body, 'Action=GetCallerIdentity&Version=2011-06-15');

      final amzDate = req.headers['x-amz-date']!;
      expect(amzDate, matches(RegExp(r'^\d{8}T\d{6}Z$')));

      expect(
        req.headers['authorization'],
        'AWS4-HMAC-SHA256 '
        'Credential=$_key/${amzDate.substring(0, 8)}/us-east-1/sts/aws4_request, '
        'SignedHeaders=content-type;host;x-amz-date, '
        'Signature=${_expectedSignature(amzDate)}',
      );
    });

    test('a 403 is a rejection', () async {
      final capture = _Capture();
      final check = AwsIdentityCheck(
        client: capture.client(
          status: 403,
          body: '<Error><Code>InvalidClientTokenId</Code></Error>',
        ),
      );
      expect(
        await check.check(accessKeyId: _key, secretAccessKey: _secret),
        AwsIdentityResult.rejected,
      );
    });

    test('blank keys are "not set up", and nothing is sent', () async {
      final capture = _Capture();
      final check = AwsIdentityCheck(client: capture.client());

      expect(
        await check.check(accessKeyId: '  ', secretAccessKey: _secret),
        AwsIdentityResult.unknown,
      );
      expect(
        await check.check(accessKeyId: _key, secretAccessKey: ''),
        AwsIdentityResult.unknown,
      );
      expect(capture.calls, 0);
    });

    test('a network failure is unknown, not rejected', () async {
      final check = AwsIdentityCheck(
        client: MockClient((_) async => throw http.ClientException('offline')),
      );
      expect(
        await check.check(accessKeyId: _key, secretAccessKey: _secret),
        AwsIdentityResult.unknown,
      );
    });
  });
}
