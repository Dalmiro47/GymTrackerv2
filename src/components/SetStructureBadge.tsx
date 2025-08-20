
"use client";

import { SET_STRUCTURE_COLORS, SET_STRUCTURE_LABEL, type SetStructure } from '@/types/setStructure';

export function SetStructureBadge({ value }: { value: SetStructure }) {
  if (!value || value === 'normal') {
    return null; // Don't render anything for "normal" to keep UI clean
  }
  
  const styles = SET_STRUCTURE_COLORS[value];
  
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '9999px',
      backgroundColor: styles.bg,
      color: styles.text,
      border: `1px solid ${styles.border}`,
      fontSize: '11px',
      fontWeight: 500,
      lineHeight: 1.5,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {SET_STRUCTURE_LABEL[value]}
    </span>
  );
}
