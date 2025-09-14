'use client';
import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';
import type { UserProfile, Goal } from '@/lib/types.gym';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function CoachProfileForm({ initial }: { initial: UserProfile }) {
  const { user } = useAuth();
  const [form, setForm] = useState<UserProfile>(initial);

  async function save() {
    if (!user) return;
    await setDoc(doc(db, 'users', user.id, 'profile', 'profile'), form, { merge: true });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Coach Profile</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div><Label>Goal</Label>
          <Select value={form.goal} onValueChange={(v)=>setForm({ ...form, goal: v as Goal })}>
            <SelectTrigger><SelectValue placeholder="Goal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Hypertrophy">Hypertrophy</SelectItem>
              <SelectItem value="Strength">Strength</SelectItem>
              <SelectItem value="Fat Loss">Fat Loss</SelectItem>
              <SelectItem value="General Fitness">General Fitness</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Age</Label><Input type="number" value={form.age ?? ''} onChange={e=>setForm({...form, age: Number(e.target.value)})}/></div>
        <div><Label>Gender</Label><Input value={form.gender ?? ''} onChange={e=>setForm({...form, gender: e.target.value as any})}/></div>
        <div><Label>Days/week target</Label><Input type="number" value={form.daysPerWeekTarget ?? ''} onChange={e=>setForm({...form, daysPerWeekTarget: Number(e.target.value)})}/></div>
        <div className="col-span-2"><Label>Constraints</Label><Input value={(form.constraints||[]).join(', ')} onChange={e=>setForm({...form, constraints: e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})}/></div>
        <div className="col-span-2"><Button onClick={save}>Save profile</Button></div>
      </CardContent>
    </Card>
  );
}
