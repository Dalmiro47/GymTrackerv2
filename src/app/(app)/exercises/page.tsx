import { Suspense } from "react";
import { ExerciseClientPage } from "@/components/exercises/ExerciseClientPage";

// ExerciseClientPage reads useSearchParams (?edit=<id>), which requires a
// Suspense boundary during static rendering.
export default function ExercisesPage() {
  return (
    <div className="container mx-auto py-2 sm:py-4 lg:py-6">
      <Suspense fallback={null}>
        <ExerciseClientPage />
      </Suspense>
    </div>
  );
}
