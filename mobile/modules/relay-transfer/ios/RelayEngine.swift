import Foundation
import Photos
import UniformTypeIdentifiers

actor RelayEngine {
  static let shared = RelayEngine()
  static let origin = "https://relay-media-exchange.kiwanukaphil.workers.dev"
  private var preparing = Set<String>()

  // Device credentials are sent only to Relay's pinned metadata API, never to signed storage URLs.
  func request(_ method: String, _ path: String, _ body: String?) async throws -> String {
    guard !path.hasPrefix("/"), !path.contains(".."), let url = URL(string: "\(Self.origin)/api/\(path)") else { throw RelayFailure(message: "Invalid API path") }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("Bearer \(try RelayKeychain.read())", forHTTPHeaderField: "Authorization")
    if let body { request.httpBody = Data(body.utf8); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let response = response as? HTTPURLResponse else { throw RelayFailure(message: "No response. Try again.") }
    guard (200..<300).contains(response.statusCode) else {
      let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
      throw RelayFailure(message: message ?? "Request failed. Try again.")
    }
    return String(decoding: data, as: UTF8.self)
  }
  private func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
    let json = try body.map { String(decoding: try JSONSerialization.data(withJSONObject: $0), as: UTF8.self) }
    return try JSONSerialization.jsonObject(with: Data(try await request(method, path, json).utf8)) as? [String: Any] ?? [:]
  }
  func list() throws -> String {
    let rows = try RelayJournal.all().map { ["id": $0.id, "name": $0.name, "state": $0.state, "progress": $0.progress, "message": $0.message] as [String: Any] }
    return String(decoding: try JSONSerialization.data(withJSONObject: rows), as: UTF8.self)
  }
  // Copy the selected resource before returning; the picker cache can disappear after suspension.
  func enqueueUpload(_ uri: String, _ name: String, _ mime: String, _ category: String) async throws -> String {
    guard let source = URL(string: uri), source.isFileURL, ["original", "final"].contains(category) else { throw RelayFailure(message: "Choose an original file") }
    var job = RelayJob(id: UUID().uuidString.lowercased(), name: name, mime: mime, kind: "upload")
    job.category = category
    let granted = source.startAccessingSecurityScopedResource()
    defer { if granted { source.stopAccessingSecurityScopedResource() } }
    let target = RelayJournal.file(job.id, "original")
    try FileManager.default.copyItem(at: source, to: target)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: target.path)
    job.size = (try FileManager.default.attributesOfItem(atPath: target.path)[.size] as? NSNumber)?.int64Value ?? 0
    guard job.size > 0, job.size <= 100 * 1024 * 1024 * 1024 else { throw RelayFailure(message: "File size is unsupported") }
    job.state = "preparing"; try RelayJournal.save(job)
    Task { await resume(job.id) }
    return job.id
  }
  func enqueueDownload(_ json: String) async throws -> String {
    let media = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] ?? [:]
    guard let mediaId = media["id"] as? String, let name = media["name"] as? String, let mime = media["mime"] as? String, let size = media["size"] as? NSNumber, let hash = media["sha256"] as? String else { throw RelayFailure(message: "Invalid media") }
    var job = RelayJob(id: UUID().uuidString.lowercased(), name: name, mime: mime, kind: "download")
    job.mediaId = mediaId; job.size = size.int64Value; job.sha256 = hash
    if mime.hasPrefix("image/") || mime.hasPrefix("video/") { _ = await PHPhotoLibrary.requestAuthorization(for: .addOnly) }
    try RelayJournal.save(job); Task { await resume(job.id) }; return job.id
  }
  // A persisted manifest and file-backed URLSession task let resume skip accepted multipart chunks.
  func resume(_ id: String) async {
    guard !preparing.contains(id) else { return }
    preparing.insert(id); defer { preparing.remove(id) }
    do {
      var job = try RelayJournal.load(id)
      guard job.state != "complete" else { return }
      let tasks = await RelayBackgroundSession.shared.session.allTasks
      guard !tasks.contains(where: { $0.taskDescription == id }) else { return }
      job.message = ""; try RelayJournal.save(job)
      if job.kind == "download" {
        if FileManager.default.fileExists(atPath: RelayJournal.file(id, "download").path) { try await saveVerifiedDownload(id); return }
        let link = try await api("GET", "media/\(job.mediaId)/link")
        var request = URLRequest(url: try storageURL(link))
        request.httpMethod = "GET"
        let task = RelayBackgroundSession.shared.session.downloadTask(with: request)
        task.taskDescription = id; job.state = "saving"; try RelayJournal.save(job); task.resume(); return
      }
      let source = RelayJournal.file(id, "original")
      if job.sha256.isEmpty { job.sha256 = try RelayJournal.hash(source); try RelayJournal.save(job) }
      let upload = try await api("POST", "uploads", ["id": id, "name": job.name, "mime": job.mime, "category": job.category, "size": job.size, "sha256": job.sha256])
      if upload["status"] as? String == "ready" { job.state = "complete"; job.progress = 100; try RelayJournal.save(job); return }
      job.partSize = (upload["partSize"] as? NSNumber)?.int64Value ?? job.partSize
      let total = Int((job.size + job.partSize - 1) / job.partSize)
      guard let number = (1...total).first(where: { number in !job.parts.contains(where: { $0.partNumber == number }) }) else {
        _ = try await api("POST", "uploads/\(id)/complete", ["parts": job.parts.map { ["partNumber": $0.partNumber, "etag": $0.etag] as [String: Any] }])
        job.state = "complete"; job.progress = 100; try RelayJournal.save(job); return
      }
      let signed = try await api("POST", "uploads/\(id)/part", ["number": number])
      let chunk = RelayJournal.file(id, "part")
      let input = try FileHandle(forReadingFrom: source); defer { try? input.close() }
      try input.seek(toOffset: UInt64(Int64(number - 1) * job.partSize))
      let data = try input.read(upToCount: Int(min(job.partSize, job.size - Int64(number - 1) * job.partSize))) ?? Data()
      try data.write(to: chunk, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      var request = URLRequest(url: try storageURL(signed)); request.httpMethod = "PUT"
      let task = RelayBackgroundSession.shared.session.uploadTask(with: request, fromFile: chunk)
      task.taskDescription = id; job.state = "sending"; try RelayJournal.save(job); task.resume()
    } catch { await fail(id, error.localizedDescription) }
  }
  private func storageURL(_ response: [String: Any]) throws -> URL {
    guard let value = response["url"] as? String, let url = URL(string: value), url.scheme == "https", url.host?.hasSuffix(".r2.cloudflarestorage.com") == true else { throw RelayFailure(message: "Invalid storage destination") }
    return url
  }
  func progress(_ id: String, transferred: Int64) {
    guard var job = try? RelayJournal.load(id), ["sending", "saving"].contains(job.state), job.size > 0 else { return }
    let offset = job.kind == "upload" ? Int64(job.parts.count) * job.partSize : 0
    let percent = Int(min(99, (offset + transferred) * 99 / job.size))
    if job.progress != percent { job.progress = percent; try? RelayJournal.save(job) }
  }
  func fail(_ id: String, _ message: String) {
    guard var job = try? RelayJournal.load(id) else { return }
    job.state = "error"; job.message = message; try? RelayJournal.save(job)
  }
  // Commit an ETag before scheduling the next part; completion retries remain idempotent.
  func finished(_ id: String, status: Int, etag: String?, error: Error?) async {
    do {
      var job = try RelayJournal.load(id)
      if let error { throw error }
      guard (200..<300).contains(status) else { throw RelayFailure(message: "Connection interrupted. Tap Resume for a fresh transfer link.") }
      if job.kind == "download" { try await saveVerifiedDownload(id); return }
      guard let etag else { throw RelayFailure(message: "Storage did not acknowledge the original. Tap Resume.") }
      let number = job.parts.count + 1
      job.parts.append(RelayPart(partNumber: number, etag: etag)); try RelayJournal.save(job)
      await resume(id)
    } catch { await fail(id, error.localizedDescription) }
  }
  // PhotoKit receives a verified resource file without an image decode/re-encode step.
  private func saveVerifiedDownload(_ id: String) async throws {
    var job = try RelayJournal.load(id)
    let source = RelayJournal.file(id, "download")
    let size = (try FileManager.default.attributesOfItem(atPath: source.path)[.size] as? NSNumber)?.int64Value
    guard size == job.size, try RelayJournal.hash(source) == job.sha256 else {
      try? FileManager.default.removeItem(at: source)
      throw RelayFailure(message: "Verification failed. Tap Resume to fetch a fresh copy.")
    }
    let photo = job.mime.hasPrefix("image/"); let video = job.mime.hasPrefix("video/")
    if (photo || video) && PHPhotoLibrary.authorizationStatus(for: .addOnly) == .authorized {
      let options = PHAssetResourceCreationOptions(); options.originalFilename = job.name
      options.uniformTypeIdentifier = UTType(mimeType: job.mime)?.identifier
      do {
        try await PHPhotoLibrary.shared().performChanges {
          PHAssetCreationRequest.forAsset().addResource(with: video ? .video : .photo, fileURL: source, options: options)
        }
        job.state = "complete"; job.progress = 100; job.message = "Saved to Photos · original verified"
      } catch { job.state = "ready-to-save"; job.message = "This format can be saved to Files." }
    } else { job.state = "ready-to-save"; job.message = "Original verified. Choose where to save it." }
    try RelayJournal.save(job)
  }
  func exportURL(_ id: String) throws -> URL {
    let job = try RelayJournal.load(id)
    guard job.state == "ready-to-save" else { throw RelayFailure(message: "This file is not ready to save") }
    let folder = RelayJournal.directory.appendingPathComponent(id, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let target = folder.appendingPathComponent((job.name as NSString).lastPathComponent)
    if !FileManager.default.fileExists(atPath: target.path) { try FileManager.default.copyItem(at: RelayJournal.file(id, "download"), to: target) }
    return target
  }
  func exported(_ id: String) {
    guard var job = try? RelayJournal.load(id) else { return }
    job.state = "complete"; job.progress = 100; job.message = "Saved to Files · original verified"; try? RelayJournal.save(job)
  }
}
