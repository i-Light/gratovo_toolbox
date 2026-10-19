import 'dart:math';

/// A random UUID (version 4), for rows this machine creates before the server
/// has ever seen them.
///
/// Hand-rolled rather than pulled from a `uuid` package, because the
/// repositories that need it must stay importable on web — see
/// `sync_engine_types.dart`. Ten lines is a smaller price than a dependency,
/// and smaller still than making the whole data layer platform-specific.
///
/// [Random.secure] rather than the default generator: these ids are primary
/// keys that two machines can mint at the same moment with no coordination at
/// all, and a seeded PRNG that happens to start in the same state on two
/// laptops would collide on the first row each of them wrote.
String localUuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));

  // Version 4, variant 1 — the bits that say "this was made up, not derived
  // from a timestamp or a MAC address".
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  final hex = [
    for (final byte in bytes) byte.toRadixString(16).padLeft(2, '0'),
  ].join();

  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
