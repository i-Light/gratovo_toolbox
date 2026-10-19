import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_channel_stats_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/dashboard/application/channel_analytics_controller.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/channel_analytics_section.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/mini_charts.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The analytics section, against the seeded mock population.
///
/// Two things worth pinning here and nowhere else. The first is the access
/// gate: this section aggregates every channel the agency has ever found, and
/// showing it to a `basic` account would answer, in one glance, a question the
/// whole redaction layer exists to refuse. The second is that the filters
/// actually narrow — a filter bar over charts that ignore it is the kind of bug
/// that looks like working software.
Widget _harness({AccessLevel level = AccessLevel.full, bool expanded = true}) {
  return ProviderScope(
    overrides: [
      // Overriding the derived provider rather than a session and a profile
      // row: what the section reads is the level, and standing up an auth
      // stack to arrive at the same boolean tests Supabase, not this widget.
      canSeeChannelAnalyticsProvider.overrideWithValue(level.seesSensitiveData),
      channelStatsRepositoryProvider
          .overrideWithValue(const MockChannelStatsRepository()),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          // The section is collapsed on the real Dashboard; every test that
          // reads a figure or a chart wants it open, so the harness opens it by
          // default and the one collapse test asks for it shut.
          child: ChannelAnalyticsSection(initiallyExpanded: expanded),
        ),
      ),
    ),
  );
}

