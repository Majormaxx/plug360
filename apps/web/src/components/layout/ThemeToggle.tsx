'use client';

import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { Segmented } from '../ui/Segmented';
import { useTheme, type ThemeChoice } from '../providers/ThemeProvider';

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <Segmented<ThemeChoice>
      label="Theme"
      size="sm"
      value={choice}
      onChange={setChoice}
      options={[
        { value: 'system', label: <span className="inline-flex items-center gap-1.5"><Desktop className="size-4" />Auto</span> },
        { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun className="size-4" />Light</span> },
        { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon className="size-4" />Dark</span> },
      ]}
    />
  );
}
