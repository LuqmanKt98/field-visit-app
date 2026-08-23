import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Lightbulb, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export function TaskEntry() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [taskId, setTaskId] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Supports direct links like MyFieldVisitApp.com?taskid=345667896.
    useEffect(() => {
        const taskIdParam = searchParams.get('taskid');
        if (taskIdParam) {
            navigate(`/task/${encodeURIComponent(taskIdParam)}`, { replace: true });
        }
    }, [searchParams, navigate]);

    function handleSubmit(event: FormEvent): void {
        event.preventDefault();
        const trimmed = taskId.trim();
        if (!trimmed) return;
        if (!/^\d+$/.test(trimmed)) {
            setError('A Task ID is numbers only. Check the ID on your job sheet.');
            return;
        }
        navigate(`/task/${encodeURIComponent(trimmed)}`);
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
                        <h1 className="text-2xl font-bold tracking-tight">Start your visit</h1>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                            Enter the Task ID from your job sheet.
                        </p>

                        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
                            <div className="space-y-2">
                                <Label htmlFor="taskId">Task ID</Label>
                                <Input
                                    id="taskId"
                                    type="text"
                                    /* numeric keypad on phones, without type=number's spinners */
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder="345667896"
                                    value={taskId}
                                    onChange={(e) => {
                                        setTaskId(e.target.value);
                                        if (error) setError(null);
                                    }}
                                    autoFocus
                                    autoComplete="off"
                                    className="h-14 text-center text-2xl font-semibold tracking-[0.15em] tabular-nums"
                                    aria-describedby={error ? 'taskIdError' : undefined}
                                    aria-invalid={Boolean(error)}
                                />
                                {error && (
                                    <p id="taskIdError" className="text-sm font-medium text-destructive">
                                        {error}
                                    </p>
                                )}
                            </div>

                            <Button type="submit" size="lg" className="w-full" disabled={!taskId.trim()}>
                                Continue
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        </form>

                        <div className="mt-6 flex gap-2.5 rounded-lg bg-muted p-3.5 text-sm text-muted-foreground">
                            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <p>
                                If your supervisor sent you a link, just tap it — your task opens straight
                                away.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <div className="mt-5 text-center">
                    <Button variant="link" size="sm" asChild>
                        <a href="/admin">Administrator sign in</a>
                    </Button>
                </div>
            </div>
        </div>
    );
}
