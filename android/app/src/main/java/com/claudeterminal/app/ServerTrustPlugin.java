package com.claudeterminal.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

@CapacitorPlugin(name = "ServerTrust")
public final class ServerTrustPlugin extends Plugin {
    @PluginMethod
    public void probe(PluginCall call) {
        try {
            URI endpoint = URI.create(call.getString("endpoint", ""));
            if (!"https".equalsIgnoreCase(endpoint.getScheme()) || endpoint.getHost() == null) {
                call.reject("A valid HTTPS endpoint is required");
                return;
            }
            int port = endpoint.getPort() > 0 ? endpoint.getPort() : 443;
            TrustManager[] trustAll = new TrustManager[]{new X509TrustManager() {
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            }};
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, trustAll, new SecureRandom());
            try (SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket(endpoint.getHost(), port)) {
                socket.setSoTimeout(5000);
                socket.startHandshake();
                Certificate certificate = socket.getSession().getPeerCertificates()[0];
                JSObject result = new JSObject();
                result.put("fingerprint", DonutCodeWebViewClient.sha256(certificate.getEncoded()));
                call.resolve(result);
            }
        } catch (Exception error) {
            call.reject("Unable to probe Server certificate", error);
        }
    }

    @PluginMethod
    public void trust(PluginCall call) {
        try {
            URI endpoint = URI.create(call.getString("endpoint", ""));
            String fingerprint = call.getString("fingerprint", "");
            if (!"https".equalsIgnoreCase(endpoint.getScheme()) || endpoint.getHost() == null || fingerprint.isEmpty()) {
                call.reject("A valid HTTPS endpoint and fingerprint are required");
                return;
            }
            int port = endpoint.getPort() > 0 ? endpoint.getPort() : 443;
            DonutCodeWebViewClient.trust(endpoint.getHost(), port, fingerprint);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to trust Server certificate", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            URI endpoint = URI.create(call.getString("endpoint", ""));
            int port = endpoint.getPort() > 0 ? endpoint.getPort() : 443;
            if (endpoint.getHost() != null) DonutCodeWebViewClient.remove(endpoint.getHost(), port);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to remove Server certificate trust", error);
        }
    }
}
