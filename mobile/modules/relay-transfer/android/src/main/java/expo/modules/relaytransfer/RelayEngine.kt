package expo.modules.relaytransfer

import android.content.Context
import android.content.ContentValues
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import org.json.JSONObject
import org.json.JSONArray

class RelayEngine(private val context: Context, private val stopped: () -> Boolean, private val progress: (String, Int) -> Unit) {
  private val store = RelayStore(context)
  companion object { const val ORIGIN = "https://relay-media-exchange.kiwanukaphil.workers.dev" }
  private fun checkRunning() { if (stopped()) throw CancellationException("Paused by Android; tap Resume when ready") }
  // Only the pinned API receives the device token; storage requests receive signed URLs alone.
  fun api(method: String, path: String, body: JSONObject? = null): JSONObject {
    require(!path.contains("..") && !path.startsWith("/"))
    val connection = URL("$ORIGIN/api/$path").openConnection() as HttpURLConnection
    connection.requestMethod = method
    connection.connectTimeout = 30000; connection.readTimeout = 60000
    connection.setRequestProperty("Authorization", "Bearer ${RelayCredentials.read(context)}")
    try {
      if (body != null) {
        connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(body.toString().toByteArray()) }
      }
      val status = connection.responseCode
      val result = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
      val json = JSONObject(result)
      if (status == 408 || status == 429 || status >= 500) throw IOException("Connection interrupted. Retrying…")
      if (status !in 200..299) error(json.optString("error", "Request failed ($status)"))
      return json
    } finally { connection.disconnect() }
  }
  private fun publish(job: JSONObject, state: String, percent: Int = job.optInt("progress")) {
    if (job.optString("state") == state && job.optInt("progress", -1) == percent) return
    job.put("state", state).put("progress", percent); store.save(job); progress(job.getString("name"), percent)
  }
  // SQLite journals survive process death; only the OS service executes work, not the React screen.
  fun run(id: String) {
    val job = store.get(id) ?: return
    if (job.optString("state") == "complete") return
    try {
      checkRunning()
      job.remove("message")
      publish(job, "resuming")
      var attempt = 0
      while (true) {
        try {
          if (job.getString("kind") == "upload") upload(job) else download(job)
          break
        } catch (network: IOException) {
          if (++attempt >= 4) throw network
          publish(job, "reconnecting")
          repeat(1 shl attempt) { checkRunning(); Thread.sleep(1000) }
        }
      }
      publish(job, "complete", 100)
    } catch (failure: Exception) {
      job.put("message", failure.message ?: "Transfer interrupted. Tap Resume.")
      publish(job, if (failure is CancellationException) "paused" else "error")
    } finally { store.close() }
  }
  // Copy into app-owned storage atomically before hashing or uploading; never transform media bytes.
  private fun stageOriginal(job: JSONObject): File {
    val directory = File(context.filesDir, "relay-originals").apply { mkdirs() }
    val target = File(directory, job.getString("id"))
    if (target.exists()) return target
    publish(job, "preparing")
    val staging = File(directory, "${job.getString("id")}.staging")
    val source = Uri.parse(job.getString("uri"))
    val input = if (source.scheme == "file") File(source.path!!).inputStream() else context.contentResolver.openInputStream(source) ?: error("Original file is unavailable. Select it again.")
    input.use { incoming -> staging.outputStream().use { output ->
      val buffer = ByteArray(1024 * 1024)
      while (true) { checkRunning(); val count = incoming.read(buffer); if (count < 0) break; output.write(buffer, 0, count) }
    } }
    check(staging.length() > 0 && staging.length() <= 100L * 1024 * 1024 * 1024) { "File size is unsupported" }
    check(staging.renameTo(target)) { "Couldn't retain the original on this device" }
    return target
  }
  private fun hash(file: File): String {
    val hash = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(1024 * 1024); while (true) { checkRunning(); val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) } }
    return hash.digest().joinToString("") { "%02x".format(it) }
  }
  // Persist each accepted ETag so a retry uploads only missing parts of the same immutable file.
  private fun upload(job: JSONObject) {
    val file = stageOriginal(job)
    if (!job.has("sha256")) { job.put("sha256", hash(file)); store.save(job) }
    val input = JSONObject().put("id", job.getString("id")).put("name", job.getString("name")).put("mime", job.getString("mime"))
      .put("size", file.length()).put("sha256", job.getString("sha256")).put("category", job.getString("category"))
    val upload = api("POST", "uploads", input)
    if (upload.getString("status") == "ready") return
    val partSize = upload.getInt("partSize")
    val parts = job.optJSONArray("parts") ?: JSONArray().also { job.put("parts", it) }
    val total = ((file.length() + partSize - 1) / partSize).toInt()
    for (number in 1..total) {
      checkRunning()
      if ((0 until parts.length()).any { parts.getJSONObject(it).getInt("partNumber") == number }) continue
      val signed = api("POST", "uploads/${job.getString("id")}/part", JSONObject().put("number", number)).getString("url")
      requireStorageUrl(signed)
      val connection = URL(signed).openConnection() as HttpURLConnection
      val offset = (number - 1).toLong() * partSize
      val size = minOf(partSize.toLong(), file.length() - offset)
      try {
        connection.requestMethod = "PUT"; connection.doOutput = true; connection.setFixedLengthStreamingMode(size)
        connection.connectTimeout = 30000; connection.readTimeout = 120000
        file.inputStream().use { source ->
          source.channel.position(offset)
          connection.outputStream.use { output ->
            val buffer = ByteArray(256 * 1024); var remaining = size
            while (remaining > 0) { checkRunning(); val count = source.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt()); check(count > 0); output.write(buffer, 0, count); remaining -= count
              publish(job, "sending", ((offset + size - remaining) * 99 / file.length()).toInt()) }
          }
        }
        if (connection.responseCode !in 200..299) throw IOException("Connection interrupted. Resume to retry this part.")
        val etag = connection.getHeaderField("ETag")?.trim('"') ?: error("Storage did not acknowledge this part")
        parts.put(JSONObject().put("partNumber", number).put("etag", etag)); store.save(job)
      } finally { connection.disconnect() }
    }
    api("POST", "uploads/${job.getString("id")}/complete", JSONObject().put("parts", parts))
  }
  private fun requireStorageUrl(value: String) {
    val url = URL(value)
    require(url.protocol == "https" && url.host.endsWith(".r2.cloudflarestorage.com")) { "Untrusted storage URL" }
  }
  // Resume an interrupted download by byte range, then verify before exposing it to other apps.
  private fun download(job: JSONObject) {
    val directory = File(context.filesDir, "relay-downloads").apply { mkdirs() }
    val target = File(directory, job.getString("id"))
    val expected = job.getLong("size")
    if (target.length() != expected) {
      val signed = api("GET", "media/${job.getString("mediaId")}/link").getString("url")
      requireStorageUrl(signed)
      val connection = URL(signed).openConnection() as HttpURLConnection
      val offset = target.length()
      try {
        connection.connectTimeout = 30000; connection.readTimeout = 120000
        if (offset > 0) connection.setRequestProperty("Range", "bytes=$offset-")
        val status = connection.responseCode
        if (status != 200 && status != 206) throw IOException("Download interrupted. Tap Resume.")
        val append = status == 206 && offset > 0
        if (append) check(connection.getHeaderField("Content-Range")?.startsWith("bytes $offset-") == true)
        connection.inputStream.use { input -> java.io.FileOutputStream(target, append).use { output ->
          val buffer = ByteArray(256 * 1024); var received = if (append) offset else 0L
          while (true) { checkRunning(); val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count); received += count; check(received <= expected); publish(job, "saving", (received * 99 / expected).toInt()) }
        } }
      } finally { connection.disconnect() }
    }
    if (target.length() != expected || hash(target) != job.getString("sha256")) {
      // Discard only this app-owned corrupt staging file so Resume can fetch a fresh original.
      target.delete()
      error("File verification failed. Tap Resume to download a fresh copy.")
    }
    saveToDevice(job, target)
  }
  // Pending MediaStore entries stay invisible until the verified original is fully copied.
  private fun saveToDevice(job: JSONObject, source: File) {
    val mime = job.getString("mime")
    val image = mime.startsWith("image/"); val video = mime.startsWith("video/")
    val collection = if (image) MediaStore.Images.Media.EXTERNAL_CONTENT_URI else if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Downloads.EXTERNAL_CONTENT_URI
    val relative = if (image) "${Environment.DIRECTORY_PICTURES}/Relay" else if (video) "${Environment.DIRECTORY_MOVIES}/Relay" else "${Environment.DIRECTORY_DOWNLOADS}/Relay"
    val values = ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, job.getString("name")); put(MediaStore.MediaColumns.MIME_TYPE, mime); put(MediaStore.MediaColumns.RELATIVE_PATH, relative); put(MediaStore.MediaColumns.IS_PENDING, 1) }
    val destination = if (job.has("destination")) Uri.parse(job.getString("destination")) else context.contentResolver.insert(collection, values) ?: error("Couldn't create the saved file")
    job.put("destination", destination.toString()); store.save(job)
    context.contentResolver.openOutputStream(destination, "wt")!!.use { output -> source.inputStream().use { input ->
      val buffer = ByteArray(256 * 1024); while (true) { checkRunning(); val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count) }
    } }
    context.contentResolver.update(destination, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    job.put("message", if (image || video) "Saved to your gallery · original verified" else "Saved to Downloads · original verified")
  }
}
