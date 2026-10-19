import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
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

/// Every screen is pumped against the in-memory mocks, which is automatic:
/// `localMirrorProvider` is null in a test, and every repository provider
/// falls back to its mock when there is no local database.
///
/// Text contrast is NOT asserted here — see `theme_contrast_test.dart`, which
/// measures the theme's color roles directly instead of reading a histogram
/// out of rendered pixels.
Widget _harness(Widget child) {
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
      // Several of these are views that live inside the AppShell's Scaffold
      // rather than screens that bring their own. Without one there is no
      // Material underneath, so every one of them would be measured against
      // an unpainted background.
      home: Scaffold(body: child),
    ),
  );
}

/// 40x40, not Android's 48x48.
///
/// This is a mouse-and-trackpad Windows tool, and its controls are laid out at
/// desktop density on purpose — a dense table of channels is the point of the
/// screen. 48 would fail nearly every icon button in the app and the honest
/// answer to that is not to assert it. 40 is the floor the design already
/// holds everywhere (`VisualDensity.compact` lands exactly there), so this
/// catches anything that drifts *below* what was chosen, which is the part
/// worth guarding. Raise it the day this app is pointed at a touchscreen.
const _desktopTapTarget = MinimumTapTargetGuideline(
  size: Size(40, 40),
  link: 'https://www.w3.org/WAI/WCAG21/Understanding/target-size.html',
);

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

void main() {
  for (final entry in _screens.entries) {
    testWidgets('${entry.key}: every tappable is labelled and big enough',
        (tester) async {
      tester.view.physicalSize = const Size(1400, 1800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final handle = tester.ensureSemantics();

      await tester.pumpWidget(_harness(entry.value()));
      // Bounded, not `pumpAndSettle`: Settings shows an indeterminate spinner
      // for every service it cannot reach, and in a test it can reach none of
      // them, so the tree never goes quiet. A fixed number of frames is enough
      // for the providers to resolve and is what the other screens need too.
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      // Nothing tappable is unreachable to a screen reader...
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      // ...and nothing tappable is smaller than _desktopTapTarget.
      await expectLater(tester, meetsGuideline(_desktopTapTarget));

      handle.dispose();
    });
  }
}
