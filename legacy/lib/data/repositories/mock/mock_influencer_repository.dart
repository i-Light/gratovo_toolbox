import 'package:flutter/foundation.dart';
import 'package:gratovo_toolbox/core/utils/blank.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/keyword_view_sample.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/models/sponsor_sighting.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/repositories/edit_cas.dart';
import 'package:gratovo_toolbox/data/repositories/influencer_repository.dart';

/// In-memory [InfluencerRepository], seeded with a realistic-looking set of
/// discovered channels so every screen is demoable before the shared backend is
/// wired up (Phase 5). Mutations are held in memory only — they don't
/// survive an app restart, which is fine for a mock; the real Supabase
/// implementation is what needs to actually persist.
class MockInfluencerRepository implements InfluencerRepository {
  final List<Influencer> _influencers = [
    Influencer(
      id: 'inf_001',
      handle: '@TechWithTaha',
      channelUrl: 'https://youtube.com/@TechWithTaha',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 185000,
      country: 'EG',
      lastVideoAt: DateTime.now().subtract(const Duration(days: 2)),
      medianViewsLast30: 42000,
      sourceKeywords: const ['tech review', 'smartphone review'],
      vettingStatus: VettingStatus.shortlisted,
      discoveredAt: DateTime.now().subtract(const Duration(days: 40)),
      notes: 'Replies fast, prefers WhatsApp over email for quick check-ins.',
      relevanceCriteria: const ['sponsorship mentions', 'upload frequency'],
      name: 'Tech With Taha',
      pipelineStage: PipelineStage.roster,
      contactAttempts: 2,
      channelTags: const [],
      videosLast30: 6,
      // Two ways to reach the same person, which is the normal case and the
      // reason contacts is a list — the WhatsApp number is the one that gets
      // answered, so it is the primary even though the email came first.
      contacts: const [
        InfluencerContact(
          method: ContactMethod.email,
          value: 'business@techwithtaha.com',
        ),
        InfluencerContact(
          method: ContactMethod.whatsapp,
          value: '+20 100 123 4567',
          isPrimary: true,
        ),
      ],
      lastFetchedAt: DateTime.now().subtract(const Duration(hours: 5)),
    ),
    Influencer(
      id: 'inf_002',
      handle: '@DailyGrindProductivity',
      channelUrl: 'https://youtube.com/@DailyGrindProductivity',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 62000,
      country: 'US',
      lastVideoAt: DateTime.now().subtract(const Duration(days: 5)),
      medianViewsLast30: 15000,
      sourceKeywords: const ['productivity app'],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime.now().subtract(const Duration(days: 3)),
      name: 'The Daily Grind',
      channelTags: const [ChannelTag.undecided],
      videosLast30: 3,
    ),
    Influencer(
      id: 'inf_003',
      handle: '@FitWithLayla',
      channelUrl: 'https://youtube.com/@FitWithLayla',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 310000,
      country: 'AE',
      lastVideoAt: DateTime.now().subtract(const Duration(hours: 18)),
      medianViewsLast30: 90000,
      sourceKeywords: const ['fitness routine', 'home workout'],
      vettingStatus: VettingStatus.shortlisted,
      discoveredAt: DateTime.now().subtract(const Duration(days: 55)),
      notes: 'Prefers a full video over a mid-roll spot.',
      name: 'Fit With Layla',
      pipelineStage: PipelineStage.negotiating,
      contactAttempts: 4,
      channelTags: const [],
      videosLast30: 11,
    ),
    Influencer(
      id: 'inf_004',
      handle: '@PixelPlaysGaming',
      channelUrl: 'https://youtube.com/@PixelPlaysGaming',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 540000,
      country: 'US',
      lastVideoAt: DateTime.now().subtract(const Duration(days: 1)),
      medianViewsLast30: 120000,
      sourceKeywords: const ['gaming setup', 'pc build'],
      vettingStatus: VettingStatus.rejected,
      discoveredAt: DateTime.now().subtract(const Duration(days: 70)),
      notes: 'Audience skews too young for our current brand roster.',
      name: 'Pixel Plays',
      pipelineStage: PipelineStage.lost,
      contactAttempts: 1,
      channelTags: const [ChannelTag.irrelevant],
      videosLast30: 9,
    ),
    Influencer(
      id: 'inf_005',
      handle: '@KitchenWithNour',
      channelUrl: 'https://youtube.com/@KitchenWithNour',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 128000,
      country: 'EG',
      lastVideoAt: DateTime.now().subtract(const Duration(days: 4)),
      medianViewsLast30: 30000,
      sourceKeywords: const ['easy recipes'],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime.now().subtract(const Duration(days: 2)),
      name: 'Kitchen With Nour',
      channelTags: const [ChannelTag.undecided],
      videosLast30: 5,
    ),
    Influencer(
      id: 'inf_006',
      handle: '@WanderlustWithSara',
      channelUrl: 'https://youtube.com/@WanderlustWithSara',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 95000,
      country: 'LB',
      lastVideoAt: DateTime.now().subtract(const Duration(days: 6)),
      medianViewsLast30: 22000,
      sourceKeywords: const ['budget travel'],
      vettingStatus: VettingStatus.shortlisted,
      discoveredAt: DateTime.now().subtract(const Duration(days: 30)),
      name: 'Wanderlust With Sara',
      pipelineStage: PipelineStage.contacted,
      contactAttempts: 1,
      channelTags: const [],
      videosLast30: 2,
    ),
    Influencer(
      id: 'inf_007',
      handle: '@MoneyMovesWithKarim',
      channelUrl: 'https://youtube.com/@MoneyMovesWithKarim',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 210000,
      country: 'EG',
      lastVideoAt: DateTime.now().subtract(const Duration(days: 3)),
      medianViewsLast30: 55000,
      sourceKeywords: const ['personal finance', 'investing basics'],
      vettingStatus: VettingStatus.shortlisted,
      discoveredAt: DateTime.now().subtract(const Duration(days: 130)),
      notes: 'Already closed one deal with us (Skillshare). Great to work '
          'with — turns scripts around in under 48h.',
      relevanceCriteria: const ['sponsorship mentions', 'new series launches'],
      name: 'Money Moves With Karim',
      pipelineStage: PipelineStage.paid,
      contactAttempts: 3,
      channelTags: const [ChannelTag.qualified],
      videosLast30: 7,
      contacts: const [
        InfluencerContact(
          method: ContactMethod.email,
          value: 'karim@moneymoves.eg',
          isPrimary: true,
        ),
        InfluencerContact(
          method: ContactMethod.email,
          value: 'deals@creatorhub.agency',
          label: 'manager',
        ),
      ],
      // The one seeded channel with a closed deal, so the dynamic
      // days-since-last-deal tag has something to supersede in the demo data.
      lastDealAt: DateTime.now().subtract(const Duration(days: 112)),
      daysSinceLastDeal: 112,
    ),
    Influencer(
      id: 'inf_008',
      handle: '@BeautyByRania',
      channelUrl: 'https://youtube.com/@BeautyByRania',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 78000,
      country: 'JO',
      lastVideoAt: DateTime.now().subtract(const Duration(days: 7)),
      medianViewsLast30: 18000,
      sourceKeywords: const ['skincare routine'],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime.now().subtract(const Duration(days: 1)),
      name: 'Beauty By Rania',
      channelTags: const [ChannelTag.haramStuff],
      videosLast30: 4,
    ),
  ];

