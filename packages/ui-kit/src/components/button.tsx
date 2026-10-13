import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      className = '',
      children,
      disabled,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none';

    const sizeStyles = {
      sm: 'h-8 px-3 text-xs rounded-md gap-1.5',
      md: 'h-10 px-4 text-sm rounded-lg gap-2',
      lg: 'h-12 px-6 text-base rounded-xl gap-2.5',
    }[size];

    const variantStyles = {
      primary:
        'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm shadow-brand-500/20',
      secondary:
        'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 shadow-sm',
      outline:
        'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
      ghost:
        'text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100',
    }[variant];

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
