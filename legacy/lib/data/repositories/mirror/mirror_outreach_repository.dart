import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Outreach threads and messages, local-first.
///
/// No access level here. The `basic` role hides the Outreach page (see
/// `app_router.dart`); the data itself reaches every machine, because "how
/// many messages went out today" and the outbound count on the influencer
/// list are computed from these tables locally, and a machine without the
/// rows could not answer either.
class MirrorOutreachRepository implements OutreachRepository {
  const MirrorOutreachRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<OutreachThread>> getAllThreads() async {
    final rows = await _db
        .getAll('SELECT * FROM outreach_threads WHERE channel_id IS NOT NULL '
            'ORDER BY updated_at DESC');
    return [for (final row in rows) _toThread(row)];
  }

  @override
  Future<OutreachThread> getOrCreateThreadForBrand(
    String brandId,
    String contactEmail,
  ) async {
    final email = contactEmail.trim().toLowerCase();
    final rows = await _db.getAll(
      'SELECT * FROM outreach_threads WHERE brand_id = ? '
      'AND lower(contact_email) = ? ORDER BY updated_at DESC LIMIT 1',
      [brandId, email],
    );
    if (rows.isNotEmpty) return _toThread(rows.first);
    final id = localUuid();
    final now = DateTime.now().toUtc();
    await _db.execute(
      'INSERT INTO outreach_threads (id, brand_id, contact_email, status, '
      'updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, brandId, email, ThreadStatus.notContactedYet.name, toIso(now)],
    );
    await enqueueRowUpsert(
      _db,
      table: 'outreach_threads',
      id: id,
      row: {
        'id': id,
        'channel_id': null,
        'brand_id': brandId,
        'contact_email': email,
        'status': ThreadStatus.notContactedYet.name,
      },
    );
    return OutreachThread(
      id: id,
      influencerId: '',
      brandId: brandId,
      contactEmail: email,
      status: ThreadStatus.notContactedYet,
      updatedAt: now,
    );
  }

  @override
  Future<List<OutreachThread>> getThreadsForBrand(String brandId) async {
    final rows = await _db.getAll(
      'SELECT * FROM outreach_threads WHERE brand_id = ? '
      'ORDER BY updated_at DESC',
      [brandId],
    );
    return [for (final row in rows) _toThread(row)];
  }

  @override
  Future<OutreachThread?> getThreadById(String id) async {
    final rows =
        await _db.getAll('SELECT * FROM outreach_threads WHERE id = ?', [id]);
    return rows.isEmpty ? null : _toThread(rows.first);
  }

  @override
  Future<OutreachThread?> getThreadByInfluencer(String influencerId) async {
    final rows = await _db.getAll(
      'SELECT * FROM outreach_threads WHERE channel_id = ? '
      'ORDER BY updated_at DESC LIMIT 1',
      [influencerId],
    );
    return rows.isEmpty ? null : _toThread(rows.first);
  }

  @override
  Future<OutreachThread> getOrCreateThreadForInfluencer(
      String influencerId) async {
    final existing = await getThreadByInfluencer(influencerId);
    if (existing != null) return existing;
    final id = localUuid();
    final now = DateTime.now().toUtc();
    await _db.execute(
      'INSERT INTO outreach_threads (id, channel_id, status, updated_at) '
      'VALUES (?, ?, ?, ?)',
      [id, influencerId, ThreadStatus.notContactedYet.name, toIso(now)],
    );
    // `channel_id` is unique on the server. Two machines opening a thread
    // for the same channel while offline would each mint one; the second to
    // land is refused by that constraint, and the next pull brings the
    // winner down. The loser's messages are the one thing that could be
    // stranded, which is why a thread is only created when a message is
    // about to be written, not when the panel opens.
    await enqueueRowUpsert(
      _db,
      table: 'outreach_threads',
      id: id,
      row: {
        'id': id,
        'channel_id': influencerId,
        'status': ThreadStatus.notContactedYet.name,
      },
    );
    return OutreachThread(
      id: id,
      influencerId: influencerId,
      status: ThreadStatus.notContactedYet,
      updatedAt: now,
    );
  }

  @override
  Future<void> updateThreadStatus(String threadId, ThreadStatus status) async {
    await _db.execute(
      'UPDATE outreach_threads SET status = ?, updated_at = ? WHERE id = ?',
      [status.name, toIso(DateTime.now()), threadId],
    );
    await _queueThread(threadId);
  }

  @override
  Future<void> updateThreadOwner(String threadId, String? ownerId) async {
    await _db.execute(
      'UPDATE outreach_threads SET owner_id = ?, updated_at = ? WHERE id = ?',
      [ownerId, toIso(DateTime.now()), threadId],
    );
    await _queueThread(threadId);
  }

  @override
  Future<List<OutreachMessage>> getMessages(String threadId) async {
    final rows = await _db.getAll(
      'SELECT * FROM outreach_messages WHERE thread_id = ? ORDER BY at ASC',
      [threadId],
    );
    return [for (final row in rows) _toMessage(row)];
  }

