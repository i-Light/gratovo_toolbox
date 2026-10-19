import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/repositories/influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_page_controller.dart';

/// The newest upload for each channel the list has loaded, fetched once per
/// channel rather than once per page.
///
/// This replaces a `FutureProvider.family` keyed on the comma-joined ids of
/// every row loaded so far. That key was chosen to work around a real problem
/// — a Riverpod family compares its argument by `==`, and two equal `List`s
/// are not equal — but it made the request grow with the whole list instead of
/// with the new page. Scrolling ten pages asked for 50 channels, then 100,
/// then 150, and so on: 2,750 channel-fetches to show 500 channels, and every
/// one of them re-fetched rows already on screen.
///
/// Here the ids already answered are remembered, so each page costs exactly
/// the channels that page added. Ten pages ask for 500 channels once.
///
/// Driven by [influencerPageProvider] rather than called from the widget, so
/// there is no side effect in a `build` and nothing to remember to trigger. A
/// new page arrives, this rebuilds, and it asks for the difference.
class LatestVideosNotifier extends AsyncNotifier<Map<String, Video>> {
  LatestVideosNotifier(this.query);

  /// The same filter its page provider is keyed on. Held as a field because
  /// Riverpod 3 hands a family's argument to the constructor.
  final InfluencerQuery query;

  final _known = <String, Video>{};

  /// Channels already asked about, including the ones that came back with
  /// nothing.
  ///
  /// Separate from [_known] because "this channel has no stored videos" is an
  /// answer, and without recording it those channels would be re-requested on
  /// every single page — which for a database full of channels discovered but
  /// never fetched is most of them.
  final _asked = <String>{};

  InfluencerRepository? _repository;

  @override
  Future<Map<String, Video>> build() async {
    // Signing out, or the mirror finishing its first sync, swaps the
    // repository underneath. What was cached came from the old one, and while
    // a channel's newest upload is the same fact either way, holding rows from
    // a repository this notifier no longer talks to is the kind of thing that
    // is only ever right by accident.
    final repository = ref.watch(influencerRepositoryProvider);
    if (!identical(repository, _repository)) {
      _repository = repository;
      _known.clear();
      _asked.clear();
    }

    // `.value` rather than awaiting the future: while the first page is
    // still loading there is nothing to ask about, and this provider resolving
    // to an empty map immediately is what lets the rows paint before their
    // strips do.
    final page = ref.watch(influencerPageProvider(query)).value;
    if (page == null) return Map.unmodifiable(_known);

    final missing = [
      for (final influencer in page.items)
        if (!_asked.contains(influencer.id)) influencer.id,
    ];
    if (missing.isEmpty) return Map.unmodifiable(_known);

    // Marked as asked BEFORE the await. Two pages can land in quick
    // succession, and the second build must not re-request what the first has
    // in flight.
    _asked.addAll(missing);
    try {
      _known.addAll(await repository.getLatestVideoPerChannel(missing));
    } catch (_) {
      // Un-ask on failure, so the next page retries these instead of leaving
      // them permanently blank. The strip is decoration; a failure here must
      // not take the list down with it, which is why this returns what it has
      // rather than rethrowing.
      _asked.removeAll(missing);
    }
    return Map.unmodifiable(_known);
  }
}

final latestVideosProvider = AsyncNotifierProvider.family<LatestVideosNotifier,
    Map<String, Video>, InfluencerQuery>(LatestVideosNotifier.new);
