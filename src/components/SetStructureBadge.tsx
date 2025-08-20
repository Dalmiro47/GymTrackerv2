
"use client";

import { SET_STRUCTURE_COLORS, SET_STRUCTURE_LABEL, type SetStructure } from '@/types/setStructure';

export function SetStructureBadge({ value }: { value: SetStructure }) {
  if (!value || value === 'normal') {
    return null; // Don't render anything for "normal" to keep UI clean
  }
  
  const styles = SET_STRUCTURE_COLORS[value];
  
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 9999,
      backgroundColor: styles.bg,
      color: styles.text,
      border: `1px solid ${styles.border}`,
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1.4,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      whiteSpace: 'nowrap',
      width: 'auto',
      maxWidth: 'max-content',
      flex: '0 0 auto',
    }}>
      {SET_STRUCTURE_LABEL[value]}
    </span>
  );
}
