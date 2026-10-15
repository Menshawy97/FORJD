package expo.modules.forjdhealthrationale

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle

// docs/product/health-connect-privacy-link-plan.md. Opened by Health Connect's "privacy policy" link.
// Shows the same policy given to Play Console (src/legal/links.ts PRIVACY_POLICY_URL, kept equal by
// config/__tests__/health-rationale-manifest.test.ts) in the browser, then closes, so nothing of
// FORJD flashes or stays in the back stack.
class HealthPermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_POLICY_URL)))
    } catch (e: ActivityNotFoundException) {
      // No browser on the phone: nothing to show, so just close rather than crash.
    }
    finish()
  }

  private companion object {
    const val PRIVACY_POLICY_URL = "https://getforjd.com/privacy"
  }
}
