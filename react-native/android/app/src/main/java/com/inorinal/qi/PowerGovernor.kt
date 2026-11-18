package com.inorinal.qi

/**
 * Adaptive long-poll cadence for [PuppyGuardService].
 *
 * Deliberately pure Kotlin: no `android.*` imports at all. The whole power
 * budget of the app lives in one reviewable function, and it can be unit tested
 * on a plain JVM (no Robolectric, no instrumentation).
 *
 * Why this exists: the guard loop is the only component that keeps running
 * while the phone sits in a pocket all night. Two tempting designs are wrong
 * here:
 *  - a fixed 25 s timer keeps the CPU/app awake far too often for a "companion"
 *    app that mostly has nothing to do;
 *  - an AlarmManager chain wakes the device out of Doze every few minutes and
 *    is exactly the pattern Android's power team asks apps not to use.
 * Instead the loop performs one blocking wait whose *length* encodes the
 * current power situation. Nothing else schedules work, so the cost of being
 * resident is one wakeup per interval and nothing in between.
 */
enum class Tier {
  /** Maximum battery saving: only poll when the screen is on, otherwise very rarely. */
  SAVER,

  /** Default: responsive while the screen is on, lazy behind the scenes. */
  BALANCED,

  /** Live-feeling mode the user can choose; still backs off when idle. */
  REALTIME
}

/**
 * Snapshot of the factors that may change the poll cadence.
 *
 * [batteryPercent] is -1 when the value is unknown (e.g. battery broadcast not
 * seen yet) — unknown must never be treated as "low".
 */
data class PowerState(
  val screenOn: Boolean,
  val userPresent: Boolean,
  val charging: Boolean,
  val batteryPercent: Int,
  val idleMinutes: Long
) {
  val lowBattery: Boolean
    get() = batteryPercent in 0 until PowerGovernor.LOW_BATTERY_PERCENT
}

object PowerGovernor {

  /** Screen on, user right there: poll often so replies feel live. */
  const val FOREGROUND_MS: Long = 25_000L

  /** Screen off but recent activity: still reachable, just slowly. */
  const val SCREEN_OFF_MS: Long = 120_000L

  /** Screen off and nothing happened for [IDLE_AFTER_MINUTES]: near-idle. */
  const val IDLE_MS: Long = 300_000L

  /** Charging is "free" energy, so a middle cadence is affordable. */
  const val CHARGING_MS: Long = 60_000L

  /** SAVER floor with the screen off — one wakeup every five minutes. */
  const val SAVER_MS: Long = 300_000L

  /** Below this level and unplugged the loop silently drops to SAVER. */
  const val LOW_BATTERY_PERCENT: Int = 15

  /** "No events for 10 minutes" counts as idle. */
  const val IDLE_AFTER_MINUTES: Long = 10L

  /** Hard bounds so a bad state value can never spin or stall the loop. */
  const val MIN_WAIT_MS: Long = 15_000L
  const val MAX_WAIT_MS: Long = 600_000L

  /**
   * Low battery overrides whatever the user asked for. This is intentional: an
   * unplugged phone under 15% should not be kept in REALTIME by a UI toggle,
   * because the user will blame the app when the phone dies overnight.
   */
  fun effectiveTier(state: PowerState, requested: Tier): Tier =
    if (state.lowBattery && !state.charging) Tier.SAVER else requested

  /**
   * Returns how long [PuppyGuardService] should block before the next poll.
   *
   * Precedence (highest first):
   *  1. low battery + not charging  -> SAVER (ignore the requested tier)
   *  2. screen on                   -> fastest cadence of the tier
   *  3. charging                    -> middle cadence (energy is not scarce)
   *  4. idle >= 10 min             -> near-idle cadence
   *  5. otherwise (screen off)      -> [SCREEN_OFF_MS]
   */
  fun decide(state: PowerState, tier: Tier): Long {
    val effective = effectiveTier(state, tier)
    val wait =
      when (effective) {
        // Even in SAVER the screen being on is the one case worth paying for:
        // the user can see the screen, so an hour-old message would be noticed.
        Tier.SAVER -> if (state.screenOn) SCREEN_OFF_MS else SAVER_MS

        Tier.REALTIME ->
          when {
            state.screenOn -> FOREGROUND_MS
            state.charging -> CHARGING_MS
            state.idleMinutes >= IDLE_AFTER_MINUTES -> IDLE_MS
            else -> SCREEN_OFF_MS
          }

        Tier.BALANCED ->
          when {
            state.charging -> CHARGING_MS
            state.screenOn -> CHARGING_MS
            state.idleMinutes >= IDLE_AFTER_MINUTES -> IDLE_MS
            else -> SCREEN_OFF_MS
          }
      }
    return wait.coerceIn(MIN_WAIT_MS, MAX_WAIT_MS)
  }

  /** Alias kept for call sites that read better as "how long do we poll at". */
  fun pollWaitMs(state: PowerState, tier: Tier): Long = decide(state, tier)
}
