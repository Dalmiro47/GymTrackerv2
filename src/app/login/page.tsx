"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import type { UserProfile } from "@/types";

// Google Icon SVG
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="fill-current w-5 h-5 mr-2">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);


export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const handleMockLogin = () => {
    const mockUser: UserProfile = {
      id: "mock-user-123",
      email: "user@example.com",
      name: "Mock User",
      avatarUrl: "https://placehold.co/100x100.png?text=MU"
    };
    login(mockUser);
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center">
          <div className="mb-6 flex justify-center">
            <Logo iconSize={32} textSize="text-3xl" />
          </div>
          <CardTitle className="font-headline text-2xl">Welcome Back</CardTitle>
          <CardDescription>Sign in to continue to GymFlow.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleMockLogin} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" aria-label="Sign in with Google">
            <GoogleIcon />
            Sign in with Google
          </Button>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            This is a mock sign-in for demonstration purposes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
