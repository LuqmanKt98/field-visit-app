import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AdminPagination, listAdminTasks } from '../services/api';
import { MediaGallery } from '../components/MediaGallery';
import { AdminTaskSummary, TaskStatus } from '../types';

const STATUS_LABEL: Record<TaskStatus, string> = {
    [TaskStatus.NotStarted]: 'Not Started',
    [TaskStatus.InProgress]: 'In Progress',
    [TaskStatus.Completed]: 'Completed',
};

const PAGE_SIZE = 25;

export function AdminDashboard() {
    const [token, setToken] = useState(() => localStorage.getItem('adminToken'));
    const [tasks, setTasks] = useState<AdminTaskSummary[]>([]);
    const [pagination, setPagination] = useState<AdminPagination | null>(null);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<'created_timestamp' | 'updated_timestamp'>('updated_timestamp');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);

    const handleAuthExpired = useCallback(() => {
        localStorage.removeItem('adminToken');
        setToken(null);
    }, []);

    // Debounced so typing a Task ID doesn't fire a request per keystroke.
    useEffect(() => {
        const id = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(id);
    }, [searchInput]);

    useEffect(() => {
        if (!token) return;
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
                // An expired or invalid session should return to the login screen
                // rather than leaving a permanently broken table on screen.
                if ((err as { status?: number })?.status === 401) {
                    handleAuthExpired();
                    return;
                }
                setError((err as Error).message);
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [token, search, sortBy, sortDir, page, handleAuthExpired]);

    if (!token) {
        return <Navigate to="/admin/login" replace />;
    }

    function handleLogout(): void {
        localStorage.removeItem('adminToken');
        setToken(null);
    }

    const totalPages = pagination?.totalPages ?? 1;

    return (
        <div className="page">
            <header className="admin-header">
                <h1>All Tasks</h1>
                <button type="button" className="btn btn-secondary" onClick={handleLogout}>
                    Log out
                </button>
            </header>

            <div className="admin-controls">
                <input
                    type="text"
                    placeholder="Search by Task ID"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="input"
                />
                <select
                    value={sortBy}
                    onChange={(e) => {
                        setSortBy(e.target.value as typeof sortBy);
                        setPage(1);
                    }}
                    className="input"
                    aria-label="Sort by"
                >
                    <option value="updated_timestamp">Updated date</option>
                    <option value="created_timestamp">Created date</option>
                </select>
                <select
                    value={sortDir}
                    onChange={(e) => {
                        setSortDir(e.target.value as typeof sortDir);
                        setPage(1);
                    }}
                    className="input"
                    aria-label="Sort direction"
                >
                    <option value="desc">Newest first</option>
                    <option value="asc">Oldest first</option>
                </select>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="table-wrapper">
                <table className="admin-table">
                    <thead>
                        <tr>
                            <th>Task ID</th>
                            <th>Status</th>
                            <th>Address</th>
                            <th>Agent</th>
                            <th>Created</th>
                            <th>Updated</th>
                            <th>Media</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map((t) => (
                            <tr key={t.taskId}>
                                <td>{t.taskId}</td>
                                <td>{STATUS_LABEL[t.status] ?? t.status}</td>
                                <td>{t.address ?? '—'}</td>
                                <td>{t.agent || '—'}</td>
                                <td>{t.createdTimestamp ? new Date(t.createdTimestamp).toLocaleString() : '—'}</td>
                                <td>{t.updatedTimestamp ? new Date(t.updatedTimestamp).toLocaleString() : '—'}</td>
                                <td>
                                    {t.cloudUrl ? (
                                        <button
                                            type="button"
                                            className="link-button"
                                            onClick={() => setViewingTaskId(t.taskId)}
                                        >
                                            View
                                        </button>
                                    ) : (
                                        '—'
                                    )}
                                </td>
                            </tr>
                        ))}
                        {tasks.length === 0 && !loading && (
                            <tr>
                                <td colSpan={7} className="muted">
                                    No tasks found.
                                </td>
                            </tr>
                        )}
                        {loading && tasks.length === 0 && (
                            <tr>
                                <td colSpan={7} className="muted">
                                    Loading…
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {pagination && pagination.total > 0 && (
                <div className="pagination">
                    <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={page <= 1 || loading}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                        Previous
                    </button>
                    <span className="muted">
                        Page {pagination.page} of {totalPages} · {pagination.total} task
                        {pagination.total === 1 ? '' : 's'}
                    </span>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={page >= totalPages || loading}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </button>
                </div>
            )}

            {viewingTaskId && (
                <MediaGallery
                    token={token}
                    taskId={viewingTaskId}
                    onClose={() => setViewingTaskId(null)}
                    onAuthExpired={handleAuthExpired}
                />
            )}
        </div>
    );
}
