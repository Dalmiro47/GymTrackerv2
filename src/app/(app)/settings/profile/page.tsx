'use client';
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types.gym';
import { Loader2 } from 'lucide-react';
import { CoachProfileForm } from '@/components/coach/CoachProfileForm';
import { PageHeader } from '@/components/PageHeader';

export default function SettingsProfilePage() {
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoadingProfile(true);
      const snap = await getDoc(doc(db, 'users', user.id, 'profile', 'profile'));
      setProfile((snap.data() as UserProfile) ?? { goal: 'General Fitness' });
      setLoadingProfile(false);
    })();
  }, [user]);

  if (isLoading || loadingProfile || !profile) {
    return (
      <div className="mx-auto w-full max-w-2xl flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading profile…
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
