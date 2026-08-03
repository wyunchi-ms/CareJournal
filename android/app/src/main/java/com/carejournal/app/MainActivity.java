package com.carejournal.app;

import android.os.Bundle;
import android.os.SystemClock;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long MIN_STARTUP_DURATION_MS = 2000;
    private View startupOverlay;
    private boolean startupReady;
    private boolean startupDismissScheduled;
    private long startupShownAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolderImportPlugin.class);
        registerPlugin(ImageStoragePlugin.class);
        registerPlugin(LanSyncPlugin.class);
        registerPlugin(StartupPlugin.class);
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(getColor(R.color.status_bar_background));
        getWindow().setNavigationBarColor(getColor(R.color.navigation_bar_background));

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);

        showStartupOverlay();
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void showStartupOverlay() {
        startupShownAt = SystemClock.uptimeMillis();
        ViewGroup content = findViewById(android.R.id.content);
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.rgb(247, 240, 232));
        overlay.setClickable(true);
        overlay.setFocusable(true);

        LinearLayout message = new LinearLayout(this);
        message.setOrientation(LinearLayout.VERTICAL);
        message.setGravity(Gravity.CENTER_HORIZONTAL);
        message.setTranslationY(-dp(52));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        message.addView(icon, new LinearLayout.LayoutParams(dp(92), dp(92)));

        ImageView slogan = new ImageView(this);
        slogan.setImageResource(R.drawable.splash_branding);
        slogan.setContentDescription("放化疗只是一时，愿康复如期而至。");
        slogan.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams sloganParams = new LinearLayout.LayoutParams(
            dp(300),
            dp(108)
        );
        sloganParams.topMargin = dp(18);
        message.addView(slogan, sloganParams);

        FrameLayout.LayoutParams messageParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        overlay.addView(message, messageParams);
        content.addView(overlay, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        startupOverlay = overlay;
        if (startupReady) dismissStartupOverlay();
    }

    public void dismissStartupOverlay() {
        startupReady = true;
        View overlay = startupOverlay;
        if (overlay == null) return;
        long remaining = MIN_STARTUP_DURATION_MS - (SystemClock.uptimeMillis() - startupShownAt);
        if (remaining > 0) {
            if (!startupDismissScheduled) {
                startupDismissScheduled = true;
                overlay.postDelayed(() -> {
                    startupDismissScheduled = false;
                    dismissStartupOverlay();
                }, remaining);
            }
            return;
        }
        startupOverlay = null;
        overlay.animate()
            .alpha(0f)
            .setDuration(260)
            .withEndAction(() -> {
                if (overlay.getParent() instanceof ViewGroup) {
                    ((ViewGroup) overlay.getParent()).removeView(overlay);
                }
            })
            .start();
    }
}
