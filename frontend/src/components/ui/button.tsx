import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
    // min-h-11 keeps every button at a comfortable touch target; this app is used
    // one-handed outdoors, where small controls are genuinely hard to hit.
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] touch-manipulation select-none',
    {
        variants: {
            variant: {
                default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
                destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
                outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
                secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
                ghost: 'hover:bg-accent hover:text-accent-foreground',
                link: 'text-primary underline-offset-4 hover:underline',
            },
            size: {
                default: 'min-h-11 px-5 py-2.5',
                sm: 'min-h-9 rounded-md px-3 text-sm',
                lg: 'min-h-14 rounded-xl px-7 text-base',
                // Used for the primary capture action, which must be unmissable.
                capture: 'min-h-16 w-full rounded-xl px-6 text-base',
                icon: 'h-11 w-11',
            },
        },
        defaultVariants: { variant: 'default', size: 'default' },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
    loading?: boolean;
    loadingText?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, loading, loadingText, children, disabled, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button';
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                disabled={disabled || loading}
                {...props}
            >
                {loading ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {loadingText ?? children}
                    </>
                ) : (
                    children
                )}
            </Comp>
        );
    },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
