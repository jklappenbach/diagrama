package dev.diagrama.intellij

/** Assembles the JCEF page (core bundle + host bridge inlined) and JS-escapes strings. */
object Html {

    fun page(): String = """
        <!doctype html><html><head><meta charset="utf-8">
        <style>html,body{margin:0;height:100%;background:#fff}#stage{height:100vh;width:100vw}</style>
        </head><body><div id="stage"></div>
        <script>${resource("/web/diagrama.min.js")}</script>
        <script>${resource("/web/host.js")}</script>
        </body></html>
    """.trimIndent()

    private fun resource(path: String): String =
        Html::class.java.getResourceAsStream(path)?.bufferedReader()?.use { it.readText() }
            ?: "/* missing $path — run build-intellij-bundle.sh to copy the core bundle */"

    /** Minimal, correct JS string literal (quotes, newlines, U+2028/9 line separators). */
    fun jsString(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when {
            c == '\\' -> sb.append("\\\\")
            c == '"' -> sb.append("\\\"")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\t' -> sb.append("\\t")
            c.code == 0x2028 -> sb.append("\\u2028")
            c.code == 0x2029 -> sb.append("\\u2029")
            c < ' ' -> sb.append("\\u%04x".format(c.code))
            else -> sb.append(c)
        }
        return sb.append("\"").toString()
    }
}
