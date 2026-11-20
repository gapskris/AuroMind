# AuroMind Firebase Backend Integration Artifacts

This directory contains the Google Firebase configuration artifacts, Firestore security rules, composite indexes, and Cloud Functions definitions for the AuroMind platform.

## Configuration & Environment Variables

When configuring Firebase as the active backend provider:

1. **Client-Facing Configuration (Public / Browser):**
   - `AUROMIND_FIREBASE_PROJECT_ID`: e.g. `auromind-production`
   - `AUROMIND_FIREBASE_API_KEY`: Web API Key (safe for public distribution; guarded by Firestore security rules)
   - `AUROMIND_FIREBASE_AUTH_DOMAIN`: e.g. `auromind-production.firebaseapp.com`

2. **Security Invariant:**
   - **NEVER** expose Firebase service account private keys (`private_key`, `client_email`, `service_account`) in client-side code or browser bundles. Any attempt to pass service account keys throws a fatal `FIREBASE_SECRET_KEY_FORBIDDEN` exception.

3. **Local Firebase Emulator Suite (Development & Testing):**
   To test with the local Firebase emulator:
   ```bash
   firebase emulators:start
   ```
   Ports configured in `firebase.json`:
   - Firestore: `127.0.0.1:8080`
   - Auth: `127.0.0.1:9099`
   - Functions: `127.0.0.1:5001`
   - Emulator UI: `127.0.0.1:4000`
