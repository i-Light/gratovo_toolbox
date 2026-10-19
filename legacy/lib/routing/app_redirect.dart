import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The one rule for where anyone is allowed to be, as a pure function of the
/// four facts it depends on. `app_router.dart` feeds it the live values on
/// every navigation and every auth change; this file is what the rule *is*,
/// kept apart from the router so it can be read in one screen and tested
/// without building a single widget.
///
/// Returns the location to send the person to, or null to let them stay.
///
/// In order:
/// 1. Not signed in — everything is the login page.
/// 2. Signed in but the profile row (which carries the access level) has not
///    arrived yet — stay put. Bouncing someone to the access-pending screen
///    for a few hundred milliseconds on every launch and then bouncing them
///    back is worse than a blank frame.
/// 3. Signed in and not yet granted an access level — the access-pending
///    page, and nothing else.
/// 4. Authorized and still on one of the two holding pages — the dashboard.
/// 5. Outreach is for `full` only. `basic` sees everything else; the outreach
///    rows still sync to the machine (the influencer list's outbound count
///    and the dashboard's "sent today" read them locally), but the page
///    itself — bodies, addresses, who was written to — is not theirs. The rail
///    hides the destination; this is what makes a typed or remembered URL
///    land on the dashboard instead.
String? redirectFor({
  required String location,
  required bool signedIn,
  required bool profileLoading,
  required AccessLevel accessLevel,
}) {
  if (!signedIn) {
    return location == AppRoutes.login ? null : AppRoutes.login;
  }

  if (profileLoading) return null;

  if (!accessLevel.isAuthorized) {
    return location == AppRoutes.accessPending ? null : AppRoutes.accessPending;
  }

  if (location == AppRoutes.login || location == AppRoutes.accessPending) {
    return AppRoutes.dashboard;
  }

  if (location.startsWith(AppRoutes.outreach) &&
      !accessLevel.seesSensitiveData) {
    return AppRoutes.dashboard;
  }
  return null;
}
