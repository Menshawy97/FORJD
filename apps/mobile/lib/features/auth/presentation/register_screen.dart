import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/widgets.dart';
import 'package:forjd/features/auth/application/auth_controller.dart';
import 'package:forjd/features/auth/domain/auth_state.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _showEmptyFieldError = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final email = _email.text.trim();
    final password = _password.text;

    // The screen requires a name; the wire contract makes it optional so a client predating
    // the field keeps working. The asymmetry is deliberate — do not "fix" one to match.
    if (name.isEmpty || email.isEmpty || password.isEmpty) {
      setState(() => _showEmptyFieldError = true);
      return;
    }

    setState(() => _showEmptyFieldError = false);
    await ref
        .read(authControllerProvider.notifier)
        .register(email: email, password: password, displayName: name);
  }

  /// Marks a field that was left blank. Empty string, not a message: the form shows one
  /// summary line rather than repeating "required" three times.
  String? _blankMarker(bool isBlank) =>
      _showEmptyFieldError && isBlank ? '' : null;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authControllerProvider);

    if (state is AuthNeedsEmailConfirmation) {
      return _ConfirmEmailPanel(email: state.email);
    }

    final isBusy = state is AuthAuthenticating;
    final serverError = state is AuthUnauthenticated
        ? state.failure?.message
        : null;
    final localError = _showEmptyFieldError ? 'All fields are required.' : null;

    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppDimens.screenPaddingX - 14,
              ),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: AppColors.border)),
              ),
              child: ForjdBackButton(onPressed: () => context.go('/welcome')),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  AppDimens.screenPaddingX,
                  26,
                  AppDimens.screenPaddingX,
                  26,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Create account', style: AppText.h1Auth),
                    const SizedBox(height: 9),
                    const Text(
                      'Start tracking everything in one place.',
                      style: AppText.body,
                    ),
                    const SizedBox(height: 26),
                    ForjdTextField(
                      label: 'Full name',
                      controller: _name,
                      hintText: 'Your name',
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.name],
                      errorText: _blankMarker(_name.text.trim().isEmpty),
                      enabled: !isBusy,
                    ),
                    const SizedBox(height: AppDimens.fieldGap),
                    ForjdTextField(
                      label: 'Email',
                      controller: _email,
                      hintText: 'you@email.com',
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.email],
                      errorText: _blankMarker(_email.text.trim().isEmpty),
                      enabled: !isBusy,
                    ),
                    const SizedBox(height: AppDimens.fieldGap),
                    ForjdTextField(
                      label: 'Password',
                      controller: _password,
                      hintText: 'Min. 8 characters',
                      obscure: true,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _submit(),
                      autofillHints: const [AutofillHints.newPassword],
                      errorText: _blankMarker(_password.text.isEmpty),
                      enabled: !isBusy,
                    ),
                    ForjdInlineError(localError ?? serverError),
                    const SizedBox(height: 22),
                    ForjdButton(
                      label: 'Create Account',
                      isLoading: isBusy,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: 18),
                    const Center(
                      child: Text(
                        'By creating an account you agree to our Terms of '
                        'Service and Privacy Policy.',
                        textAlign: TextAlign.center,
                        style: AppText.legal,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shown when registration succeeded but issued no session.
///
/// An addition to the design, not a transcription of it: the contract makes the session
/// nullable and forjd-dev returns null, so without this the app would look like it had
/// failed at the exact moment it succeeded.
class _ConfirmEmailPanel extends ConsumerWidget {
  const _ConfirmEmailPanel({required this.email});

  final String email;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppDimens.screenPaddingX),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const ForjdIcon('check', color: AppColors.green, size: 36),
            const SizedBox(height: 20),
            const Text('Check your inbox', style: AppText.h1Auth),
            const SizedBox(height: 9),
            Text(
              'We sent a confirmation link to $email. Open it to finish setting '
              'up your account, then log in.',
              style: AppText.body,
            ),
            const SizedBox(height: 26),
            ForjdButton(
              label: 'Back to log in',
              kind: ForjdButtonKind.ghost,
              onPressed: () {
                // Must come first. The router pins the awaiting-confirmation state to
                // /register, so navigating without clearing it bounces straight back here.
                ref
                    .read(authControllerProvider.notifier)
                    .dismissEmailConfirmation();
                context.go('/login');
              },
            ),
          ],
        ),
      ),
    ),
  );
}
