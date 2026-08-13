import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { listAdminTasks } from '../services/api';
import { AdminTaskSummary, TaskStatus } from '../types';

const STATUS_LABEL: Record<TaskStatus, string> = {
    [TaskStatus.NotStarted]: 'Not Started',
    [TaskStatus.InProgress]: 'In Progress',
    [TaskStatus.Completed]: 'Completed',
};

export function AdminDashboard() {
    const token = localStorage.getItem('adminToken');
    const [tasks, setTasks] = useState<AdminTaskSummary[]>([]);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<'created_timestamp' | 'updated_timestamp'>('updated_timestamp');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;
        listAdminTasks(token, { search: search || undefined, sortBy, sortDir, page: 1, pageSize: 50 })
            .then((res) => setTasks(res.tasks))
            .catch((err: Error) => setError(err.message));
    }, [token, search, sortBy, sortDir]);

    if (!token) {
        return <Navigate to="/admin/login" replace />;
    }

    function handleLogout(): void {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin/login';
    }

    return (
        <div className="page">
            <header className="admin-header">
                <h1>All Tasks</h1>
                <button type="button" className="btn btn-secondary" onClick={handleLogout}>
                    Log out
                </button>
            </header>

            <div className="admin-controls">
                <input type="text" placeholder="Search by Task ID" value={search} onChange={(e) => setSearch(e.target.value)} className="input" />
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="input">
                    <option value="updated_timestamp">Updated date</option>
                    <option value="created_timestamp">Created date</option>
                </select>
                <select value={sortDir} onChange={(e) => setSortDir(e.target.value as typeof sortDir)} className="input">
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
                            <th>Updated</th>
                            <th>Media</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map((t) => (
                            <tr key={t.taskId}>
                                <td>{t.taskId}</td>
                                <td>{STATUS_LABEL[t.status]}</td>
                                <td>{t.address ?? '—'}</td>
                                <td>{t.agent || '—'}</td>
                                <td>{t.updatedTimestamp ? new Date(t.updatedTimestamp).toLocaleString() : '—'}</td>
                                <td>{t.cloudUrl ? <a href={t.cloudUrl} target="_blank" rel="noreferrer">View</a> : '—'}</td>
                            </tr>
                        ))}
                        {tasks.length === 0 && (
                            <tr>
                                <td colSpan={6} className="muted">
                                    No tasks found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
