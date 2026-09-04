"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import React from 'react';


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
  const { loginWithGoogle, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  const handleGoogleSignIn = async () => {
    try {
      await loginWithGoogle();
      // Navigation is handled by the useEffect above or onAuthStateChanged in AuthContext
    } catch (error) {
      console.error("Login failed", error);
      // Optionally show a toast error to the user
    }
  };

  if (isLoading || (!isLoading && isAuthenticated)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center p-4">
      <Card className="animate-enter w-full max-w-sm">
        <CardHeader className="items-center pt-8 text-center">
          <div className="mb-6 flex justify-center">
            <Logo iconSize={30} textSize="text-[26px]" />
          </div>
          <CardTitle className="text-[28px]">Welcome Back</CardTitle>
          <CardDescription className="text-[15px]">
            Sign in to continue to DDS Gym Tracker.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-8">
          <Button
            onClick={handleGoogleSignIn}
            className="w-full"
            aria-label="Sign in with Google"
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleIcon />}
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
