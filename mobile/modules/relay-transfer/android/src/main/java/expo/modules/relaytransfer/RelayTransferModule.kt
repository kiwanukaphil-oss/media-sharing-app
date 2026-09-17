package expo.modules.relaytransfer

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import org.json.JSONArray
import java.util.UUID
import android.app.job.JobScheduler
import android.os.Build

class RelayTransferModule : Module() {
  // Bridge calls persist transfer intent; OS services own the actual file and network work.
  override fun definition() = ModuleDefinition {
    Name("RelayTransfer")

    AsyncFunction("configure") { token: String -> RelayCredentials.save(requireNotNull(appContext.reactContext), token) }
    AsyncFunction("request") { method: String, path: String, body: String? ->
      RelayEngine(requireNotNull(appContext.reactContext), { false }) { _, _ -> }.api(method, path, body?.let { JSONObject(it) }).toString()
    }
    AsyncFunction("listTransfers") {
      val context = requireNotNull(appContext.reactContext)
      val scheduled = if (Build.VERSION.SDK_INT >= 34) context.getSystemService(JobScheduler::class.java).allPendingJobs.map { it.extras.getString("id") }.toSet() else null
      RelayStore(context).use { store ->
        JSONArray(store.all().map { job ->
          // Force-stop removes OS jobs. Make orphaned manifests explicitly resumable on reopening.
          if (scheduled != null && !scheduled.contains(job.getString("id")) && job.getString("state") !in listOf("complete", "error", "paused")) {
            job.put("state", "paused").put("message", "Transfer paused. Tap Resume to continue."); store.save(job)
          }
          JSONObject().put("id", job.getString("id")).put("name", job.getString("name")).put("state", job.getString("state")).put("progress", job.optInt("progress")).put("message", job.optString("message"))
        }).toString()
      }
    }
    // The module records intent immediately; all file/network work belongs to the OS service.
    AsyncFunction("enqueueUpload") { uri: String, name: String, mime: String, category: String ->
      val context = requireNotNull(appContext.reactContext)
      require(category == "original" || category == "final")
      try { context.contentResolver.takePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: SecurityException) {}
      val id = UUID.randomUUID().toString()
      val job = JSONObject().put("id", id).put("kind", "upload").put("uri", uri).put("name", name).put("mime", mime).put("category", category).put("state", "queued").put("parts", JSONArray())
      RelayStore(context).use { it.save(job) }; RelayNotifications.schedule(context, id); id
    }
    AsyncFunction("enqueueDownload") { media: String ->
      val context = requireNotNull(appContext.reactContext)
      val job = JSONObject(media); val id = UUID.randomUUID().toString()
      job.put("mediaId", job.getString("id")).put("id", id).put("kind", "download").put("state", "queued")
      RelayStore(context).use { it.save(job) }; RelayNotifications.schedule(context, id); id
    }
    AsyncFunction("resume") { id: String -> RelayNotifications.schedule(requireNotNull(appContext.reactContext), id) }
  }
}
