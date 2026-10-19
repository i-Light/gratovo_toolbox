// Draws the Windows .exe's icon (windows/runner/resources/app_icon.ico) from
// the app's one logo, assets/images/logo.svg.
//
// Run by scripts/build_windows.ps1 before every build:
//
//     flutter test tool/generate_app_icon.dart
//
// It is a "test" only because rendering an SVG needs Flutter's own painting
// engine, and `flutter test` is the way to run Dart code with it outside an
// app. The generated .ico is git-ignored: the SVG is the one source.
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';

const _source = 'assets/images/logo.svg';
const _output = 'windows/runner/resources/app_icon.ico';

/// The sizes packed into the .ico. Windows picks the nearest one for the title
/// bar, taskbar, Alt+Tab and the file explorer.
const _sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];

void main() {
  testWidgets('generate the Windows app icon from the SVG', (tester) async {
    await tester.runAsync(() async {
      final svg = await File(_source).readAsString();
      await File(_output).writeAsBytes(await _renderIco(svg), flush: true);
    });
    expect(File(_output).existsSync(), isTrue);
  });
}

/// Renders [svg] into an .ico with one image per size, fitted inside each
/// square and centred so a non-square logo is never stretched.
Future<Uint8List> _renderIco(String svg) async {
  final info = await vg.loadPicture(SvgStringLoader(svg), null);
  try {
    final pngs = <Uint8List>[];
    for (final size in _sizes) {
      pngs.add(await _renderPng(info, size));
    }
    return _packIco(pngs);
  } finally {
    info.picture.dispose();
  }
}

Future<Uint8List> _renderPng(PictureInfo info, int size) async {
  final recorder = ui.PictureRecorder();
  final longSide = info.size.width > info.size.height
      ? info.size.width
      : info.size.height;
  final scale = size / longSide;
  ui.Canvas(recorder)
    ..translate(
      (size - info.size.width * scale) / 2,
      (size - info.size.height * scale) / 2,
    )
    ..scale(scale)
    ..drawPicture(info.picture);
  final picture = recorder.endRecording();
  final image = await picture.toImage(size, size);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return data!.buffer.asUint8List();
}

/// An .ico is a small directory followed by the images; since Windows Vista
/// each image can simply be a PNG.
Uint8List _packIco(List<Uint8List> pngs) {
  final headerLength = 6 + 16 * pngs.length;
  final total = headerLength + pngs.fold<int>(0, (sum, png) => sum + png.length);
  final bytes = Uint8List(total);
  final view = ByteData.sublistView(bytes);
  view
    ..setUint16(0, 0, Endian.little) // reserved
    ..setUint16(2, 1, Endian.little) // type: icon
    ..setUint16(4, pngs.length, Endian.little);
  var offset = headerLength;
  for (var i = 0; i < pngs.length; i++) {
    final entry = 6 + 16 * i;
    final dimension = _sizes[i] >= 256 ? 0 : _sizes[i]; // 0 means 256
    view
      ..setUint8(entry, dimension)
      ..setUint8(entry + 1, dimension)
      ..setUint16(entry + 4, 1, Endian.little) // colour planes
      ..setUint16(entry + 6, 32, Endian.little) // bits per pixel
      ..setUint32(entry + 8, pngs[i].length, Endian.little)
      ..setUint32(entry + 12, offset, Endian.little);
    bytes.setRange(offset, offset + pngs[i].length, pngs[i]);
    offset += pngs[i].length;
  }
  return bytes;
}
