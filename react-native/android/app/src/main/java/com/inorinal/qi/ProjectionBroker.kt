package com.inorinal.qi

import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

/**
 * The one place a [MediaProjection] instance lives.
 *
 * Android allows only one active projection per consent token, and the token can
 * only be consumed by a foreground service that declares the mediaProjection
 * type (enforced from Android 14, recommended from 10). So the instance is
 * created inside [PuppyGuardService] and shared here; the screenshot module waits
 * on this broker instead of calling `getMediaProjection` itself.
 *
 * Threading: attach/fail are called from the service (main thread); await is
 * called from the screenshot executor. A ReentrantLock + Condition is used
 * instead of Object.wait so the wait is a named, single-purpose signal and can
 * be interrupted cleanly.
 */
object ProjectionBroker {

  private val lock = ReentrantLock()
  private val signal = lock.newCondition()

  private var projection: MediaProjection? = null
  private var failure: String? = null

  /** True once a projection instance exists and has not been stopped. */
  fun isAttached(): Boolean {
    lock.lock()
    try {
      return projection != null
    } finally {
      lock.unlock()
    }
  }

  fun current(): MediaProjection? {
    lock.lock()
    try {
      return projection
    } finally {
      lock.unlock()
    }
  }

  fun attach(value: MediaProjection) {
    var replaced: MediaProjection? = null
    lock.lock()
    try {
      failure = null
      replaced = projection
      projection = value
      // Must be registered before a VirtualDisplay is created, otherwise the
      // system may drop the projection without telling us.
      value.registerCallback(
        object : MediaProjection.Callback() {
          override fun onStop() {
            lock.lock()
            try {
              if (projection === value) projection = null
            } finally {
              lock.unlock()
            }
          }
        },
        Handler(Looper.getMainLooper())
      )
      signal.signalAll()
    } finally {
      lock.unlock()
    }
    // stop() may synchronously invoke onStop, so it happens outside the lock.
    replaced?.let { previous -> if (previous !== value) runCatching { previous.stop() } }
  }

  fun fail(message: String) {
    lock.lock()
    try {
      failure = message
      signal.signalAll()
    } finally {
      lock.unlock()
    }
  }

  /**
   * Blocks until the service produces a projection (or fails). Returns null on
   * timeout; [lastError] then explains why.
   */
  fun await(timeoutMs: Long): MediaProjection? {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    lock.lock()
    try {
      while (projection == null && failure == null) {
        val remaining = deadline - System.nanoTime()
        if (remaining <= 0) return null
        signal.awaitNanos(remaining)
      }
      return projection
    } catch (interrupted: InterruptedException) {
      Thread.currentThread().interrupt()
      return null
    } finally {
      lock.unlock()
    }
  }

  fun lastError(): String? {
    lock.lock()
    try {
      return failure
    } finally {
      lock.unlock()
    }
  }

  fun clearError() {
    lock.lock()
    try {
      failure = null
    } finally {
      lock.unlock()
    }
  }

  /** Stops and forgets the instance; safe to call repeatedly. */
  fun release() {
    var dying: MediaProjection? = null
    lock.lock()
    try {
      dying = projection
      projection = null
    } finally {
      lock.unlock()
    }
    dying?.let { runCatching { it.stop() } }
  }
}
