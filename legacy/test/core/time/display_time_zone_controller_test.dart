import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/time/device_time_zone.dart';
import 'package:gratovo_toolbox/core/time/display_time_zone_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

ProviderContainer _container({String device = 'UTC'}) {
  final container = ProviderContainer(
    overrides: [
      deviceTimeZoneProvider.overrideWith((ref) async => device),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

/// Lets the notifier's async `_load` (SharedPreferences + the device-zone
/// provider) run to completion.
Future<void> _settle(ProviderContainer container) async {
  await container.read(deviceTimeZoneProvider.future);
  await pumpEventQueue();
}

void main() {
  setUpAll(tzdata.initializeTimeZones);
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('with no saved preference, adopts the device zone', () async {
    SharedPreferences.setMockInitialValues({});
    final container = _container(device: 'Asia/Tokyo');
    container.read(displayTimeZoneProvider);
    await _settle(container);

    expect(container.read(displayTimeZoneProvider), 'Asia/Tokyo');
  });

  test('a saved valid zone wins over the device zone', () async {
    SharedPreferences.setMockInitialValues(
      {'gratovo.display.timezone': 'Europe/Paris'},
    );
    final container = _container(device: 'Asia/Tokyo');
    container.read(displayTimeZoneProvider);
    await _settle(container);

    expect(container.read(displayTimeZoneProvider), 'Europe/Paris');
  });

  test('a saved unknown zone falls back to UTC', () async {
    SharedPreferences.setMockInitialValues(
      {'gratovo.display.timezone': 'Middle/Earth'},
    );
    final container = _container(device: 'Asia/Tokyo');
    container.read(displayTimeZoneProvider);
    await _settle(container);

    expect(container.read(displayTimeZoneProvider), 'UTC');
  });

  test('an empty saved value falls through to the device zone', () async {
    SharedPreferences.setMockInitialValues({'gratovo.display.timezone': ''});
    final container = _container(device: 'Africa/Cairo');
    container.read(displayTimeZoneProvider);
    await _settle(container);

    expect(container.read(displayTimeZoneProvider), 'Africa/Cairo');
  });

  test('setZone accepts a known zone, updates state, and persists', () async {
    SharedPreferences.setMockInitialValues({});
    final container = _container();
    container.read(displayTimeZoneProvider);
    await _settle(container);

    final accepted = await container
        .read(displayTimeZoneProvider.notifier)
        .setZone('Asia/Kolkata');

    expect(accepted, isTrue);
    expect(container.read(displayTimeZoneProvider), 'Asia/Kolkata');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('gratovo.display.timezone'), 'Asia/Kolkata');
  });

  test('setZone rejects an unknown zone and changes nothing', () async {
    SharedPreferences.setMockInitialValues({});
    final container = _container(device: 'Europe/Berlin');
    container.read(displayTimeZoneProvider);
    await _settle(container);
    final before = container.read(displayTimeZoneProvider);

    final accepted = await container
        .read(displayTimeZoneProvider.notifier)
        .setZone('Nowhere/Special');

    expect(accepted, isFalse);
    expect(container.read(displayTimeZoneProvider), before);
  });
}
