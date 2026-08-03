package com.green.inorinal.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Update
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.green.inorinal.ui.icons.AppIdentityIcon
import com.green.inorinal.ui.layout.rememberAppWindowSize
import com.green.inorinal.ui.icons.HeartIcon
import com.green.inorinal.ui.icons.StarIcon
import com.green.inorinal.ui.theme.*
import kotlinx.coroutines.delay
import kotlin.random.Random

data class Particle(
    val x: Float,
    val y: Float,
    val speed: Float,
    val isHeart: Boolean,
    val size: Float,
    val drift: Float,
    val rotation: Float
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(
    onBack: () -> Unit,
    onLicensesClick: () -> Unit
) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val windowSize = rememberAppWindowSize()
    var tapCount by remember { mutableIntStateOf(0) }
    var showEasterEgg by remember { mutableStateOf(false) }
    val particles = remember { mutableStateListOf<Particle>() }

    LaunchedEffect(showEasterEgg) {
        if (showEasterEgg) {
            repeat(30) {
                particles.add(
                    Particle(
                        x = Random.nextFloat(),
                        y = -0.1f,
                        speed = Random.nextFloat() * 0.005f + 0.003f,
                        isHeart = Random.nextBoolean(),
                        size = Random.nextFloat() * 20f + 12f,
                        drift = Random.nextFloat() * 0.003f - 0.0015f,
                        rotation = Random.nextFloat() * 360f
                    )
                )
            }
            delay(5000)
            showEasterEgg = false
            particles.clear()
        }
    }

    LaunchedEffect(particles.isNotEmpty()) {
        while (particles.isNotEmpty()) {
            val indicesToRemove = mutableListOf<Int>()
            particles.forEachIndexed { index, particle ->
                particles[index] = particle.copy(
                    y = particle.y + particle.speed,
                    x = particle.x + particle.drift,
                    rotation = particle.rotation + 2f
                )
                if (particle.y > 1.2f) {
                    indicesToRemove.add(index)
                }
            }
            indicesToRemove.reversed().forEach { particles.removeAt(it) }
            delay(16)
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
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
                            "关于",
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
                    .padding(horizontal = windowSize.contentPadding)
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                                MaterialTheme.colorScheme.background,
                                MaterialTheme.colorScheme.background
                            )
                        )
                    ),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Spacer(Modifier.height(windowSize.aboutTopSpacer))

                AppIdentityIcon(size = windowSize.aboutIconSize, tint = MaterialTheme.colorScheme.primary)

                Spacer(Modifier.height(20.dp))

                Text(
                    "祈",
                    fontSize = windowSize.aboutHeroSp.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary
                )

                Spacer(Modifier.height(12.dp))

                Text(
                    "Alpha v0.2.3",
                    fontSize = 16.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clickable {
                        tapCount++
                        if (tapCount >= 5) {
                            tapCount = 0
                            showEasterEgg = true
                        }
                    }
                )

                Spacer(Modifier.height(40.dp))

                Text(
                    "以本软件献给我最亲爱的小不点儿～",
                    fontSize = if (windowSize.isNarrow) 13.sp else 15.sp,
                    fontStyle = FontStyle.Italic,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp)
                )

                Spacer(Modifier.height(20.dp))

                // 开源声明
                Text(
                    "本软件使用了若干开源组件与图标，详见许可证信息。",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp)
                )

                Spacer(Modifier.height(24.dp))

                OutlinedButton(
                    onClick = onLicensesClick,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.primary
                    )
                ) {
                    Icon(
                        Icons.Filled.Description,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("开放源代码许可")
                }

                Spacer(Modifier.height(12.dp))

                // 检查更新按钮
                OutlinedButton(
                    onClick = {
                        android.widget.Toast.makeText(context, "当前已是最新版本", android.widget.Toast.LENGTH_SHORT).show()
                    },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.primary
                    )
                ) {
                    Icon(
                        Icons.Filled.Update,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("检查更新")
                }
            }
        }

        // 彩蛋粒子层
        if (showEasterEgg || particles.isNotEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
            ) {
                particles.forEach { particle ->
                    Box(
                        modifier = Modifier
                            .offset(
                                x = (particle.x * configuration.screenWidthDp).dp,
                                y = (particle.y * configuration.screenHeightDp).dp
                            )
                    ) {
                        if (particle.isHeart) {
                            HeartIcon(size = particle.size.dp, tint = FavoriteRed.copy(alpha = 0.8f))
                        } else {
                            StarIcon(size = particle.size.dp, tint = StarYellow.copy(alpha = 0.8f))
                        }
                    }
                }
            }
        }
    }
}
