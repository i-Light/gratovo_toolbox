import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/images/image_preferences.dart';
import 'package:gratovo_toolbox/core/images/image_store.dart';
import 'package:http/http.dart' as http;

/// The pipeline stores this literal string in `channels.banner` when YouTube
/// reports no banner. It is a real value that is not a URL, so loading it is a
/// guaranteed failure rather than a missing image.
const _noBannerSentinel = 'No Banner';

/// Whether [url] is something worth trying to load at all.
///
/// Exported because callers need to decide *layout* on this — a card with no
/// banner should not reserve banner space and then show an empty box.
bool isUsableImageUrl(String? url) {
  if (url == null) return false;
  final trimmed = url.trim();
  if (trimmed.isEmpty) return false;
  if (trimmed == _noBannerSentinel) return false;
  // A stored value that is not a URL at all (a handful of imported rows carry
  // status text where a link should be) would otherwise become a request to a
  // nonsense host.
  final uri = Uri.tryParse(trimmed);
  return uri != null && (uri.isScheme('http') || uri.isScheme('https'));
}

/// Matches Google's avatar-sizing directive (`=s800-c-k-c0x00ffffff-no-rj`)
/// so it can be swapped for a size that actually matches what is drawn on
/// screen. Runs to the end of the string rather than just the digits: the
/// crop/mask flags that follow the size (`-c-k-...`) are appended directly
/// after it with no further `=` to bound the match, so leaving them in place
/// would keep the original crop for a size that no longer matches it.
final _avatarSizeDirective = RegExp(r'=s\d+.*$');

/// YouTube's own thumbnail-quality tiers that are larger than this app ever
/// needs: `maxresdefault`/`hq720` (up to 1280x720) and `sddefault`/`hqdefault`
/// (640x480), all swapped for `mqdefault` (320x180).
final _oversizedThumbnail =
    RegExp(r'/(maxresdefault|sddefault|hqdefault|hq720)\.jpg');

/// Rewrites [url] to ask the source for a picture close to what will actually
/// be decoded, instead of the multi-hundred-kilobyte original the pipeline
/// stored.
///
/// [targetPixelSize] is the largest side of the widget the image is drawn
/// into, in *device* pixels (logical size times device pixel ratio) — null
/// when the caller has no target yet (the full-screen image viewer, which
/// wants the original for zooming). The avatar rewrite is skipped in that
/// case; the thumbnail one still applies, since nothing in this app ever
/// opens a video thumbnail full-size the way it does an avatar or banner.
///
/// A URL that matches neither pattern (a banner, or a manually-entered
/// picture that isn't hosted on Google's own image host) is returned as-is.
///
/// Not private: exposed only so [remote_image_test.dart] can check the regex
/// rewrites directly, rather than through the widget lifecycle they are an
/// implementation detail of.
@visibleForTesting
String sizedImageUrl(String url, int? targetPixelSize) {
  var result = url;
  if (targetPixelSize != null) {
    final match = _avatarSizeDirective.firstMatch(result);
    if (match != null) {
      result = result.replaceRange(
        match.start,
        match.end,
        '=s$targetPixelSize-c',
      );
    }
  }
  return result.replaceAll(_oversizedThumbnail, '/mqdefault.jpg');
}

/// Caps how many image loads run at once, end to end: the disk read and, on a
/// miss, the HTTP fetch that replaces it each occupy a slot for their whole
/// duration.
///
/// A page of the influencer list is up to fifty rows, each asking for one or
/// two images. Without a cap, arriving at a fresh page starts fifty concurrent
/// disk reads and fifty concurrent HTTP requests to the same couple of hosts —
/// which does not serve any one of them faster, since past a handful of
/// connections per host the CDN simply queues them, and is what made a
/// freshly-loaded page feel slow rather than any single request's own cost.
///
/// Not private: exposed only so [remote_image_test.dart] can check that the
/// cap actually holds, which is the whole point of it and the one thing that
/// cannot be observed from outside the widget.
@visibleForTesting
class ImageLoadPool {
  ImageLoadPool(this._maxConcurrent);

  final int _maxConcurrent;
  int _active = 0;
  final _waiting = <Completer<void>>[];

  Future<T> run<T>(Future<T> Function() action) async {
    await _acquire();
    try {
      return await action();
    } finally {
      _release();
    }
  }