  final Map<String, List<Video>> _videos = {
    'inf_001': [
      Video(
        id: 'vid_001a',
        title: 'This \$200 phone beat my \$1000 flagship — full review',
        url: 'https://youtube.com/watch?v=001a',
        publishedAt: DateTime.now().subtract(const Duration(days: 2)),
        viewCount: 51000,
        description:
            'Side by side against my daily driver: camera, battery and '
            'the one thing that actually made me switch back.',
      ),
      Video(
        id: 'vid_001b',
        title: 'Which VPN actually deserves your money in 2026?',
        url: 'https://youtube.com/watch?v=001b',
        publishedAt: DateTime.now().subtract(const Duration(days: 9)),
        viewCount: 38000,
        description: 'Sponsored segment at 4:12. Speed tests across three '
            'countries and what the fine print actually allows.',
      ),
    ],
    'inf_002': [
      Video(
        id: 'vid_002a',
        title: 'I tried every productivity app for 30 days',
        url: 'https://youtube.com/watch?v=002a',
        publishedAt: DateTime.now().subtract(const Duration(days: 5)),
        viewCount: 14200,
        description: 'Thirty days, eleven apps, one spreadsheet. What survived '
            'the month and what I deleted by day four.',
      ),
    ],
    'inf_003': [
      Video(
        id: 'vid_003a',
        title: '20-minute home workout — no equipment needed',
        url: 'https://youtube.com/watch?v=003a',
        publishedAt: DateTime.now().subtract(const Duration(hours: 18)),
        viewCount: 102000,
        description:
            'No equipment, no jumping, apartment friendly. Follow along '
            'in real time.',
      ),
      Video(
        id: 'vid_003b',
        title: 'My honest morning routine as a full-time creator',
        url: 'https://youtube.com/watch?v=003b',
        publishedAt: DateTime.now().subtract(const Duration(days: 8)),
        viewCount: 76000,
        description: 'The unedited version, including the two hours I spend on '
            'admin that nobody puts in these videos.',
      ),
    ],
    'inf_004': [
      Video(
        id: 'vid_004a',
        title: 'Building the ultimate 2026 gaming PC — budget edition',
        url: 'https://youtube.com/watch?v=004a',
        publishedAt: DateTime.now().subtract(const Duration(days: 1)),
        viewCount: 140000,
        description: 'Every part, every price, and where I would spend more if '
            'the budget stretched.',
      ),
    ],
    'inf_005': [
      Video(
        id: 'vid_005a',
        title: '5 easy dinners under 20 minutes',
        url: 'https://youtube.com/watch?v=005a',
        publishedAt: DateTime.now().subtract(const Duration(days: 4)),
        viewCount: 27000,
        description: 'Five dinners, one shopping list, nothing that needs more '
            'than one pan.',
      ),
    ],
    'inf_006': [
      Video(
        id: 'vid_006a',
        title: 'How I traveled 6 countries on \$1000',
        url: 'https://youtube.com/watch?v=006a',
        publishedAt: DateTime.now().subtract(const Duration(days: 6)),
        viewCount: 24000,
        description: 'Full breakdown of what each country cost, including the '
            'two nights that blew the budget.',
      ),
    ],
    'inf_007': [
      Video(
        id: 'vid_007a',
        title: 'Investing basics: how I built my first \$10k',
        url: 'https://youtube.com/watch?v=007a',
        publishedAt: DateTime.now().subtract(const Duration(days: 3)),
        viewCount: 61000,
        description:
            'What I actually bought, what I would skip, and the mistake '
            'that cost me a year of gains.',
      ),
      Video(
        id: 'vid_007b',
        title: 'The course platform that actually taught me to invest',
        url: 'https://youtube.com/watch?v=007b',
        publishedAt: DateTime.now().subtract(const Duration(days: 20)),
        viewCount: 48000,
        description:
            'Sponsored. My honest take after finishing three courses on '
            'it.',
      ),
    ],
    'inf_008': [
      Video(
        id: 'vid_008a',
        title: 'My skincare routine for sensitive skin',
        url: 'https://youtube.com/watch?v=008a',
        publishedAt: DateTime.now().subtract(const Duration(days: 7)),
        viewCount: 19500,
        description:
            'Morning and evening, with the two products I stopped using '
            'and why.',
      ),
    ],
  };

