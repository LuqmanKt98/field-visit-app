import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
    'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap',
    {
        variants: {
            variant: {
                default: 'border-transparent bg-primary/10 text-primary',
                neutral: 'border-transparent bg-muted text-muted-foreground',
                success: 'border-transparent bg-success/12 text-emerald-700',
                warning: 'border-transparent bg-warning/15 text-amber-700',
                destructive: 'border-transparent bg-destructive/10 text-destructive',
                outline: 'text-foreground',
            },
        },
        defaultVariants: { variant: 'default' },
    },
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
