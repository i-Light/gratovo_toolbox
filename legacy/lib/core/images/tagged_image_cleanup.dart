import 'package:gratovo_toolbox/core/images/image_store.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/repositories/influencer_repository.dart';

/// Purges cached images for channels carrying a rejecting tag (see
/// [ChannelTag.rejecting]) once those images are old enough that nobody has
/// needed them for a while.
///
/// A channel dismissed with such a tag is unlikely to be revisited, so
/// keeping its avatar, banner, and thumbnails cached indefinitely just spends
/// disk for pictures nobody will look at again — but not so eagerly that a
/// picture cached minutes ago (from a review still in progress) gets pulled
/// out from under it.
///
/// The database decides which channels those are. This used to read every
/// channel and test the tags in Dart, which meant a 20-minute idle on a
/// 100,000-channel database woke up to fetch the whole table — 35 MB — to find
/// the few thousand rows carrying a tag. `channel_tags` is filterable in the
/// query, so it is filtered there.
class TaggedImageCleanup {
  const TaggedImageCleanup._();

  static const maxAge = Duration(days: 30);

  /// The same "this channel is not coming back" set the archive path uses —
  /// read from [ChannelTag.rejecting] rather than repeated here, so a tag added
  /// to that list is swept for cached images without touching this file.
  static const _staleTags = ChannelTag.rejecting;

  /// Rows per request. Small enough that a sweep interrupted by the app being
  /// closed has only wasted one page, large enough that a few thousand tagged
  /// channels is a few dozen requests rather than a few hundred.
  static const _pageSize = 200;

  static Future<void> run(InfluencerRepository repository) async {
    if (!ImageStore.isAvailable) return;

    // One pass per tag rather than one query for the whole set: a channel
    // carrying two stale tags is visited twice and the second visit finds the
    // files already gone, which is why the ids are not de-duplicated across
    // passes: [ImageStore.deleteIfOlderThan] is a no-op on a file that is not
    // there, and remembering every id seen would put the whole tagged set
    // back in memory to avoid a handful of stat calls.
    for (final tag in _staleTags) {
      var offset = 0;
      while (true) {
        final page = await repository.getPage(
          offset: offset,
          limit: _pageSize,
          query: InfluencerQuery(includeChannelTags: {tag}),
        );

        // One thumbnail read for the page, not one per channel: this loop
        // runs on the UI isolate against a synchronous database, and two
        // hundred queries in a row with nothing between them is a stall on
        // the first repaint after the app comes back to the foreground.
        final urls = <String>{
          for (final influencer in page.items) ...[
            if (influencer.profilePicture != null) influencer.profilePicture!,
            if (influencer.banner != null) influencer.banner!,
          ],
          ...await repository.getVideoThumbnails([
            for (final influencer in page.items) influencer.id,
          ]),
        };
        for (final url in urls) {
          await ImageStore.deleteIfOlderThan(url, maxAge);
        }

        if (!page.hasMore) break;
        offset += page.items.length;
      }
    }
  }
}
