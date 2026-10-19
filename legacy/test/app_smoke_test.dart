import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/app.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';

void main() {
  // With per-person accounts, "boots to the Dashboard" is no longer the right
  // assertion — nobody reaches the Dashboard without signing in. What matters
  // now is that a build with NO working backend lands on the sign-in screen
  // and explains itself, rather than throwing or showing an empty app.
  testWidgets('boots to sign-in, and says why, when the backend is unreachable',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          supabaseBootProvider.overrideWithValue(
            const SupabaseBoot(
              config: SupabaseConfig(url: '', anonKey: ''),
              error: 'no server configured in this test',
            ),
          ),
          // Pinned, because the assertions below are in English and the app's
          // default language is Arabic (see LocaleNotifier — it is the team's
          // working language, not an oversight). Without this override the
          // test reads whatever the default happens to be, and asserting
          // English against an Arabic UI fails in a way that looks like the
          // sign-in screen is broken rather than like a test that never said
          // which language it meant.
          localeProvider.overrideWith(_EnglishLocale.new),
        ],
        child: const GratovoApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Sign in'), findsOneWidget);
    // The unreachable-server card, not a blank form the user would poke at.
    expect(
      find.textContaining("Can't reach the server"),
      findsOneWidget,
    );
  });

  testWidgets('boots in Arabic by default, right-to-left', (tester) async {
    // The other half of the same point: the default really is Arabic, and a
    // change to that should break a test that says so out loud rather than one
    // that happens to assert English strings.
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          supabaseBootProvider.overrideWithValue(
            const SupabaseBoot(
              config: SupabaseConfig(url: '', anonKey: ''),
              error: 'no server configured in this test',
            ),
          ),
        ],
        child: const GratovoApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(Directionality.of(tester.element(find.byType(Form).first)),
        TextDirection.rtl);
  });
}

/// A LocaleNotifier fixed to English, so the assertions above are testing the
/// screen rather than the current default language.
class _EnglishLocale extends LocaleNotifier {
  @override
  Locale build() => const Locale('en');
}
