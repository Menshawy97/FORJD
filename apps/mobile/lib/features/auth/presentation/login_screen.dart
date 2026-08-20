import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/widgets.dart';
import 'package:forjd/features/auth/application/auth_controller.dart';
import 'package:forjd/features/auth/domain/auth_state.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();

  /// Client-side "you left something blank". Anything the server rejects arrives through
  /// AuthState instead — the two never describe the same failure.
  String? _localError;

  @override
  void initState() {
    super.initState();

    // A failure from an earlier attempt — possibly from a different screen — must not
    // greet someone who has just opened this form. Deferred to after the first frame
    // because a provider cannot be written during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        ref.read(authControllerProvider.notifier).clearFailure();
      }
    });
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    final password = _password.text;

    if (email.isEmpty || password.isEmpty) {
      setState(() => _localError = 'Enter your email and password.');
      return;
    }

    setState(() => _localError = null);
    await ref
        .read(authControllerProvider.notifier)
        .login(email: email, password: password);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authControllerProvider);
    final isBusy = state is AuthAuthenticating;
    final serverError = state is AuthUnauthenticated
        ? state.failure?.message
        : null;

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
                    const Text('Welcome back', style: AppText.h1Auth),
                    const SizedBox(height: 9),
                    const Text(
                      'Log in to continue your training.',
                      style: AppText.body,
                    ),
                    const SizedBox(height: 26),
                    ForjdTextField(
                      label: 'Email',
                      controller: _email,
                      hintText: 'you@email.com',
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.email],
                      enabled: !isBusy,
                    ),
                    const SizedBox(height: AppDimens.fieldGap),
                    ForjdTextField(
                      label: 'Password',
                      controller: _password,
                      hintText: '••••••••',
                      obscure: true,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _submit(),
                      autofillHints: const [AutofillHints.password],
                      enabled: !isBusy,
                    ),
                    const SizedBox(height: 14),
                    GestureDetector(
                      onTap: () => context.go('/forgot-password'),
                      child: const Text(
                        'Forgot password?',
                        style: AppText.link,
                      ),
                    ),
                    ForjdInlineError(_localError ?? serverError),
                    const SizedBox(height: 26),
                    ForjdButton(
                      label: 'Log In',
                      isLoading: isBusy,
                      onPressed: _submit,
                    ),
                    const SizedBox(height: 20),
                    Center(
                      child: GestureDetector(
                        onTap: () => context.go('/register'),
                        child: Text.rich(
                          TextSpan(
                            text: 'No account? ',
                            style: AppText.custom(
                              fontSize: 12.5,
                              color: AppColors.dimmer,
                              height: 1,
                            ),
                            children: const [
                              TextSpan(
                                text: 'Create one',
                                style: TextStyle(
                                  color: AppColors.accent,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
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
