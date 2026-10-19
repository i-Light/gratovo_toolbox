import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _shipped = SupabaseConfig(
  url: 'https://shipped.supabase.co',
  anonKey: 'shipped-anon-key-0123456789',
);

const _urlKey = 'gratovo.supabase.url';
const _anonKey = 'gratovo.supabase.anonKey';

void main() {
  group('compiledOrFallback', () {
    test('a real define wins', () {
      expect(compiledOrFallback('https://x.co', 'fb'), 'https://x.co');
    });

    test('a blank define counts as no define', () {
      // `--dart-define-from-file` with `SUPABASE_URL=` hands the compiler an
      // empty string, which String.fromEnvironment does NOT replace with its
      // default. That compiled an empty server address into real builds.
      expect(compiledOrFallback('', 'fb'), 'fb');
      expect(compiledOrFallback('   ', 'fb'), 'fb');
    });

    test('whitespace around a define is dropped', () {
      expect(compiledOrFallback('  https://x.co \n', 'fb'), 'https://x.co');
    });
  });

  test('the compiled-in pair is never blank', () {
    expect(kCompiledSupabaseUrl, isNotEmpty);
    expect(kCompiledSupabaseAnonKey, isNotEmpty);
  });

  group('maskedAnonKey', () {
    test('shows both ends of a long key only', () {
      const config = SupabaseConfig(url: '', anonKey: 'abcd_middle_part_wxyz');
      expect(config.maskedAnonKey, 'abcd…wxyz');
    });

    test('hides a short key completely', () {
      const config = SupabaseConfig(url: '', anonKey: 'short');
      expect(config.maskedAnonKey, '••••');
    });

    test('is empty for no key', () {
      const config = SupabaseConfig(url: '', anonKey: '  ');
      expect(config.maskedAnonKey, '');
    });
  });

  group('SupabaseConfigStore', () {
    const store = SupabaseConfigStore(shipped: _shipped);

    test('no override reads back the shipped pair', () async {
      SharedPreferences.setMockInitialValues({});
      expect(await store.read(), _shipped);
      expect(await store.hasOverride(), isFalse);
    });

    test('stores only the field that differs from what shipped', () async {
      SharedPreferences.setMockInitialValues({});
      await store.write(
        const SupabaseConfig(
          url: ' https://other.supabase.co ',
          anonKey: 'shipped-anon-key-0123456789',
        ),
      );

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(_urlKey), 'https://other.supabase.co');
      expect(prefs.containsKey(_anonKey), isFalse);
      expect(
        await store.read(),
        const SupabaseConfig(
          url: 'https://other.supabase.co',
          anonKey: 'shipped-anon-key-0123456789',
        ),
      );
    });

    test('saving the shipped values is the same as saving nothing', () async {
      // A copy of today's default on disk would outlive the update that
      // changes the default and pin this machine to the old project.
      SharedPreferences.setMockInitialValues({
        _urlKey: 'https://old.supabase.co',
        _anonKey: 'old-key',
      });
      await store.write(_shipped);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey(_urlKey), isFalse);
      expect(prefs.containsKey(_anonKey), isFalse);
      expect(await store.hasOverride(), isFalse);
    });

    test('a blank field falls back to what shipped', () async {
      SharedPreferences.setMockInitialValues({_urlKey: 'https://old.co'});
      await store.write(const SupabaseConfig(url: '', anonKey: ''));
      expect(await store.read(), _shipped);
    });

    test('clear drops the override', () async {
      SharedPreferences.setMockInitialValues({
        _urlKey: 'https://old.supabase.co',
        _anonKey: 'old-key',
      });
      expect(await store.hasOverride(), isTrue);
      await store.clear();
      expect(await store.hasOverride(), isFalse);
      expect(await store.read(), _shipped);
    });
  });
}
