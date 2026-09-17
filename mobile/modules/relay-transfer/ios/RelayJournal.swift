import Foundation
import Security
import CryptoKit

struct RelayFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}
struct RelayPart: Codable { var partNumber: Int; var etag: String }
struct RelayJob: Codable {
  var id: String
  var name: String
  var mime: String
  var kind: String
  var state = "queued"
  var progress = 0
  var message = ""
  var category = "original"
  var mediaId = ""
  var size: Int64 = 0
  var sha256 = ""
  var parts: [RelayPart] = []
  var partSize: Int64 = 16 * 1024 * 1024
}

// Each manifest is replaced atomically; only RelayEngine's actor mutates journal files.
enum RelayJournal {
  static let directory: URL = {
    let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Relay", isDirectory: true)
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    var mutable = url
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try? mutable.setResourceValues(values)
    return url
  }()
  static func file(_ id: String, _ suffix: String) -> URL { directory.appendingPathComponent("\(id).\(suffix)") }
  static func save(_ job: RelayJob) throws { try JSONEncoder().encode(job).write(to: file(job.id, "json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
  static func load(_ id: String) throws -> RelayJob {
    guard UUID(uuidString: id) != nil else { throw RelayFailure(message: "Invalid transfer") }
    return try JSONDecoder().decode(RelayJob.self, from: Data(contentsOf: file(id, "json")))
  }
  static func all() throws -> [RelayJob] {
    try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "json" }.compactMap { try? JSONDecoder().decode(RelayJob.self, from: Data(contentsOf: $0)) }
  }
  static func hash(_ file: URL) throws -> String {
    let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
    var hash = SHA256()
    while let bytes = try input.read(upToCount: 1024 * 1024), !bytes.isEmpty { hash.update(data: bytes) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
}

enum RelayKeychain {
  static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.relay.media", kSecAttrAccount as String: "device"]
  static func save(_ token: String) throws {
    guard token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw RelayFailure(message: "Invalid device credential") }
    let values: [String: Any] = [kSecValueData as String: Data(token.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
      guard SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw RelayFailure(message: "Could not securely pair this phone") }
    } else if status != errSecSuccess { throw RelayFailure(message: "Could not update this device credential") }
  }
  static func read() throws -> String {
    var result: CFTypeRef?
    let lookup = query.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { _, new in new }
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else { throw RelayFailure(message: "Pair this phone first") }
    return token
  }
}