void _sizeTo(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('full authority sees the section and its figures',
      (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Channel analytics'), findsOneWidget);
    // 14 seeded channels, and every chart title present.
    expect(find.text('14'), findsOneWidget);
    expect(find.text('Subscriber distribution'), findsOneWidget);
    expect(find.text('Median views distribution'), findsOneWidget);
    expect(find.text('Countries'), findsOneWidget);
    expect(find.text('Found per month'), findsOneWidget);
    // The figure that replaced "Active this month": the current-month bucket of
    // the finds series, live count over archived count.
    expect(find.text('Found channels this month'), findsOneWidget);
    expect(find.text('Pipeline stage'), findsWidgets);
  });

  // The seed's fourteenth channel has never been measured. It sits in the
  // '<10K' bar at zero — with the auto-clean rule on, "never measured" is a
  // channel that was too small to have its videos fetched, which is the
  // bottom of the distribution and not missing data — and the subtitle is what
  // tells the reader how much of that bar was measured. Pinned to the number
  // rather than to its presence.
  testWidgets('the view distribution says how many channels were measured',
      (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(
      find.text('13 of 14 have a measured 30-day median; the rest count as 0 '
          'under <10K. Same buckets as the subscriber chart above.'),
      findsOneWidget,
    );
  });

  // The distributions are histograms read for their shape, so they get the
  // whole width rather than half of it. Asserting the geometry rather than the
  // widget tree: a ColumnChart that quietly fell back to its 44px minimum
  // still passes every "is it on screen" check while drawing a small chart
  // marooned in an empty rectangle.
  testWidgets('a distribution spends the full width it is given',
      (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    final chart = find
        .ancestor(
          of: find.text('<10K'),
          matching: find.byType(ColumnChart),
        )
        .first;
    final columns = find.descendant(of: chart, matching: find.byType(Row));

    expect(
      tester.getSize(columns.first).width,
      moreOrLessEquals(tester.getSize(chart).width, epsilon: 0.5),
    );
    // And well past the 44px-per-column floor, which is what "filled" means
    // here — six tiers would otherwise occupy 264 of 1400 points.
    expect(tester.getSize(chart).width, greaterThan(6 * 44.0));
  });

  // The gate. Not a disabled control or an error panel — nothing at all.
  testWidgets('basic authority sees nothing at all', (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness(level: AccessLevel.basic));
    await tester.pumpAndSettle();

    expect(find.text('Channel analytics'), findsNothing);
    expect(find.byType(Card), findsNothing);
  });

  testWidgets('unauthorized sees nothing at all', (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness(level: AccessLevel.unauthorized));
    await tester.pumpAndSettle();

    expect(find.text('Channel analytics'), findsNothing);
  });

  // Collapsed by default on the Dashboard: the title is there, nothing behind
  // it is. Tapping the chevron expands it, and the charts and their fetch only
  // happen then.
  testWidgets('starts collapsed and expands on the chevron', (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness(expanded: false));
    await tester.pumpAndSettle();

    expect(find.text('Channel analytics'), findsOneWidget);
    expect(find.text('Subscriber distribution'), findsNothing);
    expect(find.byType(DropdownButtonFormField<String?>), findsNothing);

    await tester.tap(find.byTooltip('Expand'));
    await tester.pumpAndSettle();

    expect(find.text('Subscriber distribution'), findsOneWidget);
    expect(find.text('14'), findsOneWidget);

    // And back: the chevron in the header row folds it away again.
    await tester.tap(find.byTooltip('Collapse'));
    await tester.pumpAndSettle();

    expect(find.text('Subscriber distribution'), findsNothing);
  });

  testWidgets('a country filter narrows every figure', (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('14'), findsOneWidget);

    // The seed puts seven of its fourteen channels in EG. Tapping the field
    // itself rather than its floating label: the label is painted inside the
    // decoration and does not hit test.
    await tester.tap(find.byType(DropdownButtonFormField<String?>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('EG').last);
    await tester.pumpAndSettle();

    expect(find.text('7'), findsWidgets);
    expect(find.text('Clear filters'), findsOneWidget);
  });

  testWidgets('clearing the filters puts every channel back', (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String?>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('AE').last);
    await tester.pumpAndSettle();
    expect(find.text('14'), findsNothing);

    await tester.tap(find.text('Clear filters'));
    await tester.pumpAndSettle();
    expect(find.text('14'), findsOneWidget);
  });

  // A filter that matches nothing has to say so, rather than drawing eight
  // empty charts that read as a failed load.
  testWidgets('a filter matching nothing says so', (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextField, 'Min subscribers'),
      '99000000',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(find.text('No channel matches this filter.'), findsOneWidget);
  });

  // The archive is a second population, reported beside the live one. The mock
  // seeds six rejected channels, so the legend and the archived sub-lines are
  // on screen unfiltered — and a country filter, which the archive has no
  // column for, takes them back off. Archive-due channels are still full live
  // rows (two of them, seeded across EG and US), so a country filter narrows
  // that sub-line instead of clearing it.
  testWidgets('the archived series shows a legend and per-figure sub-lines',
      (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('Live'), findsOneWidget);
    expect(find.text('Archive due'), findsOneWidget);
    expect(find.text('Archived'), findsWidgets);
    expect(find.text('-2 archive due'), findsOneWidget);
    expect(find.text('-611K archive due'), findsOneWidget);
    expect(find.text('-20.8K archive due'), findsOneWidget);
    expect(find.text('+6 archived'), findsOneWidget);
    // The mock seeds two rejected channels found in the current month, so the
    // "Found channels this month" figure carries its own archived sub-line —
    // neither archive-due channel was found this month, so it carries none.
    expect(find.text('+2 archived'), findsOneWidget);

    await tester.tap(find.byType(DropdownButtonFormField<String?>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('EG').last);
    await tester.pumpAndSettle();

    // The toggles now ride in the filter row and stay put — a control that
    // vanished would just look broken. What comes off is the archived data
    // itself: its per-figure sub-lines disappear because the archive keeps no
    // country column. Archive-due is a full live row, so its own sub-line
    // survives, narrowed to the one EG channel counting down.
    expect(find.text('Live'), findsOneWidget);
    expect(find.text('Archive due'), findsOneWidget);
    expect(find.text('Archived'), findsOneWidget);
    expect(find.text('-1 archive due'), findsOneWidget);
    expect(find.textContaining('archived'), findsNothing);
  });

  // The legend is a trio of checkboxes: unticking one drops that series from
  // the figures and the charts without touching the filter, so re-ticking it
  // brings the same numbers straight back.
  testWidgets('the legend checkboxes drop and restore the archived series',
      (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('+6 archived'), findsOneWidget);
    expect(find.text('+2 archived'), findsOneWidget);

    // Three checkboxes in the legend, Live, Archive due, then Archived.
    // Untick Archived.
    await tester.tap(find.byType(Checkbox).at(2));
    await tester.pumpAndSettle();

    expect(find.textContaining('archived'), findsNothing);
    // The legend itself stays put, so the series can be brought back.
    expect(find.text('Live'), findsOneWidget);
    expect(find.text('Archive due'), findsOneWidget);
    expect(find.text('Archived'), findsWidgets);
    // Unaffected by the Archived checkbox, since it is a disjoint population.
    expect(find.text('-2 archive due'), findsOneWidget);

    await tester.tap(find.byType(Checkbox).at(2));
    await tester.pumpAndSettle();

    expect(find.text('+6 archived'), findsOneWidget);
    expect(find.text('+2 archived'), findsOneWidget);
  });

  // Same shape as the archived checkbox, one column over: unticking "Archive
  // due" drops that series and re-ticking it brings the numbers straight back
  // — and it does not touch the archived sub-lines, since the two are
  // disjoint populations.
  testWidgets('the legend checkboxes drop and restore the archive-due series',
      (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('-2 archive due'), findsOneWidget);
    expect(find.text('-611K archive due'), findsOneWidget);

    await tester.tap(find.byType(Checkbox).at(1));
    await tester.pumpAndSettle();

    expect(find.textContaining('archive due'), findsNothing);
    expect(find.text('Live'), findsOneWidget);
    expect(find.text('Archive due'), findsOneWidget);
    // Unaffected by the Archive due checkbox.
    expect(find.text('+6 archived'), findsOneWidget);

    await tester.tap(find.byType(Checkbox).at(1));
    await tester.pumpAndSettle();

    expect(find.text('-2 archive due'), findsOneWidget);
    expect(find.text('-611K archive due'), findsOneWidget);
  });

  // The three number fields that replaced the old activity chip. Each one
  // narrows the population, and the arrows/wheel are exercised in the
  // SteppedNumberField test alongside.
  testWidgets('the avg-views and min-videos fields narrow the page',
      (tester) async {
    _sizeTo(tester, const Size(1400, 3000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(find.text('14'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Min videos uploaded last month'),
      '3',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    // Seven of the seeded channels post three or more times in the window.
    expect(find.text('7'), findsWidgets);
    expect(find.text('Clear filters'), findsOneWidget);
  });

  // The stacked layout. Eight charts, a filter bar and eight figures is the
  // densest thing on the Dashboard, and it is the one most likely to overflow.
  // The distributions scroll horizontally at this width rather than squeezing,
  // which is the branch the full-width path above does not exercise.
  testWidgets('lays out on a phone without overflowing', (tester) async {
    _sizeTo(tester, const Size(390, 5000));
    await tester.pumpWidget(_harness());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Channel analytics'), findsOneWidget);
  });
}
