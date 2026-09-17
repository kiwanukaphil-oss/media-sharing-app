import Foundation
import ExpoModulesCore
import UIKit

// URLSession owns file-backed tasks even while the JavaScript runtime is suspended.
final class RelayBackgroundSession: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate, @unchecked Sendable {
  static let shared = RelayBackgroundSession()
  static let identifier = "app.relay.media.original-transfers"
  let callbacks = DispatchGroup()
  var completion: (() -> Void)?
  lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = true
    config.waitsForConnectivity = true
    config.timeoutIntervalForResource = 7 * 24 * 3600
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    guard let id = downloadTask.taskDescription, UUID(uuidString: id) != nil else { return }
    let destination = RelayJournal.file(id, "download")
    do {
      // This is private staging, never an existing user file.
      if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
      try FileManager.default.moveItem(at: location, to: destination)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
    } catch { callbacks.enter(); Task { await RelayEngine.shared.fail(id, error.localizedDescription); self.callbacks.leave() } }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let id = task.taskDescription else { return }
    let response = task.response as? HTTPURLResponse
    let status = response?.statusCode ?? 0
    let etag = response?.value(forHTTPHeaderField: "ETag")?.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    callbacks.enter()
    Task { await RelayEngine.shared.finished(id, status: status, etag: etag, error: error); self.callbacks.leave() }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    guard let id = task.taskDescription else { return }
    Task { await RelayEngine.shared.progress(id, transferred: totalBytesSent) }
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    guard let id = downloadTask.taskDescription else { return }
    Task { await RelayEngine.shared.progress(id, transferred: totalBytesWritten) }
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    callbacks.notify(queue: .main) { let callback = self.completion; self.completion = nil; callback?() }
  }
}

public class RelayTransferAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    guard identifier == RelayBackgroundSession.identifier else { completionHandler(); return }
    RelayBackgroundSession.shared.completion = completionHandler
    _ = RelayBackgroundSession.shared.session
  }
}
