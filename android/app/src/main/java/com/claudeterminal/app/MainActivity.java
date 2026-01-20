package com.claudeterminal.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.os.Build;
import android.content.pm.ApplicationInfo;

import com.getcapacitor.BridgeActivity;
import io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register the barcode scanner plugin
        registerPlugin(BarcodeScannerPlugin.class);

        super.onCreate(savedInstanceState);

        // SECURITY: Only enable WebView debugging in debug builds
        // Remote debugging allows arbitrary code execution via Chrome DevTools
        boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(isDebuggable);
        }

        // Enable WebSocket and other features for local network connections
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();

        // SECURITY: Use COMPATIBILITY mode instead of ALWAYS_ALLOW
        // This allows HTTP content only from the same origin (our local server)
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        // Enable JavaScript (required for the app)
        settings.setJavaScriptEnabled(true);

        // SECURITY: Disable universal file access - prevents sandbox bypass
        // These were allowing any loaded content to read local files
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowFileAccessFromFileURLs(false);

        // Enable DOM storage (needed for app state)
        settings.setDomStorageEnabled(true);
    }
}