  /// The slot is taken synchronously, in the same turn the caller asked for
  /// it, so [_active] is an exact count of what is running rather than a count
  /// that trails whichever waiters have not resumed yet — and a caller
  /// arriving mid-handover cannot slip past a waiter that has already been
  /// given a slot.
  Future<void> _acquire() {
    if (_waiting.isEmpty && _active < _maxConcurrent) {
      _active++;
      return Future.value();
    }
    final completer = Completer<void>();
    _waiting.add(completer);
    return completer.future;
  }

  /// Newest waiter first. The queue is drained by a list that keeps building
  /// rows as it scrolls, so the requests that arrived last are the ones whose
  /// rows are on screen now; the ones at the bottom of the stack were asked
  /// for by rows the reader has already scrolled past. Serving the oldest
  /// first means a long scroll spends its whole budget on pictures nobody is
  /// looking at any more.
  ///
  /// The slot is handed straight to that waiter rather than being freed for
  /// whoever asks next — which is why [_active] is not decremented here: the
  /// slot never actually becomes free.
  void _release() {
    if (_waiting.isNotEmpty) {
      _waiting.removeLast().complete();
      return;
    }
    _active--;
  }
}

/// Turns a URL into an [ImageProvider], local copy first.
///
/// The order is the whole feature: a picture already on disk is used without
/// touching the network, whatever the setting says. Only a miss goes out to
/// fetch, and [autoDownloadImagesProvider] decides only whether the bytes that
/// come back are kept afterwards.
class RemoteImageResolver {
  RemoteImageResolver._();

  /// Resolved providers, newest last — a plain map, which in Dart is
  /// insertion-ordered, so "the oldest entry" is simply the first key.
  ///
  /// This exists so that scrolling a list does not re-read the same file from
  /// disk on every rebuild. It matters more than it looks: Flutter's own image
  /// cache is keyed on the [ImageProvider], and a fresh `MemoryImage` over
  /// freshly read bytes is a different key every time — so without this, every
  /// rebuild would both re-read the file AND re-decode the image, which is the
  /// expensive half.
  static final _resolved = <String, ImageProvider>{};

  /// Encoded size of each entry in [_resolved], so [_heldBytes] can be kept
  /// without interrogating the providers.
  static final _resolvedBytes = <String, int>{};
  static int _heldBytes = 0;

  /// In-flight resolutions, so ten rows showing the same avatar make one read
  /// rather than ten.
  static final _inFlight = <String, Future<ImageProvider?>>{};

  /// Bounded so a long vetting session cannot grow this without limit, but set
  /// well above what a long *scroll* touches: a page of the influencer list is
  /// 50 rows with up to two images each, and the list keeps appending pages, so
  /// a cap near one or two pages meant that scrolling back up past it re-read
  /// every avatar from disk and re-decoded it — the stutter that "scroll up
  /// after scrolling far down" was.
  static const _maxEntries = 2500;

  /// The other half of that bound, and the one that usually binds. Entries
  /// hold a picture's *encoded* bytes (the decoded-bitmap budget is a separate
  /// thing — `imageCache` in main()), and an avatar's few kilobytes and a
  /// full-width channel banner's few hundred are far enough apart that a count
  /// on its own says nothing about how much memory 2500 of them are.
  static const _maxHeldBytes = 64 * 1024 * 1024;

  /// Anything larger is displayed but never written to disk. YouTube banners
  /// are well under this; a multi-megabyte response is a sign of something
  /// other than an avatar, and filling a shared machine's disk with it is not
  /// a trade worth making silently.
  static const _maxCacheableBytes = 8 * 1024 * 1024;

  /// How long a single attempt may sit before it is abandoned and retried.
  /// Generous relative to a normal fetch of an avatar-sized image, tight
  /// enough that a stalled connection cannot hold a pool slot — or a row's
  /// placeholder — for long.
  static const _fetchTimeout = Duration(seconds: 8);

  /// How many times one URL is fetched before it is given up on.
  ///
  /// One attempt was the whole story before, and it was the wrong number: a
  /// refused or reset connection is the *ordinary* outcome of a burst of
  /// requests to a CDN, and with no second attempt the only thing that could
  /// ever try again was the widget being built afresh. That is why scrolling a
  /// row out of view and back was what made its picture finally appear.
  static const _maxAttempts = 3;

  /// Waited between attempts, doubling each time. Deliberately outside the
  /// pool: a URL that is backing off must not sit on a slot the rest of the
  /// page is queued behind.
  static const _retryBackoff = Duration(milliseconds: 250);

