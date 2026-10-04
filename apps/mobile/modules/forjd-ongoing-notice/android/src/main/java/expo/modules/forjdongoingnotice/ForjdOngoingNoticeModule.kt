package expo.modules.forjdongoingnotice

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * ADR-063: an ongoing lock-screen notice whose time Android ticks itself (a chronometer), which
 * `expo-notifications` cannot draw. JavaScript reaches it only through
 * `src/integrations/notifications/ongoing-notice.ts`, which validates every option first. The behaviour
 * lives in `OngoingNotices.kt`; this file is the bridge.
 */
class ForjdOngoingNoticeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ForjdOngoingNotice")

    Events(ON_ACTION)

    OnCreate {
      instance = this@ForjdOngoingNoticeModule
      consumeIntent(appContext.currentActivity?.intent)
    }

    OnDestroy {
      if (instance === this@ForjdOngoingNoticeModule) {
        instance = null
        listening = false
      }
    }

    OnStartObserving(ON_ACTION) { listening = true }

    OnStopObserving(ON_ACTION) { listening = false }

    // An `opensApp` action starts or resumes the app's activity with the tap in its intent.
    OnNewIntent { intent -> consumeIntent(intent) }

    OnActivityEntersForeground { consumeIntent(appContext.currentActivity?.intent) }

    AsyncFunction("show") { options: ShowOptions ->
      OngoingNotices.show(context, options.toNotice(), options.then?.toContent())
    }

    Function("dismiss") { id: String ->
      OngoingNotices.dismiss(context, id)
    }

    Function("takePendingActions") {
      PendingActions.take(context).map { (noticeId, actionId) -> mapOf("noticeId" to noticeId, "actionId" to actionId) }
    }
  }

  private fun consumeIntent(intent: Intent?) {
    val tap = OngoingNotices.takeTap(intent) ?: return
    val ctx = appContext.reactContext ?: return
    deliver(ctx, tap.first, tap.second)
  }

  companion object {
    private const val ON_ACTION = "onAction"

    @Volatile private var instance: ForjdOngoingNoticeModule? = null

    @Volatile private var listening = false

    /** Sends a tap to JavaScript when it listens; otherwise keeps it until `takePendingActions`. */
    internal fun deliver(context: Context, noticeId: String, actionId: String) {
      val module = instance
      if (module != null && listening) {
        try {
          module.sendEvent(ON_ACTION, mapOf("noticeId" to noticeId, "actionId" to actionId))
          return
        } catch (_: Throwable) {
          // The JavaScript side went away between the check and the send: keep the tap instead.
        }
      }
      PendingActions.add(context, noticeId, actionId)
    }
  }
}

class NoticeActionRecord : Record {
  @Field val id: String = ""
  @Field val title: String = ""
  @Field val opensApp: Boolean = false
}

class NoticeContentRecord : Record {
  @Field val title: String = ""
  @Field val text: String = ""
  @Field val subText: String? = null
  @Field val countDownToMs: Double? = null
  @Field val countUpFromMs: Double? = null
  @Field val actions: List<NoticeActionRecord> = emptyList()

  internal fun toContent() = NoticeContent(
    title = title,
    text = text,
    subText = subText,
    countDownToMs = countDownToMs?.toLong(),
    countUpFromMs = countUpFromMs?.toLong(),
    actions = actions.map { NoticeAction(it.id, it.title, it.opensApp) },
  )
}

class ShowOptions : Record {
  @Field val id: String = ""
  @Field val channelId: String = ""
  @Field val channelName: String = ""
  @Field val color: String = "#E9712F"
  @Field val visibility: String = "public"
  @Field val title: String = ""
  @Field val text: String = ""
  @Field val subText: String? = null
  @Field val countDownToMs: Double? = null
  @Field val countUpFromMs: Double? = null
  @Field val actions: List<NoticeActionRecord> = emptyList()
  @Field val then: NoticeContentRecord? = null

  internal fun toNotice() = Notice(
    id = id,
    channelId = channelId,
    channelName = channelName,
    color = color,
    isPrivate = visibility == "private",
    content = NoticeContent(
      title = title,
      text = text,
      subText = subText,
      countDownToMs = countDownToMs?.toLong(),
      countUpFromMs = countUpFromMs?.toLong(),
      actions = actions.map { NoticeAction(it.id, it.title, it.opensApp) },
    ),
  )
}
