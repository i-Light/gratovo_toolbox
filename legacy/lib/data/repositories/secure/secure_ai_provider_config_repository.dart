import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:gratovo_toolbox/data/models/ai_provider_config.dart';
import 'package:gratovo_toolbox/data/repositories/ai_provider_config_repository.dart';

const _storageKey = 'gratovo.ai.providerConfigs';

/// The real (not mock) [AiProviderConfigRepository] implementation — see
/// the interface's doc comment for why this domain skips the usual
/// mock-now/Supabase-later pattern. Stores every configured provider as
/// one JSON-encoded list under a single key in the OS-level encrypted
/// store (`flutter_secure_storage`: Keychain on macOS/iOS, DPAPI-backed
/// storage on Windows, libsecret on Linux, Keystore-backed on Android) —
/// the same class of storage a password manager uses, deliberately NOT
/// `shared_preferences` (a plaintext file) like every other Settings
/// value, because an API key is a real secret and the rest aren't.
class SecureAiProviderConfigRepository implements AiProviderConfigRepository {
  SecureAiProviderConfigRepository({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<List<AiProviderConfig>> getAll() async {
    try {
      final raw = await _storage.read(key: _storageKey);
      if (raw == null || raw.isEmpty) return [];
      final decoded = jsonDecode(raw) as List<dynamic>;
      return [
        for (final entry in decoded)
          AiProviderConfig.fromJson(entry as Map<String, dynamic>),
      ];
    } catch (error, stackTrace) {
      // A corrupt/unreadable secure-storage entry shouldn't crash the
      // whole Settings page — surface an empty list (the UI reads this as
      // "no providers configured yet") rather than propagating.
      developer.log(
        'Failed to read AI provider configs from secure storage.',
        name: 'gratovo.ai.providerConfigs',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return [];
    }
  }

  @override
  Future<void> upsert(AiProviderConfig config) async {
    final all = await getAll();
    final index = all.indexWhere((c) => c.id == config.id);
    final updated = List<AiProviderConfig>.from(all);
    if (index == -1) {
      updated.add(config);
    } else {
      updated[index] = config;
    }
    await _persist(updated);
  }

  @override
  Future<void> delete(String id) async {
    final all = await getAll();
    await _persist(all.where((c) => c.id != id).toList());
  }

  Future<void> _persist(List<AiProviderConfig> configs) async {
    final encoded = jsonEncode([for (final c in configs) c.toJson()]);
    await _storage.write(key: _storageKey, value: encoded);
  }
}
