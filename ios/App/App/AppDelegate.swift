import UIKit
import Capacitor
import CryptoKit
import WebKit

private func certificateFingerprint(_ trust: SecTrust) -> String? {
    guard let certificate = SecTrustGetCertificateAtIndex(trust, 0) else { return nil }
    let digest = SHA256.hash(data: SecCertificateCopyData(certificate) as Data)
    return digest.map { String(format: "%02x", $0) }.joined()
}

private func certificateEndpointKey(host: String, port: Int) -> String {
    "\(host.lowercased()):\(port > 0 ? port : 443)"
}

private final class CertificateProbeDelegate: NSObject, URLSessionDelegate {
    let completion: (Result<String, Error>) -> Void
    private var completed = false

    init(completion: @escaping (Result<String, Error>) -> Void) {
        self.completion = completion
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard !completed,
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let fingerprint = certificateFingerprint(trust) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completed = true
        completion(.success(fingerprint))
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}

@objc(ServerTrustPlugin)
public final class ServerTrustPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ServerTrustPlugin"
    public let jsName = "ServerTrust"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "probe", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trust", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]
    private static var trustedFingerprints: [String: String] = [:]
    private var probes: [UUID: (URLSession, CertificateProbeDelegate)] = [:]

    private static func normalize(_ value: String) -> String {
        value.replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "sha256:", with: "", options: [.caseInsensitive, .anchored])
            .lowercased()
    }

    @objc public func probe(_ call: CAPPluginCall) {
        guard let endpoint = call.getString("endpoint"), let url = URL(string: endpoint), url.scheme == "https" else {
            call.reject("A valid HTTPS endpoint is required")
            return
        }
        let id = UUID()
        let delegate = CertificateProbeDelegate { [weak self] result in
            defer { self?.probes.removeValue(forKey: id)?.0.invalidateAndCancel() }
            switch result {
            case .success(let fingerprint): call.resolve(["fingerprint": fingerprint])
            case .failure(let error): call.reject("Unable to probe Server certificate", nil, error)
            }
        }
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        probes[id] = (session, delegate)
        session.dataTask(with: url).resume()
    }

    @objc public func trust(_ call: CAPPluginCall) {
        guard let endpoint = call.getString("endpoint"), let url = URL(string: endpoint), url.scheme == "https",
              let host = url.host, let fingerprint = call.getString("fingerprint"), !fingerprint.isEmpty else {
            call.reject("A valid HTTPS endpoint and fingerprint are required")
            return
        }
        Self.trustedFingerprints[certificateEndpointKey(host: host, port: url.port ?? 443)] = Self.normalize(fingerprint)
        call.resolve()
    }

    @objc public func remove(_ call: CAPPluginCall) {
        if let endpoint = call.getString("endpoint"), let url = URL(string: endpoint), let host = url.host {
            Self.trustedFingerprints.removeValue(forKey: certificateEndpointKey(host: host, port: url.port ?? 443))
        }
        call.resolve()
    }

    public override func handleWKWebViewURLAuthenticationChallenge(
        _ challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) -> Bool {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let actual = certificateFingerprint(trust),
              let expected = Self.trustedFingerprints[certificateEndpointKey(
                host: challenge.protectionSpace.host,
                port: challenge.protectionSpace.port
              )],
              Self.normalize(actual) == expected else { return false }
        completionHandler(.useCredential, URLCredential(trust: trust))
        return true
    }
}

@objc(DonutCodeBridgeViewController)
public final class DonutCodeBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ServerTrustPlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
