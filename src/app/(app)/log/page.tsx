"use client";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import Image from 'next/image';

export default function TrainingLogPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Training Log" description="Record your daily workouts and track your progress.">
         <Button variant="default" className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <PlusCircle className="mr-2 h-4 w-4" /> Log Workout
        </Button>
      </PageHeader>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl">Your Workout History</CardTitle>
          <CardDescription>Feature coming soon! Log your sets, reps, and weights for each session.</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-12">
          <Image 
            src="https://placehold.co/400x300.png?text=Log+WIP" 
            alt="Training log placeholder" 
            width={400} 
            height={300}
            className="mx-auto rounded-lg mb-4"
            data-ai-hint="notebook pen"
          />
          <p className="text-lg text-muted-foreground font-semibold">Training log is under construction.</p>
          <p className="text-muted-foreground">Soon you'll be able to track every lift!</p>
        </CardContent>
      </Card>
    </div>
  );
}
