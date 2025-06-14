"use client";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon } from "lucide-react"; // Renamed to avoid conflict with ShadCN Calendar
import { Calendar } from "@/components/ui/calendar"; // ShadCN Calendar
import React from "react";
import Image from 'next/image';

export default function TrainingCalendarPage() {
  const [date, setDate] = React.useState<Date | undefined>(new Date());

  return (
    <div className="space-y-6">
      <PageHeader title="Training Calendar" description="Visualize your workout consistency over time." />
      
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="font-headline text-xl flex items-center">
            <CalendarIcon className="mr-2 h-5 w-5 text-primary" />
            Your Activity
          </CardTitle>
          <CardDescription>Feature coming soon! This calendar will highlight your training days.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-6">
           <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            className="rounded-md border bg-card shadow"
          />
           <Image 
            src="https://placehold.co/400x250.png?text=Calendar+WIP" 
            alt="Calendar placeholder" 
            width={400} 
            height={250}
            className="mx-auto rounded-lg"
            data-ai-hint="calendar marked"
          />
          <p className="text-lg text-muted-foreground font-semibold">Training calendar integration is under development.</p>
          <p className="text-muted-foreground">Soon you'll see your workout schedule at a glance!</p>
        </CardContent>
      </Card>
    </div>
  );
}