  /// See [ImageLoadPool] — eight, a little above the six-per-host browsers
  /// settled on because this app draws from two hosts (avatars and video
  /// thumbnails), and well below what fifty rows resolving together would
  /// otherwise fire off.
  static final _pool = ImageLoadPool(8);

  /// One client for every fetch, so a few hundred pictures from the same two
  /// hosts share a handful of keep-alive connections. The top-level `http.get`
  /// this used to call builds a client and closes it again per call, which
  /// means a fresh TCP connection and TLS handshake for every single image.
  static final http.Client _client = http.Client();

  static Future<ImageProvider?> resolve(
    String url, {
    required bool autoDownload,
  }) {
    final cached = _resolved.remove(url);
    if (cached != null) {
      // Re-inserted so the most recently used entry is the last to be evicted.
      _resolved[url] = cached;
      return Future.value(cached);
    }
    // This callback's body has to be a block, and it has to end there.
    // `whenComplete(() => _inFlight.remove(url))` reads as the same thing and
    // is not: an arrow body *returns* what `Map.remove` hands back, which is
    // the very future `whenComplete` is building — and since `void` is a top
    // type in Dart, a `Future<ImageProvider?>` satisfies the callback's
    // declared `FutureOr<void>` without a murmur from the analyser, so
    // `whenComplete` dutifully waits for that future before completing itself.
    // It waits on itself. It never completes.
    //
    // The resolution underneath still ran, so the picture was fetched and
    // remembered in [_resolved] — it was just never handed to the widget that
    // asked for it, which sat on its placeholder until something rebuilt it
    // from scratch and the second ask took the [_resolved] fast path above.
    // That is the whole of "the pictures only appear if I scroll them out of
    // view and back".
    return _inFlight[url] ??=
        _resolve(url, autoDownload: autoDownload).whenComplete(() {
      _inFlight.remove(url);
    });
  }

  static Future<ImageProvider?> _resolve(
    String url, {
    required bool autoDownload,
  }) async {
    // 0. On web, hand the whole job to the browser. There is no local copy to
    //    look for there (see image_store_stub.dart), the browser already caps
    //    its own connections per host — the thing the pool exists to do — and
    //    `NetworkImage` becomes an <img> element, which is allowed to draw a
    //    cross-origin picture that an XHR for the same bytes would not be
    //    allowed to read.
    if (!ImageStore.isAvailable) {
      return _rememberProvider(url, NetworkImage(url), 0);
    }

    // 1. A local copy, if there is one. Costs no network whatever the setting.
    final local = await _pool.run(() => ImageStore.read(url));
    if (local != null) return _remember(url, local);

    // 2. Otherwise fetch the bytes here — including when nothing is being
    //    kept, which is the default and therefore the ordinary case. Handing
    //    that case a bare `NetworkImage`, which is what this used to do, put
    //    the request somewhere [_pool] cannot see: the cap still held, but it
    //    held over *disk reads*, while every one of a page's fifty images went
    //    to the network at once behind them. `NetworkImage` brings no timeout
    //    and no retry of its own, so whichever of that burst stalled or was
    //    refused stayed on a pulsing placeholder until something happened to
    //    rebuild the row.
    final bytes = await _fetch(url);
    if (bytes == null) return null;

    // 3. Keeping it is the setting's only job.
    if (autoDownload && bytes.length <= _maxCacheableBytes) {
      await ImageStore.write(url, bytes);
    }
    return _remember(url, bytes);
  }

  /// The bytes for [url], or null once it has been tried [_maxAttempts] times
  /// or answered with something a retry cannot change.
  ///
  /// Each attempt takes a pool slot for itself and gives it back before the
  /// backoff, so a handful of dead URLs cannot pin the pool shut for the page
  /// queued behind them.
  ///
  /// A failure is deliberately not remembered in [_resolved]: the next build
  /// that asks for this URL should go and try again, not be handed a cached
  /// "this one doesn't work" for the rest of the session.
  static Future<Uint8List?> _fetch(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return null;
    for (var attempt = 1; attempt <= _maxAttempts; attempt++) {
      final (bytes, retriable) = await _pool.run(() => _fetchOnce(uri));
      if (bytes != null) return bytes;
      if (!retriable || attempt == _maxAttempts) return null;
      await Future<void>.delayed(_retryBackoff * (1 << (attempt - 1)));
    }
    return null;
  }

