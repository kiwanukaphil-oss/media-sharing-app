package expo.modules.relaytransfer

import android.app.*
import android.app.job.*
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import android.os.IBinder
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

object RelayNotifications {
  fun notification(context: Context, title: String, percent: Int): Notification {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel("relay-transfers", "Media transfers", NotificationManager.IMPORTANCE_LOW))
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
    val pending = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return Notification.Builder(context, "relay-transfers").setContentTitle(title).setContentText("Relay · original quality")
      .setSmallIcon(android.R.drawable.stat_sys_upload).setContentIntent(pending).setOngoing(true).setProgress(100, percent, percent == 0).build()
  }
  // Schedule while the user is foregrounded; newer Android owns the transfer independently of JS.
  fun schedule(context: Context, id: String) {
    if (Build.VERSION.SDK_INT >= 34) {
      val extras = PersistableBundle().apply { putString("id", id) }
      val info = JobInfo.Builder(id.hashCode() and 0x7fffffff, ComponentName(context, RelayTransferJob::class.java))
        .setUserInitiated(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setExtras(extras).build()
      check(context.getSystemService(JobScheduler::class.java).schedule(info) == JobScheduler.RESULT_SUCCESS) { "Android deferred this transfer. Reopen Relay and tap Resume." }
    } else {
      context.startForegroundService(Intent(context, RelayTransferService::class.java).putExtra("id", id))
    }
  }
}

class RelayTransferJob : JobService() {
  private val workers = Executors.newFixedThreadPool(2)
  private val stopped = ConcurrentHashMap<Int, AtomicBoolean>()
  // A required notification accompanies each user-initiated job; the journal supports OS restarts.
  override fun onStartJob(parameters: JobParameters): Boolean {
    val id = parameters.extras.getString("id") ?: return false
    val cancellation = AtomicBoolean(false); stopped[parameters.jobId] = cancellation
    if (Build.VERSION.SDK_INT >= 34) setNotification(parameters, parameters.jobId, RelayNotifications.notification(this, "Moving your original", 0), JOB_END_NOTIFICATION_POLICY_REMOVE)
    workers.execute {
      RelayEngine(this, { cancellation.get() }) { title, percent ->
        if (!cancellation.get()) getSystemService(NotificationManager::class.java).notify(parameters.jobId, RelayNotifications.notification(this, title, percent))
      }.run(id)
      stopped.remove(parameters.jobId)
      if (!cancellation.get()) jobFinished(parameters, false)
    }
    return true
  }
  override fun onStopJob(parameters: JobParameters): Boolean {
    stopped[parameters.jobId]?.set(true)
    return parameters.stopReason != JobParameters.STOP_REASON_USER
  }
}

class RelayTransferService : Service() {
  private val workers = Executors.newSingleThreadExecutor()
  private val stopped = AtomicBoolean(false)
  override fun onBind(intent: Intent?): IBinder? = null
  // Older Android receives the same durable engine through a foreground data-sync service.
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("id") ?: return START_NOT_STICKY
    startForeground(7301, RelayNotifications.notification(this, "Moving your original", 0))
    workers.execute {
      RelayEngine(this, { stopped.get() }) { title, percent -> getSystemService(NotificationManager::class.java).notify(7301, RelayNotifications.notification(this, title, percent)) }.run(id)
      stopSelfResult(startId)
    }
    return START_REDELIVER_INTENT
  }
  override fun onDestroy() { stopped.set(true); workers.shutdown(); super.onDestroy() }
  override fun onTimeout(startId: Int, fgsType: Int) { stopped.set(true); stopSelf() }
}