  @override
  Future<int> countOutboundSince(DateTime since) async {
    final rows = await _db.getAll(
      "SELECT COUNT(*) AS n FROM outreach_messages WHERE direction = 'outbound' "
      'AND at >= ?',
      [toIso(since)],
    );
    return parseInt(rows.first['n']) ?? 0;
  }

  @override
  Future<OutreachMessage> recordMessage({
    required String threadId,
    required MessageDirection direction,
    required String subject,
    required String body,
    ContactMethod method = ContactMethod.email,
    String? peerAddress,
    DateTime? at,
    bool isAiDrafted = false,
    String? templateId,
  }) async {
    final id = localUuid();
    final stamp = (at ?? DateTime.now()).toUtc();
    final now = toIso(DateTime.now());
    final peer =
        peerAddress != null && peerAddress.isNotEmpty ? peerAddress : null;
    await _db.execute(
      'INSERT INTO outreach_messages (id, thread_id, direction, method, '
      'subject, body, peer_email, at, is_ai_drafted, template_id, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        threadId,
        direction.name,
        method.wire,
        subject,
        body,
        peer,
        toIso(stamp),
        isAiDrafted ? 1 : 0,
        templateId,
        now,
      ],
    );
    await enqueueRowUpsert(
      _db,
      table: 'outreach_messages',
      id: id,
      row: {
        'id': id,
        'thread_id': threadId,
        'direction': direction.name,
        'method': method.wire,
        'subject': subject,
        'body': body,
        'peer_email': peer,
        'at': toIso(stamp),
        'is_ai_drafted': isAiDrafted,
        'template_id': templateId,
      },
    );
    await _db.execute(
      'UPDATE outreach_threads SET updated_at = ? WHERE id = ?',
      [now, threadId],
    );
    await _queueThread(threadId);
    return OutreachMessage(
      id: id,
      threadId: threadId,
      direction: direction,
      method: method,
      peerAddress: peer,
      subject: subject,
      body: body,
      at: stamp,
      isAiDrafted: isAiDrafted,
      templateId: templateId,
    );
  }

  @override
  Future<void> deleteMessage(String messageId) async {
    await _db
        .execute('DELETE FROM outreach_messages WHERE id = ?', [messageId]);
    await enqueueRowDelete(_db, table: 'outreach_messages', id: messageId);
  }

  @override
  Future<void> updateMessageClassification(
    String messageId,
    MessageClassification? classification,
  ) async {
    await _db.execute(
      'UPDATE outreach_messages SET classification = ?, updated_at = ? '
      'WHERE id = ?',
      [classification?.wire, toIso(DateTime.now()), messageId],
    );
    final rows = await _db
        .getAll('SELECT * FROM outreach_messages WHERE id = ?', [messageId]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(
      _db,
      table: 'outreach_messages',
      id: messageId,
      row: rows.first,
    );
  }

  @override
  Future<void> deleteThread(String threadId) async {
    final messages = await _db.getAll(
        'SELECT id FROM outreach_messages WHERE thread_id = ?', [threadId]);
    await _db.execute(
        'DELETE FROM outreach_messages WHERE thread_id = ?', [threadId]);
    await _db.execute('DELETE FROM outreach_threads WHERE id = ?', [threadId]);
    // The server cascades messages with the thread; the local rows are
    // deleted by name so a machine that pulls the tombstone later matches.
    await enqueueRowDeleteMany(
      _db,
      table: 'outreach_messages',
      ids: [for (final row in messages) '${row['id']}'],
    );
    await enqueueRowDelete(_db, table: 'outreach_threads', id: threadId);
  }

  Future<void> _queueThread(String threadId) async {
    final rows = await _db
        .getAll('SELECT * FROM outreach_threads WHERE id = ?', [threadId]);
    if (rows.isEmpty) return;
    await enqueueRowUpsert(
      _db,
      table: 'outreach_threads',
      id: threadId,
      row: rows.first,
    );
  }

  static OutreachThread _toThread(Map<String, Object?> row) => OutreachThread(
        id: row['id'] as String,
        influencerId: parseString(row['channel_id']) ?? '',
        dealId: parseString(row['deal_id']),
        ownerId: parseString(row['owner_id']),
        brandId: parseString(row['brand_id']),
        contactEmail: parseString(row['contact_email']),
        status: ThreadStatus.values.firstWhere(
          (s) => s.name == row['status'],
          orElse: () => ThreadStatus.notContactedYet,
        ),
        updatedAt: parseDate(row['updated_at']) ?? DateTime.now(),
      );

  static OutreachMessage _toMessage(Map<String, Object?> row) =>
      OutreachMessage(
        id: row['id'] as String,
        threadId: parseString(row['thread_id']) ?? '',
        direction: row['direction'] == 'inbound'
            ? MessageDirection.inbound
            : MessageDirection.outbound,
        method: ContactMethod.fromWire(
            parseString(row['method']) ?? ContactMethod.email.wire),
        peerAddress: parseString(row['peer_email']),
        subject: parseString(row['subject']) ?? '',
        body: parseString(row['body']) ?? '',
        at: parseDate(row['at']) ?? DateTime.now(),
        isAiDrafted: parseBool(row['is_ai_drafted']),
        templateId: parseString(row['template_id']),
        classification:
            MessageClassification.fromWire(parseString(row['classification'])),
      );
}