  /// Replaces the seeded demo data. Exists for tests, which need a known set
  /// rather than whatever the demo list currently holds — otherwise editing
  /// the seed data above silently changes what those tests assert. Public
  /// because a private member is not reachable from the test library at all;
  /// [visibleForTesting] is what keeps app code from calling it.
  @visibleForTesting
  void replaceAllForTesting(List<Influencer> replacement) {
    _influencers
      ..clear()
      ..addAll(replacement);
  }

  @override
  Future<List<Influencer>> getAll() async => List.unmodifiable(_influencers);

  @override
  Future<int> countByVettingStatus(VettingStatus status) async =>
      _influencers.where((i) => i.vettingStatus == status).length;

  @override
  Future<int> countArchiveDue() async =>
      _influencers.where((i) => i.isPendingArchive).length;

  @override
  Future<List<KeywordViewSample>> keywordViewSamples() async => [
        for (final i in _influencers)
          if (i.medianViewsLast30 case final views?)
            for (final keyword in i.sourceKeywords)
              KeywordViewSample(
                keyword: keyword,
                medianViews: views,
                pendingArchive: i.isPendingArchive,
              ),
      ];

  @override
  Future<List<String>> getVideoThumbnails(List<String> channelIds) async {
    final urls = <String>{
      for (final id in channelIds)
        for (final video in _videos[id] ?? const <Video>[])
          if (video.thumbnail case final url?) url,
    };
    return urls.toList();
  }

