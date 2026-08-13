import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin, ApiError } from '../services/api';

export function AdminLogin() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(event: FormEvent): Promise<void> {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const { token } = await adminLogin(username, password);
            localStorage.setItem('adminToken', token);
            navigate('/admin');
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Login failed');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="page page-centered">
            <div className="card">
                <h1>Admin Login</h1>
                <form onSubmit={handleSubmit} className="stack">
                    <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="input" autoFocus />
                    <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
                    {error && <p className="error-text">{error}</p>}
                    <button type="submit" className="btn btn-primary" disabled={submitting || !username || !password}>
                        {submitting ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>
            </div>
        </div>
    );
}
