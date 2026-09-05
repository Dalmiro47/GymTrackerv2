
"use client";

import { SET_STRUCTURE_COLORS, type SetStructure } from '@/types/setStructure';
import { useI18n } from '@/contexts/LanguageContext';
import { setStructureLabel } from '@/i18n';

export function SetStructureBadge({ value }: { value: SetStructure }) {
  const { language } = useI18n();
  if (!value || value === 'normal') {
    return null; // Don't render anything for "normal" to keep UI clean
  }

  const styles = SET_STRUCTURE_COLORS[value];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 22,
      padding: '0 8px',
      borderRadius: 9999,
      backgroundColor: styles.bg,
      color: styles.text,
      border: `1px solid ${styles.border}`,
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      whiteSpace: 'nowrap',
      width: 'auto',
      maxWidth: 'max-content',
      flex: '0 0 auto',
    }}>
      {setStructureLabel(value, language)}
    </span>
  );
}
