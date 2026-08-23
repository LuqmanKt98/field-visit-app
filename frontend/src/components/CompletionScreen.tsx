import { Check } from 'lucide-react';

export function CompletionScreen({ taskId }: { taskId?: string }) {
    return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-6 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success text-white shadow-lg">
                <Check className="h-10 w-10" strokeWidth={3} />
            </div>
            {/* Exact wording from the client's brief -- no trailing period. */}
            <h1 className="max-w-sm text-2xl font-bold leading-snug tracking-tight">
                The task is complete, you can leave the field
            </h1>
            <p className="mt-3 max-w-sm text-muted-foreground">
                All photos and the video were uploaded successfully
                {taskId ? ` for task #${taskId}` : ''}.
            </p>
            <p className="mt-8 text-sm text-muted-foreground">You can close this page now.</p>
        </div>
    );
}
