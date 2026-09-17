import ExpoModulesCore
import UIKit

public class RelayTransferModule: Module {
  private var exportDelegate: RelayExportDelegate?
  // Native session delegates continue transferring files when React is suspended.
  public func definition() -> ModuleDefinition {
    Name("RelayTransfer")

    AsyncFunction("configure") { (token: String) in try RelayKeychain.save(token) }
    AsyncFunction("request") { (method: String, path: String, body: String?) async throws -> String in
      try await RelayEngine.shared.request(method, path, body)
    }
    AsyncFunction("listTransfers") { () async throws -> String in try await RelayEngine.shared.list() }
    AsyncFunction("enqueueUpload") { (uri: String, name: String, mime: String, category: String) async throws -> String in
      try await RelayEngine.shared.enqueueUpload(uri, name, mime, category)
    }
    AsyncFunction("enqueueDownload") { (media: String) async throws -> String in try await RelayEngine.shared.enqueueDownload(media) }
    AsyncFunction("resume") { (id: String) async in await RelayEngine.shared.resume(id) }
    AsyncFunction("exportFile") { (id: String) async throws in
      let url = try await RelayEngine.shared.exportURL(id)
      try await MainActor.run {
        guard let controller = self.appContext?.utilities?.currentViewController() else { throw RelayFailure(message: "Reopen Relay to choose a save location") }
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        let delegate = RelayExportDelegate(id: id); self.exportDelegate = delegate; picker.delegate = delegate
        controller.present(picker, animated: true)
      }
    }
  }
}
final class RelayExportDelegate: NSObject, UIDocumentPickerDelegate {
  let id: String
  init(id: String) { self.id = id }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    if !urls.isEmpty { Task { await RelayEngine.shared.exported(id) } }
  }
}
