package com.akshay.happylocal;

import android.app.*;
import android.content.*;
import android.os.*;
import com.chaquo.python.*;

public class ServerService extends Service {
    private Thread worker;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        Notification n = new Notification.Builder(this, "happy_host")
            .setContentTitle("Happy Local Host")
            .setContentText("Telegram addon server is running")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build();
        startForeground(1001, n);

        if (worker == null || !worker.isAlive()) {
            worker = new Thread(() -> {
                try {
                    Python py = Python.getInstance();
                    PyObject m = py.getModule("server");
                    String channel = getSharedPreferences("host", MODE_PRIVATE)
                        .getString("channel", "");
                    String token = getSharedPreferences("host", MODE_PRIVATE)
                        .getString("tpdb", "");
                    m.callAttr("start_server",
                        getFilesDir().getAbsolutePath(),
                        channel,
                        token,
                        8765);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            });
            worker.start();
        }
        return START_STICKY;
    }

    private void createChannel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(
            "happy_host", "Happy Local Host",
            NotificationManager.IMPORTANCE_LOW));
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
