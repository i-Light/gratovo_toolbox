import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/core/theme/font_scale_provider.dart';
import 'package:gratovo_toolbox/features/archive/presentation/archive_screen.dart';
import 'package:gratovo_toolbox/features/brands/presentation/brand_list_screen.dart';
import 'package:gratovo_toolbox/features/conflicts/presentation/conflicts_screen.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/dashboard_screen.dart';
import 'package:gratovo_toolbox/features/deals/presentation/deal_list_screen.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_list_screen.dart';
import 'package:gratovo_toolbox/features/logs/presentation/logs_screen.dart';
import 'package:gratovo_toolbox/features/news/presentation/news_screen.dart';
import 'package:gratovo_toolbox/features/scratchpad/presentation/scratchpad_screen.dart';
import 'package:gratovo_toolbox/features/settings/presentation/settings_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Every main screen, at every window shape and text size the app lets a
/// person reach, with nothing allowed to overflow.
///
/// This exists because overflow is this project's recurring bug: a 53px
/// overflow in the dashboard's analytics header and a 166px one in the
/// onboarding wizard both shipped and were both found by accident. Neither
/// needed a special case to reproduce — one window size and one font step
/// away from the default was enough, and both are settings a teammate can
/// actually pick ([kMaxFontScale] is 1.6, and the app runs windowed).
///
/// A `RenderFlex overflowed` is reported as a Flutter error, which
/// `tester.takeException()` returns, so the assertion is simply that a screen
/// built at this size raised nothing.

Widget _harness(Widget child, double fontScale) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      locale: const Locale('en'),
      theme: AppTheme.dark,
      builder: (context, child) => MediaQuery(
        // The same place and the same mechanism app.dart applies the slider.
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(fontScale)),
        child: child!,
      ),
      home: Scaffold(body: child),
    ),
  );
}

final _screens = <String, Widget Function()>{
  'dashboard': DashboardScreen.new,
  'influencers': InfluencerListScreen.new,
  'brands': BrandListScreen.new,
  'deals': DealListScreen.new,
  'archive': ArchiveScreen.new,
  'conflicts': ConflictsScreen.new,
  'news': NewsScreen.new,
  'logs': LogsScreen.new,
  'scratchpad': ScratchpadView.new,
  'settings': SettingsScreen.new,
};

/// Window shapes the app is actually used at — see `ResponsiveContext`, which
/// branches at 700 and 1100 logical pixels.
const _windows = <String, Size>{
  'desktop': Size(1400, 900),
  'tablet': Size(900, 800),
  'phone': Size(420, 820),
};

void main() {
  for (final screen in _screens.entries) {
    for (final window in _windows.entries) {
      // The default and the top of the slider's range. The bottom (0.8) can
      // only ever free up space.
      for (final scale in <double>[kDefaultFontScale, kMaxFontScale]) {
        testWidgets(
            '${screen.key} lays out at ${window.key} '
            '(${window.value.width.toInt()}x${window.value.height.toInt()}) '
            'and ${scale}x text', (tester) async {
          tester.view.physicalSize = window.value;
          tester.view.devicePixelRatio = 1.0;
          addTearDown(tester.view.reset);

          await tester.pumpWidget(_harness(screen.value(), scale));
          // Bounded rather than pumpAndSettle: Settings spins forever on the
          // services it cannot reach in a test.
          for (var i = 0; i < 12; i++) {
            await tester.pump(const Duration(milliseconds: 100));
          }

          expect(tester.takeException(), isNull);
        });
      }
    }
  }
}
