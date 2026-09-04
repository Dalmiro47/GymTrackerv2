'use client';
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types.gym';
import { Loader2 } from 'lucide-react';
import { CoachProfileForm } from '@/components/coach/CoachProfileForm';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/hooks/use-toast';
import { friendlyErrorMessage } from '@/lib/errorMessages';

export default function SettingsProfilePage() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    if (!user) return;
    let ignore = false;
    (async () => {
      setLoadingProfile(true);
      try {
        const snap = await getDoc(doc(db, 'users', user.id, 'profile', 'profile'));
        if (ignore) return;
        setProfile((snap.data() as UserProfile) ?? { goal: 'General Fitness' });
      } catch (error) {
        console.error('[SettingsProfilePage] profile load failed:', error);
        if (ignore) return;
        toast({
          title: 'Load error',
          description: friendlyErrorMessage(error, "Couldn't load your profile. Showing defaults."),
          variant: 'destructive',
        });
        // Fall back to defaults so the page never hangs on the spinner.
        setProfile({ goal: 'General Fitness' });
      } finally {
        if (!ignore) setLoadingProfile(false);
      }
    })();
    return () => { ignore = true; };
  }, [user, toast]);

  if (isLoading || loadingProfile || !profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 py-8 text-[15px] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading profile…
      </div>
    );
  }

  const first = (user?.name ?? 'Your').split(' ')[0];
  const title = `${first}'s Profile`;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="Profile Settings"
        description="Your goals and constraints — the AI Coach uses these to tailor advice."
      />
      <CoachProfileForm initial={profile} title={title} />
    </div>
  );
}
