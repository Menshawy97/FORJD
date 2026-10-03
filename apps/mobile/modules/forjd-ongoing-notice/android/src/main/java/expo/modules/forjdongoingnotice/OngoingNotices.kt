package expo.modules.forjdongoingnotice

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

internal data class NoticeAction(val id: String, val title: String, val opensApp: Boolean)

internal data class NoticeContent(
  val title: String,
  val text: String,
  val subText: String?,
  val countDownToMs: Long?,
  val countUpFromMs: Long?,
  val actions: List<NoticeAction>,
)

internal data class Notice(
  val id: String,
  val channelId: String,
  val channelName: String,
  val color: String,
  val isPrivate: Boolean,
  val content: NoticeContent,
)

/**
 * ADR-063. Posts, replaces and removes the ongoing notices; everything Android-specific is here.
 *
 * - **The chronometer** is drawn and ticked by Android (`setUsesChronometer`), so it stays exact with the
 *   screen off and the app asleep. A countdown times out at zero (`setTimeoutAfter`) and an alarm posts
 *   its `then` content in its place, from this process alone, so no timer ever runs below zero.
 * - **Taps** go to [OngoingNoticeReceiver] (acting without opening the app) or, for `opensApp`, start the
 *   app's launch activity with the tap in its intent. Either way they reach JavaScript through
 *   [ForjdOngoingNoticeModule.deliver], or wait in [PendingActions] until it listens.
 * - **Quiet:** a low-importance channel and `setOnlyAlertOnce`, so updating in place never sounds or pops up.
 */
internal object OngoingNotices {
  private const val PREFIX = "expo.modules.forjdongoingnotice"
  const val ACTION_TAP = "$PREFIX.TAP"
  const val ACTION_EXPIRE = "$PREFIX.EXPIRE"
  const val ACTION_DELETED = "$PREFIX.DELETED"
  const val EXTRA_NOTICE_ID = "$PREFIX.NOTICE_ID"
  const val EXTRA_ACTION_ID = "$PREFIX.ACTION_ID"
  private const val EXTRA_NOTICE = "$PREFIX.NOTICE"
  private const val EXTRA_COUNT_DOWN_TO = "$PREFIX.COUNT_DOWN_TO"

  /** Every notice is posted with its id as the tag, so two ids never collide through a hash. */
  private const val NOTIFICATION_NUMBER = 0x0F0D

  /** A removal this close to zero is the countdown's own timeout, not the person swiping it away. */
  private const val TIMEOUT_GRACE_MS = 1_000L

  private val ember = Color.parseColor("#E9712F")

  fun show(context: Context, notice: Notice, then: NoticeContent?): Boolean {
    cancelExpiry(context, notice.id)
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    if (!manager.areNotificationsEnabled()) return false
    ensureChannel(manager, notice)
    manager.notify(notice.id, NOTIFICATION_NUMBER, build(context, notice))
    val endsAt = notice.content.countDownToMs
    if (then != null && endsAt != null) scheduleExpiry(context, notice.copy(content = then), endsAt)
    return true
  }

  fun dismiss(context: Context, id: String) {
    cancelExpiry(context, id)
    context.getSystemService(NotificationManager::class.java)?.cancel(id, NOTIFICATION_NUMBER)
  }

  /** The tap an `opensApp` action put in the activity's intent, removed so it is delivered once. */
  fun takeTap(intent: Intent?): Pair<String, String>? {
    val noticeId = intent?.getStringExtra(EXTRA_NOTICE_ID) ?: return null
    val actionId = intent.getStringExtra(EXTRA_ACTION_ID) ?: return null
    intent.removeExtra(EXTRA_NOTICE_ID)
    intent.removeExtra(EXTRA_ACTION_ID)
    return noticeId to actionId
  }

  /** The countdown reached zero: post what follows it. Runs from the alarm, without JavaScript. */
  fun expire(context: Context, intent: Intent) {
    val notice = intent.getBundleExtra(EXTRA_NOTICE)?.let(::noticeFrom) ?: return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (!manager.areNotificationsEnabled()) return
    ensureChannel(manager, notice)
    manager.notify(notice.id, NOTIFICATION_NUMBER, build(context, notice))
  }

  /** Swiped away (Android 14 allows it for ongoing notices): the follow-up must not bring it back. */
  fun deleted(context: Context, intent: Intent) {
    val noticeId = intent.getStringExtra(EXTRA_NOTICE_ID) ?: return
    val countDownTo = intent.getLongExtra(EXTRA_COUNT_DOWN_TO, Long.MAX_VALUE)
    if (System.currentTimeMillis() < countDownTo - TIMEOUT_GRACE_MS) cancelExpiry(context, noticeId)
  }

