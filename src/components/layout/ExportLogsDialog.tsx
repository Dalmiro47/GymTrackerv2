
"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileSpreadsheet, FileText } from 'lucide-react';
import { db } from '@/lib/firebaseConfig';
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  startAfter, 
  DocumentData, 
  QueryDocumentSnapshot,
  documentId
} from 'firebase/firestore';

interface SetEntry {
  id?: string;
  reps?: number;
  weight?: number;
}

interface ExerciseEntry {
  exerciseId?: string;
  name?: string;
  muscleGroup?: string;
  notes?: string;
  exerciseSetup?: string;
  sets?: SetEntry[];
}

interface WorkoutLog {
  date?: string;
  id?: string;
  name?: string;
  muscleGroup?: string;
  notes?: string;
  exerciseSetup?: string;
  createdAt?: { toDate: () => Date }; 
  sets?: SetEntry[];
  exercises?: ExerciseEntry[];
}


interface ExportRow {
  date: string;
  exercise_id: string;
  exercise_name: string;
  muscle_group: string;
  set_index: number | string;
  set_id: string;
  reps: number | string;
  weight: number | string;
  notes: string;
  exercise_setup: string;
  created_at: string;
}

interface ExportLogsDialogProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const PAGE_SIZE = 1000;

const buildQuery = (uid: string) =>
  query(
    collection(db, `users/${uid}/workoutLogs`),
    orderBy(documentId()),
    limit(PAGE_SIZE)
  );

const headers: (keyof ExportRow)[] = [
  'date','exercise_id','exercise_name','muscle_group','set_index','set_id',
  'reps','weight','notes','exercise_setup','created_at'
];

/** Thrown when the row count exceeds what Excel can open; mapped to a translated toast. */
const EXCEL_ROW_LIMIT_ERROR = 'EXCEL_ROW_LIMIT';