  /// One attempt: the bytes, or nothing plus whether asking again could help.
  static Future<(Uint8List?, bool)> _fetchOnce(Uri uri) async {
    try {
      final response = await _client.get(uri).timeout(_fetchTimeout);
      final bytes = response.bodyBytes;
      if (response.statusCode == 200 && bytes.isNotEmpty) return (bytes, false);
      // 404 for an avatar the channel has deleted, 403 for a signed URL that
      // has expired: the answer is the same next time, so that is the end of
      // it. 408, 429 and the 5xx range are the host asking for a moment, which
      // is the one thing a retry is actually for.
      final status = response.statusCode;
      return (null, status == 408 || status == 429 || status >= 500);
    } catch (error) {
      // A timeout, a refused connection, a reset socket — all of them are what
      // a burst of requests to one host produces, and all of them usually
      // clear on a second attempt.
      return (null, true);
    }
  }

  static ImageProvider _remember(String url, Uint8List bytes) =>
      _rememberProvider(url, MemoryImage(bytes), bytes.length);

  /// [heldBytes] is what this entry costs the [_maxHeldBytes] budget — the
  /// encoded picture for a [MemoryImage], and nothing for a provider that only
  /// holds a URL.
  static ImageProvider _rememberProvider(
    String url,
    ImageProvider provider,
    int heldBytes,
  ) {
    _resolved[url] = provider;
    _heldBytes += heldBytes - (_resolvedBytes[url] ?? 0);
    _resolvedBytes[url] = heldBytes;
    // Never down to nothing: a picture bigger than the whole budget is still
    // the one that was just asked for, and evicting it here would only mean
    // fetching it again on the very next build.
    while (_resolved.length > 1 &&
        (_resolved.length > _maxEntries || _heldBytes > _maxHeldBytes)) {
      final oldest = _resolved.keys.first;
      _resolved.remove(oldest);
      _heldBytes -= _resolvedBytes.remove(oldest) ?? 0;
    }
    return provider;
  }

  /// Drops every remembered provider. Called after the on-disk cache is
  /// cleared from Settings, so the next build actually goes and looks again
  /// instead of serving bytes from a file that no longer exists.
  static void forgetAll() {
    _resolved.clear();
    _resolvedBytes.clear();
    _heldBytes = 0;
  }
}

/// One picture from the internet, drawn local-copy-first.
///
/// [fallback] is shown in every state that is not "an image is on screen":
/// while resolving, when the URL is unusable, when [enabled] is false, and
/// when decoding fails. While resolving, an image is genuinely pending — the
/// fetch is in flight — so [fallback] pulses gently there rather than sitting
/// dead, the same way a skeleton loader would without the weight of a spinner
/// in a 36-pixel avatar.
///
/// Every other state gets the *static* [fallback]. That includes [enabled]
/// being false: "don't load images" is a deliberate, stable choice, not a
/// wait, and the Influencers list sets it on dozens of avatars and banners at
/// once precisely to make the page scroll smoothly — a pulse on every one of
/// them is dozens of opacity layers repainting every frame, which is the
/// opposite of what the switch is for. Flip it back on and the images load
/// then.
class RemoteImage extends ConsumerStatefulWidget {
  const RemoteImage({
    super.key,
    required this.url,
    required this.fallback,
    this.fit = BoxFit.cover,
    this.width,
    this.height,
    this.enabled = true,
  });

  final String? url;

  /// Shown whenever there is no image to show. Built lazily by the caller so a
  /// fallback can be as cheap as a colored box or as rich as an initial.
  final Widget fallback;

  final BoxFit fit;
  final double? width;
  final double? height;

  /// False turns the widget into its fallback without touching disk or
  /// network — what the Influencers list's "don't load images" switch sets.
  final bool enabled;

  @override
  ConsumerState<RemoteImage> createState() => _RemoteImageState();
}

class _RemoteImageState extends ConsumerState<RemoteImage> {
  ImageProvider? _provider;

  /// What [_provider] was resolved for, so a rebuild with the same inputs does
  /// not start the work again and a rebuild with different ones does.
  String? _resolvedFor;
  bool _resolvedAutoDownload = false;
  bool _failed = false;

