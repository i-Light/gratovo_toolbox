import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/proxy_entry.dart';
import 'package:gratovo_toolbox/data/models/search_tuning_settings.dart';

void main() {
  group('DelayRange', () {
    test('copyWith changes only the fields passed', () {
      const original = DelayRange(min: 1, max: 3);
      final updated = original.copyWith(max: 5);

      expect(updated.min, 1);
      expect(updated.max, 5);
    });
  });

  group('PacingProfile', () {
    test('copyWith changes only the fields passed', () {
      const original = PacingProfile.normalDefaults;
      final updated =
          original.copyWith(jitterDelay: const DelayRange(min: 0, max: 1));

      expect(updated.jitterDelay.min, 0);
      expect(updated.humanScrollDelay, original.humanScrollDelay);
      expect(updated.ipCooldownChance, original.ipCooldownChance);
    });

    test('fastDefaults is strictly faster than normalDefaults', () {
      const normal = PacingProfile.normalDefaults;
      const fast = PacingProfile.fastDefaults;

      expect(fast.humanScrollDelay.max, lessThan(normal.humanScrollDelay.max));
      expect(fast.jitterDelay.max, lessThan(normal.jitterDelay.max));
      expect(
          fast.recentVideosDelay.max, lessThan(normal.recentVideosDelay.max));
      expect(fast.fastSubCountCheckDelay.max,
          lessThan(normal.fastSubCountCheckDelay.max));
      expect(
          fast.foundChannelsDelay.max, lessThan(normal.foundChannelsDelay.max));
      expect(fast.ipCooldown.max, lessThan(normal.ipCooldown.max));
      expect(fast.ipCooldownChance, lessThan(normal.ipCooldownChance));
    });
  });

  group('SearchTuningSettings', () {
    test('copyWith changes only the fields passed', () {
      const original = SearchTuningSettings.defaults;
      final updated = original.copyWith(handlesToSearchLimit: 100);

      expect(updated.handlesToSearchLimit, 100);
      expect(updated.pacing.jitterDelay.min, original.pacing.jitterDelay.min);
      expect(updated.proxyRotationEnabled, original.proxyRotationEnabled);
    });

    test('copyWith replaces the pacing profile wholesale, not field-by-field',
        () {
      const original = SearchTuningSettings.defaults;
      final newPacing = original.pacing
          .copyWith(ipCooldown: const DelayRange(min: 10, max: 20));
      final updated = original.copyWith(pacing: newPacing);

      expect(updated.pacing.ipCooldown.min, 10);
      expect(updated.pacing.ipCooldown.max, 20);
      // fastPacing is untouched by a pacing-only copyWith.
      expect(updated.fastPacing, original.fastPacing);
    });

    test('normal and fast pacing profiles are independent', () {
      const original = SearchTuningSettings.defaults;
      final newFast = original.fastPacing
          .copyWith(ipCooldown: const DelayRange(min: 1, max: 2));
      final updated = original.copyWith(fastPacing: newFast);

      expect(updated.fastPacing.ipCooldown.min, 1);
      expect(updated.pacing, original.pacing);
    });

    test('proxy fields default to disabled, direct included, empty list', () {
      const settings = SearchTuningSettings.defaults;
      expect(settings.proxyRotationEnabled, isFalse);
      expect(settings.includeDirectConnection, isTrue);
      expect(settings.proxies, isEmpty);
    });

    test(
        'enabling proxy rotation via copyWith leaves other proxy fields'
        ' intact', () {
      const original = SearchTuningSettings.defaults;
      const entry = ProxyEntry(id: 'p1', host: 'proxy.example.com', port: 8080);
      final withRotation = original.copyWith(proxyRotationEnabled: true);
      final withProxies = withRotation.copyWith(proxies: [entry]);

      expect(withProxies.proxyRotationEnabled, isTrue);
      expect(withProxies.includeDirectConnection, isTrue);
      expect(withProxies.proxies, [entry]);
    });

    group('proxyRotationActive', () {
      test('false when rotation is disabled, even with usable proxies', () {
        const entry = ProxyEntry(id: 'p1', host: '1.2.3.4', port: 8080);
        final settings = SearchTuningSettings.defaults
            .copyWith(proxyRotationEnabled: false, proxies: [entry]);

        expect(settings.proxyRotationActive, isFalse);
      });

      test('false when enabled but every entry is disabled or hostless', () {
        const disabled =
            ProxyEntry(id: 'p1', host: '1.2.3.4', port: null, enabled: false);
        const hostless = ProxyEntry(id: 'p2', host: '  ', port: null);
        final settings = SearchTuningSettings.defaults.copyWith(
          proxyRotationEnabled: true,
          proxies: [disabled, hostless],
        );

        expect(settings.proxyRotationActive, isFalse);
      });

      test('true when enabled with at least one usable entry', () {
        const entry = ProxyEntry(id: 'p1', host: '1.2.3.4', port: 8080);
        final settings = SearchTuningSettings.defaults
            .copyWith(proxyRotationEnabled: true, proxies: [entry]);

        expect(settings.proxyRotationActive, isTrue);
      });
    });
  });

  group('ProxyEntry', () {
    test('copyWith changes only the fields passed', () {
      const original = ProxyEntry(id: 'p1', host: '1.2.3.4', port: 8080);
      final updated = original.copyWith(host: '5.6.7.8');

      expect(updated.id, 'p1');
      expect(updated.host, '5.6.7.8');
      expect(updated.port, 8080);
    });

    test('clearPort clears the port even though it is nullable', () {
      const original = ProxyEntry(id: 'p1', host: '1.2.3.4', port: 8080);
      final updated = original.copyWith(clearPort: true);

      expect(updated.port, isNull);
    });

    test('round-trips through toJson/fromJson', () {
      const original = ProxyEntry(
        id: 'p1',
        label: 'residential-1',
        host: '1.2.3.4',
        port: 8080,
        username: 'user',
        password: 'pass',
        enabled: false,
      );

      final restored = ProxyEntry.fromJson(original.toJson());

      expect(restored.id, original.id);
      expect(restored.label, original.label);
      expect(restored.host, original.host);
      expect(restored.port, original.port);
      expect(restored.username, original.username);
      expect(restored.password, original.password);
      expect(restored.enabled, original.enabled);
    });

    test('hostPort omits the port when unset', () {
      const withPort = ProxyEntry(id: 'p1', host: '1.2.3.4', port: 8080);
      const withoutPort = ProxyEntry(id: 'p2', host: '1.2.3.4', port: null);

      expect(withPort.hostPort, '1.2.3.4:8080');
      expect(withoutPort.hostPort, '1.2.3.4');
    });
  });

  group('parallel search', () {
    const twoProxies = [
      ProxyEntry(id: 'a', host: '1.1.1.1', port: 1),
      ProxyEntry(id: 'b', host: '2.2.2.2', port: 2),
      ProxyEntry(id: 'off', host: '3.3.3.3', port: 3, enabled: false),
      ProxyEntry(id: 'blank', host: ' ', port: 4),
    ];

    test('off by default', () {
      expect(SearchTuningSettings.defaults.parallelSearchEnabled, isFalse);
      expect(SearchTuningSettings.defaults.parallelWorkers(gateways: 5), 1);
    });

    test('counts rotating connections the way the pipeline does', () {
      final settings = SearchTuningSettings.defaults
          .copyWith(proxyRotationEnabled: true, proxies: twoProxies);
      expect(settings.rotatingConnections(), 2);
      expect(settings.rotatingConnections(gateways: 3), 5);
      // Proxies only count while rotation is on; gateways always do.
      expect(
        settings.copyWith(proxyRotationEnabled: false).rotatingConnections(
              gateways: 3,
            ),
        3,
      );
    });

    test('one worker per connection, capped', () {
      final settings = SearchTuningSettings.defaults
          .copyWith(parallelSearchEnabled: true, parallelMaxWorkers: 3);
      expect(settings.parallelWorkers(), 1);
      expect(settings.parallelWorkers(gateways: 1), 1);
      expect(settings.parallelWorkers(gateways: 2), 2);
      expect(settings.parallelWorkers(gateways: 7), 3);
    });

    test('copyWith keeps the hand-set minimum gap', () {
      const settings = SearchTuningSettings(
        handlesToSearchLimit: 10,
        pacing: PacingProfile.normalDefaults,
        fastPacing: PacingProfile.fastDefaults,
        proxyMinGapSeconds: 9,
        proxyMinGapJitter: 0.2,
      );
      final updated = settings.copyWith(parallelSearchEnabled: true);
      expect(updated.proxyMinGapSeconds, 9);
      expect(updated.proxyMinGapJitter, 0.2);
    });
  });
}
