package com.inorinal.qi

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Append-only, hash-chained audit log at `filesDir/qi/audit.jsonl`.
 *
 * Every record carries the hash of the previous record, so deleting or editing
 * a line in the middle breaks [verifyChain] — that is the whole point: the
 * user (小狗) can be told "this is a complete record of what your owner did",
 * and the claim is checkable on the device without any server.
 *
 * Plain JSONL instead of a database because the file is meant to be exported
 * verbatim and inspected by a human or a script.
 */
object AuditLog {

  private const val FILE_NAME = "audit.jsonl"
  private const val ROTATED_NAME = "audit.1.jsonl"
  private const val GENESIS = "0000000000000000000000000000000000000000000000000000000000000000"

  /** Keeps filesDir bounded without needing a cleanup service. */
  private const val MAX_BYTES = 2L * 1024L * 1024L

  private val lock = Any()

  fun qiDir(context: Context): File =
    File(context.filesDir, "qi").apply { if (!exists()) mkdirs() }

  fun file(context: Context): File = File(qiDir(context), FILE_NAME)

  /**
   * Appends one record and returns its sequence number plus hash.
   *
   * The hash covers the previous hash, so the chain is only as strong as the
   * append path: it is always done under [lock] on a single file.
   */
  fun append(context: Context, type: String, detail: String): Pair<Long, String> =
    synchronized(lock) {
      val target = file(context)
      rotateIfNeeded(target)
      val (previousSeq, previousHash) = tail(target)
      val record =
        JSONObject()
          .put("seq", previousSeq + 1)
          .put("at", System.currentTimeMillis())
          .put("type", type)
          .put("detail", detail)
          .put("prevHash", previousHash)
      val recordHash = hashOf(previousSeq + 1, record.getLong("at"), type, detail, previousHash)
      record.put("hash", recordHash)
      target.appendText(record.toString() + "\n")
      previousSeq + 1 to recordHash
    }

  fun read(context: Context, limit: Int, offset: Int): List<JSONObject> {
    val records = readAll(context)
    val start = offset.coerceIn(0, records.size)
    val end = if (limit <= 0) records.size else (start + limit).coerceAtMost(records.size)
    return records.subList(start, end)
  }

  fun count(context: Context): Int = readAll(context).size

  fun readAll(context: Context): List<JSONObject> {
    val target = file(context)
    if (!target.exists()) return emptyList()
    return target.readLines().mapNotNull { line ->
      if (line.isBlank()) null
      else runCatching { JSONObject(line) }.getOrNull()
    }
  }

  fun export(context: Context): File = file(context)

  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(8 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  /**
   * Recomputes the chain. Returns `valid=false` plus the 1-based index of the
   * first broken record (0 when the file is empty or fine).
   */
  fun verifyChain(context: Context): ChainResult {
    val records = readAll(context)
    var expectedPrev = GENESIS
    records.forEachIndexed { index, record ->
      val seq = record.optLong("seq", -1L)
      val at = record.optLong("at", 0L)
      val type = record.optString("type", "")
      val detail = record.optString("detail", "")
      val prevHash = record.optString("prevHash", "")
      val hash = record.optString("hash", "")
      val wants = index + 1L
      if (seq != wants || prevHash != expectedPrev) {
        return ChainResult(false, index + 1, records.size)
      }
      if (hashOf(seq, at, type, detail, prevHash) != hash) {
        return ChainResult(false, index + 1, records.size)
      }
      expectedPrev = hash
    }
    return ChainResult(true, 0, records.size)
  }

  data class ChainResult(val valid: Boolean, val brokenAt: Int, val count: Int)

  private fun rotateIfNeeded(target: File) {
    if (!target.exists() || target.length() <= MAX_BYTES) return
    val rotated = File(target.parentFile, ROTATED_NAME)
    if (rotated.exists()) rotated.delete()
    target.renameTo(rotated)
  }

  /** Returns (last seq, last hash) or the genesis pair for a fresh file. */
  private fun tail(target: File): Pair<Long, String> {
    if (!target.exists()) return 0L to GENESIS
    val lines = target.readLines()
    for (index in lines.indices.reversed()) {
      val line = lines[index]
      if (line.isBlank()) continue
      val record = runCatching { JSONObject(line) }.getOrNull() ?: return 0L to GENESIS
      return record.optLong("seq", 0L) to record.optString("hash", GENESIS)
    }
    return 0L to GENESIS
  }

  private fun hashOf(
    seq: Long,
    at: Long,
    type: String,
    detail: String,
    prevHash: String
  ): String {
    val material = "$seq|$at|$type|$detail|$prevHash"
    val digest = MessageDigest.getInstance("SHA-256").digest(material.toByteArray())
    return digest.joinToString("") { "%02x".format(it) }
  }
}