  private fun ensureChannel(manager: NotificationManager, notice: Notice) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (manager.getNotificationChannel(notice.channelId) != null) return
    val channel = NotificationChannel(notice.channelId, notice.channelName, NotificationManager.IMPORTANCE_LOW).apply {
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  @Suppress("DEPRECATION")
  private fun build(context: Context, notice: Notice): Notification {
    val content = notice.content
    val icon = smallIcon(context)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, notice.channelId)
    } else {
      Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
    }
    builder
      .setSmallIcon(icon)
      .setColor(parseColor(notice.color))
      .setContentTitle(content.title)
      .setContentText(content.text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setAutoCancel(false)
      .setVisibility(if (notice.isPrivate) Notification.VISIBILITY_PRIVATE else Notification.VISIBILITY_PUBLIC)
      .setDeleteIntent(deleteIntent(context, notice))
    launchIntent(context, notice.id, null)?.let { builder.setContentIntent(it) }
    content.subText?.let { builder.setSubText(it) }

    val countDownTo = content.countDownToMs
    val countUpFrom = content.countUpFromMs
    when {
      countDownTo != null -> {
        builder.setUsesChronometer(true).setChronometerCountDown(true).setWhen(countDownTo).setShowWhen(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          builder.setTimeoutAfter((countDownTo - System.currentTimeMillis()).coerceAtLeast(1L))
        }
      }
      countUpFrom != null -> builder.setUsesChronometer(true).setWhen(countUpFrom).setShowWhen(true)
      else -> builder.setShowWhen(false)
    }

    content.actions.forEach { action ->
      val pending = if (action.opensApp) {
        launchIntent(context, notice.id, action.id)
      } else {
        val tap = Intent(context, OngoingNoticeReceiver::class.java).setAction(ACTION_TAP)
          .putExtra(EXTRA_NOTICE_ID, notice.id)
          .putExtra(EXTRA_ACTION_ID, action.id)
        broadcast(context, tap, "tap/${notice.id}/${action.id}")
      }
      builder.addAction(Notification.Action.Builder(Icon.createWithResource(context, icon), action.title, pending).build())
    }
    return builder.build()
  }

  /** The FORJD symbol `expo-notifications` generates from `app.config.ts`, else the app's own icon. */
  private fun smallIcon(context: Context): Int {
    val generated = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (generated != 0) generated else context.applicationInfo.icon
  }

  private fun parseColor(color: String): Int = try {
    Color.parseColor(color)
  } catch (_: IllegalArgumentException) {
    ember
  }

