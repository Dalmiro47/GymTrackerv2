# GymFlow - Your AI-Powered Fitness Tracker

GymFlow is a Next.js application designed to help you manage exercises, build workout routines, log your training sessions, and track your fitness journey, enhanced with AI capabilities powered by Genkit and Gemini.

This project is a starter for Firebase Studio.

## Getting Started

Follow these instructions to get the project set up and running on your local machine.

### Prerequisites

*   Node.js (LTS version recommended)
*   npm or yarn

### Installation

1.  **Clone the repository** (if you haven't already):
    ```bash
    # If you're working outside Firebase Studio and cloned manually
    # git clone <repository-url>
    # cd <repository-name>
    ```

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

2.  **Set up Gemini API Key (Required for AI features)**:
    *   Open the `.env.local` file.
    *   You need a Gemini API key to use the AI-powered features. Obtain one from Google AI Studio: [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
    *   Add your API key to the `.env.local` file:
        ```env
        GOOGLE_API_KEY=YOUR_GEMINI_API_KEY_HERE
        ```

3.  **Firebase Setup (Mocked by Default)**:
    *   **Current State**: This application currently uses a **mock authentication system**. This means you can run and test the app without connecting to a live Firebase backend. User data is stored in the browser's `localStorage`.
    *   **Integrating a Real Firebase Backend**: If you want to connect to a real Firebase project for features like persistent data storage, real user authentication, etc.:
        1.  Create a Firebase project at [https://console.firebase.google.com/](https://console.firebase.google.com/).
        2.  In your Firebase project settings, add a new Web App.
        3.  Firebase will provide you with a `firebaseConfig` object. It looks like this:
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
        4.  You would typically create a file, for example, `src/lib/firebaseConfig.ts`, and initialize Firebase there:
            ```typescript
            // src/lib/firebaseConfig.ts
            import { initializeApp } from "firebase/app";

            const firebaseConfig = {
              apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
              authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
              // ... other config values
            };

            const app = initializeApp(firebaseConfig);
            export default app;
            // export const auth = getAuth(app); // etc.
            ```
        5.  Add your Firebase project's configuration values to your `.env.local` file. The keys should start with `NEXT_PUBLIC_` to be accessible on the client-side. See `.env.local.example` for the variable names.
        6.  Update the `src/contexts/AuthContext.tsx` to use the real Firebase Authentication instead of the mock system.

## Running the Application

You'll need to run two separate development servers: one for the Next.js frontend and one for the Genkit AI flows.

1.  **Start the Next.js Development Server**:
    Open a terminal and run:
    ```bash
    npm run dev
    ```
    This will typically start the application on [http://localhost:9002](http://localhost:9002).

2.  **Start the Genkit Development Server**:
    Open a *new, separate* terminal and run:
    ```bash
    npm run genkit:dev
    ```
    This will start the Genkit development flow server, usually on port 3400, and the Genkit developer UI on port 4000. This server handles the AI logic.

## Exploring the App

Once both servers are running, you can open your browser to [http://localhost:9002](http://localhost:9002) (or the port your Next.js app is running on) to see the application.

### Key Project Structure:

*   `src/app/`: Contains the main pages and layouts for the Next.js application (using App Router).
    *   `src/app/(app)/`: Authenticated routes.
    *   `src/app/login/`: Login page.
*   `src/components/`: Shared React components.
    *   `src/components/ui/`: UI components from ShadCN.
    *   `src/components/layout/`: Layout components like sidebar and header.
    *   `src/components/exercises/`: Components specific to the exercises feature.
*   `src/ai/`: Contains Genkit AI flows and configuration.
    *   `src/ai/genkit.ts`: Genkit global instance initialization.
    *   `src/ai/flows/`: Directory for individual Genkit flows.
*   `src/contexts/`: React context providers (e.g., `AuthContext`).
*   `src/hooks/`: Custom React hooks.
*   `src/lib/`: Utility functions, constants, and configuration files.
*   `public/`: Static assets.

### Next Steps:

*   Navigate through the app: explore the dashboard, exercises, routines, log, and calendar pages.
*   Try adding new exercises (currently using mock data, but the UI flow is present).
*   If you've set up your `GOOGLE_API_KEY`, explore any AI features as they are implemented.
*   Look at the code in `src/app/page.tsx` as a starting point, then dive into other pages and components.
*   If you plan to use a real Firebase backend, start by setting up your Firebase project and configuring `src/lib/firebaseConfig.ts` and `src/contexts/AuthContext.tsx`.

Happy coding!
