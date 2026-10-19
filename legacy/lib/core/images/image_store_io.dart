import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

/// The on-disk half of "look for a local copy first".
///
/// Files are named by the SHA-256 of their source URL. A cheaper hash would be
/// faster and wrong: a collision here does not corrupt anything, it shows one
/// channel's avatar on another channel's row, silently, in the one place in
/// this app where telling two creators apart is the entire job.
///
/// Everything is best effort. A read that fails, a directory that cannot be
/// created, a disk that is full — all of them resolve to "no local copy", and
/// the caller falls back to the network. An image cache that can break the
/// screen it is meant to speed up is worse than no cache.
class ImageStore {
  const ImageStore._();

  static const bool isAvailable = true;

  /// Resolved once and reused. `getApplicationSupportDirectory` is a platform
  /// channel call, and the influencer list asks about dozens of images per
  /// screen.
  static Directory? _directory;
  static Future<Directory?>? _pending;

  static Future<Directory?> _cacheDirectory() {
    final resolved = _directory;
    if (resolved != null) return Future.value(resolved);
    return _pending ??= _resolveDirectory();
  }

  static Future<Directory?> _resolveDirectory() async {
    try {
      final support = await getApplicationSupportDirectory();
      final directory = Directory('${support.path}${Platform.pathSeparator}'
          'image_cache');
      if (!await directory.exists()) {
        await directory.create(recursive: true);
      }
      _directory = directory;
      return directory;
    } catch (error, stackTrace) {
      developer.log(
        'No image cache directory available; every image will be fetched.',
        name: 'gratovo.images',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return null;
    } finally {
      _pending = null;
    }
  }

  static String _fileName(String url) =>
      sha256.convert(utf8.encode(url)).toString();

  /// The cached bytes for [url], or null when there is no local copy.
  static Future<Uint8List?> read(String url) async {
    try {
      final directory = await _cacheDirectory();
      if (directory == null) return null;
      final file = File(
        '${directory.path}${Platform.pathSeparator}${_fileName(url)}',
      );
      if (!await file.exists()) return null;
      // Timed out rather than left to run: a network drive or a disk under
      // heavy contention (fifty rows' worth of avatars all reading at once)
      // can stall a read indefinitely, and a stalled read is caught by the
      // same catch-all below as a caught exception -- either way this
      // resolves to "no local copy" and the caller falls back to the network.
      final bytes =
          await file.readAsBytes().timeout(const Duration(seconds: 4));
      // A zero-length file is a half-finished write from a previous run, not a
      // cached image. Treated as a miss so the next fetch replaces it, rather
      // than handed to the decoder to fail on.
      return bytes.isEmpty ? null : bytes;
    } catch (error) {
      return null;
    }
  }

  /// Saves [bytes] as the local copy of [url].
  ///
  /// Written to a temporary name and then renamed, because rename is atomic on
  /// every platform this runs on. Writing in place would leave a truncated
  /// file behind if the app is closed mid-write, and a truncated file is
  /// indistinguishable from a valid cache entry on the next launch.
  static Future<void> write(String url, Uint8List bytes) async {
    if (bytes.isEmpty) return;
    try {
      final directory = await _cacheDirectory();
      if (directory == null) return;
      final path = '${directory.path}${Platform.pathSeparator}'
          '${_fileName(url)}';
      final temporary = File('$path.part');
      await temporary.writeAsBytes(bytes, flush: true);
      await temporary.rename(path);
    } catch (error) {
      // Best effort — see the class doc comment.
    }
  }

  /// Deletes the cached file for [url] if it was written more than [age] ago.
  ///
  /// File modification time is the "cached since" marker: [write] never
  /// touches a file again after creating it, so mtime is exactly when it was
  /// cached.
  static Future<void> deleteIfOlderThan(String url, Duration age) async {
    try {
      final directory = await _cacheDirectory();
      if (directory == null) return;
      final file = File(
        '${directory.path}${Platform.pathSeparator}${_fileName(url)}',
      );
      if (!await file.exists()) return;
      final modified = await file.lastModified();
      if (DateTime.now().difference(modified) > age) {
        await file.delete();
      }
    } catch (error) {
      // Best effort — see the class doc comment.
    }
  }

  /// Deletes every cached file. Returns how many bytes were freed, which is
  /// what the Settings card reports back.
  static Future<int> clear() async {
    try {
      final directory = await _cacheDirectory();
      if (directory == null || !await directory.exists()) return 0;
      var freed = 0;
      await for (final entity in directory.list()) {
        if (entity is! File) continue;
        try {
          freed += await entity.length();
          await entity.delete();
        } catch (error) {
          // One undeletable file (open elsewhere, permissions) must not stop
          // the rest from being cleared.
        }
      }
      return freed;
    } catch (error) {
      return 0;
    }
  }

  /// Total bytes currently cached, for the Settings card.
  static Future<int> size() async {
    try {
      final directory = await _cacheDirectory();
      if (directory == null || !await directory.exists()) return 0;
      var total = 0;
      await for (final entity in directory.list()) {
        if (entity is File) total += await entity.length();
      }
      return total;
    } catch (error) {
      return 0;
    }
  }
}
