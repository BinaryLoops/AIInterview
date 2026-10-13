import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ hoverEffect = false, className = '', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-sm transition-all duration-200 dark:border-slate-800 dark:bg-slate-900/80 ${
          hoverEffect
            ? 'hover:-translate-y-1 hover:border-slate-300 hover:shadow-md dark:hover:border-slate-700'
            : ''
        } ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div className={`mb-4 flex flex-col space-y-1.5 ${className}`.trim()} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <h3
    className={`text-lg font-semibold tracking-tight text-slate-900 dark:text-white ${className}`.trim()}
    {...props}
  >
    {children}
  </h3>
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <p
    className={`text-sm text-slate-500 dark:text-slate-400 ${className}`.trim()}
    {...props}
  >
    {children}
  </p>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => <div className={`${className}`.trim()} {...props}>{children}</div>;
