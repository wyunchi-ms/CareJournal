import Capacitor

/// Capacitor plugin "Startup" — iOS counterpart to Android's StartupPlugin.
///
/// On Android, ready() dismisses a native splash overlay.
/// On iOS there is no such overlay managed by this plugin,
/// so ready() resolves immediately to unblock the web layer.
public class StartupPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "StartupPlugin"
    public let jsName = "Startup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
    ]

    @objc func ready(_ call: CAPPluginCall) {
        call.resolve()
    }
}
