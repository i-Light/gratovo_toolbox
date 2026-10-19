import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';
import 'package:gratovo_toolbox/core/status/gemini_bridge_presentation.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

final _en = lookupAppLocalizations(const Locale('en'));
final _ar = lookupAppLocalizations(const Locale('ar'));

void main() {
  group('describeGeminiFailure', () {
    test('an ordinary failure is "CODE: message"', () {
      expect(
        describeGeminiFailure(
          GeminiBridgeException(code: 'TIMEOUT', message: 'took too long'),
          _en,
        ),
        'TIMEOUT: took too long',
      );
    });

    // The outreach cards' own sentences went with decision old-files: their
    // codes are now ordinary failures, with no pointer to Settings.
    test('an old outreach cards code is an ordinary failure now', () {
      expect(
        describeGeminiFailure(
          GeminiBridgeException(
            code: 'OUTREACH_CARDS_MISSING',
            message: 'no cards list',
          ),
          _en,
        ),
        'OUTREACH_CARDS_MISSING: no cards list',
      );
    });

    test('a bridge problem adds the pointer to Settings', () {
      final error = GeminiBridgeException(
        code: 'EXTENSION_NOT_CONNECTED',
        message: 'no extension',
      );
      final text = describeGeminiFailure(error, _en);
      expect(text, startsWith('EXTENSION_NOT_CONNECTED: no extension\n'));
      expect(text, contains(_en.geminiBridgeFailureHint));
      expect(
        describeGeminiFailure(error, _ar),
        contains(_ar.geminiBridgeFailureHint),
      );
    });
  });
}
