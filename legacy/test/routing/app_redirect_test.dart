import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/routing/app_redirect.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

String? _at(
  String location, {
  bool signedIn = true,
  bool profileLoading = false,
  AccessLevel accessLevel = AccessLevel.full,
}) =>
    redirectFor(
      location: location,
      signedIn: signedIn,
      profileLoading: profileLoading,
      accessLevel: accessLevel,
    );

void main() {
  group('signed out', () {
    test('everything goes to login', () {
      for (final where in [
        AppRoutes.dashboard,
        AppRoutes.search,
        AppRoutes.outreach,
        AppRoutes.accessPending,
        AppRoutes.dealDetail('d1'),
      ]) {
        expect(_at(where, signedIn: false), AppRoutes.login, reason: where);
      }
    });

    test('login itself stays put', () {
      expect(_at(AppRoutes.login, signedIn: false), isNull);
    });

    test('the access level is irrelevant without a session', () {
      expect(
        _at(AppRoutes.dashboard,
            signedIn: false, accessLevel: AccessLevel.unauthorized),
        AppRoutes.login,
      );
    });
  });

  group('profile still loading', () {
    test('nobody is moved, whatever the level currently reads', () {
      // The level is `unauthorized` until the row arrives; acting on it
      // would bounce every launch through the access-pending page.
      expect(
        _at(AppRoutes.dashboard,
            profileLoading: true, accessLevel: AccessLevel.unauthorized),
        isNull,
      );
      expect(_at(AppRoutes.login, profileLoading: true), isNull);
      expect(
        _at(AppRoutes.outreach,
            profileLoading: true, accessLevel: AccessLevel.basic),
        isNull,
      );
    });
  });

  group('signed in, not yet granted access', () {
    test('everything goes to access-pending', () {
      for (final where in [
        AppRoutes.dashboard,
        AppRoutes.login,
        AppRoutes.settings,
      ]) {
        expect(
          _at(where, accessLevel: AccessLevel.unauthorized),
          AppRoutes.accessPending,
          reason: where,
        );
      }
    });

    test('access-pending itself stays put', () {
      expect(
        _at(AppRoutes.accessPending, accessLevel: AccessLevel.unauthorized),
        isNull,
      );
    });
  });

  group('authorized', () {
    test('the two holding pages hand over to the dashboard', () {
      expect(_at(AppRoutes.login), AppRoutes.dashboard);
      expect(_at(AppRoutes.accessPending), AppRoutes.dashboard);
      expect(
        _at(AppRoutes.login, accessLevel: AccessLevel.basic),
        AppRoutes.dashboard,
      );
    });

    test('ordinary pages are left alone', () {
      for (final where in [
        AppRoutes.dashboard,
        AppRoutes.search,
        AppRoutes.roster,
        AppRoutes.conflicts,
        AppRoutes.influencerDetail('x'),
      ]) {
        expect(_at(where), isNull, reason: where);
        expect(_at(where, accessLevel: AccessLevel.basic), isNull,
            reason: where);
      }
    });

    test('outreach is for full only, including its sub-routes', () {
      for (final where in [
        AppRoutes.outreach,
        AppRoutes.outreachThread('t1'),
        AppRoutes.outreachCompose('i1'),
      ]) {
        expect(_at(where), isNull, reason: where);
        expect(
          _at(where, accessLevel: AccessLevel.basic),
          AppRoutes.dashboard,
          reason: where,
        );
      }
    });
  });
}
