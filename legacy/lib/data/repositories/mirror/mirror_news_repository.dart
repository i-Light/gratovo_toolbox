import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/news_item.dart';
import 'package:gratovo_toolbox/data/repositories/news_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// The news feed, read from the pipeline's local `news_*` tables.
///
/// The fetcher (`pipeline/tools/news.py`) writes them; this reads them and
/// manages the source list. Nothing here is shared — each machine follows
/// the feeds its own person added.
class MirrorNewsRepository implements NewsRepository {
  const MirrorNewsRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<NewsItem>> getItems({
    int limit = 50,
    int offset = 0,
    String? sourceId,
    String? niche,
  }) async {
    final where = <String>['1 = 1'];
    final params = <Object?>[];
    if (sourceId != null) {
      where.add('i.source_id = ?');
      params.add(sourceId);
    } else if (niche != null) {
      where.add('i.source_id IN (SELECT id FROM news_sources WHERE niche = ?)');
      params.add(niche);
    }
    final rows = await _db.getAll(
      'SELECT i.* FROM news_items i WHERE ${where.join(' AND ')} '
      'ORDER BY i.published_at DESC NULLS LAST, i.fetched_at DESC '
      'LIMIT ? OFFSET ?',
      [...params, limit, offset],
    );
    return [for (final row in rows) _toItem(row)];
  }

  @override
  Future<int> countItems() async {
    final rows = await _db.getAll('SELECT COUNT(*) AS n FROM news_items');
    return parseInt(rows.first['n']) ?? 0;
  }

  @override
  Future<void> clearItems() => _db.execute('DELETE FROM news_items');

  @override
  Future<List<NewsSource>> getSources() async {
    final rows =
        await _db.getAll('SELECT * FROM news_sources ORDER BY title, feed_url');
    return [for (final row in rows) _toSource(row)];
  }

  @override
  Future<void> addSource({
    required String feedUrl,
    String? title,
    String? niche,
  }) async {
    final cleanTitle = title?.trim();
    final cleanNiche = niche?.trim();
    await _db.execute(
      'INSERT INTO news_sources (id, feed_url, title, niche, enabled, added_at) '
      'VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(feed_url) DO UPDATE SET '
      'title = COALESCE(excluded.title, news_sources.title), '
      'niche = COALESCE(excluded.niche, news_sources.niche), enabled = 1',
      [
        localUuid(),
        feedUrl.trim(),
        cleanTitle == null || cleanTitle.isEmpty ? null : cleanTitle,
        cleanNiche == null || cleanNiche.isEmpty ? null : cleanNiche,
        DateTime.now().toUtc().toIso8601String(),
      ],
    );
  }

  @override
  Future<void> setSourceEnabled(String id, bool enabled) => _db.execute(
        'UPDATE news_sources SET enabled = ? WHERE id = ?',
        [enabled ? 1 : 0, id],
      );

  @override
  Future<void> removeSource(String id) async {
    // Foreign keys are off on the app's connection, so the cascade the
    // pipeline's schema declares is done by hand.
    await _db.execute('DELETE FROM news_items WHERE source_id = ?', [id]);
    await _db.execute('DELETE FROM news_sources WHERE id = ?', [id]);
  }

  static NewsItem _toItem(Map<String, Object?> row) => NewsItem(
        id: row['id'] as String,
        sourceId: row['source_id'] as String,
        guid: parseString(row['guid']) ?? '',
        title: parseString(row['title']) ?? '(untitled)',
        link: parseString(row['link']),
        summary: parseString(row['summary']),
        author: parseString(row['author']),
        imageUrl: parseString(row['image_url']),
        publishedAt: parseDate(row['published_at']),
      );

  static NewsSource _toSource(Map<String, Object?> row) => NewsSource(
        id: row['id'] as String,
        feedUrl: parseString(row['feed_url']) ?? '',
        title: parseString(row['title']),
        niche: parseString(row['niche']),
        enabled: parseBool(row['enabled']),
        lastFetchedAt: parseDate(row['last_fetched_at']),
        lastFetchStatus: parseString(row['last_fetch_status']),
        lastFetchError: parseString(row['last_fetch_error']),
      );
}
