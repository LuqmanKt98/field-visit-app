import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export function TaskEntry() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [taskId, setTaskId] = useState('');

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
        if (trimmed) {
            navigate(`/task/${encodeURIComponent(trimmed)}`);
        }
    }

    return (
        <div className="page page-centered">
            <div className="card">
                <h1>Field Visit</h1>
                <p className="muted">Enter your Task ID to begin.</p>
                <form onSubmit={handleSubmit} className="stack">
                    <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Task ID"
                        value={taskId}
                        onChange={(e) => setTaskId(e.target.value)}
                        autoFocus
                        className="input"
                    />
                    <button type="submit" className="btn btn-primary" disabled={!taskId.trim()}>
                        Submit
                    </button>
                </form>
                <a href="/admin/login" className="admin-link">
                    Admin login
                </a>
            </div>
        </div>
    );
}
