# Relay native app

The shared React Native screen uses a local Expo module for transfers. It requires a native build; Expo Go cannot load this module. The API is pinned to the deployed Relay Worker. Device credentials stay in Android Keystore-encrypted preferences or iOS Keychain.

## Run on Android

Requirements: Node 22.13+, Java 17, Android SDK 36 and USB debugging. Android 10+ is the supported baseline because verified gallery writes use MediaStore pending entries.

```sh
cd mobile
npm ci
npx expo prebuild --platform android --no-install
npx expo run:android --device
```

Pair once using the desktop's device invitation QR, or paste the invitation. The default feed has Originals and Final cuts. Tap Drop, select files in the system picker, and they immediately enter the native queue. Tap Save to device to download, verify SHA-256, and publish images/videos to Pictures/Relay or Movies/Relay. Other formats go to Download/Relay.

Android 14+ uses user-initiated JobScheduler transfers with notifications; older versions use a foreground data-sync service. Uploads are staged durably, hashed in bounded buffers, and sent in 16 MiB multipart chunks. Accepted ETags are journaled in SQLite. Downloads resume through HTTP Range. Transient connection failures retry with backoff; interrupted jobs expose Resume.

## Build iOS on a Mac

```sh
cd mobile
npm ci
npx expo prebuild --platform ios
npx expo run:ios --device
```

Use the Xcode version required by Expo SDK 57. Configure your Apple signing team in Xcode. The Swift module uses a background URLSession with file-backed multipart upload tasks and atomic manifests. Verified compatible downloads import through PhotoKit with add-only permission. Other formats expose a Files export sheet.

**The iOS source has not been compiled or exercised on a device in this Windows workspace.** It is not a verified iOS release. Validate background relaunch, large-file staging, PhotoKit imports, Files export, and signing on a Mac before distribution.

## Current boundaries

- This build imports files through the system document picker. Dedicated capture and original PhotoKit/MediaStore resource extraction, including Live Photo pairs and RAW companions, remain pending. A provider may supply an exported representation; Relay preserves the exact selected bytes, not resources the provider did not supply.
- First-use permissions and OS pickers are outside the two normal in-app actions. An OS permission prompt cannot safely be eliminated.
- OS force-stop, device reboot, exhausted storage, and revoked permissions can require reopening and resuming. No mobile platform permits an unconditional background-execution guarantee.
- Staged originals and verified downloads are retained in app-private storage for recovery. A user-visible cache cleanup policy is still needed before broad rollout.
- The iOS manual download retry currently starts a fresh request; active background downloads are managed by URLSession. Multipart uploads retain accepted chunks.
- App-store signing and distribution are not configured. A debug build is for testing, not production distribution.

Reference APIs: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Android user-initiated transfers](https://developer.android.com/develop/background-work/background-tasks/uidt), [Apple background downloads](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background).
