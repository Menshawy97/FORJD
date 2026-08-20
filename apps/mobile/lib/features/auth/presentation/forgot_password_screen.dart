import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/widgets.dart';
import 'package:forjd/features/auth/application/auth_controller.dart';

/// Requests a password-reset email.
///
/// Only the request half of the flow exists. The emailed link carries a recovery token the
/// app has no deep-link handler for yet, so the journey deliberately ends here and the user
/// finishes in a browser. See the roadmap's follow-ups.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();

  bool _isSending = false;
  bool _isSent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();

    if (email.isEmpty) {
      setState(() => _error = 'Enter the email you signed up with.');
      return;
    }

    setState(() {
      _isSending = true;
      _error = null;
    });

    final failure = await ref
        .read(authControllerProvider.notifier)
        .requestPasswordReset(email);

    if (!mounted) {
      return;
    }

    setState(() {
      _isSending = false;
      // Success here means "the server accepted the request". It deliberately does not mean
      // an account exists — the API answers identically either way, and surfacing a
      // difference would rebuild the enumeration oracle the endpoint exists to avoid.
      _isSent = failure == null;
      _error = failure?.message;
    });
  }

  @override
  Widget build(BuildContext context) {
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
              child: ForjdBackButton(onPressed: () => context.go('/login')),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  AppDimens.screenPaddingX,
                  26,
                  AppDimens.screenPaddingX,
                  26,
                ),
                child: _isSent ? _sentPanel() : _form(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _form() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('Reset password', style: AppText.h1Auth),
      const SizedBox(height: 9),
      const Text(
        "Enter your email and we'll send you a reset link.",
        style: AppText.body,
      ),
      const SizedBox(height: 26),
      ForjdTextField(
        label: 'Email',
        controller: _email,
        hintText: 'you@email.com',
        keyboardType: TextInputType.emailAddress,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _submit(),
        autofillHints: const [AutofillHints.email],
        enabled: !_isSending,
      ),
      ForjdInlineError(_error),
      const SizedBox(height: 26),
      ForjdButton(
        label: 'Send reset link',
        isLoading: _isSending,
        onPressed: _submit,
      ),
    ],
  );

  Widget _sentPanel() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const SizedBox(height: 40),
      const ForjdIcon('check', color: AppColors.green, size: 36),
      const SizedBox(height: 20),
      const Text('Check your email', style: AppText.h1Auth),
      const SizedBox(height: 9),
      Text(
        'If ${_email.text.trim()} has an account, a reset link is on its way. '
        'Open it in your browser to choose a new password, then come back and '
        'log in.',
        style: AppText.body,
      ),
      const SizedBox(height: 26),
      ForjdButton(
        label: 'Back to log in',
        kind: ForjdButtonKind.ghost,
        onPressed: () => context.go('/login'),
      ),
    ],
  );
}