  /// Filters and sorts in memory, which is exactly what the Supabase
  /// implementation deliberately does NOT do — but here the whole dataset is
  /// eight hardcoded rows, so the in-memory version is the honest one. What
  /// matters is that it returns the same shape, including a truthful
  /// [InfluencerPage.hasMore], so the list's paging logic is exercised by the
  /// mock rather than only meeting the real thing in production.
  @override
  Future<InfluencerPage> getPage({
    required int offset,
    required int limit,
    InfluencerQuery query = const InfluencerQuery(),
  }) async {
    final matched = _influencers.where((i) => _matches(i, query)).toList()
      ..sort((a, b) {
        final result = _compare(a, b, query.sortBy);
        return query.descending ? -result : result;
      });

    final start = offset.clamp(0, matched.length);
    final end = (offset + limit).clamp(0, matched.length);
    final items = matched.sublist(start, end);

    // hasMore means "the database returned a full page", NOT "there are more
    // rows" — even though this implementation knows the total and could answer
    // the second question exactly. It must not: the Supabase implementation
    // cannot know without a second count query over the whole table, so the
    // honest shared contract is the weaker one. The cost is one extra empty
    // request when the row count is an exact multiple of the page size. The
    // cost of NOT matching is a mock that pages differently from production,
    // which is the one thing a mock must never do.
    return InfluencerPage(items: items, hasMore: items.length == limit);
  }

