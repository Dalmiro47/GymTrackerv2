import { Suspense } from "react";
import { ExerciseClientPage } from "@/components/exercises/ExerciseClientPage";

// ExerciseClientPage reads useSearchParams (?edit=<id>), which requires a
// Suspense boundary during static rendering.
export default function ExercisesPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <ExerciseClientPage />
      </Suspense>
    </div>
  );
}
