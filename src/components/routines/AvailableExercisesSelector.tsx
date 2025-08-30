
"use client";

import { useState, useMemo, useEffect } from 'react';
import type { Exercise } from '@/types';
import type { MuscleGroup } from '@/lib/constants';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Filter, Loader2 } from 'lucide-react';
import { assertMuscleGroup } from '@/lib/muscleGroup';

interface AvailableExercisesSelectorProps {
  allExercises: Exercise[];
  selectedExerciseIds: string[];
  onSelectionChange: (exerciseId: string, isSelected: boolean) => void;
  isLoadingExercises: boolean;
}

export function AvailableExercisesSelector({
  allExercises,
  selectedExerciseIds,
  onSelectionChange,
  isLoadingExercises,
}: AvailableExercisesSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | 'All'>('All');
  
  const canonicalExercises = useMemo(() => {
      return allExercises.map(e => ({...e, muscleGroup: assertMuscleGroup(e.muscleGroup as any)}));
  }, [allExercises]);

  const { availableMuscleGroups, muscleGroupCounts } = useMemo(() => {
    const counts: Record<string, number> = {};
    const seenGroups = new Set<MuscleGroup>();

    canonicalExercises.forEach(ex => {
      const group = ex.muscleGroup;
      seenGroups.add(group);
      counts[group] = (counts[group] || 0) + 1;
    });
    
    const available = MUSCLE_GROUPS_LIST.filter(group => seenGroups.has(group));
    
    return { availableMuscleGroups: available, muscleGroupCounts: counts };
  }, [canonicalExercises]);
  
  useEffect(() => {
    if (selectedMuscleGroup !== 'All' && !availableMuscleGroups.includes(selectedMuscleGroup)) {
      setSelectedMuscleGroup('All');
    }
  }, [availableMuscleGroups, selectedMuscleGroup]);


  const filteredExercises = useMemo(() => {
    let tempExercises = [...canonicalExercises];
    if (searchTerm.trim() !== '') {
      tempExercises = tempExercises.filter(ex =>
        ex.name.toLowerCase().includes(searchTerm.toLowerCase().trim())
      );
    }
    if (selectedMuscleGroup !== 'All') {
      tempExercises = tempExercises.filter(ex => ex.muscleGroup === selectedMuscleGroup);
    }
    return tempExercises;
  }, [canonicalExercises, searchTerm, selectedMuscleGroup]);

  if (isLoadingExercises) {
    return (
      <div className="flex flex-col space-y-3 p-4 border rounded-md min-h-[300px] justify-center items-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading exercises...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1 h-full flex flex-col">
      <h3 className="text-lg font-medium flex-shrink-0">Available Exercises</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-shrink-0">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Select
            value={selectedMuscleGroup}
            onValueChange={(value) => setSelectedMuscleGroup(value as MuscleGroup | 'All')}
          >
            <SelectTrigger className="w-full pl-9" aria-label="Filter by muscle group">
              <SelectValue placeholder="Filter by muscle group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Muscle Groups</SelectItem>
              {availableMuscleGroups.map(group => (
                <SelectItem key={group} value={group}>
                  {group} ({muscleGroupCounts[group] || 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search exercise by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9"
            aria-label="Search exercises"
          />
        </div>
      </div>

      <div className="flex-grow min-h-0">
        <ScrollArea className="h-[calc(100vh-28rem)] sm:h-[300px] w-full rounded-md border p-4">
          {filteredExercises.length > 0 ? (
            <div className="space-y-3">
              {filteredExercises.map(exercise => (
                <div key={exercise.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`ex-${exercise.id}`}
                    checked={selectedExerciseIds.includes(exercise.id)}
                    onCheckedChange={(checked) => onSelectionChange(exercise.id, !!checked)}
                  />
                  <Label htmlFor={`ex-${exercise.id}`} className="flex-1 cursor-pointer">
                    {exercise.name} <span className="text-xs text-muted-foreground">({exercise.muscleGroup})</span>
                  </Label>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No exercises match your criteria.
            </p>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
