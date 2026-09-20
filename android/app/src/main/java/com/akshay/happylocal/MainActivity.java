package com.akshay.happylocal;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.*;
import android.graphics.Color;
import android.view.ViewGroup;

public class MainActivity extends Activity {
    EditText apiId, apiHash, phone, code, channel, tpdbToken;
    TextView status;

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        if (!com.chaquo.python.Python.isStarted()) {
            com.chaquo.python.Python.start(new com.chaquo.python.android.AndroidPlatform(this));
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 48, 32, 32);
        root.setBackgroundColor(Color.rgb(18,18,18));

        TextView title = new TextView(this);
        title.setText("Happy Local Host");
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("Telegram → local Stremio/Nuvio addon");
        sub.setTextColor(Color.LTGRAY);
        sub.setTextSize(15);
        root.addView(sub);

        apiId = field("Telegram API ID");
        apiHash = field("Telegram API Hash");
        phone = field("Phone (+91...)");
        code = field("Telegram login code");
        channel = field("Channel username or ID");
        tpdbToken = field("TPDB token (optional)");
        root.addView(apiId); root.addView(apiHash); root.addView(phone);
        root.addView(code); root.addView(channel); root.addView(tpdbToken);

        Button send = new Button(this);
        send.setText("Send Telegram Code");
        root.addView(send);

        Button login = new Button(this);
        login.setText("Login");
        root.addView(login);

        Button start = new Button(this);
        start.setText("START LOCAL SERVER");
        root.addView(start);

        status = new TextView(this);
        status.setTextColor(Color.LTGRAY);
        status.setText("Enter Telegram API credentials.");
        root.addView(status);

        send.setOnClickListener(v -> runPython("send_code"));
        login.setOnClickListener(v -> runPython("login"));
        start.setOnClickListener(v -> {
            save();
            startService(new Intent(this, ServerService.class));
            status.setText("Server starting on port 8765...");
        });

        setContentView(root);
    }

    EditText field(String hint) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.GRAY);
        e.setSingleLine(true);
        e.setPadding(0, 12, 0, 12);
        return e;
    }

    void save() {
        getPreferences(0).edit()
            .putString("apiId", apiId.getText().toString().trim())
            .putString("apiHash", apiHash.getText().toString().trim())
            .putString("phone", phone.getText().toString().trim())
            .putString("code", code.getText().toString().trim())
            .putString("channel", channel.getText().toString().trim())
            .putString("tpdb", tpdbToken.getText().toString().trim())
            .apply();
        getSharedPreferences("host", MODE_PRIVATE).edit()
            .putString("apiId", apiId.getText().toString().trim())
            .putString("apiHash", apiHash.getText().toString().trim())
            .putString("phone", phone.getText().toString().trim())
            .putString("channel", channel.getText().toString().trim())
            .putString("tpdb", tpdbToken.getText().toString().trim())
            .apply();
    }

    void runPython(String action) {
        save();
        new Thread(() -> {
            try {
                com.chaquo.python.Python py =
                    com.chaquo.python.Python.getInstance();
                com.chaquo.python.PyObject m = py.getModule("server");
                String result = m.callAttr(
                    action,
                    apiId.getText().toString().trim(),
                    apiHash.getText().toString().trim(),
                    phone.getText().toString().trim(),
                    code.getText().toString().trim(),
                    getFilesDir().getAbsolutePath()
                ).toString();
                runOnUiThread(() -> status.setText(result));
            } catch (Exception e) {
                runOnUiThread(() -> status.setText("ERROR: " + e.getMessage()));
            }
        }).start();
    }
}
