import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gratovo_toolbox/core/time/calendar_date_format.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// A whole moment as five spin boxes — `4-Fri  9-Sep  26   16:23`.
///
/// The same pointing task the email library's `VideoDateField` and
/// `TimecodeField` make of a date and a timecode, extended to cover both
/// halves at once: scroll the wheel over a box, or arrow-key it once it has
/// focus. Nothing here is typed. A moment being *chosen* — when to chase this
/// up — is picked by nudging the part that is wrong, not keyed in, and every
/// box that cannot be typed into is a box with no half-entered state to
/// validate, no formatter, and no caret to fight.
///
/// The day box carries its weekday and the month box its name for the same
/// reason the video-date field does: the number is the thing you scroll to,
/// and the name is how you confirm you landed where you meant to. "Chase this
/// on the 12th" is a different decision once the box says `12-Sun`.
///
/// [value] and everything handed back through [onChanged] are **local wall
/// clock** times — the thing a person points at on a clock on the wall. The
/// caller converts with `.toUtc()` before storing or transporting it, exactly
/// as `pickDateTime` requires.
class QuickDateTimeField extends StatelessWidget {
  const QuickDateTimeField({
    super.key,
    required this.value,
    required this.onChanged,
    this.notBefore,
  });

  /// The moment currently shown, as a local wall clock.
  final DateTime value;

  final ValueChanged<DateTime> onChanged;

  /// Inclusive floor. A spin that would land before it lands *on* it instead,
  /// rather than being refused: a wheel that stops dead reads as broken, and
  /// the bound itself is the moment the person was reaching for.
  ///
  /// Callers scheduling something pass the start of today, not "now" — 09:00
  /// this morning is a perfectly sensible thing to point at while setting a
  /// reminder, and yesterday is not.
  final DateTime? notBefore;

  DateTime _clamped(DateTime next) {
    final floor = notBefore;
    return floor != null && next.isBefore(floor) ? floor : next;
  }

  void _bumpDays(int delta) => onChanged(
        _clamped(
          DateTime(
            value.year,
            value.month,
            value.day + delta,
            value.hour,
            value.minute,
          ),
        ),
      );

  /// A month step keeps the day where it can. The 31st a month before April is
  /// 31 March, and a month after it is 30 April — not 1 May, which is what
  /// letting [DateTime] roll the overflow would produce.
  void _bumpMonths(int delta) {
    final month = value.month + delta;
    final lastDay = DateTime(value.year, month + 1, 0).day;
    onChanged(
      _clamped(
        DateTime(
          value.year,
          month,
          value.day > lastDay ? lastDay : value.day,
          value.hour,
          value.minute,
        ),
      ),
    );
  }

  /// Same rule a year at a time, which is what keeps 29 February from becoming
  /// 1 March on the way out of a leap year.
  void _bumpYears(int delta) {
    final year = value.year + delta;
    final lastDay = DateTime(year, value.month + 1, 0).day;
    onChanged(
      _clamped(
        DateTime(
          year,
          value.month,
          value.day > lastDay ? lastDay : value.day,
          value.hour,
          value.minute,
        ),
      ),
    );
  }

  void _bumpHours(int delta) => onChanged(
        _clamped(
          DateTime(
            value.year,
            value.month,
            value.day,
            value.hour + delta,
            value.minute,
          ),
        ),
      );

  void _bumpMinutes(int delta) => onChanged(
        _clamped(
          DateTime(
            value.year,
            value.month,
            value.day,
            value.hour,
            value.minute + delta,
          ),
        ),
      );

  static String _two(int value) => value.toString().padLeft(2, '0');

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toString();

    return Tooltip(
      message: l10n.commonSpinHint,
      waitDuration: const Duration(milliseconds: 700),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _SpinBox(
            key: const ValueKey('quickDateTime.day'),
            text: formatDayLabel(value, locale),
            semanticsLabel: l10n.commonDay,
            onBump: _bumpDays,
          ),
          const SizedBox(width: 4),
          _SpinBox(
            key: const ValueKey('quickDateTime.month'),
            text: formatShortMonthLabel(value.month, locale),
            semanticsLabel: l10n.commonMonth,
            onBump: _bumpMonths,
          ),
          const SizedBox(width: 4),
          _SpinBox(
            key: const ValueKey('quickDateTime.year'),
            text: _two(value.year % 100),
            semanticsLabel: l10n.commonYear,
            onBump: _bumpYears,
          ),
          const SizedBox(width: 10),
          _SpinBox(
            key: const ValueKey('quickDateTime.hour'),
            text: _two(value.hour),
            semanticsLabel: l10n.commonHour,
            onBump: _bumpHours,
          ),
          const _Colon(),
          _SpinBox(
            key: const ValueKey('quickDateTime.minute'),
            text: _two(value.minute),
            semanticsLabel: l10n.commonMinute,
            onBump: _bumpMinutes,
          ),
        ],
      ),
    );
  }
}

class _Colon extends StatelessWidget {
  const _Colon();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Text(
        ':',
        style: theme.textTheme.titleMedium
            ?.copyWith(color: theme.colorScheme.outline),
      ),
    );
  }
}

/// One box: a value you scroll. Focusable so the arrow keys reach it, and a
/// tap moves focus there so the next key press lands on the box you meant.
class _SpinBox extends StatefulWidget {
  const _SpinBox({
    super.key,
    required this.text,
    required this.semanticsLabel,
    required this.onBump,
  });

  final String text;
  final String semanticsLabel;

  /// +1 for a notch up (later), -1 for a notch down.
  final ValueChanged<int> onBump;

  @override
  State<_SpinBox> createState() => _SpinBoxState();
}

class _SpinBoxState extends State<_SpinBox> {
  final _node = FocusNode();

  @override
  void dispose() {
    _node.dispose();
    super.dispose();
  }

  /// Claims the wheel event for this box so a spin does not also scroll the
  /// composer out from under the pointer. The resolver is the right tool: it
  /// hands the event to exactly one claimant, so a box inside a scroll view
  /// wins the events over it without disabling the scrolling around it.
  void _onPointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    final dy = event.scrollDelta.dy;
    if (dy == 0) return;
    GestureBinding.instance.pointerSignalResolver.register(
      event,
      (_) => widget.onBump(dy < 0 ? 1 : -1),
    );
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      widget.onBump(1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      widget.onBump(-1);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final focused = _node.hasFocus;

    return Listener(
      onPointerSignal: _onPointerSignal,
      child: Focus(
        focusNode: _node,
        onKeyEvent: _onKey,
        onFocusChange: (_) => setState(() {}),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _node.requestFocus,
          child: Container(
            height: 40,
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(4),
              border: Border.all(
                color: focused
                    ? theme.colorScheme.primary
                    : theme.colorScheme.outline,
                width: focused ? 2 : 1,
              ),
            ),
            child: Semantics(
              label: widget.semanticsLabel,
              child: Text(
                widget.text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