export function ExportLogsDialog({ isOpen, setIsOpen }: ExportLogsDialogProps) {
  const { firebaseUser } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'xlsx' | 'csv' | null>(null);

  const flattenWorkoutLogsToRows = (logDoc: QueryDocumentSnapshot<DocumentData>): ExportRow[] => {
    const docId = logDoc.id;
    const data = logDoc.data() as WorkoutLog;
    const rows: ExportRow[] = [];
  
    const isoFromId = /\d{4}-\d{2}-\d{2}/.test(docId) ? docId : '';
    const createdAtIso = data.createdAt ? data.createdAt.toDate().toISOString() : '';
    const date = data.date || isoFromId || (createdAtIso ? createdAtIso.slice(0, 10) : '');
  
    const pushExercise = (exercise: Partial<ExerciseEntry>, sets: SetEntry[] | undefined) => {
      const base = {
        date,
        exercise_id: exercise.exerciseId || data.id || docId,
        exercise_name: exercise.name || data.name || '',
        muscle_group: exercise.muscleGroup || data.muscleGroup || '',
        notes: (exercise.notes ?? data.notes) || '',
        exercise_setup: (exercise.exerciseSetup ?? data.exerciseSetup) || '',
        created_at: createdAtIso,
      };
  
      const s = sets ?? [];
      if (s.length === 0) {
        rows.push({ ...base, set_index: -1, set_id: '', reps: '', weight: '' });
      } else {
        s.forEach((set, i) => {
          rows.push({
            ...base,
            set_index: i,
            set_id: set.id || '',
            reps: set.reps ?? '',
            weight: set.weight ?? '',
          });
        });
      }
    };
  
    if (Array.isArray(data.exercises) && data.exercises.length > 0) {
      data.exercises.forEach(ex => pushExercise(ex, ex.sets));
    } else {
      pushExercise({}, data.sets);
    }
  
    return rows;
  };

  const streamRowsAsCsv = (rows: ExportRow[], headers: (keyof ExportRow)[]) => {
    const headerString = headers.join(',') + '\r\n';
    const rowStrings = rows.map(row =>
      headers.map(h => {
        const v = row[h as keyof ExportRow];
        const s = (v === null || v === undefined) ? '' : String(v);
        return `"${s.replace(/"/g, '""')}"`
      }).join(',')
    ).join('\r\n');
    return '\uFEFF' + headerString + rowStrings;
  };


  const handleDownload = async (format: 'xlsx' | 'csv') => {
    if (!firebaseUser) {
      toast({ title: t('common.error'), description: t('export.mustLogin'), variant: 'destructive' });
      return;
    }

    setIsDownloading(true);
    setDownloadFormat(format);

    try {
      let allRows: ExportRow[] = [];
      let lastVisible: QueryDocumentSnapshot<DocumentData> | undefined;
      const baseQuery = buildQuery(firebaseUser.uid);

      while (true) {
        const currentQuery = lastVisible ? query(baseQuery, startAfter(lastVisible)) : baseQuery;
        const documentSnapshots = await getDocs(currentQuery);
        
        if (documentSnapshots.empty) {
          break;
        }

        documentSnapshots.forEach(doc => {
          allRows.push(...flattenWorkoutLogsToRows(doc));
        });

        lastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1];
        if (documentSnapshots.size < PAGE_SIZE) {
            break;
        }

        if (allRows.length > 200000 && format === 'xlsx') {
            toast({
                title: t('export.largeTitle'),
                description: t('export.largeDesc'),
                variant: "default",
                duration: 5000,
            });
        }
      }

      if (allRows.length === 0) {
        toast({ title: t('export.noDataTitle'), description: t('export.noDataDesc') });
        setIsDownloading(false);
        setDownloadFormat(null);
        return;
      }
      
      const dateString = new Date().toISOString().slice(0,10).replace(/-/g,'');
      const filename = `workout-logs-${dateString}.${format}`;
      
      let blob;
      if (format === 'csv') {
        const csvString = streamRowsAsCsv(allRows, headers);
        blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      } else {
        if (allRows.length > 1048576) {
          throw new Error(EXCEL_ROW_LIMIT_ERROR);
        }
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.json_to_sheet(allRows, { header: headers as string[] });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'workout_logs');
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      }

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      toast({ title: t('export.successTitle'), description: t('export.successDesc') });
      setIsOpen(false);

    } catch (error: any) {
      console.error('Export failed:', error);
      const description = error?.message === EXCEL_ROW_LIMIT_ERROR
        ? t('export.excelLimit')
        : t('export.failedDesc');
      toast({ title: t('export.failedTitle'), description, variant: 'destructive' });
    } finally {
      setIsDownloading(false);
      setDownloadFormat(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent aria-busy={isDownloading}>
        <DialogHeader>
          <DialogTitle>{t('export.title')}</DialogTitle>
          <DialogDescription>
            {t('export.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
          <Button
            onClick={() => handleDownload('xlsx')}
            disabled={isDownloading}
            variant="outline"
            className="h-24 flex-col gap-1 rounded-md [&_svg]:size-6"
          >
            {isDownloading && downloadFormat === 'xlsx' ? (
              <Loader2 className="mb-1 animate-spin" />
            ) : (
              <FileSpreadsheet className="mb-1 text-success" />
            )}
            <span className="text-[15px] font-semibold">{t('export.excel')}</span>
            <span className="text-[12px] font-normal text-muted-foreground">{t('export.excelHint')}</span>
          </Button>
          <Button
            onClick={() => handleDownload('csv')}
            disabled={isDownloading}
            variant="outline"
            className="h-24 flex-col gap-1 rounded-md [&_svg]:size-6"
          >
            {isDownloading && downloadFormat === 'csv' ? (
              <Loader2 className="mb-1 animate-spin" />
            ) : (
              <FileText className="mb-1 text-primary" />
            )}
            <span className="text-[15px] font-semibold">{t('export.csv')}</span>
             <span className="text-[12px] font-normal text-muted-foreground">{t('export.csvHint')}</span>
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={isDownloading}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
