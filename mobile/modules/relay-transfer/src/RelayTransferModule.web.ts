import { registerWebModule, NativeModule } from 'expo';

// RelayTransferModule is not available on the web platform.
class RelayTransferModule extends NativeModule<{}> {}

export default registerWebModule(RelayTransferModule, 'RelayTransferModule');
