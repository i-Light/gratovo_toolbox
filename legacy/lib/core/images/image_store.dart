/// Public entry point for the on-disk image cache. Import this file (never
/// `image_store_io.dart`/`_stub.dart` directly) — which implementation you get
/// is picked at compile time: a real `dart:io` cache everywhere `dart:io`
/// exists, and a no-op that reports `isAvailable == false` on web, where there
/// is no filesystem to cache into.
library;

export 'image_store_stub.dart' if (dart.library.io) 'image_store_io.dart';
