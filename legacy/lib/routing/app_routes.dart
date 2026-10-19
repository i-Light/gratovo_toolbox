/// Route path constants — keep every literal path string in one place so
/// `context.go(...)` call sites and the route declarations in
/// `app_router.dart` never drift apart.
class AppRoutes {
  AppRoutes._();

  /// Sign-in. Outside the app shell — there is no nav rail before you have
  /// an identity.
  static const login = '/login';

  /// Signed in, but not yet granted an access level. Also outside the shell:
  /// every section would be empty, and an empty app reads as a broken one.
  static const accessPending = '/access-pending';

  /// Edits that were refused because the value they were based on had already
  /// changed. Outside the shell on purpose: this is a queue you empty, not a
  /// section you live in, and the nav rail has no room for a tenth-and-a-half
  /// destination that is empty most weeks. Reached from the app bar badge.
  ///
  /// Optional `?channel=` narrows it to one channel, which is what the banner
  /// on an influencer profile passes.
  static const conflicts = '/conflicts';

  static const dashboard = '/';
  static const search = '/search';

  /// Influencers, brands, and the archive of rejected channels — one nav-rail
  /// destination, three sections you switch between from the app bar. See
  /// `RosterScreen`. The profile routes below keep their own top-level paths.
  static const roster = '/roster';
  static const deals = '/deals';
  static const outreach = '/outreach';
  static const news = '/news';
  static const logs = '/logs';

  /// The broker's manual payment ledger, with the team's weekly performance
  /// rollup as its top section — see `finance_screen.dart`.
  static const finance = '/finance';

  static const settings = '/settings';

  /// The conflicts page, narrowed to one channel.
  static String conflictsForChannel(String channelId) =>
      '$conflicts?channel=${Uri.encodeQueryComponent(channelId)}';

  static String influencerDetail(String id) => '/influencers/$id';
  static String brandDetail(String id) => '/brands/$id';
  static String dealDetail(String id) => '/deals/$id';

  /// One outreach conversation, open in the detail panel.
  static String outreachThread(String threadId) => '/outreach/thread/$threadId';

  /// "Message this influencer" — resolves (or creates) their single thread,
  /// then redirects to [outreachThread]. See app_router.dart.
  static String outreachCompose(String influencerId) =>
      '/outreach/compose/$influencerId';
}
