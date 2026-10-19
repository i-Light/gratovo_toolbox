import 'dart:typed_data';

/// The web build of [ImageStore].
///
/// There is no filesystem to cache into, so every method reports "nothing
/// local" and every image is fetched. Deliberately returns empty values rather
/// than throwing (the way scraper_process_stub.dart does): looking for a local
/// copy is something every image widget in the app does on every build, as a
/// normal part of its cross-platform path, not something gated behind a
/// desktop-only check.
///
/// [isAvailable] is what the Settings card reads to explain, on web, why the
/// "save pictures" toggle is not offered — rather than showing a switch that
/// silently does nothing.
class ImageStore {
  const ImageStore._();

  static const bool isAvailable = false;

  static Future<Uint8List?> read(String url) async => null;

  static Future<void> write(String url, Uint8List bytes) async {}

  static Future<void> deleteIfOlderThan(String url, Duration age) async {}

  static Future<int> clear() async => 0;

  static Future<int> size() async => 0;
}
