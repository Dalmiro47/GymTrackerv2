
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
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileSpreadsheet, FileText } from 'lucide-react';
import { db } from '@/lib/firebaseConfig';
import { collection, getDocs, query, orderBy, limit, startAfter, DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import * as XLSX from 'xlsx';

// Define types based on the PRD
interface SetEntry {
  id?: string;
  reps?: number;
  weight?: number;
}

interface WorkoutLog {
  date?: string;
  id?: string;
  name?: string;
  muscleGroup?: string;
  notes?: string;
  exerciseSetup?: string;
  createdAt?: { toDate: () => Date }; // Firestore Timestamp
  sets?: SetEntry[];
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
    // Stable, deterministic ordering for pagination:
    orderBy('date'),                // string YYYY-MM-DD
    orderBy('createdAt'),           // Firestore Timestamp (may be missing)
    orderBy('__name__'),            // doc id as final tiebreaker
    limit(PAGE_SIZE)
  );

export function ExportLogsDialog({ isOpen, setIsOpen }: ExportLogsDialogProps) {
  const { user } = useAuth(); // This hook returns the UserProfile, we need the firebase user for uid. Let's use it from context.
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'xlsx' | 'csv' | null>(null);

  const flattenWorkoutLogsToRows = (logDoc: QueryDocumentSnapshot<DocumentData>): ExportRow[] => {
    const docId = logDoc.id;
    const data = logDoc.data() as WorkoutLog;
    const rows: ExportRow[] = [];

    const date = data.date || (/\d{4}-\d{2}-\d{2}/.test(docId) ? docId : '');
    const createdAt = data.createdAt ? data.createdAt.toDate().toISOString() : '';

    const base = {
      date,
      exercise_id: data.id || docId,
      exercise_name: data.name || '',
      muscle_group: data.muscleGroup || '',
      notes: data.notes || '',
      exercise_setup: data.exerciseSetup || '',
      created_at: createdAt,
    };

    const sets = data.sets ?? [];
    if (sets.length === 0) {
      rows.push({ ...base, set_index: -1, set_id: '', reps: '', weight: '' });
    } else {
      sets.forEach((s, i) => {
        rows.push({
          ...base,
          set_index: i,
          set_id: s.id || '',
          reps: s.reps ?? '',
          weight: s.weight ?? '',
        });
      });
    }
    return rows;
  };

  // CSV: include UTF-8 BOM for Excel
  const streamRowsAsCsv = (rows: ExportRow[], headers: (keyof ExportRow)[]) => {
    const headerString = headers.join(',') + '\r\n';
    const rowStrings = rows.map(row =>
      headers.map(h => {
        const v = row[h as keyof ExportRow];
        const s = (v === null || v === undefined) ? '' : String(v);
        return `"${s.replace(/"/g, '""')}"`
      }).join(',')
    ).join('\r\n');
    // Prepend BOM for excel compatibility
    return '\uFEFF' + headerString + rowStrings;
  };


  const handleDownload = async (format: 'xlsx' | 'csv') => {
    if (!firebaseUser) {
      toast({ title: 'Error', description: 'You must be logged in to export data.', variant: 'destructive' });
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

        // Optional soft cap to avoid OOM in the browser for XLSX
        if (allRows.length > 200_000 && format === 'xlsx') {
            throw new Error('Too many rows for Excel in browser. Please use the CSV export option.');
        }
      }
      
      const headers: (keyof ExportRow)[] = [
        'date','exercise_id','exercise_name','muscle_group','set_index','set_id',
        'reps','weight','notes','exercise_setup','created_at'
      ];
      
      const dateString = new Date().toISOString().slice(0,10).replace(/-/g,'');
      const filename = `workout-logs-${dateString}.${format}`;
      
      let blob;
      if (format === 'csv') {
        const csvString = streamRowsAsCsv(allRows, headers);
        blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      } else {
        const ws = XLSX.utils.json_to_sheet(allRows, { header: headers });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'workout_logs');
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      }

      // Create a link and trigger the download
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      toast({ title: 'Success', description: 'Your workout logs have been downloaded.' });
      setIsOpen(false);

    } catch (error: any) {
      console.error('Export failed:', error);
      toast({ title: 'Export Failed', description: error.message || 'Could not download your logs.', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
      setDownloadFormat(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Workout Data</DialogTitle>
          <DialogDescription>
            Download a complete history of your workout logs. Choose your preferred format below.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
          <Button
            onClick={() => handleDownload('xlsx')}
            disabled={isDownloading}
            variant="outline"
            className="h-20 flex-col"
          >
            {isDownloading && downloadFormat === 'xlsx' ? (
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
            ) : (
              <FileSpreadsheet className="h-6 w-6 mb-2 text-green-600" />
            )}
            <span>Excel (.xlsx)</span>
            <span className="text-xs text-muted-foreground">Best for analysis</span>
          </Button>
          <Button
            onClick={() => handleDownload('csv')}
            disabled={isDownloading}
            variant="outline"
            className="h-20 flex-col"
          >
            {isDownloading && downloadFormat === 'csv' ? (
              <Loader2 className="h-6 w-6 animate-spin mb-2" />
            ) : (
              <FileText className="h-6 w-6 mb-2 text-blue-600" />
            )}
            <span>CSV (smaller file)</span>
             <span className="text-xs text-muted-foreground">Best for compatibility</span>
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={isDownloading}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