  bool _matches(Influencer i, InfluencerQuery q) {
    final search = q.search?.trim().toLowerCase();
    if (search != null && search.isNotEmpty) {
      final scopes =
          q.searchIn.isEmpty ? const {InfluencerSearchScope.names} : q.searchIn;
      final haystack = [
        if (scopes.contains(InfluencerSearchScope.names)) ...[
          i.name ?? '',
          i.handle,
        ],
        if (scopes.contains(InfluencerSearchScope.channelDescriptions))
          i.description ?? '',
        if (scopes.contains(InfluencerSearchScope.videoDescriptions))
          for (final video in _videos[i.id] ?? const <Video>[])
            video.description ?? '',
      ].join('\n').toLowerCase();
      if (!haystack.contains(search)) return false;
    }
    if (q.includeCountries.isNotEmpty &&
        !q.includeCountries.contains(i.country)) {
      return false;
    }
    if (q.excludeCountries.isNotEmpty &&
        i.country != null &&
        q.excludeCountries.contains(i.country)) {
      return false;
    }
    if (q.includeChannelTags.isNotEmpty &&
        !i.channelTags.any(q.includeChannelTags.contains)) {
      return false;
    }
    if (q.excludeChannelTags.isNotEmpty &&
        i.channelTags.any(q.excludeChannelTags.contains)) {
      return false;
    }
    if (q.includePipelineStages.isNotEmpty &&
        !q.includePipelineStages.contains(i.pipelineStage)) {
      return false;
    }
    if (q.excludePipelineStages.isNotEmpty &&
        q.excludePipelineStages.contains(i.pipelineStage)) {
      return false;
    }
    if (q.minSubscribers != null && i.subscriberCount < q.minSubscribers!) {
      return false;
    }
    if (q.maxSubscribers != null && i.subscriberCount > q.maxSubscribers!) {
      return false;
    }
    if (q.minMedianViews != null &&
        (i.medianViewsLast30 ?? 0) < q.minMedianViews!) {
      return false;
    }
    if (q.maxMedianViews != null &&
        (i.medianViewsLast30 ?? 0) > q.maxMedianViews!) {
      return false;
    }
    // A channel that has never had a deal matches neither bound, matching the
    // SQL: `null >= 90` is not true in Postgres either.
    if (q.minDaysSinceLastDeal != null &&
        (i.daysSinceLastDeal == null ||
            i.daysSinceLastDeal! < q.minDaysSinceLastDeal!)) {
      return false;
    }
    if (q.maxDaysSinceLastDeal != null &&
        (i.daysSinceLastDeal == null ||
            i.daysSinceLastDeal! > q.maxDaysSinceLastDeal!)) {
      return false;
    }
    for (final flag in q.requireFlags) {
      final holds = switch (flag) {
        InfluencerFlag.hasEmail => i.foundEmails.isNotEmpty ||
            i.contacts.any((c) => c.method == ContactMethod.email),
        InfluencerFlag.sponsored => (i.sponsoredRatio ?? 0) > 0,
        InfluencerFlag.shortlisted =>
          i.vettingStatus == VettingStatus.shortlisted,
        InfluencerFlag.readyToPitch => PitchReadiness.of(i).ready,
        InfluencerFlag.neverContacted => i.contactAttempts == 0,
      };
      if (!holds) return false;
    }
    return true;
  }

  /// Ascending comparison; [getPage] flips it for a descending sort. Nulls
  /// always sort low, so that after the flip they land at the bottom — the
  /// same `nullsFirst: false` the real query asks Postgres for.
  int _compare(Influencer a, Influencer b, InfluencerSortBy sortBy) {
    int nullableInt(int? x, int? y) => (x ?? -1).compareTo(y ?? -1);
    int nullableDate(DateTime? x, DateTime? y) =>
        (x ?? DateTime.fromMillisecondsSinceEpoch(0))
            .compareTo(y ?? DateTime.fromMillisecondsSinceEpoch(0));

    return switch (sortBy) {
      InfluencerSortBy.subscribers =>
        a.subscriberCount.compareTo(b.subscriberCount),
      InfluencerSortBy.recentActivity =>
        nullableDate(a.lastVideoAt, b.lastVideoAt),
      InfluencerSortBy.medianViews =>
        nullableInt(a.medianViewsLast30, b.medianViewsLast30),
      InfluencerSortBy.videosThisMonth =>
        a.videosLast30.compareTo(b.videosLast30),
      InfluencerSortBy.daysSinceLastDeal =>
        nullableInt(a.daysSinceLastDeal, b.daysSinceLastDeal),
      InfluencerSortBy.discovered => a.discoveredAt.compareTo(b.discoveredAt),
    };
  }

  @override
  Future<Map<String, Video>> getLatestVideoPerChannel(
    List<String> channelIds,
  ) async {
    final latest = <String, Video>{};
    for (final id in channelIds) {
      final videos = _videos[id];
      if (videos == null || videos.isEmpty) continue;
      // The seeded lists are already newest-first, but sorting rather than
      // trusting that keeps the mock honest about what the real query
      // guarantees, which is an ordering and not an insertion order.
      final sorted = [...videos]..sort((a, b) {
          final aAt = a.publishedAt;
          final bAt = b.publishedAt;
          if (aAt == null && bAt == null) return 0;
          if (aAt == null) return 1;
          if (bAt == null) return -1;
          return bAt.compareTo(aAt);
        });
      latest[id] = sorted.first;
    }
    return latest;
  }

