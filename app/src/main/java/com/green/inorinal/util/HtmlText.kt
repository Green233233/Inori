package com.green.inorinal.util

import android.os.Build
import android.text.Html

fun htmlToPlainText(html: String): String {
    if (html.isBlank()) return ""

    val sanitized = html
        .replace(Regex("""data:image/[^"';\s>]+""", RegexOption.IGNORE_CASE), " ")
        .replace(Regex("""(?is)<script[^>]*>.*?</script>"""), " ")
        .replace(Regex("""(?is)<style[^>]*>.*?</style>"""), " ")
        .replace(Regex("""(?is)<img[^>]*>"""), " ")
        .replace(Regex("""(?is)<canvas[^>]*>.*?</canvas>"""), " ")
        .replace(Regex("<[^>]*$"), " ")
        .replace(Regex("^[^<\\[]*>"), " ")

    val parsed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        Html.fromHtml(sanitized, Html.FROM_HTML_MODE_COMPACT)
    } else {
        @Suppress("DEPRECATION")
        Html.fromHtml(sanitized)
    }.toString()

    return parsed
        .replace(Regex("<[^>]+>"), " ")
        .replace(Regex("""^[^<]*>"""), " ")
        .replace('\u00A0', ' ')
        .replace(Regex("\\s+"), " ")
        .trim()
}
