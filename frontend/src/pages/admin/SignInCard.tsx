import { FormEvent, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { PasswordInput } from '@/components/ui/password-input';
import { adminLogin, ApiError, AdminIdentity } from '@/services/api';

/**
 * Sign-in lives inside /admin rather than on its own route.
 *
 * A separate /admin/login URL means a redirect the moment a session expires, which is
 * disorienting for non-technical users; keeping it here makes signing in feel like a
 * state of the same page rather than a place you get sent to.
 */
export function SignInCard({ onSignedIn }: { onSignedIn: (token: string, admin: AdminIdentity) => void }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(event: FormEvent): Promise<void> {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const { token, admin } = await adminLogin(username.trim(), password);
            onSignedIn(token, admin);
        } catch (err) {
            setError(
                err instanceof ApiError ? err.message : 'We could not sign you in. Please try again.',
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
            <div className="w-full max-w-md">
                <div className="mb-6 flex items-center justify-center gap-2.5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <MapPin className="h-5 w-5" />
                    </span>
                    <span className="text-lg font-bold tracking-tight">Field Visit</span>
                </div>

                <Card>
                    <CardContent className="p-6 sm:p-8">
                        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                            View field visits and the photos your team has taken.
                        </p>

                        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                            <div className="space-y-2">
                                <Label htmlFor="username">Username</Label>
                                <Input
                                    id="username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    autoComplete="username"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    autoFocus
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <PasswordInput
                                    id="password"
                                    value={password}
                                    onChange={setPassword}
                                    autoComplete="current-password"
                                />
                            </div>

                            {error && <Alert variant="destructive">{error}</Alert>}

                            <Button
                                type="submit"
                                size="lg"
                                className="w-full"
                                loading={submitting}
                                loadingText="Signing in…"
                                disabled={!username.trim() || !password}
                            >
                                Sign in
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <div className="mt-5 text-center">
                    <Button variant="link" size="sm" asChild>
                        <a href="/">Back to field visit</a>
                    </Button>
                </div>
            </div>
        </div>
    );
}
