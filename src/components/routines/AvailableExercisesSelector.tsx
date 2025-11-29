import { useState, useMemo } from 'react';
import type { Exercise } from '@/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Filter, Loader2 } from 'lucide-react';
import { MUSCLE_GROUPS_LIST } from '@/lib/constants';

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
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('All');

  const filteredExercises = useMemo(() => {
    let temp = [...allExercises];
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase().trim();
      temp = temp.filter(ex => ex.name.toLowerCase().includes(q));
    }
    if (selectedMuscleGroup !== 'All') {
      temp = temp.filter(ex => ex.muscleGroup === selectedMuscleGroup);
    }
    return temp;
  }, [allExercises, searchTerm, selectedMuscleGroup]);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Search and Filter Row */}
      <div className="flex gap-2">
        <div className="relative flex-grow">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search exercises..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-1/3 min-w-[140px]">
           <Select value={selectedMuscleGroup} onValueChange={setSelectedMuscleGroup}>
            <SelectTrigger className="w-full">
               <div className="flex items-center truncate">
                  <Filter className="mr-2 h-3.5 w-3.5 text-muted-foreground opacity-70" />
                  <SelectValue placeholder="Muscle" />
               </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Muscles</SelectItem>
              {MUSCLE_GROUPS_LIST.map(mg => (
                <SelectItem key={mg} value={mg}>{mg}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List Area - Set to flex-grow to fill remaining height */}
      <div className="flex-grow border rounded-md bg-background overflow-hidden relative">
         <ScrollArea className="h-full w-full p-2">
            {isLoadingExercises ? (
              <div className="flex justify-center items-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredExercises.length > 0 ? (
              <div className="space-y-1">
                {filteredExercises.map(exercise => {
                  const isSelected = selectedExerciseIds.includes(exercise.id);
                  return (
                    <div
                      key={exercise.id}
                      className={`flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => onSelectionChange(exercise.id, !isSelected)}
                    >
                      <Checkbox
                        id={exercise.id}
                        checked={isSelected}
                        onCheckedChange={(checked) => onSelectionChange(exercise.id, checked as boolean)}
                        className="pointer-events-none" // let the parent div handle click
                      />
                      <div className="flex-grow">
                        <Label htmlFor={exercise.id} className="text-sm font-medium cursor-pointer pointer-events-none">
                          {exercise.name}
                        </Label>
                        <p className="text-xs text-muted-foreground">{exercise.muscleGroup}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
                <p>No exercises found.</p>
              </div>
            )}
         </ScrollArea>
      </div>
    </div>
  );
}
