/// Thin wrapper around the OS-level "launch at login" registration.
///
/// Desktop only. Mobile and web have no "launch at login" to register
/// with, so [StartupLaunchStore.isAvailable] is false there and callers
/// should hide the toggle rather than show one that can't do anything.
library;

export 'startup_launch_store_stub.dart'
    if (dart.library.io) 'startup_launch_store_io.dart';
