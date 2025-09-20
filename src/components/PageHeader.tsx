interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode; // For action buttons like "Add New"
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-6 md:mb-8">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-headline font-bold tracking-tight text-primary md:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-base text-muted-foreground md:text-lg">
              {description}
            </p>
          )}
        </div>

        {/* Allow actions to expand on mobile; keep desktop behavior */}
        {children && (
          <div className="w-full md:w-auto">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
