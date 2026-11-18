package com.inorinal.qi

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Boot / reconnect catch-up trigger.
 *
 * Why a one-shot flag instead of a repeating job: after a reboot or a long
 * offline stretch the guard only needs a single "resync now". Persisting one
 * pending reason in SharedPreferences means JS notices it on next attach
 * (`QiGuard.consumePendingSync`), and nothing is scheduled in between — no
 * JobScheduler, no periodic broadcast.
 */
class AutoStartReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    val reason =
      when (action) {
        Intent.ACTION_BOOT_COMPLETED -> "boot"
        Intent.ACTION_MY_PACKAGE_REPLACED -> "package_replaced"
        ACTION_CONNECTIVITY -> "connectivity"
        else -> action
      }
    AutoStartBus.request(context, reason)
    // The guard is the only component allowed to run headless; BOOT_COMPLETED
    // grants the background-start exemption needed to bring it up.
    PuppyGuardService.start(context)
  }

  companion object {
    const val ACTION_CONNECTIVITY = "android.net.conn.CONNECTIVITY_CHANGE"

    /** Used by the guard service's dynamic receiver for CONNECTIVITY_CHANGE. */
    fun requestSync(context: Context, reason: String) = AutoStartBus.request(context, reason)
  }
}

/**
 * Tiny static bus + persisted flag. No EventBus dependency: a single listener is
 * all we need, and persistence is what makes the signal survive a dead process.
 */
object AutoStartBus {
  private const val PREFS = "qi.autostart"
  private const val PREF_PENDING = "pendingSync"
  private const val PREF_PENDING_AT = "pendingSyncAt"

  @Volatile var listener: ((String) -> Unit)? = null

  fun request(context: Context, reason: String) {
    prefs(context)
      .edit()
      .putString(PREF_PENDING, reason)
      .putLong(PREF_PENDING_AT, System.currentTimeMillis())
      .apply()
    runCatching { listener?.invoke(reason) }
  }

  fun peek(context: Context): String? = prefs(context).getString(PREF_PENDING, null)

  /** Reads and clears: the caller performs exactly one catch-up sync. */
  fun consume(context: Context): String? {
    val store = prefs(context)
    val reason = store.getString(PREF_PENDING, null)
    if (reason != null) {
      store.edit().remove(PREF_PENDING).remove(PREF_PENDING_AT).apply()
    }
    return reason
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
