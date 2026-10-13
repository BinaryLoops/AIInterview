import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'neutral' | 'success' | 'warning' | 'outline';
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  className = '',
  children,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tracking-wide transition-colors';

  const variantStyles = {
    default:
      'bg-brand-50 text-brand-700 border border-brand-200 dark:bg-brand-950/50 dark:text-brand-300 dark:border-brand-800',
    neutral:
      'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    success:
      'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    warning:
      'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    outline:
      'border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
  }[variant];

  return (
    <span className={`${baseStyles} ${variantStyles} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
};
