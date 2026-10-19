import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/scroll/smooth_wheel_scroll.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/core/theme/debug_scale.dart';
import 'package:gratovo_toolbox/core/theme/font_scale_provider.dart';
import 'package:gratovo_toolbox/core/theme/theme_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/features/search/application/pipeline_warmup_controller.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_router.dart';

/// Root widget: theme, localization, and routing, all driven by Riverpod
/// providers so Settings (Phase 4) can flip them at runtime without this
/// file changing again.
///
/// No manual `Directionality` override here (the previous, Arabic-only
/// version of this app hardcoded RTL) — with both `en` and `ar` in
/// `supportedLocales`, Flutter derives text direction from the active
/// locale automatically.
class GratovoApp extends ConsumerStatefulWidget {
  const GratovoApp({super.key});

  @override
  ConsumerState<GratovoApp> createState() => _GratovoAppState();
}

class _GratovoAppState extends ConsumerState<GratovoApp> {
  @override
  void initState() {
    super.initState();
    // Starts the pipeline's shared-state download in the background, a
    // couple of seconds after launch. This used to be the first thing a
    // *search* did, which is why pressing Start sat on "Starting the
    // pipeline..." for the better part of a minute before any keyword was
    // worked. Best-effort and never awaited: see
    // `pipeline_warmup_controller.dart`. No-op off native desktop.
    ref.read(pipelineWarmupProvider.notifier).warmInBackground();

    // Slowly clears the backlog of channels a search discovered but never
    // got back around to fetching videos for, so the dashboard's average-
    // views figures fill in over time without anyone having to run search
    // after search waiting for it. See `video_catchup_controller.dart` —
    // cheap, best-effort, and gets out of the way the moment a search or a
    // manual "pull more" needs the database.
    ref.read(videoCatchUpControllerProvider.notifier).runInBackground();
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(themeModeProvider);
    final locale = ref.watch(localeProvider);
    final fontScale = ref.watch(fontScaleProvider);

    return MaterialApp.router(
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      routerConfig: ref.watch(routerProvider),
      // The single place the app-wide font scalar is applied. Wrapping here
      // rather than scaling the TextTheme means it reaches every widget —
      // including tooltips, dropdown menu items and snackbars, which build
      // their own text styles and would otherwise ignore it entirely.
      builder: (context, child) {
        if (child == null) return const SizedBox.shrink();
        Widget app = MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(fontScale)),
          // Eases desktop mouse-wheel scrolling app-wide — Flutter's default
          // is an instant jump per notch, which reads as too snappy on a
          // physical wheel. No-op off desktop and for trackpad/touch input.
          child: SmoothWheelScroll(
            // Mounted once here, above the router's Navigator, so a toast
            // raised from any screen — or from a modal dialog on top of one
            // — animates in at the same top-center spot. See AppToast.show.
            child: ToastOverlay(child: child),
          ),
        );
        // Debug-only pixel zoom (see debug_scale.dart) so the whole app can
        // be scaled up/down for eyeballing layouts, without that control
        // ever reaching a real build: `kDebugMode` is a compile-time
        // constant, so this branch — and the floating control it adds — is
        // stripped entirely from release and profile builds.
        if (kDebugMode) {
          app = Stack(
            children: [
              Positioned.fill(child: DebugScale(child: app)),
              const DebugScaleControls(),
            ],
          );
        }
        return app;
      },
    );
  }
}
