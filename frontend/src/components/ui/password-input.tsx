import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Password field with a show/hide toggle.
 *
 * Worth the extra control: these get typed on a phone keyboard, and not being able to
 * see what you typed is one of the most common reasons people fail to sign in.
 */
export function PasswordInput({
    id,
    value,
    onChange,
    placeholder,
    autoComplete,
    autoFocus,
    disabled,
    className,
}: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    autoComplete?: string;
    autoFocus?: boolean;
    disabled?: boolean;
    className?: string;
}) {
    const [shown, setShown] = useState(false);
    return (
        <div className="relative">
            <Input
                id={id}
                type={shown ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                autoComplete={autoComplete}
                autoFocus={autoFocus}
                disabled={disabled}
                className={cn('pr-12', className)}
            />
            <button
                type="button"
                onClick={() => setShown((s) => !s)}
                disabled={disabled}
                className="absolute right-1 top-1/2 flex h-9 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={shown ? 'Hide password' : 'Show password'}
            >
                {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
        </div>
    );
}

/** Coarse feedback on password length; mirrors the server's 10-character minimum. */
export function PasswordStrength({ value }: { value: string }) {
    const score = value.length === 0 ? 0 : value.length < 10 ? 1 : value.length < 14 ? 2 : value.length < 20 ? 3 : 4;
    const remaining = 10 - value.length;

    return (
        <div className="space-y-1.5">
            <div className="flex gap-1.5" aria-hidden="true">
                {[1, 2, 3, 4].map((n) => (
                    <div
                        key={n}
                        className={cn(
                            'h-1 flex-1 rounded-full transition-colors',
                            score >= n ? (score <= 1 ? 'bg-warning' : 'bg-success') : 'bg-muted',
                        )}
                    />
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
                {value.length === 0
                    ? 'At least 10 characters — a short phrase works well.'
                    : remaining > 0
                      ? `${remaining} more character${remaining === 1 ? '' : 's'} needed`
                      : score >= 3
                        ? 'Good length'
                        : 'Long enough — longer is safer'}
            </p>
        </div>
    );
}
