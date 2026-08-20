import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/widgets.dart';
import 'package:forjd/features/auth/domain/auth_models.dart';
import 'package:forjd/features/profile/application/profile_controller.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _name = TextEditingController();

  ProfileDto? _original;
  DateTime? _dateOfBirth;
  Sex? _sex;
  bool _isSaving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  /// Seeds the form once, from whatever the profile controller already holds. Re-seeding on
  /// every build would overwrite what the user is typing each time the profile refreshes.
  void _seed(ProfileDto? profile) {
    if (_original != null || profile == null) {
      return;
    }

    _original = profile;
    _name.text = profile.displayName ?? '';
    _sex = profile.sex;
    _dateOfBirth = profile.dateOfBirth == null
        ? null
        : DateTime.tryParse(profile.dateOfBirth!);
  }

  /// `YYYY-MM-DD`, built from the local date parts rather than via toIso8601String, which
  /// converts to UTC and can move the date across midnight.
  static String _formatDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  /// Only what actually changed. The API rejects an empty patch, which is right — it just
  /// means "nothing to save" has to be handled here.
  Map<String, dynamic> _patch() {
    final original = _original;
    final patch = <String, dynamic>{};
    final name = _name.text.trim();

    if (name != (original?.displayName ?? '')) {
      patch['displayName'] = name.isEmpty ? null : name;
    }

    final date = _dateOfBirth == null ? null : _formatDate(_dateOfBirth!);
    if (date != original?.dateOfBirth) {
      patch['dateOfBirth'] = date;
    }

    if (_sex != original?.sex) {
      patch['sex'] = _sex?.wire;
    }

    return patch;
  }

  Future<void> _save() async {
    final patch = _patch();

    if (patch.isEmpty) {
      context.go('/profile');
      return;
    }

    setState(() {
      _isSaving = true;
      _error = null;
    });

    final failure = await ref
        .read(profileControllerProvider.notifier)
        .save(patch);

    if (!mounted) {
      return;
    }

    if (failure != null) {
      setState(() {
        _isSaving = false;
        _error = failure.forField('displayName') ?? failure.message;
      });
      return;
    }

    context.go('/profile');
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dateOfBirth ?? DateTime(now.year - 30, now.month, now.day),
      // Nobody training is 120, and nobody is born tomorrow. Bounding the picker makes the
      // API's calendar validation a backstop rather than the first line of defence.
      firstDate: DateTime(now.year - 120),
      lastDate: now,
    );

    if (picked != null && mounted) {
      setState(() => _dateOfBirth = picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(profileControllerProvider);
    _seed(profile.valueOrNull?.profile);

    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ForjdHeader(
              title: 'Edit Profile',
              onBack: () => context.go('/profile'),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppDimens.screenPaddingX,
                  0,
                  AppDimens.screenPaddingX,
                  26,
                ),
                children: [
                  ForjdTextField(
                    label: 'Name',
                    controller: _name,
                    hintText: 'Your name',
                    textInputAction: TextInputAction.done,
                    enabled: !_isSaving,
                  ),
                  const SizedBox(height: 18),
                  const ForjdFieldLabel('Birthday'),
                  const SizedBox(height: 7),
                  _DateField(
                    value: _dateOfBirth == null
                        ? null
                        : _formatDate(_dateOfBirth!),
                    onTap: _isSaving ? null : _pickDate,
                  ),
                  const SizedBox(height: 18),
                  const ForjdFieldLabel('Sex'),
                  const SizedBox(height: 7),
                  // Four options, though the design draws three. `other` is a value the API
                  // accepts, so a UI that cannot produce or show it would render blank for
                  // anyone who set it elsewhere.
                  ForjdChips<Sex>(
                    values: Sex.values,
                    selected: _sex,
                    labelOf: (sex) => sex.label,
                    onSelected: (sex) => setState(() => _sex = sex),
                  ),
                  ForjdInlineError(_error),
                  const SizedBox(height: 26),
                  ForjdButton(
                    label: 'Save Changes',
                    isLoading: _isSaving,
                    onPressed: _save,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A read-only field that opens the date picker. Not a [ForjdTextField]: a free-text
/// birthday invites formats the API will reject.
class _DateField extends StatelessWidget {
  const _DateField({required this.value, required this.onTap});

  final String? value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: value == null ? 'Set birthday' : 'Birthday, $value',
    excludeSemantics: true,
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppDimens.fieldRadius),
      child: Container(
        height: AppDimens.controlHeight,
        padding: const EdgeInsets.symmetric(
          horizontal: AppDimens.fieldPaddingX,
        ),
        decoration: BoxDecoration(
          color: AppColors.fieldBg,
          borderRadius: BorderRadius.circular(AppDimens.fieldRadius),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                value ?? 'Not set',
                style: value == null
                    ? AppText.input.copyWith(color: AppColors.placeholder)
                    : AppText.input,
              ),
            ),
            const ForjdIcon('clock', size: AppDimens.iconSizeSmall),
          ],
        ),
      ),
    ),
  );
}
