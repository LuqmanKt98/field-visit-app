import { FormEvent, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { PasswordInput, PasswordStrength } from '@/components/ui/password-input';
import { ApiError, changeAdminPassword, AdminIdentity } from '@/services/api';

/**
 * Also a state of /admin rather than its own route.
 *
 * `forced` is the first-sign-in case, where the account still has the password whoever
 * set it up chose; it only changes the wording and removes the cancel option.
 */
export function ChangePasswordCard({
    token,
    forced,
    onDone,
    onCancel,
    onSessionExpired,
}: {
    token: string;
    forced: boolean;
    onDone: (token: string, admin: AdminIdentity) => void;
    onCancel?: () => void;
    onSessionExpired: () => void;
}) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
    const canSubmit = currentPassword.length > 0 && newPassword.length >= 10 && newPassword === confirmPassword;

    async function handleSubmit(event: FormEvent): Promise<void> {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const result = await changeAdminPassword(token, currentPassword, newPassword);
            onDone(result.token, result.admin);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401 && /session/i.test(err.message)) {
                onSessionExpired();
                return;
            }
            setError(err instanceof ApiError ? err.message : 'We could not change your password.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex min-h-screen-safe items-center justify-center bg-muted/40 px-4 py-10">
            <Card className="w-full max-w-md">
                <CardContent className="p-6 sm:p-8">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <ShieldCheck className="h-5 w-5" />
                    </div>

                    <h1 className="text-2xl font-bold tracking-tight">
                        {forced ? 'Choose your password' : 'Change your password'}
                    </h1>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {forced
                            ? 'Your account was set up with a temporary password. Please choose your own before you continue.'
                            : 'You will stay signed in on this device.'}
                    </p>

                    <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                        <div className="space-y-2">
                            <Label htmlFor="currentPassword">
                                {forced ? 'Temporary password' : 'Current password'}
                            </Label>
                            <PasswordInput
                                id="currentPassword"
                                value={currentPassword}
                                onChange={setCurrentPassword}
                                autoComplete="current-password"
                                autoFocus
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="newPassword">New password</Label>
                            <PasswordInput
                                id="newPassword"
                                value={newPassword}
                                onChange={setNewPassword}
                                autoComplete="new-password"
                            />
                            <PasswordStrength value={newPassword} />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Confirm new password</Label>
                            <PasswordInput
                                id="confirmPassword"
                                value={confirmPassword}
                                onChange={setConfirmPassword}
                                autoComplete="new-password"
                            />
                            {mismatch && (
                                <p className="text-sm font-medium text-destructive">
                                    Those two passwords do not match.
                                </p>
                            )}
                        </div>

                        {error && <Alert variant="destructive">{error}</Alert>}

                        <Button
                            type="submit"
                            size="lg"
                            className="w-full"
                            loading={submitting}
                            loadingText="Saving…"
                            disabled={!canSubmit}
                        >
                            Save new password
                        </Button>

                        {!forced && onCancel && (
                            <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>
                                Cancel
                            </Button>
                        )}
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
