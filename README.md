
# DDS Gym Tracker - Your Fitness Tracker MVP

DDS Gym Tracker is a Next.js application designed to help you manage exercises, build workout routines, log your training sessions, and track your fitness journey. This version focuses on core MVP features using Firebase for backend services.

This project is a starter for Firebase Studio. You can find the repository at [https://github.com/Dalmiro47/GymTrackerv2](https://github.com/Dalmiro47/GymTrackerv2).

## Getting Started

Follow these instructions to get the project set up and running on your local machine or in your development environment.

### Prerequisites

*   Node.js (LTS version recommended)
*   npm or yarn
*   A Firebase project (create one at [https://console.firebase.google.com/](https://console.firebase.google.com/))
*   Firebase CLI (for deploying Firestore rules): `npm install -g firebase-tools` or `yarn global add firebase-tools`

### Installation

1.  **Set up the project**:
    If you're working in an environment like Firebase Studio, the project files should already be available. If you're setting this up locally from your GitHub repository ([https://github.com/Dalmiro47/GymTrackerv2](https://github.com/Dalmiro47/GymTrackerv2)), ensure you have the latest code.

2.  **Install dependencies**:
    Open your terminal in the project root and run:
    ```bash
    npm install
    ```
    or if you use yarn:
    ```bash
    yarn install
    ```

## Configuration

Sensitive information like API keys is managed using environment variables.

1.  **Create an environment file**:
    In the root of the project, create a new file named `.env.local` by copying the example file:
    ```bash
    cp .env.local.example .env.local
    ```

2.  **Set up Firebase Configuration**:
    *   Open your Firebase project in the [Firebase Console](https://console.firebase.google.com/).
    *   Go to Project Settings (click the gear icon).
    *   Under "Your apps", if you haven't already, add a Web app (`</>`).
    *   Firebase will provide you with a `firebaseConfig` object. It looks like this:
        ```javascript
        const firebaseConfig = {
          apiKey: "AIza...",
          authDomain: "your-project-id.firebaseapp.com",
          projectId: "your-project-id",
          storageBucket: "your-project-id.appspot.com",
          messagingSenderId: "...",
          appId: "1:...",
          measurementId: "G-..." // Optional
        };
        ```
    *   Open your `.env.local` file and populate it with these values. Ensure the keys start with `NEXT_PUBLIC_` as shown in `.env.local.example`.
        ```env
        NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_FIREBASE_API_KEY
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_FIREBASE_AUTH_DOMAIN
        NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_FIREBASE_PROJECT_ID
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=YOUR_FIREBASE_STORAGE_BUCKET
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_FIREBASE_MESSAGING_SENDER_ID
        NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_FIREBASE_APP_ID
        # NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID= (Optional)
        ```
    *   **Enable Google Sign-In**: In the Firebase Console, go to "Authentication" (under Build). On the "Sign-in method" tab, enable the "Google" provider. Make sure to add your project's support email.
    *   **Enable Cloud Firestore**: In the Firebase Console, go to "Firestore Database" (under Build). Click "Create database". Start in **test mode** for initial development (it allows open access for 30 days). You will secure this with rules later. Select a Cloud Firestore location.

## Firebase Firestore Security Rules

This project includes a `firestore.rules` file. These rules are crucial for securing your data, ensuring users can only access their own information.

1.  **Review `firestore.rules`**: This file contains basic rules to protect user-specific collections (e.g., exercises).
2.  **Deploy Firestore Rules**:
    *   Log in to Firebase using the CLI: `firebase login`
    *   Set your active Firebase project: `firebase use YOUR_PROJECT_ID` (Replace `YOUR_PROJECT_ID` with your actual Firebase Project ID). You can find this in your Firebase project settings.
    *   Deploy the rules: `firebase deploy --only firestore:rules`
    *   **Important**: After initial setup or testing in "test mode", always deploy your custom security rules from `firestore.rules` to secure your database.

## Running the Application

1.  **Start the Next.js Development Server**:
    Open a terminal and run:
    ```bash
    npm run dev
    ```
    This will typically start the application on [http://localhost:9002](http://localhost:9002).

## Deployment

*   **Frontend**: The Next.js frontend is intended to be deployed to **Vercel**. Connect your GitHub repository to Vercel for continuous deployment. Remember to set up the Firebase environment variables in your Vercel project settings.
*   **Backend & Configuration**: Firebase services (Authentication, Firestore database) are managed and configured via the **Firebase Console**. Firestore security rules are deployed using the Firebase CLI (see "Firebase Firestore Security Rules" section above).

## Exploring the App

Once the server is running, you can open your browser to [http://localhost:9002](http://localhost:9002) (or the port your Next.js app is running on) to see the application.

### Key Project Structure:

*   `src/app/`: Contains the main pages and layouts for the Next.js application (using App Router).
    *   `src/app/(app)/`: Authenticated routes.
    *   `src/app/login/`: Login page.
*   `src/components/`: Shared React components.
    *   `src/components/ui/`: UI components from ShadCN.
    *   `src/components/layout/`: Layout components like sidebar and header.
    *   `src/components/exercises/`: Components specific to the exercises feature.
*   `src/contexts/`: React context providers (e.g., `AuthContext`).
*   `src/hooks/`: Custom React hooks.
*   `src/lib/`: Utility functions, constants, and Firebase configuration (`firebaseConfig.ts`).
*   `src/services/`: Services for interacting with Firebase (e.g., `exerciseService.ts`).
*   `public/`: Static assets.
*   `firestore.rules`: Contains security rules for your Cloud Firestore database.

### Next Steps (MVP Focus):

*   **Implement Firestore for Data Persistence**:
    *   `src/components/exercises/ExerciseClientPage.tsx` now uses Firestore to fetch and save exercises.
    *   Define Firestore data structures for routines, training logs, etc. in `src/types/index.ts`.
    *   Implement CRUD (Create, Read, Update, Delete) operations for all core features (Routines, Training Log) by creating corresponding services (e.g., `routineService.ts`, `logService.ts`) and integrating them into the UI components.
    *   Update `firestore.rules` as you add new collections.
*   **Build out Core Features**:
    *   Complete the UI and logic for Routine Building, Training Log, and Calendar views using data from Firestore.
*   **Refine UI/UX**: Ensure a smooth and intuitive user experience.

Happy coding!
# GymTrackerv2
