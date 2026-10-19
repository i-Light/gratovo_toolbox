import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/scheduled_email.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where "Send later" emails wait: on this machine, never on the server.
///
/// Local because the mailbox that sends them is this machine's, so a synced
/// row would only ask every teammate's app to send somebody else's email --
/// and because the server cannot take a new table while the owner is away.
abstract class ScheduledEmailStore {
  Future<List<ScheduledEmail>> load();

  /// Replaces the whole list. The list is a handful of entries; writing it
  /// whole is what keeps a half-applied edit from ever being on disk.
  Future<void> save(List<ScheduledEmail> emails);
}

/// The real store: one JSON list in `SharedPreferences`.
class PrefsScheduledEmailStore implements ScheduledEmailStore {
  static const key = 'gratovo.outreach.scheduledEmails.v1';

  @override
  Future<List<ScheduledEmail>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(key);
      if (raw == null || raw.isEmpty) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final entry in decoded)
          if (ScheduledEmail.fromJson(entry) case final email?) email,
      ];
    } catch (error, stackTrace) {
      developer.log(
        'The scheduled emails could not be read.',
        name: 'gratovo.outreach.scheduled',
        level: 1000,
        error: error,
        stackTrace: stackTrace,
      );
      return const [];
    }
  }

  @override
  Future<void> save(List<ScheduledEmail> emails) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      key,
      jsonEncode([for (final email in emails) email.toJson()]),
    );
  }
}

/// For tests, and anything else that must not touch the machine's settings.
class MemoryScheduledEmailStore implements ScheduledEmailStore {
  MemoryScheduledEmailStore([List<ScheduledEmail> initial = const []])
      : _saved = [for (final email in initial) email.toJson()];

  List<Map<String, Object?>> _saved;
  int saves = 0;

  /// What a fresh launch would read back, round-tripped through JSON the way
  /// the real store does.
  List<ScheduledEmail> get saved => [
        for (final entry in _saved)
          if (ScheduledEmail.fromJson(entry) case final email?) email,
      ];

  @override
  Future<List<ScheduledEmail>> load() async => saved;

  @override
  Future<void> save(List<ScheduledEmail> emails) async {
    saves += 1;
    _saved = [for (final email in emails) email.toJson()];
  }
}

final scheduledEmailStoreProvider =
    Provider<ScheduledEmailStore>((ref) => PrefsScheduledEmailStore());
