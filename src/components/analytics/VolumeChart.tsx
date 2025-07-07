
"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import { 
  ChartContainer, 
  ChartTooltip as ShadCNChartTooltip, // Renamed to avoid conflict
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoggedDateStrings, getWorkoutLog } from "@/services/trainingLogService";
import { getExercises as getAllUserExercisesService } from "@/services/exerciseService";
import { format, parseISO, isValid } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import type { Exercise, MuscleGroup, WorkoutLog } from "@/types";
import { MUSCLE_GROUPS_LIST } from "@/lib/constants";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ChartDataEntry = { date: string; volume: number; formattedDate: string };

interface VolumeChartProps {
  defaultExerciseId?: string;
  defaultMuscleGroup?: MuscleGroup;
  containerClassName?: string;
}

export const VolumeChart: React.FC<VolumeChartProps> = ({ 
  defaultExerciseId, 
  defaultMuscleGroup,
  containerClassName 
}) => {
  const { user } = useAuth();
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroup | "">(defaultMuscleGroup || "");
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(defaultExerciseId || "");
  
  const [chartData, setChartData] = useState<ChartDataEntry[]>([]);
  const [allLoggedDates, setAllLoggedDates] = useState<string[]>([]);
  const [allUserExercises, setAllUserExercises] = useState<Exercise[]>([]);
  
  const [isLoadingExercises, setIsLoadingExercises] = useState(true);
  const [isLoadingLoggedDates, setIsLoadingLoggedDates] = useState(true);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);

  useEffect(() => {
    if (user?.id) {
      setIsLoadingExercises(true);
      getAllUserExercisesService(user.id)
        .then(setAllUserExercises)
        .catch(err => console.error("Failed to load exercises for chart", err))
        .finally(() => setIsLoadingExercises(false));

      setIsLoadingLoggedDates(true);
      getLoggedDateStrings(user.id)
        .then(setAllLoggedDates)
        .catch(err => console.error("Failed to load logged dates for chart", err))
        .finally(() => setIsLoadingLoggedDates(false));
    }
  }, [user?.id]);

  useEffect(() => {
    if (defaultExerciseId && allUserExercises.length > 0) {
      const exercise = allUserExercises.find(ex => ex.id === defaultExerciseId);
      if (exercise) {
        setSelectedExerciseId(exercise.id);
        setSelectedMuscleGroup(exercise.muscleGroup);
      }
    }
  }, [defaultExerciseId, allUserExercises]);

  useEffect(() => {
    if (!selectedExerciseId || !user?.id || allLoggedDates.length === 0) {
      setChartData([]);
      return;
    }

    const fetchData = async () => {
      setIsLoadingChartData(true);
      const rows: ChartDataEntry[] = [];
      // Ensure dates are sorted chronologically for the chart
      const sortedDates = [...allLoggedDates].sort((a, b) => parseISO(a).getTime() - parseISO(b).getTime());

      for (let dateStr of sortedDates) {
        try {
          const log = await getWorkoutLog(user.id, dateStr);
          const exerciseInLog = log?.exercises.find(e => e.exerciseId === selectedExerciseId);
          if (exerciseInLog) {
            const volume = exerciseInLog.sets.reduce((sum, s) => sum + (s.reps || 0) * (s.weight || 0), 0);
            if (volume > 0) { // Only include entries with actual volume
              const parsedDate = parseISO(dateStr);
              if (isValid(parsedDate)) {
                rows.push({ 
                  date: dateStr, 
                  volume, 
                  formattedDate: format(parsedDate, "MMM d") 
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching log for date ${dateStr}:`, error);
        }
      }
      setChartData(rows);
      setIsLoadingChartData(false);
    };

    fetchData();
  }, [selectedExerciseId, user?.id, allLoggedDates]);

  const filteredExercises = useMemo(() => {
    if (!selectedMuscleGroup) return allUserExercises;
    return allUserExercises.filter(ex => ex.muscleGroup === selectedMuscleGroup);
  }, [selectedMuscleGroup, allUserExercises]);

  const selectedExerciseName = useMemo(() => {
    return allUserExercises.find(ex => ex.id === selectedExerciseId)?.name || "Exercise";
  }, [selectedExerciseId, allUserExercises]);

  const chartConfig = {
    volume: {
      label: "Total Volume",
      color: "hsl(var(--primary))",
    },
  };

  const showLoader = isLoadingExercises || isLoadingLoggedDates || isLoadingChartData;

  return (
    <Card className={cn("w-full", containerClassName)}>
      <CardHeader className="px-2 pt-4 pb-2 sm:px-6 sm:pt-6 sm:pb-4">
        <CardTitle className="font-headline text-base sm:text-lg">
          Volume Over Time: {selectedExerciseId ? selectedExerciseName : "Select Exercise"}
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">Total volume (reps × weight) for each workout session.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-2 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select 
            onValueChange={(value) => {
              setSelectedMuscleGroup(value as MuscleGroup);
              setSelectedExerciseId(""); // Reset exercise when muscle group changes
              setChartData([]);
            }} 
            value={selectedMuscleGroup}
            disabled={isLoadingExercises}
          >
            <SelectTrigger>
              <SelectValue placeholder={isLoadingExercises ? "Loading muscles..." : "Pick muscle group"} />
            </SelectTrigger>
            <SelectContent>
              {MUSCLE_GROUPS_LIST.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select 
            onValueChange={setSelectedExerciseId} 
            value={selectedExerciseId}
            disabled={!selectedMuscleGroup || isLoadingExercises || filteredExercises.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder={
                isLoadingExercises ? "Loading exercises..." : 
                !selectedMuscleGroup ? "Pick muscle first" : 
                filteredExercises.length === 0 ? "No exercises in group" : 
                "Pick exercise"
              } />
            </SelectTrigger>
            <SelectContent>
              {filteredExercises.map(ex => <SelectItem key={ex.id} value={ex.id}>{ex.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="h-[40vh] min-h-[250px] w-full mt-4 overflow-x-auto">
          {showLoader ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-2">Loading chart data...</p>
            </div>
          ) : chartData.length > 0 ? (
            <ChartContainer config={chartConfig} className="h-full w-full">
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                <XAxis 
                  dataKey="formattedDate" 
                  tickLine={false} 
                  axisLine={false} 
                  tickMargin={8}
                  fontSize={10}
                />
                <YAxis 
                  label={{ value: "Volume (kg)", angle: -90, position: 'insideLeft', offset: 0, fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  fontSize={10}
                  tickFormatter={(value) => `${value}`}
                />
                <ShadCNChartTooltip
                  cursor={true}
                  content={<ChartTooltipContent 
                              formatter={(value, name, props) => [`${props.payload.volume} kg`, "Total Volume"]} 
                              labelFormatter={(label, payload) => payload?.[0] ? `Date: ${payload[0].payload.formattedDate}`: label}
                           />}
                />
                <Line 
                  type="monotone" 
                  dataKey="volume" 
                  stroke="var(--color-volume)" 
                  strokeWidth={2} 
                  dot={{ r: 4, fill: "var(--color-volume)", strokeWidth:1, stroke: "hsl(var(--background))" }}
                  activeDot={{ r: 6, fill: "var(--color-volume)", strokeWidth:1, stroke: "hsl(var(--background))" }}
                />
                 <ChartLegend content={<ChartLegendContent />} />
              </LineChart>
            </ChartContainer>
          ) : selectedExerciseId ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No volume data found for {selectedExerciseName}.
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Select an exercise to view its volume history.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default VolumeChart;
