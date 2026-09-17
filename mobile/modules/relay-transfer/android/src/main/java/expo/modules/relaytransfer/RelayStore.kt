package expo.modules.relaytransfer

import android.content.Context
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

class RelayStore(context: Context) : SQLiteOpenHelper(context, "relay-jobs.db", null, 1) {
  override fun onCreate(db: SQLiteDatabase) { db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)") }
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
  fun save(job: JSONObject) {
    val values = ContentValues().apply { put("id", job.getString("id")); put("payload", job.toString()) }
    writableDatabase.insertWithOnConflict("jobs", null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }
  fun get(id: String): JSONObject? = readableDatabase.rawQuery("SELECT payload FROM jobs WHERE id = ?", arrayOf(id)).use { if (it.moveToFirst()) JSONObject(it.getString(0)) else null }
  fun all(): List<JSONObject> = readableDatabase.rawQuery("SELECT payload FROM jobs ORDER BY rowid DESC", null).use { cursor -> buildList { while (cursor.moveToNext()) add(JSONObject(cursor.getString(0))) } }
}

object RelayCredentials {
  private const val alias = "relay-device-session"
  // The session is encrypted with a non-exportable Keystore key, never stored as plain preferences.
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    return generator.generateKey()
  }
  fun save(context: Context, token: String) {
    require(token.matches(Regex("[a-f0-9]{64}"))) { "Invalid pairing credential" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val encrypted = cipher.doFinal(token.toByteArray())
    context.getSharedPreferences(alias, Context.MODE_PRIVATE).edit().putString("value", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit()
  }
  fun read(context: Context): String {
    val value = context.getSharedPreferences(alias, Context.MODE_PRIVATE).getString("value", null) ?: error("Pair this device first")
    val bytes = Base64.decode(value, Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
    return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
  }
}
