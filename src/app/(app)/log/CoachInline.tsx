'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

export function CoachInline({
  buttonProps,
}: {
  buttonProps?: any;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Coach
        </CardTitle>
        <CardDescription className="text-xs">
          Suggestions are available in the main report.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Inline analysis is disabled. Open the full Coach report for precise, data-grounded advice.
        </p>
        <Button asChild size="sm" className="w-full">
          <Link href="/coach">
            Open Full Coach Report
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