  @override
  Future<List<String>> getCountries() async {
    final codes = <String>{
      for (final i in _influencers)
        if (i.country != null) i.country!,
    };
    return codes.toList()..sort();
  }

  /// The mock's copy of `apply_channel_edit`'s decision table.
  ///
  /// Reimplemented rather than skipped. A mock that wrote blindly could not
  /// observe a lost update at all, so every widget test would pass against a
  /// repository that behaves nothing like production — and the conflict path,
  /// which is the entire point of this layer, would never be exercised offline.
  ///
  /// [current] is what the mock holds, [base] what the caller was looking at,
  /// [next] what they want. Comparison is by [_canonical] so a reordered tag
  /// list is not mistaken for a change, exactly as the SQL does it.
  EditOutcome _compareAndSet<T>(
    String id,
    T base,
    T next,
    Object? Function(T) canonicalize,
    T Function(Influencer) read,
    Influencer Function(Influencer) write,
  ) {
    final index = _influencers.indexWhere((i) => i.id == id);
    if (index < 0) return EditOutcome.missing;

    final current = canonicalize(read(_influencers[index]));
    final wanted = canonicalize(next);
    if (_same(canonicalize(base), wanted)) return EditOutcome.noop;
    if (_same(current, wanted)) return EditOutcome.auto;
    if (!_same(current, canonicalize(base))) return EditOutcome.conflict;

    _influencers[index] = write(_influencers[index]);
    return EditOutcome.applied;
  }

  /// Deep equality and set-ordering both live in `edit_cas.dart`, which the
  /// mirror repository and the uploader also read. Three copies of
  /// "is this the same value" would be three chances to disagree about it.
  static bool _same(Object? a, Object? b) => sameEditValue(a, b);

  static List<String> _asSet(Iterable<String> values) => sortedEditSet(values);

  @override
  Future<String> create(NewInfluencer draft) async {
    final handle = '@${draft.handle.trim().replaceFirst('@', '')}';
    final id = draft.channelId.trimmedOrNull ?? 'manual:$handle';
    _influencers.insert(
      0,
      Influencer(
        id: id,
        handle: handle,
        name: draft.name,
        channelUrl:
            draft.channelUrl.trimmedOrNull ?? 'https://www.youtube.com/$handle',
        platform: InfluencerPlatform.youtube,
        subscriberCount: draft.subscriberCount ?? 0,
        country: draft.country,
        sourceKeywords: const [],
        vettingStatus: VettingStatus.newlyFound,
        discoveredAt: DateTime.now(),
        notes: draft.notes,
        channelTags: Influencer.normalizeChannelTags(draft.channelTags),
      ),
    );
    return id;
  }

  @override
  Future<EditOutcome> updatePipelineStage(
    String id,
    PipelineStage stage, {
    required PipelineStage base,
  }) async {
    return _compareAndSet<PipelineStage>(
      id,
      base,
      stage,
      (v) => v.wire,
      (i) => i.pipelineStage,
      (i) => i.copyWith(pipelineStage: stage),
    );
  }

  @override
  Future<EditOutcome> updateChannelTags(
    String id,
    List<ChannelTag> tags, {
    required List<ChannelTag> base,
  }) async {
    final normalized = Influencer.normalizeChannelTags(tags);
    final outcome = _compareAndSet<List<ChannelTag>>(
      id,
      base,
      normalized,
      (v) => _asSet([for (final t in v) t.wire]),
      (i) => i.channelTags,
      (i) => i,
    );
    if (outcome != EditOutcome.applied) return outcome;

    _replace(id, (i) {
      // Mirrors the `trg_channels_archive_due` trigger in
      // backend/schema.sql, deliberately including the part that is easy to
      // leave out: a channel already counting down keeps the date it has rather
      // than restarting the 7 days, so an edit cannot postpone an archive
      // indefinitely. A mock that got this wrong would make the countdown look
      // right in tests and behave differently against a real database.
      if (!Influencer.isRejectedBy(normalized)) {
        return i.copyWith(channelTags: normalized, clearArchiveDueAt: true);
      }
      return i.copyWith(
        channelTags: normalized,
        archiveDueAt: i.archiveDueAt ??
            DateTime.now().toUtc().add(const Duration(days: 7)),
      );
    });
    return EditOutcome.applied;
  }

