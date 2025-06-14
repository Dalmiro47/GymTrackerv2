"use client";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import Image from 'next/image';

export default function RoutinesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Workout Routines" description="Design and manage your custom workout plans.">
        <Button variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <PlusCircle className="mr-2 h-4 w-4" /> Create Routine
        </Button>
      </PageHeader>
      
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">Your Routines</CardTitle>
          <CardDescription>Feature coming soon! Here you'll be able to create, view, and manage your workout routines.</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-12">
          <Image 
            src="https://placehold.co/400x300.png?text=Routines+WIP" 
            alt="Routines placeholder" 
            width={400} 
            height={300}
            className="mx-auto rounded-lg mb-4"
            data-ai-hint="planning board"
          />
          <p className="text-lg text-muted-foreground font-semibold">Routine builder is under construction.</p>
          <p className="text-muted-foreground">Check back soon to plan your workouts!</p>
        </CardContent>
      </Card>
    </div>
  );
}
