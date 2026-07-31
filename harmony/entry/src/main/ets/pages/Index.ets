import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { CareJournalBridge } from '../bridge/CareJournalBridge';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: CareJournalBridge = new CareJournalBridge(
    getContext(this) as common.UIAbilityContext
  );

  private bridgeMethods: string[] = [
    'getPlatformInfo',
    'exitApp',
    'listEntities',
    'putEntity',
    'removeEntity',
    'replaceEntities',
    'removeCompletedOcrJobs',
    'persistImage',
    'readImage',
    'garbageCollectImages',
    'pickFiles',
    'saveFile',
    'httpPost',
    'lanStart',
    'lanStop',
    'lanRefresh',
    'lanListPeers',
    'lanSendSync',
    'lanSetTransferActive',
    'lanCompleteSync',
    'lanRejectSync'
  ];

  aboutToDisappear(): void {
    this.bridge.shutdown().catch(() => undefined);
    this.controller.runJavaScript(
      `window.dispatchEvent(new CustomEvent('carejournal:harmony',{detail:{type:'background'}}))`
    );
    this.controller.deleteJavaScriptRegister('CareJournalHarmony');
  }

  onBackPress(): boolean {
    this.controller.runJavaScript(
      `window.dispatchEvent(new CustomEvent('carejournal:harmony',{detail:{type:'backPress'}}))`
    );
    return true;
  }

  build() {
    Column() {
      Web({
        src: $rawfile('www/index.html'),
        controller: this.controller
      })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .javaScriptProxy({
          object: this.bridge,
          name: 'CareJournalHarmony',
          methodList: this.bridgeMethods,
          controller: this.controller
        })
        .onControllerAttached(() => {
          this.bridge.setEventSink((detail: object) => {
            const serialized = JSON.stringify(detail)
              .replaceAll('\\', '\\\\')
              .replaceAll('`', '\\`')
              .replaceAll('${', '\\${');
            this.controller.runJavaScript(
              `window.dispatchEvent(new CustomEvent('carejournal:harmony',{detail:JSON.parse(\`${serialized}\`)}))`
            );
          });
          this.controller.registerJavaScriptProxy(
            this.bridge,
            'CareJournalHarmony',
            this.bridgeMethods
          );
        })
        .onPageEnd(() => {
          this.controller.runJavaScript(
            `window.dispatchEvent(new CustomEvent('carejournal:harmony',{detail:{type:'foreground'}}))`
          );
        });
    }
    .width('100%')
    .height('100%')
  }
}