  @override
  Future<void> archiveNow(String id) async {
    // Only where the tags warrant it, matching the trigger: writing a date onto
    // a channel that is not tagged rejected is erased server-side, so the mock
    // must not appear to accept it either.
    //
    // The real repositories now sweep as well as set the date, and so does
    // this: the channel leaves the list, which is what the button promises.
    // Leaving it in place would make the mock the one implementation where
    // "Archive now" still does nothing visible.
    final index = _influencers.indexWhere((i) => i.id == id);
    if (index == -1) return;
    if (!Influencer.isRejectedBy(_influencers[index].channelTags)) return;
    _influencers.removeAt(index);
  }

  @Deprecated(
    'Contact attempts are derived from outbound outreach messages; see '
    'backend/schema.sql',
  )
  @override
  Future<void> incrementContactAttempts(String id) async {
    // Kept for interface parity. The real count now comes from the
    // `influencer_rows` view; the mock has no cross-repo wiring to outreach,
    // so the seeded `contactAttempts` values stand in for it.
    _replace(id, (i) => i.copyWith(contactAttempts: i.contactAttempts + 1));
  }

  @override
  Future<EditOutcome> updateProvidedData(
    String id,
    Map<String, dynamic>? data, {
    required Map<String, dynamic>? base,
  }) async {
    return _compareAndSet<Map<String, dynamic>?>(
      id,
      base,
      data,
      (v) => v,
      (i) => i.providedData,
      (i) => i.copyWith(providedData: data),
    );
  }

  @override
  Future<List<SponsorSighting>> sponsorSightings() async => [
        for (final i in _influencers)
          if (i.seenBrands.isNotEmpty)
            SponsorSighting(
              channelId: i.id,
              handle: i.handle,
              name: i.name,
              latestUploadAt: i.lastVideoAt,
              brands: i.seenBrands,
            ),
      ];

  @override
  Future<EditOutcome> updateMediaKit(
    String id,
    MediaKit? kit, {
    required MediaKit? base,
  }) async {
    return _compareAndSet<Map<String, Object?>?>(
      id,
      base?.toJson(),
      kit?.toJson(),
      (v) => v,
      (i) => i.mediaKit?.toJson(),
      // An empty kit stands in for "cleared": copyWith cannot set null.
      (i) => i.copyWith(mediaKit: kit ?? const MediaKit()),
    );
  }

  @override
  Future<EditOutcome> updateCreatorGender(
    String id,
    CreatorGender? gender, {
    required CreatorGender? base,
  }) async {
    return _compareAndSet<String?>(
      id,
      base?.name,
      gender?.name,
      (v) => v,
      (i) => i.creatorGender?.name,
      (i) => i.copyWith(creatorGender: gender ?? CreatorGender.unknown),
    );
  }

  @override
  Future<EditOutcome> updateContacts(
    String id,
    List<InfluencerContact> contacts, {
    required List<InfluencerContact> base,
  }) async {
    final normalized = InfluencerContact.normalize(contacts);
    return _compareAndSet<List<InfluencerContact>>(
      id, base, normalized,
      // Ordered, not a set: normalize() puts the primary first and "make
      // primary" reorders on purpose, so a reordering here IS a change.
      (v) => [for (final c in InfluencerContact.normalize(v)) c.toJson()],
      (i) => i.contacts,
      (i) => i.copyWith(contacts: normalized),
    );
  }

