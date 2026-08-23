import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex gap-3 rounded-lg border p-4 text-sm leading-relaxed', {
    variants: {
        variant: {
            info: 'border-border bg-muted text-foreground',
            success: 'border-success/30 bg-success/10 text-emerald-900',
            warning: 'border-warning/40 bg-warning/10 text-amber-900',
            destructive: 'border-destructive/30 bg-destructive/8 text-red-900',
        },
    },
    defaultVariants: { variant: 'info' },
});

const ICONS = {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    destructive: XCircle,
} as const;

export interface AlertProps
    extends React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof alertVariants> {
    icon?: React.ReactNode;
}

export function Alert({ className, variant = 'info', icon, children, ...props }: AlertProps) {
    const Icon = ICONS[variant ?? 'info'];
    return (
        <div
            className={cn(alertVariants({ variant }), className)}
            role={variant === 'destructive' ? 'alert' : undefined}
            {...props}
        >
            <span className="mt-0.5 shrink-0" aria-hidden="true">
                {icon ?? <Icon className="h-4 w-4" />}
            </span>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

export function EmptyState({
    icon,
    title,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {icon}
            </div>
            <p className="font-semibold">{title}</p>
            {children && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
        </div>
    );
}

const STATUS = {
    0: { label: 'Not started', variant: 'neutral' },
    1: { label: 'In progress', variant: 'default' },
    2: { label: 'Completed', variant: 'success' },
} as const;

export function statusMeta(status: number) {
    return STATUS[status as keyof typeof STATUS] ?? { label: 'Unknown', variant: 'neutral' as const };
}
