import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { CareJournalBridge } from '../bridge/CareJournalBridge';

@Entry
@Component
struct Index {
  @State private splashVisible: boolean = true;
  @State private splashOpacity: number = 1;
  private controller: webview.WebviewController = new webview.WebviewController();
  private splashStartedAt: number = Date.now();
  private splashDismissScheduled: boolean = false;
  private bridge: CareJournalBridge = new CareJournalBridge(
    getContext(this) as common.UIAbilityContext
  );

  private bridgeMethods: string[] = [
    'getPlatformInfo',
    'appReady',
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

  private dismissSplash(): void {
    if (this.splashDismissScheduled) {
      return;
    }
    this.splashDismissScheduled = true;
    const remaining = Math.max(0, 2000 - (Date.now() - this.splashStartedAt));
    setTimeout(() => {
      this.splashOpacity = 0;
      setTimeout(() => {
        this.splashVisible = false;
      }, 240);
    }, remaining);
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Column() {
        Web({
          src: 'resource://rawfile/www/index.html',
          controller: this.controller
        })
          .width('100%')
          .height('100%')
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .databaseAccess(true)
          .fileAccess(true)
          .onConsole((event) => {
            if (event) {
              console.info(
                `[ArkWeb] ${event.message.getSourceId()}:${event.message.getLineNumber()} ${event.message.getMessage()}`
              );
            }
            return false;
          })
          .onErrorReceive((event) => {
            if (event) {
              console.error(
                `[ArkWeb] ${event.request.getRequestUrl()} ${event.error.getErrorCode()} ${event.error.getErrorInfo()}`
              );
            }
          })
          .javaScriptProxy({
            object: this.bridge,
            name: 'CareJournalHarmony',
            methodList: this.bridgeMethods,
            controller: this.controller
          })
          .onControllerAttached(() => {
            this.bridge.setAppReadySink(() => this.dismissSplash());
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

      if (this.splashVisible) {
        Column() {
          Image($r('app.media.app_icon'))
            .width(88)
            .height(88)
            .borderRadius(24)
          Text('放化疗只是一时\n愿康复如期而至')
            .margin({ top: 24 })
            .width('100%')
            .fontSize(22)
            .fontWeight(FontWeight.Medium)
            .fontColor('#3F302B')
            .letterSpacing(1)
            .textAlign(TextAlign.Center)
            .maxLines(2)
        }
        .width('100%')
        .height('100%')
        .padding({ left: 24, right: 24, bottom: 104 })
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#F7F1E8')
        .opacity(this.splashOpacity)
        .animation({ duration: 240, curve: Curve.EaseOut })
      }
    }
    .width('100%')
    .height('100%')
  }
}
