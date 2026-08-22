import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'neutral' | 'primary' | 'danger';
  size?: 'sm' | 'md';
}

const VARIANT_CLASS: Record<ButtonProps['variant'], string> = {
  neutral: 'border-wood-grain bg-surface text-fg hover:bg-surface-raised',
  primary: 'border-brass-bright bg-brass text-ink hover:bg-brass-bright',
  danger: 'border-ember-bright bg-surface text-ember-text hover:bg-surface-raised',
};

const SIZE_CLASS: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1',
  md: 'px-4 py-2',
};

export function Button({ variant, size = 'sm', className, ...rest }: ButtonProps) {
  return (
    <button
      className={`rounded-md border ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className ?? ''}`}
      {...rest}
    />
  );
}
