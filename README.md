# GymFlow - Your Fitness Tracker MVP

GymFlow is a Next.js application designed to help you manage exercises, build workout routines, log your training sessions, and track your fitness journey. This version focuses on core MVP features using Firebase for backend services.

This project is a starter for Firebase Studio. You can find the repository at [https://github.com/Dalmiro47/GymTrackerv2](https://github.com/Dalmiro47/GymTrackerv2).

## Getting Started

Follow these instructions to get the project set up and running on your local machine or in your development environment.

### Prerequisites

*   Node.js (LTS version recommended)
*   npm or yarn
*   A Firebase project (create one at [https://console.firebase.google.com/](https://console.firebase.google.com/))

### Installation

1.  **Set up the project**:
    If you're working in an environment like Firebase Studio, the project files should already be available. If you're setting this up locally from your GitHub repository, ensure you have the latest code.

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

## Running the Application

1.  **Start the Next.js Development Server**:
    Open a terminal and run:
    ```bash
    npm run dev
    ```
    This will typically start the application on [http://localhost:9002](http://localhost:9002).

## Deployment

*   **Frontend**: The Next.js frontend is intended to be deployed to **Vercel**. Connect your GitHub repository to Vercel for continuous deployment.
*   **Backend & Configuration**: Firebase services (Authentication, Firestore database) are managed and configured via the **Firebase Console**. If you add Firebase Functions later, they will also be deployed using Firebase tools.

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
*   `public/`: Static assets.

### Next Steps (MVP Focus):

*   **Implement Firestore for Data Persistence**:
    *   Update `src/components/exercises/ExerciseClientPage.tsx` to fetch and save exercises from/to Firebase Firestore instead of using mock data.
    *   Define Firestore data structures for routines, training logs, etc.
    *   Implement CRUD (Create, Read, Update, Delete) operations for all core features (Exercises, Routines, Training Log).
*   **Build out Core Features**:
    *   Complete the UI and logic for Routine Building, Training Log, and Calendar views using data from Firestore.
*   **Refine UI/UX**: Ensure a smooth and intuitive user experience.

Happy coding!
