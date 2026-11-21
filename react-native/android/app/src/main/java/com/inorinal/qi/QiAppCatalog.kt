package com.inorinal.qi

import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.text.Collator

/**
 * 小狗端可启动应用清单（包名 + 显示名）。
 *
 * 主人端的「应用限制」需要的是**小狗手机上的应用**，不是主人本机的列表。这个
 * 清单由小狗端算出、经 relay 交回，所以必须能在常驻服务里跑（他很可能没打开祈）。
 *
 * 与 `UsageStatsModule.installedAppsBlock()` 同源：只用 MAIN/LAUNCHER 的
 * `queryIntentActivities`，不申请 `QUERY_ALL_PACKAGES`（商店敏感权限），可见性
 * 由 AndroidManifest 的 `<queries>` 声明提供。这里不塞图标 data URL —— 主人端
 * 的应用限制列表只用文字与包名，省掉几十 KB 的密文搬运。
 */
internal object QiAppCatalog {

  /** 与 JS 侧 `InstalledApps` 同形：`{ok:true, apps:[{pkg,label,launchable}]}`。 */
  fun launchable(context: Context): JSONObject {
    val pm = context.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved =
      runCatching { pm.queryIntentActivities(intent, 0) }.getOrDefault(emptyList())
    val seen = HashSet<String>()
    val entries = ArrayList<Pair<String, String>>()
    resolved.forEach { info ->
      val activity = info.activityInfo ?: return@forEach
      val pkg = activity.packageName ?: return@forEach
      if (pkg.isEmpty() || !seen.add(pkg)) return@forEach
      val label =
        runCatching { pm.getApplicationLabel(activity.applicationInfo).toString() }
          .getOrDefault(pkg)
      entries.add(pkg to label)
    }
    val collator = Collator.getInstance()
    entries.sortWith(compareBy(collator) { it.second })

    val apps = JSONArray()
    entries.forEach { (pkg, label) ->
      apps.put(
        JSONObject()
          .put("pkg", pkg)
          .put("label", label)
          // 从 LAUNCHER intent 解析出来的，必然可启动。
          .put("launchable", true)
      )
    }
    return JSONObject().put("ok", true).put("apps", apps)
  }
}
