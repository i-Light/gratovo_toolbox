import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One team member's face: a colored initial (or a plain "unassigned" mark)
/// plus their name. The shared visual between [OwnerPicker]'s dropdown items
/// and [OwnerChip]'s read-only display, so the two never drift apart.
class _OwnerFace extends StatelessWidget {
  const _OwnerFace({required this.name, required this.color});

  final String name;

  /// Null for the "Unassigned" slot, which has no team member and so no
  /// color of its own.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final avatarColor = color ?? Theme.of(context).colorScheme.outlineVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 9,
          backgroundColor: avatarColor,
          child: color == null
              ? const Icon(Icons.person_off_outlined,
                  size: 11, color: Colors.white)
              : Text(
                  name.characters.take(1).toString().toUpperCase(),
                  style: const TextStyle(color: Colors.white, fontSize: 10),
                ),
        ),
        const SizedBox(width: 6),
        Flexible(child: Text(name, overflow: TextOverflow.ellipsis)),
      ],
    );
  }
}

/// Editable "who owns this" control: a dropdown of everyone in
/// [teamMembersProvider] plus an "Unassigned" option, each shown as their
/// name in their own color.
///
/// Purely a picker — it does not know whether it is assigning a [Deal] or an
/// [Influencer], or how to write the choice back. The caller passes the
/// entity's current [ownerId] and an [onChanged] that performs the write
/// (`updateOwner` on the relevant repository) and bumps whatever
/// `DataDomain` that entity lives on; see `deal_detail_screen.dart` and
/// `influencer_profile_screen.dart` for the two call sites.
class OwnerPicker extends ConsumerWidget {
  const OwnerPicker({
    super.key,
    required this.ownerId,
    required this.onChanged,
  });

  /// The entity's current owner, or null when unassigned.
  final String? ownerId;

  /// Called with the newly picked team member's id, or null for
  /// "Unassigned". Never called again with the value it was just given.
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final membersAsync = ref.watch(teamMembersProvider);

    return membersAsync.when(
      loading: () => const SizedBox(
        height: 20,
        width: 20,
        child: Padding(
          padding: EdgeInsets.all(2),
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
      // The picker degrades to nothing rather than an error box — losing the
      // ability to reassign ownership for a moment is a minor thing, and this
      // is exactly the situation [OwnerChip] below is for on read-only
      // surfaces that don't need to render the interactive control at all.
      error: (error, stackTrace) => const SizedBox.shrink(),
      data: (members) {
        final sortedMembers = members.values.toList()
          ..sort((a, b) => a.displayName
              .toLowerCase()
              .compareTo(b.displayName.toLowerCase()));
        // An id that no longer resolves to a member (a removed teammate)
        // falls back to the "Unassigned" slot rather than crashing the
        // dropdown on a value it has no item for.
        final resolvedValue =
            ownerId != null && members.containsKey(ownerId) ? ownerId : null;

        return DropdownButtonHideUnderline(
          child: DropdownButton<String?>(
            value: resolvedValue,
            onChanged: (value) {
              if (value == resolvedValue) return;
              onChanged(value);
            },
            items: [
              DropdownMenuItem<String?>(
                value: null,
                child:
                    _OwnerFace(name: l10n.ownerPickerUnassigned, color: null),
              ),
              for (final member in sortedMembers)
                DropdownMenuItem<String?>(
                  value: member.id,
                  child:
                      _OwnerFace(name: member.displayName, color: member.color),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// Read-only "who owns this" display for list rows and cards, where a full
/// dropdown would be the wrong affordance. Shows the same face [OwnerPicker]
/// shows for the current owner, or "Unassigned" when [ownerId] is null or
/// doesn't resolve to a known team member.
class OwnerChip extends ConsumerWidget {
  const OwnerChip({super.key, required this.ownerId});

  final String? ownerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final membersAsync = ref.watch(teamMembersProvider);
    final member = membersAsync.maybeWhen(
      data: (members) => ownerId == null ? null : members[ownerId],
      orElse: () => null,
    );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: (member?.color ?? Theme.of(context).colorScheme.outlineVariant)
            .withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
      ),
      child: _OwnerFace(
        name: member?.displayName ?? l10n.ownerPickerUnassigned,
        color: member?.color,
      ),
    );
  }
}
