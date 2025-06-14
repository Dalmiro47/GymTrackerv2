"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import Image from 'next/image';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-headline font-bold text-primary">Dashboard</h1>
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-2xl">Welcome back, {user?.name || 'Fitness Enthusiast'}!</CardTitle>
          <CardDescription>Ready to crush your workout today? Let's get started.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            This is your central hub for tracking progress, managing exercises, and planning your routines.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-secondary/50">
              <CardHeader>
                <CardTitle className="font-headline text-lg">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Workouts this week: 0</p>
                <p className="text-sm text-muted-foreground">Active Routine: Not Set</p>
                {/* Add more stats here */}
              </CardContent>
            </Card>
            <Card className="bg-secondary/50">
               <CardHeader>
                <CardTitle className="font-headline text-lg">Fitness Tip</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Stay hydrated! Drink plenty of water throughout the day, especially before, during, and after your workouts.</p>
              </CardContent>
            </Card>
          </div>
           <div className="mt-6 rounded-lg overflow-hidden">
            <Image 
              src="https://placehold.co/800x300.png" 
              alt="Fitness motivation" 
              width={800} 
              height={300}
              className="w-full h-auto object-cover"
              data-ai-hint="fitness motivation"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
