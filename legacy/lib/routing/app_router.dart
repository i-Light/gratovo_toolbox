import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/features/auth/presentation/login_screen.dart';
import 'package:gratovo_toolbox/features/brands/presentation/brand_profile_screen.dart';
import 'package:gratovo_toolbox/features/campaigns/presentation/campaign_detail_screen.dart';
import 'package:gratovo_toolbox/features/conflicts/presentation/conflicts_screen.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/dashboard_screen.dart';
import 'package:gratovo_toolbox/features/deals/presentation/deal_detail_screen.dart';
import 'package:gratovo_toolbox/features/deals/presentation/deal_list_screen.dart';
import 'package:gratovo_toolbox/features/finance/presentation/finance_screen.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_profile_screen.dart';
import 'package:gratovo_toolbox/features/onboarding/presentation/onboarding_gate.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/outreach_screen.dart';
import 'package:gratovo_toolbox/features/roster/presentation/roster_screen.dart';
import 'package:gratovo_toolbox/features/search/presentation/search_screen.dart';
import 'package:gratovo_toolbox/features/settings/presentation/settings_screen.dart';
import 'package:gratovo_toolbox/features/shell/presentation/app_shell.dart';
import 'package:gratovo_toolbox/routing/app_redirect.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');

/// The single, app-wide router.
///
/// Uses [StatefulShellRoute.indexedStack] rather than a plain [ShellRoute]
/// so each top-level section keeps its own navigation stack and scroll
/// position when you switch tabs — e.g. drilling into a Deal, hopping to
/// News, then back to Deals lands you exactly where you left off, not back at
/// the list's top. The `/deals/:id` detail route is nested under its list
/// route's branch so the back button unwinds within that branch. Influencers,
/// brands, and the archive share the one `/roster` branch (see RosterScreen);
/// `/influencers/:id` and `/brands/:id` sit beside `/roster` in that branch.
final routerProvider = Provider<GoRouter>((ref) {
  // go_router needs a plain Listenable to know when to re-evaluate `redirect`.
  // Bumping a counter on each auth/level change is enough — the redirect
  // reads the current values itself, so what it is told is irrelevant, only
  // that something changed.
  final refresh = ValueNotifier<int>(0);
  ref.listen(isSignedInProvider, (_, __) => refresh.value++);
  ref.listen(accessLevelProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: AppRoutes.dashboard,
    refreshListenable: refresh,
    // The single place that decides where anyone is allowed to be. Screens
    // never navigate on sign-in/sign-out themselves — they change state and
    // this recomputes, so there is exactly one answer rather than one per
    // call site.
    redirect: (context, state) => redirectFor(
      location: state.matchedLocation,
      signedIn: ref.read(isSignedInProvider),
      profileLoading: ref.read(currentProfileProvider).isLoading,
      accessLevel: ref.read(accessLevelProvider),
    ),
    routes: [
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.accessPending,
        builder: (context, state) => const AccessPendingScreen(),
      ),
      // Outside the shell, like the two above it, but for a different reason:
      // those are places you cannot leave, this is one you are meant to leave
      // as soon as you are done. Pushed over the app rather than switching a
      // tab, so dismissing it returns you to whatever you were doing.
      GoRoute(
        path: AppRoutes.conflicts,
        builder: (context, state) => ConflictsScreen(
          channelId: state.uri.queryParameters['channel'],
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => OnboardingGate(
          child: AppShell(navigationShell: navigationShell),
        ),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
              path: AppRoutes.dashboard,
              builder: (context, state) => const DashboardScreen(),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: AppRoutes.search,
              builder: (context, state) => const SearchScreen(),
            ),
          ]),
          // Influencers, brands, and the archive of rejected channels share one
          // branch and one rail slot. `RosterScreen` picks which of the three
          // lists is on screen; the two profile routes keep their own top-level
          // paths as siblings so nothing that links to `/influencers/:id` or
          // `/brands/:id` has to change. They are opened with `context.go`, which
          // leaves nothing to pop, so each profile app bar carries its own back
          // button to `/roster`.
          StatefulShellBranch(routes: [
            GoRoute(
              path: AppRoutes.roster,
              builder: (context, state) => const RosterScreen(),
            ),
            GoRoute(
              path: '/influencers/:id',
              builder: (context, state) => InfluencerProfileScreen(
                influencerId: state.pathParameters['id']!,
              ),
            ),
            GoRoute(
              path: '/brands/:id',
              builder: (context, state) => BrandProfileScreen(
                brandId: state.pathParameters['id']!,
              ),
              routes: [
                GoRoute(
                  path: 'campaigns/:campaignId',
                  builder: (context, state) => CampaignDetailScreen(
                    campaignId: state.pathParameters['campaignId']!,
                  ),
                ),
              ],
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: AppRoutes.deals,
              builder: (context, state) => const DealListScreen(),
              routes: [
                GoRoute(
                  path: ':id',
                  builder: (context, state) => DealDetailScreen(
                    dealId: state.pathParameters['id']!,
                  ),
                ),
              ],
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: AppRoutes.outreach,
              builder: (context, state) => const OutreachScreen(),
              routes: [
                GoRoute(
                  path: 'thread/:threadId',
                  builder: (context, state) => OutreachScreen(
                    threadId: state.pathParameters['threadId'],
                    focusCompose:
                        state.uri.queryParameters['focus'] == 'compose',
                  ),
                ),
                GoRoute(
                  path: 'compose/:influencerId',
                  builder: (context, state) => OutreachScreen(
                    composeForInfluencerId:
                        state.pathParameters['influencerId'],
                  ),
                ),
              ],
            ),
          ]),
          // News and Logs are no longer shell branches — they open as modal
          // dialogs from the Dashboard (NewsScreen.showAsDialog /
          // LogsScreen.showAsDialog). Scratchpad is no longer one either — it
          // is a view on the Outreach page now (see OutreachScreen), same as
          // the email critique library.
          // Finance is hidden in release builds. Its branch is omitted, so
          // Settings' branch index shifts down by one — see app_shell.dart.
          if (!kReleaseMode)
            StatefulShellBranch(routes: [
              GoRoute(
                path: AppRoutes.finance,
                builder: (context, state) => const FinanceScreen(),
              ),
            ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: AppRoutes.settings,
              builder: (context, state) => const SettingsScreen(),
            ),
          ]),
        ],
      ),
    ],
  );
});