  /** Opens the app; with an action id, the tap travels in the intent (see `takeTap`). */
  private fun launchIntent(context: Context, noticeId: String, actionId: String?): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (actionId != null) intent.putExtra(EXTRA_NOTICE_ID, noticeId).putExtra(EXTRA_ACTION_ID, actionId)
    return PendingIntent.getActivity(context, requestCode("open/$noticeId/${actionId.orEmpty()}"), intent, flags())
  }

  private fun deleteIntent(context: Context, notice: Notice): PendingIntent {
    val intent = Intent(context, OngoingNoticeReceiver::class.java).setAction(ACTION_DELETED)
      .putExtra(EXTRA_NOTICE_ID, notice.id)
      .putExtra(EXTRA_COUNT_DOWN_TO, notice.content.countDownToMs ?: Long.MAX_VALUE)
    return broadcast(context, intent, "deleted/${notice.id}")
  }

  private fun scheduleExpiry(context: Context, next: Notice, atMs: Long) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val pending = expiryIntent(context, next.id, next)
    // Exact when the app may (Android 12+ needs a permission this app does not request); otherwise
    // allowed while idle, which Android may delay a little. The countdown's own timeout covers the gap.
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    if (exact) {
      alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
    } else {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
    }
  }

  private fun cancelExpiry(context: Context, noticeId: String) {
    context.getSystemService(AlarmManager::class.java)?.cancel(expiryIntent(context, noticeId, null))
  }

  private fun expiryIntent(context: Context, noticeId: String, next: Notice?): PendingIntent {
    val intent = Intent(context, OngoingNoticeReceiver::class.java).setAction(ACTION_EXPIRE)
    next?.let { intent.putExtra(EXTRA_NOTICE, bundleOf(it)) }
    return broadcast(context, intent, "expire/$noticeId")
  }

  private fun broadcast(context: Context, intent: Intent, key: String): PendingIntent =
    PendingIntent.getBroadcast(context, requestCode(key), intent, flags())

  private fun requestCode(key: String): Int = key.hashCode()

  private fun flags(): Int = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  private fun bundleOf(notice: Notice): Bundle = Bundle().apply {
    putString("id", notice.id)
    putString("channelId", notice.channelId)
    putString("channelName", notice.channelName)
    putString("color", notice.color)
    putBoolean("isPrivate", notice.isPrivate)
    putString("title", notice.content.title)
    putString("text", notice.content.text)
    putString("subText", notice.content.subText)
    notice.content.countUpFromMs?.let { putLong("countUpFromMs", it) }
    putStringArray("actionIds", notice.content.actions.map { it.id }.toTypedArray())
    putStringArray("actionTitles", notice.content.actions.map { it.title }.toTypedArray())
    putBooleanArray("actionOpensApp", notice.content.actions.map { it.opensApp }.toBooleanArray())
  }

  private fun noticeFrom(bundle: Bundle): Notice? {
    val id = bundle.getString("id") ?: return null
    val channelId = bundle.getString("channelId") ?: return null
    val channelName = bundle.getString("channelName") ?: return null
    val color = bundle.getString("color") ?: return null
    val title = bundle.getString("title") ?: return null
    val ids = bundle.getStringArray("actionIds") ?: emptyArray()
    val titles = bundle.getStringArray("actionTitles") ?: emptyArray()
    val opensApp = bundle.getBooleanArray("actionOpensApp") ?: BooleanArray(0)
    if (titles.size != ids.size || opensApp.size != ids.size) return null
    return Notice(
      id = id,
      channelId = channelId,
      channelName = channelName,
      color = color,
      isPrivate = bundle.getBoolean("isPrivate"),
      content = NoticeContent(
        title = title,
        text = bundle.getString("text").orEmpty(),
        subText = bundle.getString("subText"),
        countDownToMs = null,
        countUpFromMs = if (bundle.containsKey("countUpFromMs")) bundle.getLong("countUpFromMs") else null,
        actions = ids.indices.map { NoticeAction(ids[it], titles[it], opensApp[it]) },
      ),
    )
  }
}

/** Taps that act without opening the app, the countdown's follow-up, and swipes. Not exported. */
class OngoingNoticeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      OngoingNotices.ACTION_TAP -> {
        val noticeId = intent.getStringExtra(OngoingNotices.EXTRA_NOTICE_ID) ?: return
        val actionId = intent.getStringExtra(OngoingNotices.EXTRA_ACTION_ID) ?: return
        ForjdOngoingNoticeModule.deliver(context, noticeId, actionId)
      }
      OngoingNotices.ACTION_EXPIRE -> OngoingNotices.expire(context, intent)
      OngoingNotices.ACTION_DELETED -> OngoingNotices.deleted(context, intent)
    }
  }
}

/**
 * Taps made while JavaScript was not listening (the app was stopped, or not yet started), kept on disk
 * until `takePendingActions`. Bounded, so a forgotten notice cannot grow it without limit. Holds ids only.
 */
internal object PendingActions {
  private const val PREFERENCES = "expo.modules.forjdongoingnotice.pending"
  private const val KEY = "actions"
  private const val MAX = 20

  @Synchronized
  fun add(context: Context, noticeId: String, actionId: String) {
    write(context, read(context).takeLast(MAX - 1) + (noticeId to actionId))
  }

  @Synchronized
  fun take(context: Context): List<Pair<String, String>> {
    val pending = read(context)
    if (pending.isNotEmpty()) write(context, emptyList())
    return pending
  }

  private fun read(context: Context): List<Pair<String, String>> {
    val raw = preferences(context).getString(KEY, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { index ->
        val item = array.optJSONObject(index)
        val noticeId = item?.optString("noticeId").orEmpty()
        val actionId = item?.optString("actionId").orEmpty()
        if (noticeId.isEmpty() || actionId.isEmpty()) null else noticeId to actionId
      }
    } catch (_: JSONException) {
      emptyList()
    }
  }

  private fun write(context: Context, actions: List<Pair<String, String>>) {
    val array = JSONArray()
    actions.forEach { (noticeId, actionId) -> array.put(JSONObject().put("noticeId", noticeId).put("actionId", actionId)) }
    preferences(context).edit().putString(KEY, array.toString()).commit()
  }

  private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
}
