'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface SearchableSelectOption {
  id: string;
  label: string;
  description?: string;
  meta?: string;
}

interface SearchableSelectProps {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  selectedOption?: SearchableSelectOption;
  searchValue: string;
  options: SearchableSelectOption[];
  loading?: boolean;
  error?: string;
  placeholder: string;
  emptyText: string;
  onSearchChange: (value: string) => void;
  onChange: (value: string) => void;
}

export function SearchableSelect({
  id,
  label,
  required,
  value,
  selectedOption,
  searchValue,
  options,
  loading,
  error,
  placeholder,
  emptyText,
  onSearchChange,
  onChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => selectedOption ?? options.find((option) => option.id === value),
    [options, selectedOption, value],
  );
  const displayValue = open || !selected ? searchValue : selected.label;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <Input
          id={id}
          value={displayValue}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onSearchChange(event.target.value);
            onChange('');
            setOpen(true);
          }}
          placeholder={placeholder}
          className="pl-9"
          aria-required={required}
        />
      </div>
      {selected && !open && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <div className="font-semibold">{selected.label}</div>
          {selected.description && <div className="mt-0.5">{selected.description}</div>}
        </div>
      )}
      {open && (
        <div className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div className="px-3 py-3 text-sm text-gray-500">Loading...</div>
          ) : error ? (
            <div className="px-3 py-3 text-sm text-red-700">{error}</div>
          ) : options.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-500">{emptyText}</div>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  onSearchChange('');
                  setOpen(false);
                }}
                className="block w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-amber-50"
              >
                <span className="block text-sm font-semibold text-gray-900">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-gray-500">{option.description}</span>
                )}
                {option.meta && (
                  <span className="mt-0.5 block text-xs text-gray-400">{option.meta}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
      {selected && open && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            onChange('');
            onSearchChange('');
            setOpen(false);
          }}
        >
          Clear selection
        </Button>
      )}
    </div>
  );
}
