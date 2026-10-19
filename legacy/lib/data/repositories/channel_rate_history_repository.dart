import 'package:gratovo_toolbox/data/models/channel_rate_history_entry.dart';

/// How the UI reads a channel's closed-deal rate history — what a channel
/// has actually gone for before, for pricing the next proposal. See
/// `influencer_repository.dart`'s doc comment for the mock/Supabase swap
/// pattern this follows.
///
/// Append-only, matching `ChannelRateHistoryEntry`'s own doc comment: there
/// is no `update`/`delete` here, only [record].
abstract class ChannelRateHistoryRepository {
  /// One channel's closed-deal history, most recent first.
  Future<List<ChannelRateHistoryEntry>> getForChannel(String channelId);

  /// Records a closed deal's numbers and returns the stored record with its
  /// id. The repository owns id generation; pass
  /// [ChannelRateHistoryEntry.id] as `''`. Called once, when a [Deal] closes.
  Future<ChannelRateHistoryEntry> record(ChannelRateHistoryEntry entry);
}
