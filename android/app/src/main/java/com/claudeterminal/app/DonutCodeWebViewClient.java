package com.claudeterminal.app;

import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

public final class DonutCodeWebViewClient extends BridgeWebViewClient {
    private static final ConcurrentHashMap<String, String> trustedFingerprints = new ConcurrentHashMap<>();

    public DonutCodeWebViewClient(Bridge bridge) {
        super(bridge);
    }

    static void trust(String hostname, int port, String fingerprint) {
        trustedFingerprints.put(hostname.toLowerCase(Locale.ROOT) + ":" + port, normalize(fingerprint));
    }

    static void remove(String hostname, int port) {
        trustedFingerprints.remove(hostname.toLowerCase(Locale.ROOT) + ":" + port);
    }

    static String normalize(String fingerprint) {
        return fingerprint.replace(":", "").replaceFirst("(?i)^sha256", "").toLowerCase(Locale.ROOT);
    }

    static String sha256(byte[] certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate);
        StringBuilder result = new StringBuilder(digest.length * 2);
        for (byte value : digest) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        try {
            java.net.URL endpoint = new java.net.URL(error.getUrl());
            String hostname = endpoint.getHost().toLowerCase(Locale.ROOT);
            int port = endpoint.getPort() == -1 ? 443 : endpoint.getPort();
            String expected = trustedFingerprints.get(hostname + ":" + port);
            Bundle state = SslCertificate.saveState(error.getCertificate());
            byte[] certificate = state == null ? null : state.getByteArray("x509-certificate");
            if (expected != null && certificate != null && expected.equals(sha256(certificate))) {
                handler.proceed();
                return;
            }
        } catch (Exception ignored) {
            // Fail closed below.
        }
        handler.cancel();
    }
}
