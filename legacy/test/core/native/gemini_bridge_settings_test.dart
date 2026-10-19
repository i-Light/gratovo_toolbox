import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The per-machine Gemini settings and — the reason this file exists — the
/// load/persist race: the notifier hands out defaults at once and reads the
/// saved values a moment later, and a write in that gap used to put defaults
/// on disk over the saved values.
void main() {
  const savedValues = <String, Object>{
    'gratovo.gemini.port': 9001,
    'gratovo.gemini.accountMatch': 'moustafa',
    'gratovo.gemini.defaultModel': 'Flash',
    'gratovo.gemini.browser': 'edge',
    'gratovo.gemini.browserPath': r'C:\Edge\msedge.exe',
    'gratovo.gemini.profileMode': 'existing',
    'gratovo.gemini.autoStart': false,
    'gratovo.gemini.autoOpenWindow': false,
    'gratovo.gemini.keywordsGem': 'kw-gem-id',
    'gratovo.gemini.keywordChats': 6,
    'gratovo.gemini.keywordsPerChat': 40,
    'gratovo.gemini.lastAccountName': 'Moustafa',
    'gratovo.gemini.lastAccountEmail': 'moustafa@example.com',
    'gratovo.gemini.lastAccountIndex': 2,
  };

  ProviderContainer newContainer() {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    return container;
  }

  GeminiBridgeSettingsNotifier notifierOf(ProviderContainer container) =>
      container.read(geminiBridgeSettingsProvider.notifier);

  GeminiBridgeSettings stateOf(ProviderContainer container) =>
      container.read(geminiBridgeSettingsProvider);

  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('GeminiBridgeSettings', () {
    test('the defaults', () {
      const settings = GeminiBridgeSettings();
      expect(settings.port, 8765);
      expect(settings.defaultModel, 'Pro');
      expect(settings.defaultModelOrNull, 'Pro');
      expect(settings.browser, GeminiBrowserKind.firefox);
      expect(settings.browserPath, '');
      expect(settings.profileMode, GeminiProfileMode.managed);
      expect(settings.autoStart, isTrue);
      expect(settings.autoOpenWindow, isTrue);
      expect(settings.keywordsGem, '');
      expect(settings.hasKeywordsGem, isFalse);
      expect(settings.keywordsGemOrNull, isNull);
      expect(settings.keywordChats, 4);
      expect(settings.keywordsPerChat, 25);
      expect(settings.lastAccountName, '');
      expect(settings.lastAccountEmail, '');
      expect(settings.lastAccountIndex, isNull);
    });

    test('a blank or whitespace keywords gem is no gem', () {
      expect(const GeminiBridgeSettings(keywordsGem: '   ').hasKeywordsGem,
          isFalse);
      const set = GeminiBridgeSettings(keywordsGem: ' kw ');
      expect(set.hasKeywordsGem, isTrue);
      expect(set.keywordsGemOrNull, 'kw');
    });

    test('copyWith changes only what it is given', () {
      const base = GeminiBridgeSettings(
        port: 9000,
        accountMatch: 'a',
        defaultModel: 'Flash',
        lastAccountName: 'N',
        lastAccountEmail: 'e@x',
        lastAccountIndex: 3,
      );
      final changed = base.copyWith(
        browser: GeminiBrowserKind.chrome,
        browserPath: 'p',
        profileMode: GeminiProfileMode.existing,
        autoStart: false,
        autoOpenWindow: false,
        keywordsGem: 'k',
        keywordChats: 7,
        keywordsPerChat: 10,
      );
      expect(changed.browser, GeminiBrowserKind.chrome);
      expect(changed.browserPath, 'p');
      expect(changed.profileMode, GeminiProfileMode.existing);
      expect(changed.autoStart, isFalse);
      expect(changed.autoOpenWindow, isFalse);
      expect(changed.keywordsGem, 'k');
      expect(changed.keywordChats, 7);
      expect(changed.keywordsPerChat, 10);
      // …and everything else came through untouched.
      expect(changed.port, 9000);
      expect(changed.accountMatch, 'a');
      expect(changed.defaultModel, 'Flash');
      expect(changed.lastAccountName, 'N');
      expect(changed.lastAccountEmail, 'e@x');
      expect(changed.lastAccountIndex, 3);
    });

    test('the remembered account index can be set and forgotten', () {
      const base = GeminiBridgeSettings();
      final set = base.copyWith(lastAccountIndex: 1);
      expect(set.lastAccountIndex, 1);
      // null means "keep"; forgetting is explicit.
      expect(set.copyWith(lastAccountIndex: null).lastAccountIndex, 1);
      expect(
          set.copyWith(clearLastAccountIndex: true).lastAccountIndex, isNull);
    });
  });

  group('loading', () {
    test('every saved value is read back under gratovo.gemini.<name>',
        () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = newContainer();
      await notifierOf(container).ready;
      final s = stateOf(container);
      expect(s.port, 9001);
      expect(s.accountMatch, 'moustafa');
      expect(s.defaultModel, 'Flash');
      expect(s.browser, GeminiBrowserKind.edge);
      expect(s.browserPath, r'C:\Edge\msedge.exe');
      expect(s.profileMode, GeminiProfileMode.existing);
      expect(s.autoStart, isFalse);
      expect(s.autoOpenWindow, isFalse);
      expect(s.keywordsGem, 'kw-gem-id');
      expect(s.keywordChats, 6);
      expect(s.keywordsPerChat, 40);
      expect(s.lastAccountName, 'Moustafa');
      expect(s.lastAccountEmail, 'moustafa@example.com');
      expect(s.lastAccountIndex, 2);
    });

    test('nothing saved means the defaults, and the model default is Pro',
        () async {
      final container = newContainer();
      await notifierOf(container).ready;
      final s = stateOf(container);
      // The bug this pins: a load with no saved model used to say ''.
      expect(s.defaultModel, 'Pro');
      expect(s.browser, GeminiBrowserKind.firefox);
      expect(s.autoStart, isTrue);
      expect(s.lastAccountIndex, isNull);
    });

    test('a model saved as blank on purpose stays blank', () async {
      SharedPreferences.setMockInitialValues({
        'gratovo.gemini.defaultModel': '',
      });
      final container = newContainer();
      await notifierOf(container).ready;
      expect(stateOf(container).defaultModel, '');
      expect(stateOf(container).defaultModelOrNull, isNull);
    });

    test('one value of the wrong type costs only that setting', () async {
      SharedPreferences.setMockInitialValues({
        ...savedValues,
        'gratovo.gemini.port': 'not a number',
        'gratovo.gemini.autoStart': 'yes',
        'gratovo.gemini.keywordsPerChat': -5,
        'gratovo.gemini.browser': 'netscape',
        'gratovo.gemini.profileMode': 7,
      });
      final container = newContainer();
      await notifierOf(container).ready;
      final s = stateOf(container);
      expect(s.port, 8765);
      expect(s.autoStart, isTrue);
      expect(s.keywordsPerChat, 25);
      expect(s.browser, GeminiBrowserKind.firefox);
      expect(s.profileMode, GeminiProfileMode.managed);
      // The rest of the saved values survived.
      expect(s.accountMatch, 'moustafa');
      expect(s.keywordsGem, 'kw-gem-id');
      expect(s.lastAccountEmail, 'moustafa@example.com');
    });

    test('the batch size is held to what the action accepts', () async {
      SharedPreferences.setMockInitialValues({
        'gratovo.gemini.keywordChats': 99,
      });
      var container = newContainer();
      await notifierOf(container).ready;
      expect(stateOf(container).keywordChats,
          GeminiBridgeSettings.maxKeywordChats);

      SharedPreferences.setMockInitialValues({
        'gratovo.gemini.keywordChats': 0,
      });
      container = newContainer();
      await notifierOf(container).ready;
      expect(stateOf(container).keywordChats, 1);
    });
  });

  group('persisting', () {
    test('update writes every field under its own key and reloads', () async {
      final container = newContainer();
      const settings = GeminiBridgeSettings(
        port: 9100,
        accountMatch: 'me',
        defaultModel: 'Pro',
        browser: GeminiBrowserKind.chrome,
        browserPath: r'C:\Chrome\chrome.exe',
        profileMode: GeminiProfileMode.existing,
        autoStart: false,
        autoOpenWindow: false,
        keywordsGem: 'kw',
        keywordChats: 3,
        keywordsPerChat: 30,
        lastAccountName: 'Me',
        lastAccountEmail: 'me@x.com',
        lastAccountIndex: 1,
      );
      await notifierOf(container).update(settings);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt('gratovo.gemini.port'), 9100);
      expect(prefs.getString('gratovo.gemini.browser'), 'chrome');
      expect(prefs.getString('gratovo.gemini.browserPath'),
          r'C:\Chrome\chrome.exe');
      expect(prefs.getString('gratovo.gemini.profileMode'), 'existing');
      expect(prefs.getBool('gratovo.gemini.autoStart'), isFalse);
      expect(prefs.getBool('gratovo.gemini.autoOpenWindow'), isFalse);
      expect(prefs.getString('gratovo.gemini.keywordsGem'), 'kw');
      expect(prefs.getInt('gratovo.gemini.keywordChats'), 3);
      expect(prefs.getInt('gratovo.gemini.keywordsPerChat'), 30);
      expect(prefs.getString('gratovo.gemini.lastAccountName'), 'Me');
      expect(prefs.getString('gratovo.gemini.lastAccountEmail'), 'me@x.com');
      expect(prefs.getInt('gratovo.gemini.lastAccountIndex'), 1);

      final fresh = newContainer();
      await notifierOf(fresh).ready;
      final s = stateOf(fresh);
      expect(s.browser, GeminiBrowserKind.chrome);
      expect(s.profileMode, GeminiProfileMode.existing);
      expect(s.autoStart, isFalse);
      expect(s.keywordsGem, 'kw');
      expect(s.keywordChats, 3);
      expect(s.lastAccountIndex, 1);
    });

    // The drafter and QA gems went with the old drafting path (decision
    // old-files): the next save takes their keys off the disk.
    test('saving clears the retired drafter and QA gem keys', () async {
      SharedPreferences.setMockInitialValues({
        ...savedValues,
        'gratovo.gemini.drafterGem': 'https://gemini.google.com/gem/drafter',
        'gratovo.gemini.qaGem': 'qa-gem-id',
      });
      final container = newContainer();
      await notifierOf(container).edit((s) => s.copyWith(port: 9002));

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('gratovo.gemini.drafterGem'), isFalse);
      expect(prefs.containsKey('gratovo.gemini.qaGem'), isFalse);
      expect(prefs.getString('gratovo.gemini.keywordsGem'), 'kw-gem-id');
    });

    test('a forgotten account index is removed, not left stale', () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = newContainer();
      final notifier = notifierOf(container);
      await notifier.edit((s) => s.copyWith(clearLastAccountIndex: true));

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('gratovo.gemini.lastAccountIndex'), isFalse);

      final fresh = newContainer();
      await notifierOf(fresh).ready;
      expect(stateOf(fresh).lastAccountIndex, isNull);
    });
  });

  group('the load/persist race', () {
    test('edit before the load lands keeps every saved value', () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = newContainer();
      final notifier = notifierOf(container);

      // Nothing has been awaited: the state is still the defaults.
      expect(stateOf(container).port, 8765);
      expect(stateOf(container).lastAccountEmail, '');

      await notifier.edit((s) => s.copyWith(keywordsGem: 'a-new-kw-gem'));

      final s = stateOf(container);
      expect(s.keywordsGem, 'a-new-kw-gem');
      // What was saved is what was edited, not the defaults it started as.
      expect(s.port, 9001);
      expect(s.accountMatch, 'moustafa');
      expect(s.browser, GeminiBrowserKind.edge);
      expect(s.lastAccountEmail, 'moustafa@example.com');

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt('gratovo.gemini.port'), 9001);
      expect(prefs.getString('gratovo.gemini.accountMatch'), 'moustafa');
      expect(prefs.getString('gratovo.gemini.browser'), 'edge');
      expect(prefs.getString('gratovo.gemini.lastAccountEmail'),
          'moustafa@example.com');
      expect(prefs.getString('gratovo.gemini.keywordsGem'), 'a-new-kw-gem');
    });

    test('edit sees the LOADED state, not a stale copy', () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = newContainer();
      GeminiBridgeSettings? seen;
      await notifierOf(container).edit((s) {
        seen = s;
        return s;
      });
      expect(seen!.port, 9001);
      expect(seen!.keywordsGem, 'kw-gem-id');
    });

    test('update before the load lands is not undone by it', () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = newContainer();
      final notifier = notifierOf(container);

      final pending = notifier.update(const GeminiBridgeSettings(port: 9555));
      await pending;
      await notifier.ready;

      // The late load did not put the saved port back over the update…
      expect(stateOf(container).port, 9555);
      // …and the update reached the disk.
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt('gratovo.gemini.port'), 9555);
    });

    test('two quick edits both land, in order, on screen and on disk',
        () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = newContainer();
      final notifier = notifierOf(container);

      final first = notifier.edit((s) => s.copyWith(keywordChats: 2));
      final second = notifier.edit((s) => s.copyWith(keywordsPerChat: 50));
      await Future.wait([first, second]);

      final s = stateOf(container);
      expect(s.keywordChats, 2);
      expect(s.keywordsPerChat, 50);
      expect(s.port, 9001);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getInt('gratovo.gemini.keywordChats'), 2);
      expect(prefs.getInt('gratovo.gemini.keywordsPerChat'), 50);

      final fresh = newContainer();
      await notifierOf(fresh).ready;
      expect(stateOf(fresh).keywordChats, 2);
      expect(stateOf(fresh).keywordsPerChat, 50);
    });

    test('once loaded, update and edit still move the state at once', () async {
      final container = newContainer();
      final notifier = notifierOf(container);
      await notifier.ready;

      // Not awaited: callers that fire and forget see the new state on the
      // very next read, as they did before `ready` existed.
      final edit = notifier.edit((s) => s.copyWith(keywordsGem: 'now'));
      expect(stateOf(container).keywordsGem, 'now');
      final update = notifier.update(
        stateOf(container).copyWith(accountMatch: 'sync'),
      );
      expect(stateOf(container).accountMatch, 'sync');
      await Future.wait([edit, update]);
    });

    test('ready is complete once the values are in, and stays complete',
        () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = newContainer();
      final notifier = notifierOf(container);
      await notifier.ready;
      expect(stateOf(container).port, 9001);
      // Asking again is instant and does not reload over later edits.
      await notifier.edit((s) => s.copyWith(port: 9002));
      await notifier.ready;
      expect(stateOf(container).port, 9002);
    });

    test('a write after the container is gone is dropped, not thrown',
        () async {
      SharedPreferences.setMockInitialValues(savedValues);
      final container = ProviderContainer();
      final notifier = notifierOf(container);
      final pending = notifier.edit((s) => s.copyWith(keywordsGem: 'too late'));
      container.dispose();
      await pending;

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('gratovo.gemini.keywordsGem'), 'kw-gem-id');
    });
  });

  group('the browser vocabulary', () {
    test('wire names are the Dart names and unknown ones are null', () {
      for (final kind in GeminiBrowserKind.values) {
        expect(GeminiBrowserKind.tryParse(kind.wire), kind);
      }
      expect(
          GeminiBrowserKind.tryParse(' Firefox '), GeminiBrowserKind.firefox);
      expect(GeminiBrowserKind.tryParse('other'), isNull);
      expect(GeminiBrowserKind.tryParse(null), isNull);
      expect(GeminiBrowserKind.fromWire('brave'), GeminiBrowserKind.firefox);
      expect(
        GeminiBrowserKind.fromWire('brave', fallback: GeminiBrowserKind.edge),
        GeminiBrowserKind.edge,
      );
      expect(
          GeminiProfileMode.fromWire('existing'), GeminiProfileMode.existing);
      expect(GeminiProfileMode.fromWire('???'), GeminiProfileMode.managed);
      expect(GeminiAddonMode.tryParse('permanent'), GeminiAddonMode.permanent);
      expect(GeminiAddonMode.tryParse('forever'), isNull);
    });

    test('the add-on id is the fixed one', () {
      expect(geminiAddonId, 'gemini-bridge@gratovo.app');
    });
  });
}
