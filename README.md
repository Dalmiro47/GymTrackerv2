# DDS Gym Tracker

A Next.js app to manage exercises, build workout routines, log training sessions and track progress, with an AI coach. Firebase provides auth and data.

Repository: https://github.com/Dalmiro47/GymTrackerv2

## Run it

Prerequisites: Node.js (LTS), npm, a [Firebase project](https://console.firebase.google.com/), and the Firebase CLI (`npm install -g firebase-tools`) for deploying rules.

```bash
npm install
npm run dev
```

The dev server runs on http://localhost:3000 (Next.js default; the dev script sets no custom port).

## Configuration

Sensitive values such as API keys live in environment variables. Create `.env.local` in the repo root (gitignored; there is no example file) with:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
# NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID= (optional)
GROQ_API_KEY=
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@YOUR_PROJECT.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

- **Firebase web config**: Firebase Console, Project Settings, "Your apps", add a Web app (`</>`), and copy its values.
- **Service account**: Project Settings, Service accounts, Generate new private key. It lets the server write the daily AI-usage counter, which the security rules keep read-only for clients. Keep the double quotes above; in the Vercel dashboard paste the same value **without** them, or the quotes become part of the key. Without these two the app still runs, but daily AI limits are silently not enforced (a banner on `/admin` says so).
- **Google Sign-In**: Firebase Console, Authentication, Sign-in method: enable Google and add your project's support email.
- **Cloud Firestore**: Firebase Console, Firestore Database: create the database and pick a location, then deploy the rules below before using it.

## Firestore rules

`firestore.rules` secures the database so each user reaches only their own data. To deploy (project owner, from your own terminal):

```bash
firebase login
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules
```

## Deployment

- **Frontend**: Vercel, connected to this GitHub repository for continuous deployment. Set the environment variables above in the Vercel project settings.
- **Backend**: Authentication and Firestore are managed in the Firebase Console; security rules are deployed with the Firebase CLI as above.

## Where things live

- `src/app/`: pages and layouts (App Router): `(app)/` authenticated routes, `login/` login page, `api/coach/` AI coach endpoints
- `src/components/`: shared React components: `ui/` (ShadCN), `layout/` (desktop sidebar, header with the `AppBarActions` slot, mobile `BottomNav`), and one folder per feature (such as `exercises/`)
- `src/contexts/`: React context providers (such as `AuthContext`)
- `src/hooks/`: custom React hooks
- `src/i18n/`: English and Spanish dictionaries
- `src/lib/`: utilities, constants, AI coach code and Firebase configuration (`firebaseConfig.ts`)
- `src/services/`: Firestore access (such as `exerciseService.ts`)
- `public/`: static assets
- `firestore.rules`: Cloud Firestore security rules
- `docs/`: decision log and the mobile chat panel recipe
- `CLAUDE.md`: commands, code map, standards and gotchas for working in this repo
