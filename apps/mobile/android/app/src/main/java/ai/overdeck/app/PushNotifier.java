package ai.overdeck.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Posts a {@link PushNotice} on its channel (PAN-4840 FR-3, FR-4). */
final class PushNotifier {
    private static final int NOTIFICATION_ID = 1;

    private PushNotifier() {}

    /** Creates the `needs-you` and `updates` channels on Android 8+. Safe to call repeatedly. */
    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = ctx.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
                PushNotice.CHANNEL_NEEDS_YOU, "Needs you", NotificationManager.IMPORTANCE_HIGH));
        manager.createNotificationChannel(new NotificationChannel(
                PushNotice.CHANNEL_UPDATES, "Updates", NotificationManager.IMPORTANCE_DEFAULT));
    }

    /** True when posted; false when notifications are off or the permission is missing. */
    static boolean post(Context ctx, PushNotice n) {
        ensureChannels(ctx);
        NotificationManagerCompat manager = NotificationManagerCompat.from(ctx);
        if (!manager.areNotificationsEnabled()) return false;
        Intent intent = n.openLink != null
                ? new Intent(Intent.ACTION_VIEW, Uri.parse(n.openLink)).setClass(ctx, MainActivity.class)
                : ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent contentIntent = PendingIntent.getActivity(ctx, n.notificationTag.hashCode(), intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        boolean needsYou = PushNotice.CHANNEL_NEEDS_YOU.equals(n.channelId);
        Notification notification = new NotificationCompat.Builder(ctx, n.channelId)
                .setSmallIcon(R.drawable.ic_stat_overdeck)
                .setContentTitle(n.title)
                .setContentText(n.body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(n.body))
                // Pre-26 devices have no channels and read the priority instead.
                .setPriority(needsYou ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .build();
        try {
            manager.notify(n.notificationTag, NOTIFICATION_ID, notification);
            return true;
        } catch (SecurityException e) {
            return false;
        }
    }
}
