import Capacitor

/// Custom CAPBridgeViewController that registers the in-app Capacitor plugins.
///
/// Declared as the initial view controller in Main.storyboard (customClass="CareJournalBridgeViewController"
/// customModule="App"). Using capacitorDidLoad() is the correct Capacitor 7 hook for
/// registering CAPBridgedPlugin instances — it runs after the bridge is initialised
/// but before the web layer starts loading.
class CareJournalBridgeViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeImageStoragePlugin())
        bridge?.registerPluginInstance(StartupPlugin())
        bridge?.registerPluginInstance(LanSyncPlugin())
    }
}
