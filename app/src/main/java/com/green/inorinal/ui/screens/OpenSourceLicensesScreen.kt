package com.green.inorinal.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class LicenseItem(
    val name: String,
    val license: String,
    val source: String,
    val note: String
)

private val licenseItems = listOf(
    LicenseItem("AndroidX Activity / Lifecycle / Navigation", "Apache License 2.0", "https://developer.android.com/jetpack/androidx", "应用基础架构与导航。"),
    LicenseItem("Jetpack Compose / Material 3", "Apache License 2.0", "https://developer.android.com/jetpack/compose", "界面框架与 Material 组件。"),
    LicenseItem(
        "Material Icons / Material Symbols",
        "Apache License 2.0",
        "https://github.com/google/material-design-icons",
        "应用内天气、心情、头像、底部导航、日记卡片操作及装饰矢量图标。"
    ),
    LicenseItem("Room", "Apache License 2.0", "https://developer.android.com/training/data-storage/room", "本地数据库。"),
    LicenseItem("DataStore", "Apache License 2.0", "https://developer.android.com/topic/libraries/architecture/datastore", "用户设置存储。"),
    LicenseItem("Gson", "Apache License 2.0", "https://github.com/google/gson", "备份清单与旧 JSON 导入导出。"),
    LicenseItem("LXGW WenKai", "SIL Open Font License 1.1", "https://github.com/lxgw/LxgwWenKai", "编辑器手写风格字体。")
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OpenSourceLicensesScreen(onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                },
                title = {
                    Text(
                        "开放源代码许可",
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Text(
                "感谢以下开源项目与资源。完整许可证文本请以各项目官方仓库为准。",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(16.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column {
                    licenseItems.forEachIndexed { index, item ->
                        LicenseItemView(item)
                        if (index != licenseItems.lastIndex) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LicenseItemView(item: LicenseItem) {
    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            text = item.name,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp,
            color = MaterialTheme.colorScheme.onSurface
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = item.license,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.primary
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = item.note,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = item.source,
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
        )
    }
}
