# Releasing the Overdeck phone app

How the phone app (`apps/mobile`) gets to TestFlight and the Google Play internal testing track.
The plan is the [PAN-4841 PRD](../../.pan/drafts/PAN-4841.md).

## Before you start

- The operator does every console step below once. Only the operator can sign in to the Apple,
  Google Play, Firebase and Google Cloud consoles, and only the operator accepts terms, pays, or
  answers legal declarations (export compliance, content rating, data safety).
- The work agent does everything else: it builds and signs the app, uploads the iOS build from the
  Mac rig, commits `google-services.json`, and sets the push secrets on the connect Worker.
- The agent will run `wrangler secret put` for the five push secrets on `overdeck-connect` and
  will never run `wrangler deploy` or `wrangler rollback`.
- Overdeck uses its own Firebase project and service account. Never use MYN's Firebase project
  `mind-your-now` or its service account.
- Both stores show the developer account's name as the seller: Apple team `KUU2VM9GB9` and the
  existing Google Play developer account, which also publish MYN. No new enrollment is needed.
- No App Groups are used. iOS push goes to APNs directly, so there is no Firebase iOS app and no
  `GoogleService-Info.plist`.

## Operator checklist

> **Status, 2026-11-04 (PAN-4841).** The operator decided the agent does the console steps itself,
> with the operator only signing in. The agent completed A1–A6, F1–F4 and P1–P3 that way: Firebase
> through gcloud and the Firebase API, Apple and Play in a headed Chromium (profile
> `~/.overdeck/browser-profiles/pan-4841`), and the App Store Connect API where it works. The push
> values were produced directly into `~/.overdeck/secrets/` (mode 0600), so the secret requests
> below (C1) were not used. **Still open, operator only:** K1 (back up the upload key and its
> password) and P4 (Play "App content"; its privacy-policy URL goes live when
> eltmon/overdeck-landing#7 merges). The App Store name is "Overdeck Anywhere" because "Overdeck" was
> taken.

Do the steps in order within each group. The A, F and P groups are independent of each other.

- **A1** developer.apple.com → Identifiers: register `ai.overdeck.app` (enable **Push Notifications**), `ai.overdeck.app.NotificationService`, `ai.overdeck.app.widgets`. No App Groups.
- **A2** developer.apple.com → Keys: create an APNs auth key ("Apple Push Notifications service (APNs)", environment Sandbox & Production). If Apple refuses because the team already has two, reuse an existing key (a key is team-wide; each push names `ai.overdeck.app` as its topic). Keep the `.p8` file; note the key id and whether the key is new or reused.
- **A3** App Store Connect → Apps → New App: platform iOS, name "Overdeck" (if taken, "Overdeck Anywhere"; the name under the icon stays "Overdeck"), primary language English (U.S.), bundle id `ai.overdeck.app`, SKU `overdeck-ios`, user access Full Access.
- **A4** App Store Connect → the app → TestFlight → Internal Testing: create group "Operator", add yourself, and turn on **Enable automatic distribution** so each processed build reaches your iPhone.
- **A5** On the Mac rig: Xcode → Settings → Accounts shows the Apple ID for team `KUU2VM9GB9` and is not expired.
- **A6** After the first build is processed: answer the export-compliance question in TestFlight (facts in "Store facts").
- **F1** console.firebase.google.com → Add project, name "Overdeck" (a new project; never `mind-your-now`). Google Analytics: off.
- **F2** Project settings → Add app → Android, package `ai.overdeck.app`, nickname "Overdeck Android". Download `google-services.json`. No SHA certificate is needed for FCM.
- **F3** Project settings → Cloud Messaging: check that "Firebase Cloud Messaging API (V1)" is Enabled.
- **F4** Google Cloud console for the same project → IAM → Service accounts → Create `overdeck-fcm-sender` with role **Firebase Cloud Messaging API Admin**; Keys → Add key → JSON. If the console refuses to create a key, or you prefer it, use the Firebase console instead: Project settings → Service accounts → "Generate new private key" for the `firebase-adminsdk` account of the same project.
- **P1** play.google.com/console → Create app: name "Overdeck" (if taken, "Overdeck Anywhere"), default language English (United States), App, Free, accept the declarations.
- **P2** Testing → Internal testing → Testers: create list "Operator" with your Google account.
- **P3** Wait for the agent's message that `apps/mobile/release/overdeck-1.0-1.aab` exists. Internal testing → Create new release; Play App Signing: "Use Google-generated key"; upload the AAB by hand (Google requires the first upload in the console); release name `1.0 (1)`; Review → Start rollout to Internal testing.
- **P4** Policy → App content: privacy policy `https://overdeck.ai/privacy/app`; App access: "All or some functionality is restricted" with sign-in instructions; Ads: No; Content rating questionnaire; Target audience: 18 and over; Data safety (facts in "Store facts"); Government apps: No; Financial features: None; Health: No. If Play refuses to roll out the P3 release until these declarations are complete, do P4 first.
- **C1** When the agent's secret requests appear in the Overdeck dashboard, paste the values (next section). Paste whole files; one line is fine.
- **K1** Copy the content of `~/.overdeck/secrets/android-upload.password` into your password manager, entry "Overdeck Android upload key", and back up `~/.overdeck/secrets/android-upload.jks` with it.

## Secrets the agent requests

These are the values the connect Worker needs. On 2026-11-04 the agent produced them itself (see
the status note above); the secret-request flow below is the fallback when it cannot.

The agent asks for each value through a secret request in the Overdeck dashboard. You type or paste
the value there; it never appears in chat, the repo, a commit or an issue comment.

| Name | What to paste | From step |
| --- | --- | --- |
| `GOOGLE_SERVICES_JSON` | The whole `google-services.json` file. It is not secret, but it arrives the same way. | F2 |
| `FCM_SERVICE_ACCOUNT_JSON` | The whole service-account JSON key file. | F4 |
| `APNS_KEY_P8` | The content of the `AuthKey_<key id>.p8` file. | A2 |
| `APNS_KEY_ID` | The 10-character key id of that APNs key. | A2 |
| `APNS_TEAM_ID` | The Apple team id that owns the key. Default `KUU2VM9GB9`. | A2 |

Values go only into the connect Worker (`wrangler secret put`), or, for `google-services.json`,
into the repo at `apps/mobile/android/app/google-services.json`. The fifth Worker secret,
`FCM_PROJECT_ID`, is not requested: the agent takes it from `project_info.project_id` in
`google-services.json` and checks that it matches the service account's `project_id`.

## Build and upload

### Build numbers

Both scripts take `--build <n>`, a positive integer: the Android `versionCode` and the iOS
`CFBundleVersion` (the app and both extensions get the same number). Each store refuses a number
it has already seen, so use the next one; the first upload to each store is `--build 1`. The
version name stays `1.0` unless you pass `--version-name` (Android). Nothing is committed per
build.

### Android (this host)

```bash
apps/mobile/scripts/build-android.sh --build <n> \
  [--version-name 1.0] \
  [--keystore ~/.overdeck/secrets/android-upload.jks] \
  [--password-file ~/.overdeck/secrets/android-upload.password] \
  [--alias overdeck-upload]
```

The script needs the upload keystore and its password file, `apps/mobile/android/upload-certificate.sha1`
and `apps/mobile/android/app/google-services.json`, and stops naming the first one that is missing.
It builds the web bundle, syncs Capacitor, runs `bundleRelease` with JDK 21, checks the signature
with `jarsigner -verify`, and checks that the signer's SHA-1 equals the pinned certificate. The
bundle lands in `apps/mobile/release/overdeck-<version>-<n>.aab` (ignored by git). Upload it in
Play Console → Testing → Internal testing → Create new release.

The upload key is `~/.overdeck/secrets/android-upload.jks` (PKCS12, alias `overdeck-upload`) and its
password is in `~/.overdeck/secrets/android-upload.password` (the folder is mode 700, the files
600). Neither is in the repo; only the certificate's SHA-1 is. Keep the password in the password
manager and a backup of the keystore with it (step K1). If the key is lost, Play App Signing lets
Play Console support reset the upload key, which is slow.

Debug and CI builds stay unsigned: Gradle signs the release build only when
`OVERDECK_UPLOAD_KEYSTORE` is set, which only this script does.

### iOS (the Mac rig)

```bash
apps/mobile/scripts/build-ios-on-rig.sh --build <n> --rig eltmon@<rig-ip> \
  [--team KUU2VM9GB9] [--key ~/.ssh/gauntlet_air] [--no-upload] [--dry-run]
```

The rig's address comes from DHCP, so `--rig` is required. The script builds and syncs the app on
this host, copies `apps/mobile/ios/` and the local Capacitor Swift packages to `~/overdeck-mobile/`
on the rig with `rsync -aL`, and writes `~/release-ios/overdeck-<n>.command` there. It opens that
file in Terminal on the rig's desktop, because signing needs the unlocked login keychain and an SSH
session cannot use it (`codesign` fails with `errSecInternalComponent`). The `.command` file
archives to `~/release-ios/overdeck-<n>.xcarchive`, then exports and uploads to App Store Connect
with `apps/mobile/ios/App/ExportOptions.plist` into `~/release-ios/overdeck-<n>-export/`. The
script follows `~/release-ios/overdeck-<n>.log` until it ends with `== DONE ==` or
`== FAILED: <step> ==` (60 minutes at most) and prints the archive's version and build number.
`--no-upload` stops after the archive; `--dry-run` prints every command and the `.command` file and
runs nothing.

When it fails:

- **No signing identity.** `ssh -i ~/.ssh/gauntlet_air <rig> 'security find-identity -v -p codesigning'`
  must list an identity for team `KUU2VM9GB9`. If it does not, sign in to the Apple ID in Xcode →
  Settings → Accounts on the rig (step A5) and run the script again.
- **`missing Xcode-Token` during the upload.** The upload uses the Xcode Apple ID session. Sign in
  again in Xcode → Settings → Accounts on the rig. App Store Connect API keys do not work for this
  team.
- **Low disk space.** The MacBook Air has little free space. Check `df -g /` on the rig and delete
  `~/overdeck-mobile/DerivedData` when it is short.

After the build is processed, answer export compliance in TestFlight (step A6). With automatic
distribution on (step A4), the build then reaches the "Operator" group's iPhones.

### Icons and splash

The launcher icons and splash images are generated from the Overdeck mark
(`src/dashboard/frontend/public/favicon.svg`) on `#202020`. After the mark changes, run
`node apps/mobile/scripts/generate-brand-assets.mjs` and commit the PNGs it rewrites.

## Store facts

### Data the app collects (privacy policy, App Store privacy, Play Data safety)

- **Collected:** the GitHub account id and login used to sign in, the device label and platform, a
  random install id, the APNs or FCM push token, and relay byte counts for relay-plan accounts.
- **Not collected:** conversation content, notification text, analytics, ads data, location and
  contacts. The app contains no analytics, crash-reporting or ads SDK.
- **Encrypted in transit:** yes. Conversation content and notification text are end-to-end
  encrypted between the phone and the operator's machines; Apple, Google, Cloudflare and Overdeck
  see only ciphertext.
- **Deletion:** account.overdeck.ai → Delete account. Signing out on the phone removes its push
  token.

### Export compliance (step A6)

The answer is yours to give. These are the facts: the app uses standard encryption algorithms to
end-to-end encrypt user data — X25519 key agreement, ChaCha20-Poly1305 and XChaCha20-Poly1305
authenticated encryption, and SHA-256 — through libsodium and the Noise protocol. MYN's answer
("none of the algorithms") does not apply to this app. `ITSAppUsesNonExemptEncryption` is not set
in `Info.plist`, so App Store Connect asks on the first build.

### App Store review

TestFlight internal testing works today. Submitting to the App Store itself (beyond TestFlight)
needs in-app account deletion (App Review Guideline 5.1.1(v)), because signing in creates an
overdeck.ai account. The app does not have it yet.