  @override
  Future<void> updateOwner(String id, String? ownerId) async {
    _replace(
      id,
      (i) => Influencer(
        id: i.id,
        handle: i.handle,
        channelUrl: i.channelUrl,
        platform: i.platform,
        subscriberCount: i.subscriberCount,
        name: i.name,
        description: i.description,
        profilePicture: i.profilePicture,
        banner: i.banner,
        country: i.country,
        lastVideoAt: i.lastVideoAt,
        medianViewsLast30: i.medianViewsLast30,
        medianViewsAll: i.medianViewsAll,
        sourceKeywords: i.sourceKeywords,
        vettingStatus: i.vettingStatus,
        discoveredAt: i.discoveredAt,
        notes: i.notes,
        relevanceCriteria: i.relevanceCriteria,
        pipelineStage: i.pipelineStage,
        contactAttempts: i.contactAttempts,
        channelTags: i.channelTags,
        lastDealAt: i.lastDealAt,
        daysSinceLastDeal: i.daysSinceLastDeal,
        videosLast30: i.videosLast30,
        providedData: i.providedData,
        lastFetchedAt: i.lastFetchedAt,
        contacts: i.contacts,
        archiveDueAt: i.archiveDueAt,
        ownerId: ownerId,
        manualEngagementRate: i.manualEngagementRate,
        manualEngagementNote: i.manualEngagementNote,
        manualEngagementUpdatedAt: i.manualEngagementUpdatedAt,
      ),
    );
  }

  @override
  Future<void> updateManualEngagement(
    String id, {
    required double? rate,
    required String? note,
  }) async {
    _replace(
      id,
      (i) => Influencer(
        id: i.id,
        handle: i.handle,
        channelUrl: i.channelUrl,
        platform: i.platform,
        subscriberCount: i.subscriberCount,
        name: i.name,
        description: i.description,
        profilePicture: i.profilePicture,
        banner: i.banner,
        country: i.country,
        lastVideoAt: i.lastVideoAt,
        medianViewsLast30: i.medianViewsLast30,
        medianViewsAll: i.medianViewsAll,
        sourceKeywords: i.sourceKeywords,
        vettingStatus: i.vettingStatus,
        discoveredAt: i.discoveredAt,
        notes: i.notes,
        relevanceCriteria: i.relevanceCriteria,
        pipelineStage: i.pipelineStage,
        contactAttempts: i.contactAttempts,
        channelTags: i.channelTags,
        lastDealAt: i.lastDealAt,
        daysSinceLastDeal: i.daysSinceLastDeal,
        videosLast30: i.videosLast30,
        providedData: i.providedData,
        lastFetchedAt: i.lastFetchedAt,
        contacts: i.contacts,
        archiveDueAt: i.archiveDueAt,
        ownerId: i.ownerId,
        manualEngagementRate: rate,
        manualEngagementNote: note,
        manualEngagementUpdatedAt: DateTime.now(),
      ),
    );
  }

  @override
  Future<Influencer?> getById(String id) async {
    for (final influencer in _influencers) {
      if (influencer.id == id) return influencer;
    }
    return null;
  }

  @override
  Future<List<Video>> getRecentVideos(String influencerId) async {
    return List.unmodifiable(_videos[influencerId] ?? const []);
  }

  @override
  Future<EditOutcome> updateVettingStatus(
    String id,
    VettingStatus status, {
    required VettingStatus base,
  }) async {
    return _compareAndSet<VettingStatus>(
      id,
      base,
      status,
      (v) => v.name,
      (i) => i.vettingStatus,
      (i) => i.copyWith(vettingStatus: status),
    );
  }

  @override
  Future<EditOutcome> updateRelevanceCriteria(
    String id,
    List<String> criteria, {
    required List<String> base,
  }) async {
    return _compareAndSet<List<String>>(
      id,
      base,
      criteria,
      _asSet,
      (i) => i.relevanceCriteria,
      (i) => i.copyWith(relevanceCriteria: criteria),
    );
  }

  @override
  Future<EditOutcome> updateNotes(
    String id,
    String notes, {
    required String? base,
  }) async {
    return _compareAndSet<String?>(
      id,
      base,
      notes,
      (v) => (v == null || v.isEmpty) ? null : v,
      (i) => i.notes,
      (i) => i.copyWith(notes: notes),
    );
  }

  void _replace(String id, Influencer Function(Influencer) update) {
    final index = _influencers.indexWhere((i) => i.id == id);
    if (index == -1) return;
    _influencers[index] = update(_influencers[index]);
  }
}
