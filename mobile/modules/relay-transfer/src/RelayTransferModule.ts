import { NativeModule, requireNativeModule } from 'expo';

declare class RelayTransferModule extends NativeModule<{}> {
  configure(token: string): Promise<void>;
  request(method: string, path: string, body: string | null): Promise<string>;
  listTransfers(): Promise<string>;
  enqueueUpload(uri: string, name: string, mime: string, category: string): Promise<string>;
  enqueueDownload(media: string): Promise<string>;
  resume(id: string): Promise<void>;
  exportFile(id: string): Promise<void>;
}

export default requireNativeModule<RelayTransferModule>('RelayTransfer');
