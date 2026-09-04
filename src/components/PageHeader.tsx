interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode; // For action buttons like "Add New"
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="animate-enter mb-6 md:mb-8">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="font-headline text-[34px] font-bold leading-none tracking-tight text-foreground md:text-[40px]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-[15px] leading-snug text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {/* Allow actions to expand on mobile; keep desktop behavior */}
        {children && (
          <div className="w-full md:w-auto md:text-right">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
