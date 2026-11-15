package com.google.antigravity.remoteapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import org.json.JSONObject

/**
 * 1:1 counterpart of Claude Android's `com.anthropic.claude.code.remote.notification.CCRPermissionActionReceiver`
 * decompiled via REA (`rea inspect-android-method`).
 *
 * Supports:
 * - ACTION_APPROVE ("com.google.antigravity.remoteapp.action.CCR_PERMISSION_APPROVE")
 * - ACTION_DENY ("com.google.antigravity.remoteapp.action.CCR_PERMISSION_DENY")
 * - ACTION_DENY_WITH_COMMENT ("com.google.antigravity.remoteapp.action.CCR_PERMISSION_DENY_WITH_COMMENT")
 *   with inline Android `RemoteInput` key `"ccr_comment"`.
 */
class AGYPermissionActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: "latest"
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, DEFAULT_NOTIF_ID)

        val decision = when (action) {
            ACTION_APPROVE -> "APPROVE"
            ACTION_DENY -> "DENY"
            ACTION_DENY_WITH_COMMENT -> "DENY_WITH_COMMENT"
            else -> return
        }

        // Extract inline comment from RemoteInput ("ccr_comment") just like Claude's `pm3.J(intent, "ccr_comment")`
        val comment: String? = if (action == ACTION_DENY_WITH_COMMENT) {
            val results = RemoteInput.getResultsFromIntent(intent)
            results?.getCharSequence(KEY_CCR_COMMENT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
        } else {
            null
        }

        // Dispatch decision to active WebView bridge on UI thread
        val payloadJson = JSONObject().apply {
            put("action", action)
            put("requestId", requestId)
            put("decision", decision)
            if (comment != null) {
                put("comment", comment)
            }
        }.toString()

        MainActivity.dispatchNativeEventToWebView(payloadJson)

        // Update notification in-place with FLAG_ONLY_ALERT_ONCE (matching Claude's notificationO3.flags |= 8)
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val statusText = when (decision) {
            "APPROVE" -> "✅ 已批准执行 (Approved)"
            "DENY_WITH_COMMENT" -> "💬 已附言拒绝: ${comment ?: ""}"
            else -> "✕ 已拒绝 (Denied)"
        }

        val updated = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Antigravity Remote 审批已处理")
            .setContentText(statusText)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .build()
            .apply {
                flags = flags or Notification.FLAG_ONLY_ALERT_ONCE
            }

        nm.notify(notificationId, updated)
    }

    companion object {
        const val CHANNEL_ID = "agy_ccr_permission_channel"
        const val KEY_CCR_COMMENT = "ccr_comment"
        const val EXTRA_REQUEST_ID = "extra_request_id"
        const val EXTRA_NOTIFICATION_ID = "extra_notification_id"
        const val DEFAULT_NOTIF_ID = 4201

        const val ACTION_APPROVE = "com.google.antigravity.remoteapp.action.CCR_PERMISSION_APPROVE"
        const val ACTION_DENY = "com.google.antigravity.remoteapp.action.CCR_PERMISSION_DENY"
        const val ACTION_DENY_WITH_COMMENT =
            "com.google.antigravity.remoteapp.action.CCR_PERMISSION_DENY_WITH_COMMENT"

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = context.getSystemService(NotificationManager::class.java) ?: return
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Antigravity Code Remote 权限审批",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "当远端 Antigravity Agent 请求执行终端命令或修改文件时，支持在锁屏/通知栏直接批准或带评论拒绝"
                }
                nm.createNotificationChannel(channel)
            }
        }

        fun showPermissionNotification(
            context: Context,
            toolName: String,
            commandText: String,
            requestId: String
        ) {
            ensureChannel(context)
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            val notifId = DEFAULT_NOTIF_ID

            val approveIntent = Intent(context, AGYPermissionActionReceiver::class.java).apply {
                action = ACTION_APPROVE
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_NOTIFICATION_ID, notifId)
            }
            val approvePending = PendingIntent.getBroadcast(
                context,
                101,
                approveIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val denyIntent = Intent(context, AGYPermissionActionReceiver::class.java).apply {
                action = ACTION_DENY
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_NOTIFICATION_ID, notifId)
            }
            val denyPending = PendingIntent.getBroadcast(
                context,
                102,
                denyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val commentIntent = Intent(context, AGYPermissionActionReceiver::class.java).apply {
                action = ACTION_DENY_WITH_COMMENT
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_NOTIFICATION_ID, notifId)
            }
            val mutableFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE
            } else {
                0
            }
            val commentPending = PendingIntent.getBroadcast(
                context,
                103,
                commentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag
            )

            val remoteInput = RemoteInput.Builder(KEY_CCR_COMMENT)
                .setLabel("输入拒绝原因或修改指导...")
                .build()

            val denyWithCommentAction = NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_edit,
                "附言拒绝",
                commentPending
            )
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(true)
                .build()

            val openAppIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val openAppPending = PendingIntent.getActivity(
                context,
                100,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("🛡️ Antigravity 请求权限: $toolName")
                .setContentText(commandText.take(160))
                .setStyle(NotificationCompat.BigTextStyle().bigText(commandText.take(1200)))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(openAppPending)
                .setAutoCancel(true)
                .addAction(android.R.drawable.ic_input_add, "批准 (Approve)", approvePending)
                .addAction(android.R.drawable.ic_delete, "拒绝 (Deny)", denyPending)
                .addAction(denyWithCommentAction)
                .build()

            nm.notify(notifId, notification)
        }
    }
}