  @override
  Widget build(BuildContext context) {
    final autoDownload = ref.watch(autoDownloadImagesProvider);
    final rawUrl = widget.url?.trim();

    if (!isUsableImageUrl(rawUrl)) {
      return widget.fallback;
    }

    if (!widget.enabled) {
      return widget.fallback;
    }

    // The largest side this widget is actually drawn at, in device pixels —
    // what both the URL rewrite and the decode below size themselves to.
    // `double.infinity` (a banner's width, filled by its parent) can't be
    // sized from here, so it is treated the same as "unknown".
    final width = widget.width;
    final height = widget.height;
    final devicePixelRatio = MediaQuery.devicePixelRatioOf(context);
    final targetPixelSize = width != null && width.isFinite
        ? (width * devicePixelRatio).round()
        : height != null && height.isFinite
            ? (height * devicePixelRatio).round()
            : null;
    final url = sizedImageUrl(rawUrl!, targetPixelSize);

    if (_resolvedFor != url || _resolvedAutoDownload != autoDownload) {
      _resolvedFor = url;
      _resolvedAutoDownload = autoDownload;
      _provider = null;
      _failed = false;
      _start(url, autoDownload);
    }

    var provider = _provider;
    if (_failed) return widget.fallback;
    if (provider == null) return _PulsingPlaceholder(child: widget.fallback);

    // Decodes at the size the widget is actually drawn at rather than
    // whatever resolution the provider handed back — belt and braces with the
    // URL rewrite above, since a URL that didn't match either pattern (a
    // manually-entered picture, or a local copy cached before this rewrite
    // existed) would otherwise still decode at its original size. `Image`'s
    // own `cacheWidth`/`cacheHeight` only exist on its named constructors
    // (`.network`, `.memory`, ...) that build the provider themselves; this
    // one is handed a provider already, so resizing means wrapping it.
    final cacheWidth = width != null && width.isFinite
        ? (width * devicePixelRatio).round()
        : null;
    final cacheHeight = height != null && height.isFinite
        ? (height * devicePixelRatio).round()
        : null;
    if (cacheWidth != null || cacheHeight != null) {
      provider = ResizeImage(provider, width: cacheWidth, height: cacheHeight);
    }

    return Image(
      image: provider,
      fit: widget.fit,
      width: widget.width,
      height: widget.height,
      // `Image` mounts as soon as `_provider` resolves — not once its bytes
      // are decoded too. Getting the picture on screen from there used to be
      // this widget's own job: hold the placeholder in `_provider == null`,
      // await `precacheImage`, then `setState` so Flutter tears down
      // `_PulsingPlaceholder` and mounts a fresh `Image` in its place. That
      // last step is a widget-type swap timed to our own external `setState`,
      // in a lazily-built list — exactly the kind of update that showed up
      // once the row was scrolled back into view rather than the moment it
      // finished. `frameBuilder` moves the placeholder-to-picture switch
      // inside the one `Image` element instead: it stays mounted from the
      // first resolved frame onward, and Flutter's own image-stream listener
      // — the same one every `Image` in the framework relies on — drives the
      // repaint when a frame actually arrives.
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
        if (wasSynchronouslyLoaded || frame != null) return child;
        return _PulsingPlaceholder(child: widget.fallback);
      },
      // A channel whose avatar 404s gets the fallback rather than a broken
      // image box — the same outcome as never having had one.
      errorBuilder: (context, error, stackTrace) => widget.fallback,
    );
  }

  Future<void> _start(String url, bool autoDownload) async {
    final provider = await RemoteImageResolver.resolve(
      url,
      autoDownload: autoDownload,
    );
    if (!mounted) return;
    // A second resolution may have started while this one was in flight (the
    // row was recycled onto a different channel). Only the newest one may set
    // state, or a fast scroll leaves the wrong picture on the wrong row.
    if (_resolvedFor != url) return;
    setState(() {
      _provider = provider;
      _failed = provider == null;
    });
  }
}

/// Wraps [child] in a slow, gentle opacity pulse so a placeholder reads as
/// "not loaded yet" instead of a dead final box. Only used for states that
/// may still turn into an image — see [RemoteImage]'s doc comment.
class _PulsingPlaceholder extends StatefulWidget {
  const _PulsingPlaceholder({required this.child});

  final Widget child;

  @override
  State<_PulsingPlaceholder> createState() => _PulsingPlaceholderState();
}

class _PulsingPlaceholderState extends State<_PulsingPlaceholder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  late final Animation<double> _opacity = _controller.drive(
    CurveTween(curve: Curves.easeInOut).chain(
      Tween<double>(begin: 1, end: 0.45),
    ),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(opacity: _opacity, child: widget.child);
  }
}
