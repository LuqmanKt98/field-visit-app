import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ClipboardList, Images, Link2, LogOut, MapPin, Plus, Search, SearchX, ShieldCheck } from 'lucide-react';
import { AdminPagination, listAdminTasks } from '@/services/api';
import { MediaGallery } from '@/components/MediaGallery';
import { NewVisitDialog } from '@/components/NewVisitDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, EmptyState, statusMeta } from '@/components/ui/feedback';
import { AdminTaskSummary } from '@/types';

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function TaskList({
    token,
    username,
    onChangePassword,
    onSignOut,
    onSessionExpired,
}: {
    token: string;
    username: string;
    onChangePassword: () => void;
    onSignOut: () => void;
    onSessionExpired: () => void;
}) {
    const [tasks, setTasks] = useState<AdminTaskSummary[]>([]);
    const [pagination, setPagination] = useState<AdminPagination | null>(null);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<'created_timestamp' | 'updated_timestamp'>('updated_timestamp');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // The link is how a visit actually reaches the field, so copying it is a primary
    // action on every row rather than something to assemble by hand.
    async function copyVisitLink(id: string): Promise<void> {
        const url = window.location.origin + '/?taskid=' + id;
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            window.prompt('Copy this link for the field representative:', url);
        }
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    }

    // Debounced so typing a Task ID does not fire a request per keystroke.
    useEffect(() => {
        const id = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(id);
    }, [searchInput]);

    const load = useCallback(() => {
        let cancelled = false;
        setLoading(true);
        listAdminTasks(token, { search: search || undefined, sortBy, sortDir, page, pageSize: PAGE_SIZE })
            .then((res) => {
                if (cancelled) return;
                setTasks(res.tasks);
                setPagination(res.pagination);
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                // An expired session drops back to the sign-in card rather than leaving
                // a permanently broken table on screen.
                if ((err as { status?: number })?.status === 401) {
                    onSessionExpired();
                    return;
                }
                setError((err as Error).message);
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [token, search, sortBy, sortDir, page, onSessionExpired]);

    useEffect(() => load(), [load]);

    const totalPages = pagination?.totalPages ?? 1;
    const showEmpty = !loading && tasks.length === 0;

    return (
        <div className="min-h-screen-safe bg-muted/40">
            <header className="border-b bg-background">
                <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                            <MapPin className="h-4 w-4" />
                        </span>
                        <div>
                            <p className="text-sm font-bold leading-tight tracking-tight">Field Visit</p>
                            <p className="text-xs text-muted-foreground">Signed in as {username}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => setCreating(true)}>
                            <Plus className="h-4 w-4" />
                            <span className="hidden sm:inline">New visit</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onChangePassword}>
                            <ShieldCheck className="h-4 w-4" />
                            <span className="hidden sm:inline">Change password</span>
                        </Button>
                        <Button variant="outline" size="sm" onClick={onSignOut}>
                            <LogOut className="h-4 w-4" />
                            <span className="hidden sm:inline">Sign out</span>
                        </Button>
                    </div>
                </div>
            </header>

            <main className="pb-safe mx-auto max-w-6xl space-y-4 px-4 pt-5">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Field visits</h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        {pagination
                            ? `${pagination.total} task${pagination.total === 1 ? '' : 's'} in total`
                            : 'Loading…'}
                    </p>
                </div>

                <div className="flex flex-wrap gap-2.5">
                    <div className="relative min-w-0 flex-1 basis-56">
                        <Search
                            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <Input
                            type="search"
                            placeholder="Search by Task ID"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            inputMode="numeric"
                            aria-label="Search by Task ID"
                            className="pl-10"
                        />
                    </div>
                    <select
                        value={sortBy}
                        onChange={(e) => {
                            setSortBy(e.target.value as typeof sortBy);
                            setPage(1);
                        }}
                        aria-label="Sort by"
                        className="min-h-11 flex-1 basis-44 rounded-lg border border-input bg-background px-3 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <option value="updated_timestamp">Sort: Last updated</option>
                        <option value="created_timestamp">Sort: Date created</option>
                    </select>
                    <select
                        value={sortDir}
                        onChange={(e) => {
                            setSortDir(e.target.value as typeof sortDir);
                            setPage(1);
                        }}
                        aria-label="Sort direction"
                        className="min-h-11 flex-1 basis-40 rounded-lg border border-input bg-background px-3 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <option value="desc">Newest first</option>
                        <option value="asc">Oldest first</option>
                    </select>
                </div>

                {error && <Alert variant="destructive">{error}</Alert>}

                {showEmpty ? (
                    <Card>
                        {search ? (
                            <EmptyState icon={<SearchX className="h-6 w-6" />} title={`No task matches “${search}”`}>
                                Check the Task ID and try again.
                            </EmptyState>
                        ) : (
                            <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No field visits yet">
                                Create the first one, then send its link to whoever is going out to the property.
                            </EmptyState>
                        )}
                    </Card>
                ) : (
                    <>
                        {/* Desktop: full table. */}
                        <Card className="hidden overflow-hidden md:block">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[760px] border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                            <th className="px-4 py-3 font-semibold">Task ID</th>
                                            <th className="px-4 py-3 font-semibold">Status</th>
                                            <th className="px-4 py-3 font-semibold">Address</th>
                                            <th className="px-4 py-3 font-semibold">Created</th>
                                            <th className="px-4 py-3 font-semibold">Updated</th>
                                            <th className="px-4 py-3 font-semibold">Link</th>
                                            <th className="px-4 py-3 font-semibold">Photos</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tasks.map((t) => {
                                            const meta = statusMeta(t.status);
                                            return (
                                                <tr key={t.taskId} className="border-b last:border-0 hover:bg-muted/40">
                                                    <td className="px-4 py-3 font-semibold tabular-nums">{t.taskId}</td>
                                                    <td className="px-4 py-3">
                                                        <Badge variant={meta.variant}>{meta.label}</Badge>
                                                    </td>
                                                    <td className="px-4 py-3">{t.address ?? '—'}</td>
                                                    <td className="px-4 py-3 text-muted-foreground">
                                                        {formatDate(t.createdTimestamp)}
                                                    </td>
                                                    <td className="px-4 py-3 text-muted-foreground">
                                                        {formatDate(t.updatedTimestamp)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => copyVisitLink(t.taskId)}
                                                            title="Copy the link for the field representative"
                                                        >
                                                            {copiedId === t.taskId ? (
                                                                <Check className="h-3.5 w-3.5" />
                                                            ) : (
                                                                <Link2 className="h-3.5 w-3.5" />
                                                            )}
                                                            {copiedId === t.taskId ? 'Copied' : 'Copy'}
                                                        </Button>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {t.cloudUrl ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => setViewingTaskId(t.taskId)}
                                                            >
                                                                <Images className="h-3.5 w-3.5" />
                                                                View
                                                            </Button>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {loading && tasks.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                                                    Loading…
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>

                        {/* Mobile: a six-column table is unusable on a phone, and admins
                            do check visits from one, so the same rows become cards. */}
                        <div className="space-y-2.5 md:hidden">
                            {tasks.map((t) => {
                                const meta = statusMeta(t.status);
                                return (
                                    <Card key={t.taskId} className="space-y-3 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-semibold tabular-nums">#{t.taskId}</span>
                                            <Badge variant={meta.variant}>{meta.label}</Badge>
                                        </div>
                                        <p className="text-sm leading-relaxed text-muted-foreground">
                                            {t.address ?? 'No address on file'}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Updated {formatDate(t.updatedTimestamp)}
                                        </p>
                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                className="flex-1"
                                                onClick={() => copyVisitLink(t.taskId)}
                                            >
                                                {copiedId === t.taskId ? (
                                                    <Check className="h-4 w-4" />
                                                ) : (
                                                    <Link2 className="h-4 w-4" />
                                                )}
                                                {copiedId === t.taskId ? 'Copied' : 'Copy link'}
                                            </Button>
                                            {t.cloudUrl && (
                                                <Button
                                                    variant="outline"
                                                    className="flex-1"
                                                    onClick={() => setViewingTaskId(t.taskId)}
                                                >
                                                    <Images className="h-4 w-4" />
                                                    Photos
                                                </Button>
                                            )}
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    </>
                )}

                {pagination && pagination.total > 0 && totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                        <Button
                            variant="outline"
                            disabled={page <= 1 || loading}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                            Page {pagination.page} of {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            disabled={page >= totalPages || loading}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Next
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            </main>

            {creating && (
                <NewVisitDialog
                    token={token}
                    onClose={() => setCreating(false)}
                    onCreated={load}
                    onSessionExpired={onSessionExpired}
                />
            )}

            {viewingTaskId && (
                <MediaGallery
                    token={token}
                    taskId={viewingTaskId}
                    onClose={() => setViewingTaskId(null)}
                    onAuthExpired={onSessionExpired}
                    onReopened={load}
                />
            )}
        </div>
    );
}
