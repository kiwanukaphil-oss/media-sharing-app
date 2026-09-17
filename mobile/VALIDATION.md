# Native validation — 17 September 2026

Device: Samsung Galaxy S24+ (SM-S926U), Android 14 / API 34, connected over USB. The device was paired with the isolated **Relay verification** space. No personal media was selected for testing.

Passed:

- TypeScript type-check for the mobile app and the web app.
- Android ARM64 debug build, installation, and launch with an embedded JavaScript bundle and Metro stopped.
- Invitation-link pairing on the physical phone; credential persistence through app reinstall/update.
- A 10,249-byte PNG selected from the Android document picker and sent by the native JobScheduler engine directly to R2.
- Visibility from a separately paired desktop session and byte-for-byte/hash equality of the cloud copy.
- Verified gallery saving while the app was backgrounded; the resulting Pictures/Relay file was pulled and SHA-256 matched the original.
- A 67,109,888-byte fixture uploaded in five parts while the app was in the background. The desktop download matched every byte and the source SHA-256.
- Controlled app force-stop during the 64 MiB download. Reopening exposed Resume at 11%; resuming completed in the background and the saved Download/Relay file matched the original SHA-256.
- Hosted native-auth tests: invitation required, untrusted Origin rejected, one-use redemption, bearer access, malformed credential rejection, and device revocation.
- Existing web streaming-save integrity and hosted anonymous-access regression checks.

Pending:

- Real disconnected-network recovery, low disk space, revoked storage permissions, Android 10–13 foreground-service fallback, reboot, and representative 4K/RAW/HDR originals.
- iOS compilation, signing, background relaunch, Photos/Files saving, and device tests. A Mac is required.

The app retains its staged test originals for recovery. Named test fixtures are also retained in the isolated cloud space and the phone's Download/Relay and Pictures/Relay locations as applicable. This is a debug preview, not a signed production release.
