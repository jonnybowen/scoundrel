package com.scoundrel.game;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Scoundrel shell. The game is the static Vite build in assets/public; this activity only adds what a browser
 * tab can't: immersive fullscreen, drawing under the display cutout, the panel's top refresh rate, and a back
 * button that maps to the game's own Esc key instead of closing the app.
 */
public class MainActivity extends BridgeActivity {

    /**
     * Dispatches a cancelable Escape keydown into the page. The game's keydown handler calls preventDefault()
     * only when Esc maps to an intent (close menu, decline tutorial offer, cancel a fight choice, leave the
     * recap), so dispatchEvent() returning false means "handled".
     */
    private static final String BACK_JS =
        "(function(){var e=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true});"
            + "return !window.dispatchEvent(e);})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        preferHighestRefreshRate(window);
        hideSystemBars();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                onGameBack();
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    /** Ask for the fastest mode at the current resolution (120 Hz on the S22+); the WebView's rAF follows it. */
    private void preferHighestRefreshRate(Window window) {
        Display display = window.getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode m : display.getSupportedModes()) {
            if (m.getPhysicalWidth() == current.getPhysicalWidth()
                && m.getPhysicalHeight() == current.getPhysicalHeight()
                && m.getRefreshRate() > best.getRefreshRate()) {
                best = m;
            }
        }
        WindowManager.LayoutParams lp = window.getAttributes();
        lp.preferredDisplayModeId = best.getModeId();
        window.setAttributes(lp);
    }

    /** Back = the game's Esc. If Esc had nothing to close, background the app (state kept) instead of finishing. */
    private void onGameBack() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(BACK_JS, handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }
}
