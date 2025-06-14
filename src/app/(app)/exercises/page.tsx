import { ExerciseClientPage } from "@/components/exercises/ExerciseClientPage";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button"; // Will be used inside ExerciseClientPage for Add button
import { PlusCircle } from "lucide-react"; // Will be used inside ExerciseClientPage

export default function ExercisesPage() {
  return (
    <div className="container mx-auto py-2 sm:py-4 lg:py-6">
      <ExerciseClientPage />
    </div>
  );
}
